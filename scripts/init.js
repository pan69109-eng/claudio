import { config } from '../src/config.js';
import { logger } from '../src/logger.js';
import { initDb } from '../src/db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../data');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function init() {
  logger.info('开始初始化项目...');

  ensureDir(path.join(__dirname, '../db'));
  ensureDir(path.join(__dirname, '../audio'));
  ensureDir(path.join(__dirname, '../logs'));
  ensureDir(DATA_DIR);

  initDb();

  const tastePath = path.join(DATA_DIR, 'taste.md');
  if (!fs.existsSync(tastePath)) {
    fs.writeFileSync(tastePath, '# 音乐品味\n\n暂无口味偏好数据');
    logger.info('创建 taste.md');
  }

  const routinesPath = path.join(DATA_DIR, 'routines.md');
  if (!fs.existsSync(routinesPath)) {
    fs.writeFileSync(routinesPath, '# 作息习惯\n\n暂无作息数据');
    logger.info('创建 routines.md');
  }

  const playlistsPath = path.join(DATA_DIR, 'playlists.json');
  if (!fs.existsSync(playlistsPath)) {
    fs.writeFileSync(playlistsPath, JSON.stringify({ playlists: [] }, null, 2));
    logger.info('创建 playlists.json');
  }

  const moodRulesPath = path.join(DATA_DIR, 'mood-rules.md');
  if (!fs.existsSync(moodRulesPath)) {
    fs.writeFileSync(moodRulesPath, '# 情绪规则\n\n暂无情绪规则');
    logger.info('创建 mood-rules.md');
  }

  logger.info('初始化完成！');
}

init().catch(console.error);