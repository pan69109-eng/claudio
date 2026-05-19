import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = path.join(__dirname, '../db/data.json');

const messages = [];
const playHistory = [];
let currentIndex = -1; // 当前播放的索引

function loadFromDisk() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
      if (data.messages) messages.push(...data.messages);
      if (data.playHistory) playHistory.push(...data.playHistory);
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
    fs.writeFileSync(DB_FILE, JSON.stringify({ messages, playHistory }, null, 2));
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
  // 返回最后一首歌（最新播放的）
  return playHistory[playHistory.length - 1];
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