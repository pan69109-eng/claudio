import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createServer } from 'http';
import { config } from './config.js';
import { logger } from './logger.js';
import { errorHandler } from './errorHandler.js';
import { initDb, saveMessage, getMessages, savePlay, getRecentPlays } from './db.js';
import { route } from './router.js';
import { buildContext } from './context.js';
import { ask } from './claude.js';
import { TTSPipeline } from './tts.js';
import { searchTracks } from './spotify.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const tts = new TTSPipeline();

// 播放器状态
let userAccessToken = null;
let userRefreshToken = null;
let userTokenExpiry = 0;
let deviceId = null;

const REDIRECT_URI = `http://127.0.0.1:${config.app.port}/auth/callback`;
const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state'
].join(' ');

// 中间件
app.use(express.json());
app.use(express.static(join(__dirname, '../public')));

// 首页 - 跳转到登录或播放器
app.get('/', (req, res) => {
  if (userAccessToken) {
    res.redirect('/player.html');
  } else {
    res.redirect('/login.html');
  }
});

// Spotify OAuth 登录
app.get('/auth/login', (req, res) => {
  const authURL = `https://accounts.spotify.com/authorize?` +
    `client_id=${config.spotify.clientId}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&show_dialog=true`;

  logger.info('跳转Spotify授权', { authURL });
  res.redirect(authURL);
});

// Spotify OAuth 回调
app.get('/auth/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    logger.error('Spotify授权失败', { error });
    return res.redirect('/login.html?error=' + encodeURIComponent(error));
  }

  try {
    // 用code换取token
    const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${config.spotify.clientId}:${config.spotify.clientSecret}`).toString('base64')}`
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI
      })
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      throw new Error(tokenData.error_description || tokenData.error);
    }

    userAccessToken = tokenData.access_token;
    userRefreshToken = tokenData.refresh_token;
    userTokenExpiry = Date.now() + (tokenData.expires_in - 60) * 1000;

    logger.info('Spotify用户授权成功');
    res.redirect('/player.html');
  } catch (err) {
    logger.error('Token获取失败', { error: err.message });
    res.redirect('/login.html?error=' + encodeURIComponent(err.message));
  }
});

// 获取用户token（供Web Playback SDK使用）
app.get('/api/token', (req, res) => {
  if (!userAccessToken) {
    return res.status(401).json({ error: '未登录' });
  }

  // 如果token快过期了，需要刷新
  if (Date.now() >= userTokenExpiry) {
    return res.status(401).json({ error: 'token过期，请重新登录' });
  }

  res.json({ token: userAccessToken });
});

// 检查登录状态
app.get('/api/auth-status', (req, res) => {
  res.json({
    loggedIn: !!userAccessToken,
    tokenValid: userAccessToken && Date.now() < userTokenExpiry
  });
});

// 设备就绪
app.post('/api/device-ready', (req, res) => {
  deviceId = req.body.deviceId;
  logger.info('播放器设备就绪', { deviceId });
  res.json({ success: true });
});

// 播放状态更新
app.post('/api/playback-state', (req, res) => {
  logger.info('播放状态更新', req.body);
  res.json({ success: true });
});

// 播放器状态
app.get('/api/player-status', (req, res) => {
  res.json({
    deviceId,
    ready: !!deviceId,
    loggedIn: !!userAccessToken
  });
});

// 播放歌曲API
app.post('/api/play', async (req, res) => {
  try {
    const { uri } = req.body;
    if (!deviceId) {
      return res.status(400).json({ error: '播放器未就绪' });
    }
    if (!userAccessToken) {
      return res.status(401).json({ error: '未登录' });
    }

    const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${userAccessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ uris: uri ? [uri] : [] })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || '播放失败');
    }

    logger.info('播放命令已发送', { uri });
    res.json({ success: true });
  } catch (err) {
    logger.error('播放API错误', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// 登出
app.post('/auth/logout', (req, res) => {
  userAccessToken = null;
  userRefreshToken = null;
  userTokenExpiry = 0;
  deviceId = null;
  res.json({ success: true });
});

// 聊天API
app.post('/api/chat', async (req, res) => {
  try {
    logger.info('API请求到达', { method: req.method, headers: req.headers['content-type'] });
    const { message } = req.body;
    logger.info('解析消息', { message, bodyKeys: Object.keys(req.body || {}) });
    if (!message) {
      return res.status(400).json({ error: '消息不能为空' });
    }

    logger.info('收到聊天消息', { message });

    // 路由分发
    const routed = route(message);
    logger.info('路由分发结果', { type: routed.type, payload: routed.payload });

    if (routed.type === 'music') {
      const { intent, match } = routed.payload;
      logger.info('进入music分支', { intent, match });
      let tracks = [];
      let speech = '';

      if (intent === 'search' || intent === 'mood' || intent === 'playSearch') {
        logger.info('开始搜索', { match });
        tracks = await searchTracks(match);
        logger.info('搜索完成', { trackCount: tracks.length });
        speech = `为你搜索到${tracks.length}首相关歌曲`;
      }

      if (tracks.length > 0) {
        savePlay(tracks[0]);
        speech += `，现在播放：${tracks[0].name}，来自 ${tracks[0].artist}`;
        logger.info('准备自动播放', { uri: tracks[0].uri, deviceId, hasToken: !!userAccessToken });

        // 自动播放
        if (tracks[0].uri && deviceId && userAccessToken) {
          const playResponse = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${userAccessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ uris: [tracks[0].uri] })
          });
          logger.info('Spotify播放响应', { status: playResponse.status });
        }

        logger.info('返回结果', { speech, track: tracks[0].name });
        res.json({
          speech,
          track: { name: tracks[0].name, artist: tracks[0].artist }
        });
      } else {
        logger.info('没有找到歌曲');
        res.json({ speech: '没有找到相关歌曲' });
      }
    } else if (routed.type === 'command') {
      const { command } = routed.payload;
      const messages = {
        play: '开始播放音乐',
        pause: '已暂停播放',
        next: '切换到下一首',
      };
      const speech = messages[command] || '收到指令';
      await tts.speak(speech);
      res.json({ speech });
    } else {
      // LLM对话
      const recentHistory = getRecentPlays(5);
      const envContext = { time: new Date().toLocaleTimeString('zh-CN') };
      const { systemPrompt } = buildContext(message, envContext, recentHistory);
      const response = await ask(message, { systemPrompt });

      let speech = response.speech || '';
      if (response.should_speak !== false && speech) {
        await tts.speak(speech);
      }

      res.json({ speech, response: JSON.stringify(response) });
    }
  } catch (err) {
    logger.error('聊天处理失败', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// 内部函数：获取用户token
async function getUserToken() {
  if (userAccessToken && Date.now() < userTokenExpiry) {
    return userAccessToken;
  }
  if (userRefreshToken) {
    // 刷新token
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${config.spotify.clientId}:${config.spotify.clientSecret}`).toString('base64')}`
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: userRefreshToken
      })
    });
    const data = await response.json();
    userAccessToken = data.access_token;
    userTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
    if (data.refresh_token) {
      userRefreshToken = data.refresh_token;
    }
    return userAccessToken;
  }
  throw new Error('未登录');
}

export async function handleInput(userInput) {
  try {
    const routed = route(userInput);
    logger.info('路由结果', routed);

    saveMessage('user', userInput);

    if (routed.type === 'command') {
      return handleCommand(routed.payload);
    } else if (routed.type === 'music') {
      return handleMusic(routed.payload);
    } else {
      return handleLLM(routed.payload);
    }
  } catch (err) {
    const error = errorHandler(err, { input: userInput });
    logger.error('处理失败', error);
    return error;
  }
}

async function handleCommand(payload) {
  const { command } = payload;
  const messages = {
    play: '开始播放音乐',
    pause: '已暂停播放',
    next: '切换到下一首',
  };
  const speech = messages[command] || '收到指令';
  await tts.speak(speech);
  return { command, speech };
}

async function handleMusic(payload) {
  const { intent, match } = payload;
  let tracks = [];
  let speech = '';

  logger.info('handleMusic开始', { intent, match });

  if (intent === 'search' || intent === 'mood' || intent === 'playSearch') {
    tracks = await searchTracks(match);
    speech = `为你搜索到${tracks.length}首相关歌曲`;
  }

  logger.info('搜索到的歌曲', { count: tracks.length, first: tracks[0]?.name });

  if (tracks.length > 0) {
    savePlay(tracks[0]);
    speech += `，现在播放：${tracks[0].name}，来自 ${tracks[0].artist}`;
    logger.info('准备自动播放', { uri: tracks[0].uri, deviceId, hasToken: !!userAccessToken });

    // 自动播放（使用用户token）
    if (tracks[0].uri && deviceId && userAccessToken) {
      logger.info('发送播放请求到Spotify', { uri: tracks[0].uri, deviceId });
      const playResponse = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${userAccessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ uris: [tracks[0].uri] })
      });
      logger.info('Spotify播放响应', { status: playResponse.status, ok: playResponse.ok });
      if (!playResponse.ok) {
        const errText = await playResponse.text();
        logger.error('播放失败', { status: playResponse.status, error: errText });
      }
    } else {
      logger.warn('无法自动播放', { missing: { uri: !tracks[0].uri, deviceId: !deviceId, token: !userAccessToken } });
    }
  }

  await tts.speak(speech);
  return { intent, tracks, speech };
}

async function handleLLM(payload) {
  const { text } = payload;
  const recentHistory = getRecentPlays(5);
  const envContext = { time: new Date().toLocaleTimeString('zh-CN') };
  const { systemPrompt } = buildContext(text, envContext, recentHistory);

  const response = await ask(text, { systemPrompt });

  saveMessage('assistant', JSON.stringify(response));

  if (response.should_speak !== false && response.speech) {
    await tts.speak(response.speech);
  }

  if (response.actions) {
    for (const action of response.actions) {
      if (action.type === 'play' && action.track_id) {
        const tracks = await searchTracks(action.query || action.track_id);
        if (tracks.length > 0) {
          savePlay(tracks[0]);
        }
      }
    }
  }

  return response;
}

async function main() {
  await initDb();

  server.listen(config.app.port, () => {
    logger.info('Claudio电台启动', { port: config.app.port });
    logger.info('访问: http://localhost:' + config.app.port);
  });
}

main();