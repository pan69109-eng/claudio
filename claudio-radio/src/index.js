import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createServer } from 'http';
import { exec } from 'child_process';
import fs from 'fs';
import { config } from './config.js';
import { logger } from './logger.js';
import { errorHandler } from './errorHandler.js';
import { initDb, saveMessage, getMessages, savePlay, getRecentPlays, getNextTrack, getPreviousTrack, clearPlayHistory, clearMessages, savePlaylistPreference, getPlaylistPreference, setCurrentTrackByUri, setCurrentTrackById } from './db.js';
import { route } from './router.js';
import { buildContext } from './context.js';
import { ask } from './claude.js';
import { searchTracks, getPlaylistTracks, getUserPlaylists, getUserPlaylistTracks } from './spotify.js';
import { TTSPipeline } from './tts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const tts = new TTSPipeline();
tts.clearCache();

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
  'user-modify-playback-state',
  'playlist-read-private',
  'playlist-read-collaborative'
].join(' ');

// 中间件
app.use(express.json());
app.use(express.static(join(__dirname, '../public')));
app.use('/audio', express.static(join(__dirname, '../audio')));

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

    logger.info('Spotify用户授权成功', { scopes: getTokenScopes(userAccessToken) });
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
    const { uri, historyId } = req.body;
    if (!deviceId) {
      return res.status(400).json({ error: '播放器未就绪' });
    }

    const historyTrack = setCurrentTrackById(historyId) || (uri ? setCurrentTrackByUri(uri) : null);
    if (historyTrack) {
      logger.info('播放历史歌曲，已同步历史游标', { track: historyTrack.track_name, uri });
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

// 保存歌单偏好
app.post('/api/playlist-preference', (req, res) => {
  const { playlistId } = req.body;
  savePlaylistPreference(playlistId || null);
  res.json({ success: true });
});

// 关闭服务
app.post('/api/shutdown', (req, res) => {
  res.json({ success: true });
  logger.info('收到退出指令，正在关闭...');
  setTimeout(() => {
    exec(`taskkill /F /PID ${process.pid}`, () => process.exit(0));
  }, 300);
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

// 获取用户歌单列表
app.get('/api/user-playlists', async (req, res) => {
  try {
    const userToken = await getUserToken();
    const playlists = await getUserPlaylists(userToken);
    if (playlists.some(p => !p.trackCount)) {
      logger.warn('部分歌单 trackCount 为 0', {
        samples: playlists.filter(p => !p.trackCount).slice(0, 3).map(p => ({ id: p.id, name: p.name }))
      });
    }
    res.json({ playlists, playlistPreference: getPlaylistPreference() });
  } catch (err) {
    logger.error('获取用户歌单失败', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/user-playlists/:playlistId/tracks', async (req, res) => {
  try {
    const userToken = await getUserToken();
    const tracksHref = req.query.tracksHref || '';
    const tracks = await getUserPlaylistTracks(userToken, req.params.playlistId, tracksHref);
    res.json({
      count: tracks.length,
      sample: tracks.slice(0, 10)
    });
  } catch (err) {
    logger.error('诊断歌单歌曲读取失败', { error: err.message, playlistId: req.params.playlistId });
    res.status(500).json({ error: err.message, playlistId: req.params.playlistId });
  }
});

// 预生成阶段1：仅选歌（不生成过渡词/TTS）
app.post('/api/select-next', async (req, res) => {
  try {
    const { currentTrack, playlistId, tracksHref } = req.body;
    let nextTrack = await selectNextTrackForTransition(currentTrack, playlistId, tracksHref || '');

    if (!nextTrack) {
      const searchQuery = currentTrack?.artist || 'popular';
      const tracks = await searchTracks(searchQuery);
      const filtered = tracks.filter(t => t.id !== currentTrack?.id);
      if (filtered.length > 0) {
        nextTrack = filtered[Math.floor(Math.random() * filtered.length)];
      }
    }

    res.json({ nextTrack });
  } catch (err) {
    logger.error('select-next失败', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// 预生成阶段2：生成过渡词 + TTS（不选歌）
app.post('/api/generate-speech-tts', async (req, res) => {
  try {
    const { currentTrack, nextTrack } = req.body;

    const recentHistory = getRecentPlays(5);
    const envContext = { time: new Date().toLocaleTimeString('zh-CN') };
    const { systemPrompt } = buildContext('', envContext, recentHistory);

    const llmPrompt = `当前歌曲刚播放完毕：${currentTrack?.name || '未知'} - ${currentTrack?.artist || '未知'}
下一首歌曲：${nextTrack?.name || '未知'} - ${nextTrack?.artist || '未知'}

请作为电台DJ，用温暖自然的语气：
1. 简短总结上一首歌（1-2句话）
2. 生成过渡词，自然地引出下一首歌
3. 介绍下一首歌的特点或亮点

回复要简洁，控制在3-4句话，有陪伴感。`;

    let speech = '';
    try {
      const response = await ask(llmPrompt, { systemPrompt });
      speech = response.speech || response.response_type === 'speak' ? (response.speech || '') : JSON.stringify(response);
    } catch (e) {
      logger.error('generate-speech-tts LLM生成失败', { error: e.message });
      speech = `接下来为你播放：${nextTrack?.name || '未知'} - ${nextTrack?.artist || '未知'}`;
    }

    let ttsAudioUrl = null;
    if (speech) {
      try {
        ttsAudioUrl = await tts.generate(speech);
      } catch (e) {
        logger.error('generate-speech-tts TTS生成失败', { error: e.message });
      }
    }

    res.json({ speech, ttsAudioUrl });
  } catch (err) {
    logger.error('generate-speech-tts失败', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// 用户主动点击下一首（直接播放，不经过 LLM/TTS）
app.post('/api/next-track', async (req, res) => {
  try {
    const { currentTrack, playlistId, tracksHref } = req.body;

    let nextTrack = getNextTrack();
    let shouldSavePlay = false;

    if (nextTrack?.uri) {
      logger.info('下一首使用播放历史中的实际下一首', { track: nextTrack.track_name, uri: nextTrack.uri });
      return res.json({
        nextTrack: {
          id: nextTrack.track_id,
          name: nextTrack.track_name,
          artist: nextTrack.artist,
          albumArt: nextTrack.albumArt,
          uri: nextTrack.uri
        },
        speech: null,
        ttsAudioUrl: null,
        ready: true,
        source: 'history'
      });
    }

    nextTrack = null;

    // 1. 历史中没有合理的下一首时，从用户歌单中随机抽取
    if (playlistId) {
      try {
        const userToken = await getUserToken();
        const tracks = await getUserPlaylistTracks(userToken, playlistId, tracksHref || '');
        logger.info('手动下一首读取歌单成功', { playlistId, count: tracks.length });
        if (tracks.length > 0) {
          const filtered = tracks.filter(t => t.id !== currentTrack?.id);
          nextTrack = (filtered.length > 0 ? filtered : tracks)[Math.floor(Math.random() * (filtered.length > 0 ? filtered.length : tracks.length))];
          shouldSavePlay = true;
        }
      } catch (e) {
        logger.warn('手动下一首读取选定歌单失败', { error: e.message, playlistId });
        const userMsg = (tracksHref && tracksHref.includes('/me/tracks'))
          ? '喜欢的歌曲歌单暂不支持连播，请选择其他歌单'
          : '选定歌单读取失败';
        return res.status(502).json({
          error: userMsg,
          playlistId,
          source: 'playlist-error'
        });
      }
    }

    // 2. 如果没有选定歌单，再降级到搜索
    if (!nextTrack) {
      const searchQuery = currentTrack?.artist || 'popular';
      const tracks = await searchTracks(searchQuery);
      const filtered = tracks.filter(t => t.id !== currentTrack?.id);
      if (filtered.length > 0) {
        nextTrack = filtered[Math.floor(Math.random() * filtered.length)];
        shouldSavePlay = true;
      }
    }

    // 3. 只有新挑选的歌曲才追加到播放历史；历史中的下一首只移动游标，不重复入库
    if (nextTrack && shouldSavePlay) {
      savePlay(nextTrack);
    }

    res.json({
      nextTrack,
      speech: null,
      ttsAudioUrl: null,
      ready: true,
      source: shouldSavePlay ? 'random' : 'none'
    });
  } catch (err) {
    logger.error('获取下一首歌失败', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// 歌曲自然结束时的自动连播（获取下一首 + 生成过渡词 + TTS）
app.post('/api/auto-next', async (req, res) => {
  try {
    const { currentTrack, playlistId, preGenerated, tracksHref } = req.body;

    // 如果有预生成的数据，直接使用
    if (preGenerated && preGenerated.nextTrack) {
      // 保存播放记录
      savePlay(preGenerated.nextTrack);
      res.json({
        nextTrack: preGenerated.nextTrack,
        speech: preGenerated.speech || null,
        ttsAudioUrl: preGenerated.ttsAudioUrl || null,
        ready: true
      });
      return;
    }

    // 1. 由大模型判断下一首适合的歌，再从用户歌单中挑选
    let nextTrack = await selectNextTrackForTransition(currentTrack, playlistId, tracksHref || '');
    logger.info('auto-next 开始', { playlistId, hasToken: !!userAccessToken });
    if (!playlistId) {
      logger.info('auto-next: 未选择歌单，使用搜索');
    }

    if (!nextTrack) {
      const searchQuery = currentTrack?.artist || 'popular';
      const tracks = await searchTracks(searchQuery);
      const filtered = tracks.filter(t => t.id !== currentTrack?.id);
      if (filtered.length > 0) {
        nextTrack = filtered[Math.floor(Math.random() * filtered.length)];
      }
    }

    if (!nextTrack) {
      return res.json({ nextTrack: null, speech: '没有找到下一首歌曲', ttsAudioUrl: null, ready: false });
    }

    // 2. 生成过渡词
    const recentHistory = getRecentPlays(5);
    const envContext = { time: new Date().toLocaleTimeString('zh-CN') };
    const { systemPrompt } = buildContext('', envContext, recentHistory);

    const llmPrompt = `当前歌曲刚播放完毕：${currentTrack?.name || '未知'} - ${currentTrack?.artist || '未知'}
下一首歌曲：${nextTrack.name} - ${nextTrack.artist}

请作为电台DJ，用温暖自然的语气：
1. 简短总结上一首歌（1-2句话）
2. 生成过渡词，自然地引出下一首歌
3. 介绍下一首歌的特点或亮点

回复要简洁，控制在3-4句话，有陪伴感。`;

    let speech = '';
    try {
      const response = await ask(llmPrompt, { systemPrompt });
      speech = response.speech || response.response_type === 'speak' ? (response.speech || '') : JSON.stringify(response);
    } catch (e) {
      logger.error('auto-next LLM生成失败', { error: e.message });
      speech = `接下来为你播放：${nextTrack.name} - ${nextTrack.artist}`;
    }

    // 3. 生成 TTS
    let ttsAudioUrl = null;
    if (speech) {
      try {
        ttsAudioUrl = await tts.generate(speech);
      } catch (e) {
        logger.error('auto-next TTS生成失败', { error: e.message });
      }
    }

    // 4. 保存播放记录
    savePlay(nextTrack);

    res.json({
      nextTrack,
      speech,
      ttsAudioUrl,
      ready: true
    });
  } catch (err) {
    logger.error('auto-next失败', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

async function selectNextTrackForTransition(currentTrack, playlistId, tracksHref = '') {
  if (!playlistId) return null;

  // 1. 先拉歌单曲目（不依赖LLM）
  let tracks;
  try {
    const userToken = await getUserToken();
    tracks = await getUserPlaylistTracks(userToken, playlistId, tracksHref);
    logger.info('大模型选歌：获取歌单歌曲成功', { playlistId, count: tracks.length });
  } catch (e) {
    logger.warn('大模型选歌：获取歌单失败', { error: e.message, playlistId });
    return null;
  }

  if (!tracks || tracks.length === 0) return null;

  const candidates = [...tracks]
    .filter(t => t.id !== currentTrack?.id)
    .sort(() => Math.random() - 0.5)
    .slice(0, 60);

  if (candidates.length === 0) return null;

  // 2. 尝试LLM选歌，失败就随机
  try {
    const candidateText = candidates
      .map((track, index) => `${index + 1}. id=${track.id} | ${track.name} - ${track.artist}`)
      .join('\n');

    const prompt = `当前刚播放完的歌曲：${currentTrack?.name || '未知'} - ${currentTrack?.artist || '未知'}

候选歌单歌曲：
${candidateText}

请判断下一首适合衔接的歌曲。只返回 JSON，不要输出其他文字：
{"trackId":"候选歌曲id","reason":"一句话说明选择理由","keywords":["风格或情绪关键词"]}`;

    const response = await ask(prompt, {
      systemPrompt: '你是个人电台的选曲助手，负责从候选歌单中选择最适合自然衔接当前歌曲的下一首。'
    });

    const trackId = response.trackId || response.id || response.track_id;
    const selected = candidates.find(track => track.id === trackId || track.uri === trackId);
    if (selected) {
      logger.info('大模型选歌成功', { track: selected.name, artist: selected.artist, reason: response.reason });
      return selected;
    }

    const keywords = Array.isArray(response.keywords) ? response.keywords.join(' ') : String(response.keywords || response.reason || '');
    const keywordSelected = findTrackByKeywords(candidates, keywords);
    if (keywordSelected) {
      logger.info('大模型关键词选歌成功', { track: keywordSelected.name, artist: keywordSelected.artist, keywords });
      return keywordSelected;
    }

    logger.warn('大模型选歌结果未命中候选歌曲，随机降级', { trackId, keywords });
  } catch (e) {
    logger.warn('大模型选歌失败，歌单内随机降级', { error: e.message, playlistId });
  }

  // 3. 降级：歌单内随机选
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  logger.info('歌单内随机选歌', { playlistId, picked: pick.name });
  return pick;
}

function findTrackByKeywords(tracks, keywords) {
  const terms = String(keywords || '')
    .toLowerCase()
    .split(/[\s,，、/|]+/)
    .map(term => term.trim())
    .filter(term => term.length >= 2);

  if (terms.length === 0) return null;

  let bestTrack = null;
  let bestScore = 0;
  for (const track of tracks) {
    const haystack = `${track.name} ${track.artist} ${track.album || ''}`.toLowerCase();
    const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      bestTrack = track;
    }
  }

  return bestTrack;
}

// 解析 JWT 获取 scopes
function getTokenScopes(token) {
  try {
    const payload = token.split('.')[1];
    const decoded = JSON.parse(Buffer.from(payload, 'base64').toString());
    return decoded.scope || '';
  } catch (e) {
    return '';
  }
}

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

  logger.info('handleMusic开始', { intent, match });

  if (intent === 'playlist') {
    const playlistsData = JSON.parse(fs.readFileSync(join(__dirname, '../data/playlists.json'), 'utf-8'));
    const playlist = playlistsData.playlists?.find(p => p.name?.includes(match));
    if (playlist?.spotifyId) {
      tracks = await getPlaylistTracks(playlist.spotifyId);
    }
  } else if (intent === 'search' || intent === 'mood' || intent === 'playSearch') {
    const query = normalizeMusicQuery(match) || match;
    tracks = await searchTracks(query);
  }

  if (tracks.length > 0) {
    savePlay(tracks[0]);
  }

  // 使用LLM生成有感情的回复
  const recentHistory = getRecentPlays(5);
  const envContext = { time: new Date().toLocaleTimeString('zh-CN') };
  const { systemPrompt } = buildContext(match, envContext, recentHistory);

  // 构建提示词，让LLM基于搜索结果生成回复
  let llmPrompt = `用户想要播放音乐：${match}\n`;
  if (tracks.length > 0) {
    llmPrompt += `搜索到的歌曲：${tracks.slice(0, 5).map(t => `${t.name} - ${t.artist}`).join(', ')}\n`;
    llmPrompt += `现在播放：${tracks[0].name} - ${tracks[0].artist}\n`;
  } else {
    llmPrompt += `没有找到相关歌曲\n`;
  }
  llmPrompt += `请用电台主持人的风格回复，介绍歌曲特点，回复要简洁有温度。`;

  let speech = '';
  try {
    const response = await ask(llmPrompt, { systemPrompt });
    speech = response.speech || response.response_type === 'speak' ? (response.speech || '') : JSON.stringify(response);
  } catch (e) {
    logger.error('handleMusic LLM生成失败', { error: e.message });
    // 降级到简单回复
    if (tracks.length > 0) {
      speech = `为你搜索到${tracks.length}首相关歌曲，现在播放：${tracks[0].name}，来自 ${tracks[0].artist}`;
    } else {
      speech = `没有找到相关歌曲`;
    }
  }

  if (!deviceId && tracks.length > 0) {
    speech += '。但播放器设备还未就绪，请先等待 Spotify 连接完成';
  }

  // TTS 生成
  let ttsAudioUrl = null;
  if (speech) {
    try {
      ttsAudioUrl = await tts.generate(speech);
    } catch (e) {
      logger.error('handleMusic TTS生成失败', { error: e.message });
    }
  }

  return {
    intent,
    tracks,
    speech,
    ttsAudioUrl,
    track: tracks[0] ? { name: tracks[0].name, artist: tracks[0].artist, albumArt: tracks[0].albumArt, uri: tracks[0].uri } : null
  };
}

async function handleLLM(payload) {
  const { text } = payload;
  const recentHistory = getRecentPlays(5);
  const envContext = { time: new Date().toLocaleTimeString('zh-CN') };
  const { systemPrompt } = buildContext(text, envContext, recentHistory);

  const response = await ask(text, { systemPrompt });

  saveMessage('assistant', JSON.stringify(response));

  // TTS 集成
  if (response.speech && response.should_speak !== false) {
    try {
      response.ttsAudioUrl = await tts.generate(response.speech);
    } catch (e) {
      logger.error('handleLLM TTS生成失败', { error: e.message });
    }
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
  clearMessages();
  clearPlayHistory();

  server.listen(config.app.port, () => {
    const url = `http://localhost:${config.app.port}`;
    logger.info('Claudio电台启动', { port: config.app.port });
    exec(`start ${url}`);
  });
}

main();
