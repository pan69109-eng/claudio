import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { exec } from 'child_process';
import fs from 'fs';
import { config } from './config.js';
import { logger } from './logger.js';
import { errorHandler } from './errorHandler.js';
import { initDb, saveMessage, getMessages, savePlay, getRecentPlays, getNextTrack, getPreviousTrack, clearPlayHistory, clearMessages, savePlaylistPreference, getPlaylistPreference, setCurrentTrackByUri, setCurrentTrackById } from './db.js';
import { route } from './router.js';
import { buildContext } from './context.js';
import { ask } from './llm.js';
import { compute } from './brain.js';
import { searchTracks, getPlaylistTracks, getUserPlaylists, getUserPlaylistTracks, getAllPlaylistTracks } from './music/index.js';
import { fetchWithRetry, readSpotifyError } from './spotify.js';
import { TTSPipeline } from './tts.js';
import { getWeather } from './weather.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const tts = new TTSPipeline();
tts.clearCache();

// 播放器状态
let userAccessToken = null;
let userRefreshToken = null;
let userTokenExpiry = 0;
let deviceId = null;
let lastTransitionTime = null; // 上次过渡词生成时间，用于整点提醒
let cachedPlaylistId = null;
let cachedTracks = [];        // 缓存的全量歌单（上限500首）

// 天气状态
let lastWeather = null; // 上次获取的天气数据
let lastWeatherTime = 0; // 上次获取天气的时间
let isFirstPlay = true; // 是否是首次播放

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

// 播放歌曲API
app.post('/api/play', async (req, res) => {
  try {
    const { uri, historyId, track } = req.body;
    if (!deviceId) {
      return res.status(400).json({ error: '播放器未就绪' });
    }

    const historyTrack = setCurrentTrackById(historyId) || (uri ? setCurrentTrackByUri(uri) : null);
    if (historyTrack) {
      logger.info('播放历史歌曲，已同步历史游标', { track: historyTrack.track_name, uri });
    } else if (track && uri) {
      // 新歌曲首次播放，保存到播放历史
      savePlay({ id: track.id, name: track.name, artist: track.artist, uri, albumArt: track.albumArt });
    }

    const token = await getUserToken();
    const response = await fetchWithRetry(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ uris: uri ? [uri] : [] })
    });

    if (!response.ok) {
      const detail = await readSpotifyError(response);
      throw new Error(detail || '播放失败');
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
    const playlists = await getUserPlaylists({ userToken });
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

// 分析用户音乐品味
app.post('/api/analyze-taste', async (req, res) => {
  try {
    const { playlistId, playlistName, tracksHref, force } = req.body;
    const userToken = await getUserToken();

    // 1. 检查是否需要更新
    const metaPath = join(__dirname, '../data/taste-meta.json');
    const tastePath = join(__dirname, '../data/taste.md');

    const tasteExists = fs.existsSync(tastePath) && fs.readFileSync(tastePath, 'utf-8').trim().length > 0;
    if (!force && fs.existsSync(metaPath) && tasteExists) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      const daysSinceUpdate = (Date.now() - meta.updatedAt) / (1000 * 60 * 60 * 24);

      // 先获取当前歌单总数
      const { total: currentTotal } = await getAllPlaylistTracks(playlistId, {
        userToken, tracksHref, maxTracks: 1
      });

      const trackCountDiff = Math.abs(currentTotal - meta.trackCount);
      const needsUpdate = meta.playlistId !== playlistId || trackCountDiff > 10 || daysSinceUpdate > 10;

      if (!needsUpdate) {
        logger.info('Taste 无需更新', {
          playlistId,
          savedTrackCount: meta.trackCount,
          currentTotal,
          daysSinceUpdate: Math.round(daysSinceUpdate)
        });
        const taste = fs.readFileSync(tastePath, 'utf-8');
        return res.json({
          success: true,
          updated: false,
          reason: '无需更新',
          trackCount: meta.trackCount,
          taste
        });
      }

      logger.info('Taste 需要更新', {
        playlistId,
        trackCountDiff,
        daysSinceUpdate: Math.round(daysSinceUpdate)
      });
    }

    // 2. 分页获取整个歌单（上限 500 首）
    const { tracks, total } = await getAllPlaylistTracks(playlistId, {
      userToken, tracksHref, maxTracks: 500
    });

    if (tracks.length === 0) {
      return res.status(400).json({ error: '歌单为空' });
    }

    logger.info('开始分析音乐品味', { playlistId, trackCount: tracks.length, totalInPlaylist: total });

    // 3. 基于歌曲元数据的 LLM 品味分析
    try {
      const songList = tracks.map((t, i) => `${i + 1}. ${t.name} - ${t.artist}（专辑：${t.album}）`).join('\n');

      const prompt = `你是一位专业的音乐数据分析师。请根据以下 ${tracks.length} 首歌曲的列表（歌名、艺术家、专辑），分析用户的音乐品味画像。

## 歌曲列表
${songList}

## 请生成以下维度的分析（markdown 格式）

### 1. 整体画像（1-2句话总结）

### 2. 艺术家偏好
- 出现频率最高的艺术家 TOP10
- 艺术家集中度分析

### 3. 曲风推断
- 根据艺术家和歌名推断主要曲风
- 是否偏向华语流行/摇滚/电子/嘻哈/R&B/民谣/ACG等

### 4. 地域/语言特征
- 是否偏好华语/英语/日韩等特定语言音乐

### 5. 情绪/氛围推断
- 整体情绪基调
- 偏好：安静/动感/激烈/治愈等

### 6. 风格标签（3-5个关键词）

### 7. 选歌建议
基于以上画像，给出 3-5 条选歌策略

只返回分析结果，不要输出其他文字。`;

      const context = {
        systemPrompt: '你是一位专业的音乐数据分析师，擅长从歌曲元信息中推断用户的音乐品味。请用中文回答，分析要详尽专业。'
      };
      const result = await ask(prompt, context);

      const tasteContent = `# 音乐品味画像

> 基于歌单「${playlistName || '未知歌单'}」${tracks.length} 首歌曲分析

${result.speech || result}

---
*更新时间：${new Date().toLocaleString('zh-CN')}*
*歌曲总数：${total} 首（分析 ${tracks.length} 首）*`;

      fs.writeFileSync(tastePath, tasteContent, 'utf-8');

      const meta = {
        playlistId,
        playlistName: playlistName || '未知歌单',
        trackCount: total,
        analyzedCount: tracks.length,
        updatedAt: Date.now()
      };
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');

      logger.info('音乐品味分析完成', { playlistId, trackCount: tracks.length, total });
      res.json({ success: true, updated: true, trackCount: tracks.length, taste: tasteContent });
    } catch (tasteErr) {
      logger.warn('音乐品味分析失败，跳过 taste', { error: tasteErr.message });
      res.json({ success: true, updated: false, reason: tasteErr.message, trackCount: tracks.length });
    }
  } catch (err) {
    logger.error('分析音乐品味失败', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// 预生成阶段1：仅选歌（不生成过渡词/TTS）
app.post('/api/select-next', async (req, res) => {
  try {
    const { currentTrack, playlistId, tracksHref, useTaste = true } = req.body;
    const recentChats = getMessages(5);
    let nextTrack = await selectNextTrackForTransition(currentTrack, playlistId, tracksHref || '', recentChats, { useTaste });

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
    const { speech, ttsAudioUrl, songNameDelayMs } = await generateTransitionSpeech(currentTrack, nextTrack);

    res.json({ speech, ttsAudioUrl, songNameDelayMs });
  } catch (err) {
    logger.error('generate-speech-tts失败', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// 用户主动点击下一首（直接播放，不经过 LLM/TTS）
app.post('/api/next-track', async (req, res) => {
  try {
    const { currentTrack, playlistId, tracksHref } = req.body;

    // 1. 先检查历史中是否有下一首
    const historyNext = getNextTrack();
    if (historyNext?.uri) {
      logger.info('下一首使用播放历史中的下一首', { track: historyNext.track_name, uri: historyNext.uri });
      return res.json({
        nextTrack: {
          id: historyNext.track_id,
          name: historyNext.track_name,
          artist: historyNext.artist,
          albumArt: historyNext.albumArt,
          uri: historyNext.uri
        },
        speech: null,
        ttsAudioUrl: null,
        ready: true,
        source: 'history'
      });
    }

    let nextTrack = null;
    let source = 'none';

    // 2. 历史中没有下一首时，从用户歌单中随机抽取
    if (playlistId) {
      try {
        const userToken = await getUserToken();
        const tracks = await getUserPlaylistTracks(playlistId, { userToken, tracksHref: tracksHref || '' });
        logger.info('手动下一首读取歌单成功', { playlistId, count: tracks.length });
        if (tracks.length > 0) {
          const recentIds = new Set(getRecentPlays(10).map(t => t.track_id));
          if (currentTrack?.id) recentIds.add(currentTrack.id);
          const filtered = tracks.filter(t => !recentIds.has(t.id));
          const pool = filtered.length > 0 ? filtered : tracks.filter(t => t.id !== currentTrack?.id);
          const candidates = pool.length > 0 ? pool : tracks;
          nextTrack = candidates[Math.floor(Math.random() * candidates.length)];
          source = 'playlist-random';
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

    // 3. 如果没有选定歌单，再降级到搜索
    if (!nextTrack) {
      const searchQuery = currentTrack?.artist || 'popular';
      const tracks = await searchTracks(searchQuery);
      const recentIds = new Set(getRecentPlays(10).map(t => t.track_id));
      if (currentTrack?.id) recentIds.add(currentTrack.id);
      const filtered = tracks.filter(t => !recentIds.has(t.id));
      if (filtered.length > 0) {
        nextTrack = filtered[Math.floor(Math.random() * filtered.length)];
        source = 'search-random';
      }
    }

    // 4. 只有新挑选的歌曲才追加到播放历史
    if (nextTrack) {
      savePlay(nextTrack);
    }

    res.json({
      nextTrack,
      speech: null,
      ttsAudioUrl: null,
      ready: true,
      source
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
      res.json({
        nextTrack: preGenerated.nextTrack,
        speech: preGenerated.speech || null,
        ttsAudioUrl: preGenerated.ttsAudioUrl || null,
        ready: true
      });
      return;
    }

    // 1. 由大模型判断下一首适合的歌，再从用户歌单中挑选
    const recentChats = getMessages(5);
    let nextTrack = await selectNextTrackForTransition(currentTrack, playlistId, tracksHref || '', recentChats);
    logger.info('auto-next 开始', { playlistId, hasToken: !!userAccessToken });
    if (!playlistId) {
      logger.info('auto-next: 未选择歌单，使用搜索');
    }

    if (!nextTrack) {
      const searchQuery = currentTrack?.artist || 'popular';
      const tracks = await searchTracks(searchQuery);
      const recentIds = new Set(getRecentPlays(10).map(t => t.track_id));
      if (currentTrack?.id) recentIds.add(currentTrack.id);
      const filtered = tracks.filter(t => !recentIds.has(t.id));
      if (filtered.length > 0) {
        nextTrack = filtered[Math.floor(Math.random() * filtered.length)];
      }
    }

    if (!nextTrack) {
      return res.json({ nextTrack: null, speech: '没有找到下一首歌曲', ttsAudioUrl: null, ready: false });
    }

    // 2. 生成过渡词 + TTS
    const { speech, ttsAudioUrl, songNameDelayMs } = await generateTransitionSpeech(currentTrack, nextTrack);

    res.json({
      nextTrack,
      speech,
      ttsAudioUrl,
      songNameDelayMs,
      ready: true
    });
  } catch (err) {
    logger.error('auto-next失败', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// 生成过渡词 + TTS（共享函数）
// 搜索下一首歌的创作背景（Spotify 元数据 + LLM 知识）
async function researchTrackBackground(track) {
  if (!track?.name) return '';

  const parts = [];

  // 1. 从 Spotify 获取专辑详情
  try {
    const token = await getUserToken();
    const res = await fetchWithRetry(`https://api.spotify.com/v1/tracks/${track.id}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      const album = data.album;
      if (album?.name) parts.push(`专辑：${album.name}`);
      if (album?.release_date) parts.push(`发行日期：${album.release_date}`);
      if (data.popularity) parts.push(`流行度：${data.popularity}/100`);
      if (data.explicit) parts.push('含显式内容');
    }
  } catch (_) {}

  // 2. 用 LLM 搜索创作背景
  try {
    const bgPrompt = `请用2-3句话简要介绍这首歌的创作背景或歌手故事，要求有画面感和趣味性，适合电台DJ口播：
歌曲：${track.name}
歌手：${track.artist}
${parts.length > 0 ? '已知信息：' + parts.join('、') : ''}

只返回介绍文字，不要标题或格式。`;

    const bgResponse = await ask(bgPrompt, {
      systemPrompt: '你是音乐知识库，擅长用简洁生动的语言介绍歌曲背景。只输出纯文本介绍，不加任何格式。'
    });

    const bgText = typeof bgResponse === 'string'
      ? bgResponse
      : bgResponse.speech || bgResponse.text || JSON.stringify(bgResponse);

    if (bgText && bgText.length > 10) {
      parts.push(`背景：${bgText.substring(0, 200)}`);
    }
  } catch (_) {}

  return parts.join('\n');
}

async function generateTransitionSpeech(currentTrack, nextTrack) {
  const recentHistory = getRecentPlays(5);

  // 天气逻辑：首次播放强制包含，之后每小时检查一次，有变化才包含
  const now = new Date();
  let weatherStr = '';
  let shouldIncludeWeather = false;

  if (isFirstPlay) {
    // 首次播放：强制包含天气
    shouldIncludeWeather = true;
    isFirstPlay = false;
  } else {
    // 检查是否需要更新天气（每小时）
    const hoursSinceLastWeather = (now.getTime() - lastWeatherTime) / (1000 * 60 * 60);
    if (hoursSinceLastWeather >= 1) {
      const weatherData = await getWeather();
      const newWeatherStr = weatherData.tempC !== null
        ? `${weatherData.city} ${weatherData.tempC}°C，${weatherData.condition}`
        : '';

      // 天气有变化才包含
      if (newWeatherStr && newWeatherStr !== lastWeather) {
        shouldIncludeWeather = true;
        lastWeather = newWeatherStr;
        lastWeatherTime = now.getTime();
        weatherStr = newWeatherStr;
      }
    }
  }

  // 首次播放时获取天气
  if (shouldIncludeWeather && !weatherStr) {
    const weatherData = await getWeather();
    weatherStr = weatherData.tempC !== null
      ? `${weatherData.city} ${weatherData.tempC}°C，${weatherData.condition}`
      : '天气未配置';
    lastWeather = weatherStr;
    lastWeatherTime = now.getTime();
  }

  const envContext = {
    time: now.toLocaleTimeString('zh-CN'),
    weather: shouldIncludeWeather ? weatherStr : '天气未配置',
  };
  const { systemPrompt } = buildContext('', envContext, recentHistory);

  // 搜索下一首歌的创作背景
  const nextTrackBg = await researchTrackBackground(nextTrack);

  // 检测是否跨越整点
  const currentHour = now.getHours();
  let timeReminder = '';
  if (lastTransitionTime !== null) {
    const lastHour = new Date(lastTransitionTime).getHours();
    if (currentHour !== lastHour) {
      const hourStr = currentHour === 0 ? '凌晨12点' :
        currentHour < 6 ? `凌晨${currentHour}点` :
        currentHour < 12 ? `早上${currentHour}点` :
        currentHour === 12 ? '中午12点' :
        currentHour < 18 ? `下午${currentHour}点` :
        currentHour < 22 ? `晚上${currentHour}点` : `深夜${currentHour}点`;
      timeReminder = `\n【整点提醒】现在刚到${hourStr}，请在过渡词中自然地加入时间提醒，用温暖口语化的语气，比如"不知不觉已经${hourStr}了"、"夜深了，注意休息"等，要有人情味和亲和力，不要生硬。\n`;
    }
  }
  lastTransitionTime = now.toISOString();

  const weatherReminder = shouldIncludeWeather
    ? `\n【天气信息】当前天气：${weatherStr}，请在过渡词中自然地提及天气，用温暖的语气关心听众，比如"外面下着雨，适合听这样的歌"、"今天天气不错，来首轻松的歌"等。\n`
    : '';

  const llmPrompt = `当前歌曲刚播放完毕：${currentTrack?.name || '未知'} - ${currentTrack?.artist || '未知'}
下一首歌曲：${nextTrack?.name || '未知'} - ${nextTrack?.artist || '未知'}
${nextTrackBg ? `\n下一首歌的背景资料：\n${nextTrackBg}\n` : ''}${timeReminder}${weatherReminder}
请作为电台DJ，用温暖自然的语气：
1. 简短总结上一首歌（1-2句话）
2. 生成过渡词，自然地引出下一首歌
3. 融入下一首歌的创作背景或歌手故事，增加沉浸感
4. 提及下一首歌名时请用《》书名号包裹，例如"接下来为你送上《晴天》"

回复要简洁，控制在3-4句话，有陪伴感和画面感。`;

  let speech = '';
  try {
    const response = await ask(llmPrompt, { systemPrompt });
    if (response.speech) {
      speech = response.speech;
    } else if (response.response_type === 'speak') {
      speech = response.speech || '';
    } else {
      speech = JSON.stringify(response);
    }
  } catch (e) {
    logger.error('LLM生成过渡词失败', { error: e.message });
    speech = `接下来为你播放：${nextTrack?.name || '未知'} - ${nextTrack?.artist || '未知'}`;
  }

  let ttsAudioUrl = null;
  if (speech) {
    try {
      ttsAudioUrl = await tts.generate(speech);
    } catch (e) {
      logger.error('TTS生成失败', { error: e.message });
    }
  }

  // 计算歌名在语音中的时间点（找第二个》，即下一首歌名的结束位置）
  let songNameDelayMs = null;
  const firstBracket = speech.indexOf('》');
  const secondBracket = firstBracket > 0 ? speech.indexOf('》', firstBracket + 1) : -1;
  const bracketIdx = secondBracket > 0 ? secondBracket : firstBracket;
  if (bracketIdx > 0) {
    // 中文 TTS 语速约 4 字/秒，预留 0.3s 缓冲
    songNameDelayMs = Math.max(0, Math.round(bracketIdx / 4 * 1000) - 300);
  }

  const firstTitleEnd = speech.indexOf('\u300b');
  const secondTitleEnd = firstTitleEnd >= 0 ? speech.indexOf('\u300b', firstTitleEnd + 1) : -1;
  const titleEnd = secondTitleEnd >= 0 ? secondTitleEnd : firstTitleEnd;
  if (titleEnd >= 0) {
    songNameDelayMs = Math.max(0, Math.round(titleEnd / 4 * 1000) - 300);
  }

  return { speech, ttsAudioUrl, songNameDelayMs };
}

async function selectNextTrackForTransition(currentTrack, playlistId, tracksHref = '', recentChats = [], options = {}) {
  if (!playlistId) return null;

  // 1. 缓存全量歌单（仅首次或歌单切换时获取）
  if (cachedPlaylistId !== playlistId || cachedTracks.length === 0) {
    try {
      const userToken = await getUserToken();
      const result = await getAllPlaylistTracks(playlistId, { userToken, tracksHref, maxTracks: 500 });
      cachedTracks = result.tracks;
      cachedPlaylistId = playlistId;
      logger.info('大模型选歌：获取全量歌单成功', { playlistId, count: cachedTracks.length });
    } catch (e) {
      logger.warn('大模型选歌：获取歌单失败', { error: e.message, playlistId });
      return null;
    }
  }
  if (cachedTracks.length === 0) return null;

  // 2. 排除最近播放的歌曲，构建可用歌曲列表
  const recentIds = new Set(getRecentPlays(15).map(t => t.track_id));
  if (currentTrack?.id) recentIds.add(currentTrack.id);
  const availableTracks = cachedTracks.filter(t => !recentIds.has(t.id));

  // 如果可用歌曲为空，降级使用全量歌单
  const candidates = availableTracks.length > 0 ? availableTracks : cachedTracks;
  if (candidates.length === 0) return null;

  // 3. 尝试 LLM 选歌
  try {
    const candidateText = candidates
      .map((track, index) => `${index + 1}. id=${track.id} | ${track.name} - ${track.artist}`)
      .join('\n');

    // 构建最近对话摘要
    const chatSummary = recentChats.length > 0
      ? recentChats.map(m => `[${m.role}] ${m.content.substring(0, 100)}`).join('\n')
      : '暂无对话记录';

    // 构建最近播放历史
    const recentHistory = getRecentPlays(10);
    const historySummary = recentHistory.length > 0
      ? recentHistory.map(t => `${t.track_name} - ${t.artist}`).join('\n')
      : '暂无播放记录';

    // 读取用户口味偏好
    let tasteSummary = '暂无口味数据';
    try {
      const dataPath = join(__dirname, '../data/taste.md');
      const metaPath = join(__dirname, '../data/taste-meta.json');
      if (options.useTaste !== false && fs.existsSync(dataPath) && fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        if (meta.playlistId === playlistId) {
          tasteSummary = fs.readFileSync(dataPath, 'utf-8').substring(0, 2000);
        }
      }
    } catch (_) {}

    const prompt = `当前刚播放完的歌曲：${currentTrack?.name || '未知'} - ${currentTrack?.artist || '未知'}

最近用户对话：
${chatSummary}

最近播放历史（最近10首）：
${historySummary}

用户口味偏好：
${tasteSummary}

可选歌曲列表（共${candidates.length}首，已排除最近播放的歌曲）：
${candidateText}

请综合判断用户的当前情绪和偏好，从可选歌曲列表中选择下一首最适合的歌曲。

重要规则：
1. 你必须从可选歌曲列表中选择一首歌曲
2. 返回的 trackId 必须是列表中某首歌曲的 id
3. 不要编造或猜测 id
4. 尽量选择与当前歌曲风格有衔接但不完全相同的歌曲

只返回 JSON，不要输出其他文字：
{"trackId":"歌曲id","reason":"选择理由","mood":"判断的用户情绪"}`;

    const response = await ask(prompt, {
      systemPrompt: '你是个人电台的选曲助手，负责根据用户情绪、对话内容和播放历史，从歌曲列表中选择最契合当前氛围的下一首歌曲。'
    });

    const trackId = response.trackId || response.id || response.track_id;
    const selected = candidates.find(track => track.id === trackId);

    if (selected) {
      logger.info('大模型选歌成功', {
        track: selected.name,
        artist: selected.artist,
        reason: response.reason,
        mood: response.mood
      });
      return selected;
    }

    // LLM 返回的 trackId 不在列表中，随机降级
    logger.warn('大模型选歌结果未命中歌曲列表，随机降级', { trackId, reason: response.reason });
  } catch (e) {
    logger.warn('大模型选歌失败，随机降级', { error: e.message, playlistId });
  }

  // 4. 降级：随机选歌
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  logger.info('随机选歌', { playlistId, picked: pick.name });
  return pick;
}

// Spotify 播放控制（next/previous 共享逻辑）
async function spotifyPlaybackControl(token, action) {
  const endpoint = action === 'next' ? getNextTrack() : getPreviousTrack();
  if (!endpoint?.uri) return { track: null, success: false };

  const response = await fetchWithRetry(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ uris: [endpoint.uri] })
  });

  return { track: endpoint, success: response.ok };
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
async function refreshWeatherInBackground() {
  try {
    const weatherData = await getWeather();
    lastWeather = weatherData.tempC !== null
      ? `${weatherData.city} ${weatherData.tempC}°C，${weatherData.condition}`
      : '';
    lastWeatherTime = Date.now();
    logger.info('启动天气读取完成', { weather: lastWeather || weatherData.condition });
  } catch (e) {
    logger.warn('启动天气读取失败', { error: e.message });
  }
}

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

    if (!response.ok || data.error) {
      userAccessToken = null;
      userRefreshToken = null;
      userTokenExpiry = 0;
      throw new Error(data.error_description || 'Token 刷新失败');
    }

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
    if (command === 'next' || command === 'previous') {
      const result = await spotifyPlaybackControl(token, command);
      track = result.track;
      if (track) {
        logger.info(`播放${command === 'next' ? '下一首' : '上一首'}`, { track: track.track_name, uri: track.uri });
        speech = result.success ? `正在播放：${track.track_name} - ${track.artist}` : '切歌失败';
      } else {
        speech = command === 'next' ? '没有可播放的歌曲' : '没有上一首歌曲';
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
    if (response.speech) {
      speech = response.speech;
    } else if (response.response_type === 'speak') {
      speech = response.speech || '';
    } else {
      speech = JSON.stringify(response);
    }
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

  // 获取天气数据
  const weatherData = await getWeather();
  const weatherStr = weatherData.tempC !== null
    ? `${weatherData.city} ${weatherData.tempC}°C，${weatherData.condition}`
    : '天气未配置';

  const envContext = {
    time: new Date().toLocaleTimeString('zh-CN'),
    weather: weatherStr,
  };
  const { systemPrompt } = buildContext(text, envContext, recentHistory);

  // 使用 brain.compute() 获取结构化动作
  const prompt = `${systemPrompt}\n\n用户输入：${text}`;
  const action = await compute(prompt);

  logger.info('brain.compute 返回', { say: action.say?.substring(0, 50), hasPlay: !!action.play });

  // 保存消息
  saveMessage('assistant', JSON.stringify(action));

  // 构建响应对象
  const response = {
    response_type: 'speak',
    speech: action.say || action.segue || '',
    should_speak: true,
    reason: action.reason || '',
  };

  // TTS 集成
  if (response.speech) {
    try {
      response.ttsAudioUrl = await tts.generate(response.speech);
    } catch (e) {
      logger.error('handleLLM TTS生成失败', { error: e.message });
    }
  }

  // 处理 play 动作
  if (action.play) {
    let tracks = [];
    if (typeof action.play === 'string') {
      tracks = await searchTracks(action.play);
    } else if (action.play.query) {
      tracks = await searchTracks(action.play.query);
    } else if (action.play.trackId) {
      tracks = await searchTracks(action.play.trackId);
    }

    if (tracks.length > 0) {
      savePlay(tracks[0]);
      response.track = {
        name: tracks[0].name,
        artist: tracks[0].artist,
        albumArt: tracks[0].albumArt,
        uri: tracks[0].uri,
      };
    }
  }

  // 处理 plan 动作
  if (action.plan) {
    response.plan = action.plan;
  }

  return response;
}

async function main() {
  await initDb();
  clearMessages();
  clearPlayHistory();
  refreshWeatherInBackground();

  app.listen(config.app.port, () => {
    const url = `http://localhost:${config.app.port}`;
    logger.info('Claudio电台启动', { port: config.app.port });
    exec(`start ${url}`);
  });
}

main();
