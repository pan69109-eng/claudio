import { logger } from './logger.js';

const messages = [];
const playHistory = [];

export async function initDb() {
  logger.info('数据库初始化完成（内存模式）');
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
    played_at: new Date().toISOString(),
  });
  if (playHistory.length > 100) playHistory.shift();
}

export function getRecentPlays(limit = 20) {
  return playHistory.slice(-limit);
}

export function getDb() {
  return { messages, playHistory };
}