import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = path.join(__dirname, '../db/data.json');

const messages = [];
const playHistory = [];
const prefs = {}; // 用户偏好（跨会话保留）
let currentIndex = -1; // 当前播放的索引

function loadFromDisk() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
      if (data.messages) messages.push(...data.messages);
      if (data.playHistory) playHistory.push(...data.playHistory);
      if (playHistory.length > 0) currentIndex = playHistory.length - 1;
      if (data.prefs) Object.assign(prefs, data.prefs);
      logger.info('从磁盘加载数据', { messages: messages.length, plays: playHistory.length });
    }
  } catch (e) {
    logger.warn('加载数据库文件失败', { error: e.message });
  }
}

function saveToDisk() {
  try {
    const dir = path.dirname(DB_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify({ messages, playHistory, prefs }, null, 2));
  } catch (e) {
    logger.warn('保存数据库文件失败', { error: e.message });
  }
}

export async function initDb() {
  loadFromDisk();
  logger.info('数据库初始化完成', { messages: messages.length, plays: playHistory.length });
  return { messages, playHistory };
}

export function saveMessage(role, content) {
  messages.push({
    id: messages.length + 1,
    role,
    content,
    created_at: new Date().toISOString(),
  });
  if (messages.length > 100) messages.shift();
  saveToDisk();
}

export function getMessages(limit = 50) {
  return messages.slice(-limit);
}

export function savePlay(track) {
  playHistory.push({
    id: playHistory.length + 1,
    track_id: track.id || track.name,
    track_name: track.name,
    artist: track.artist || '未知',
    uri: track.uri || null,
    albumArt: track.albumArt || null,
    played_at: new Date().toISOString(),
  });
  if (playHistory.length > 100) playHistory.shift();
  currentIndex = playHistory.length - 1; // 更新当前索引
  saveToDisk();
}

export function getNextTrack() {
  if (playHistory.length === 0) return null;

  const nextIndex = currentIndex + 1;
  if (nextIndex >= playHistory.length) return null;

  currentIndex = nextIndex;
  saveToDisk();
  return playHistory[currentIndex];
}

export function getPreviousTrack() {
  if (playHistory.length < 2) return null;
  // 返回上一首歌
  const prevIndex = Math.max(0, currentIndex - 1);
  if (prevIndex < playHistory.length) {
    currentIndex = prevIndex;
    saveToDisk();
    return playHistory[prevIndex];
  }
  return null;
}

export function getCurrentTrack() {
  if (currentIndex >= 0 && currentIndex < playHistory.length) {
    return playHistory[currentIndex];
  }
  return playHistory.length > 0 ? playHistory[playHistory.length - 1] : null;
}

export function setCurrentTrackByUri(uri) {
  if (!uri) return null;

  const index = playHistory.findLastIndex(track => track.uri === uri);
  if (index === -1) return null;

  currentIndex = index;
  saveToDisk();
  return playHistory[currentIndex];
}

export function setCurrentTrackById(id) {
  const numericId = Number(id);
  if (!Number.isFinite(numericId)) return null;

  const index = playHistory.findIndex(track => track.id === numericId);
  if (index === -1) return null;

  currentIndex = index;
  saveToDisk();
  return playHistory[currentIndex];
}

export function getRecentPlays(limit = 20) {
  return playHistory.slice(-limit);
}

export function getDb() {
  return { messages, playHistory };
}

export function clearPlayHistory() {
  playHistory.length = 0;
  currentIndex = -1;
  saveToDisk();
  logger.info('播放历史已清空');
}

export function clearMessages() {
  messages.length = 0;
  saveToDisk();
  logger.info('对话消息已清空');
}

export function savePlaylistPreference(playlistId) {
  prefs.playlistId = playlistId;
  saveToDisk();
  logger.info('歌单偏好已保存', { playlistId });
}

export function getPlaylistPreference() {
  return prefs.playlistId || null;
}
