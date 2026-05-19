import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createServer } from 'http';
import fs from 'fs';
import { config } from './config.js';
import { logger } from './logger.js';
import { errorHandler } from './errorHandler.js';
import { initDb, saveMessage, getMessages, savePlay, getRecentPlays, getNextTrack, getPreviousTrack, clearPlayHistory } from './db.js';
import { route } from './router.js';
import { buildContext } from './context.js';
import { ask } from './claude.js';
import { searchTracks, getPlaylistTracks } from './spotify.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);

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

// 获取用户token（供Web Playback SDK使用，支持自动刷新）
app.get('/api/token', async (req, res) => {
  try {
    const token = await getUserToken();
    res.json({ token });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
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

    const token = await getUserToken();
    const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
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

// 播放命令API
app.post('/api/command', async (req, res) => {
  try {
    const { command } = req.body;
    if (!['play', 'pause', 'next', 'previous'].includes(command)) {
      return res.status(400).json({ error: '未知命令' });
    }
    const result = await handleCommand({ command });
    res.json(result);
  } catch (err) {
    logger.error('命令处理失败', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// 播放历史API
app.get('/api/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const history = getRecentPlays(limit);
  res.json({ history });
});

// 清空播放历史
app.delete('/api/history', (req, res) => {
  clearPlayHistory();
  res.json({ success: true });
});

// 聊天API
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: '消息不能为空' });
    }

    const result = await handleInput(message);
    res.json(result);
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
  logger.info('handleCommand 开始', { command, deviceId });

  const messages = {
    play: '开始播放音乐',
    pause: '已暂停播放',
    next: '切换到下一首',
    previous: '切换到上一首',
  };
  let speech = messages[command] || '收到指令';
  let track = null;

  if (!deviceId) {
    speech = '播放器设备还未就绪，请先等待 Spotify 连接完成';
    logger.warn('设备未就绪', { command });
    return { command, speech, code: 'DEVICE_NOT_READY' };
  }

  try {
    const token = await getUserToken();

    // 对于 next/previous，使用本地播放历史
    if (command === 'next') {
      track = getNextTrack();
      if (track && track.uri) {
        logger.info('播放下一首', { track: track.track_name, uri: track.uri });
        const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ uris: [track.uri] })
        });
        if (response.ok) {
          speech = `正在播放：${track.track_name} - ${track.artist}`;
        } else {
          speech = '切歌失败';
        }
      } else {
        speech = '没有可播放的歌曲';
      }
    } else if (command === 'previous') {
      track = getPreviousTrack();
      if (track && track.uri) {
        logger.info('播放上一首', { track: track.track_name, uri: track.uri });
        const response = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ uris: [track.uri] })
        });
        if (response.ok) {
          speech = `正在播放：${track.track_name} - ${track.artist}`;
        } else {
          speech = '切歌失败';
        }
      } else {
        speech = '没有上一首歌曲';
      }
    } else {
      // pause/play 继续使用 Spotify API
      const endpoints = {
        pause: { url: 'https://api.spotify.com/v1/me/player/pause', method: 'PUT' },
        play: { url: 'https://api.spotify.com/v1/me/player/play', method: 'PUT' },
      };
      const ep = endpoints[command];
      if (ep) {
        logger.info('调用Spotify API', { url: ep.url, method: ep.method, deviceId });
        const response = await fetch(`${ep.url}?device_id=${deviceId}`, {
          method: ep.method,
          headers: { 'Authorization': `Bearer ${token}` }
        });
        logger.info('Spotify API 响应', { status: response.status, ok: response.ok });
        if (!response.ok) {
          speech = `操作失败 (${response.status})`;
        }
      }
    }
  } catch (e) {
    logger.error('播放控制失败', { error: e.message, stack: e.stack });
    speech = `操作失败: ${e.message}`;
  }

  return { command, speech, track: track ? { name: track.track_name, artist: track.artist, albumArt: track.albumArt } : null };
}

function normalizeMusicQuery(query) {
  return String(query || '')
    .replace(/^(一首|一曲|一个|一些|点|首)\s*/u, '')
    .replace(/(的)?(歌|歌曲|音乐)$/u, '')
    .trim();
}

async function handleMusic(payload) {
  const { intent, match } = payload;
  let tracks = [];
  let speech = '';

  logger.info('handleMusic开始', { intent, match });

  if (intent === 'playlist') {
    const playlistsData = JSON.parse(fs.readFileSync(join(__dirname, '../data/playlists.json'), 'utf-8'));
    const playlist = playlistsData.playlists?.find(p => p.name?.includes(match));
    if (playlist?.spotifyId) {
      tracks = await getPlaylistTracks(playlist.spotifyId);
      speech = `正在播放歌单：${playlist.name}`;
    } else {
      speech = `没有找到名为"${match}"的歌单`;
    }
  } else if (intent === 'search' || intent === 'mood' || intent === 'playSearch') {
    const query = normalizeMusicQuery(match) || match;
    tracks = await searchTracks(query);
    speech = `为你搜索到${tracks.length}首相关歌曲`;
  }

  if (tracks.length > 0) {
    savePlay(tracks[0]);
    speech += `，现在播放：${tracks[0].name}，来自 ${tracks[0].artist}`;

    if (!deviceId) {
      speech += '。但播放器设备还未就绪，请先等待 Spotify 连接完成';
    } else if (tracks[0].uri) {
      try {
        const token = await getUserToken();
        const playResponse = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ uris: [tracks[0].uri] })
        });
        logger.info('Spotify播放响应', { status: playResponse.status });
      } catch (e) {
        logger.error('自动播放失败', { error: e.message });
      }
    }
  }

  return { intent, tracks, speech, track: tracks[0] ? { name: tracks[0].name, artist: tracks[0].artist, albumArt: tracks[0].albumArt } : null };
}

async function handleLLM(payload) {
  const { text } = payload;
  const recentHistory = getRecentPlays(5);
  const envContext = { time: new Date().toLocaleTimeString('zh-CN') };
  const { systemPrompt } = buildContext(text, envContext, recentHistory);

  const response = await ask(text, { systemPrompt });

  saveMessage('assistant', JSON.stringify(response));

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
