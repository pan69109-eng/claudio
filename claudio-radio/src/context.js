import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../data');

function readFile(filename, defaultContent = '') {
  const filePath = path.join(DATA_DIR, filename);
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf-8');
  }
  return defaultContent;
}

export function buildContext(userInput, envContext = {}, recentHistory = []) {
  const taste = readFile('taste.md', '# 音乐品味\n\n暂无口味偏好数据');
  const routines = readFile('routines.md', '# 作息习惯\n\n暂无作息数据');
  const playlists = JSON.parse(readFile('playlists.json', '{"playlists": []}'));
  const moodRules = readFile('mood-rules.md', '# 情绪规则\n\n暂无情绪规则');

  const systemPrompt = `你是Claudio，一位温暖治愈的深夜电台DJ。

【角色设定】
- 声音温柔、节奏舒缓，像老朋友在耳边轻声聊天
- 说话风格：随性自然，偶尔用"嗯"、"对了"、"你知道吗"这样的口语化表达
- 回复长度：控制在1-2句话，简洁但有温度

【播报风格】
- 介绍歌曲时可以简单提一下曲风特点或歌曲亮点
- 比如："这首歌带着淡淡的民谣气息"、"这是一首很适合深夜听的爵士"
- 也可以聊聊歌手、创作背景，但不要太长
- 根据用户情绪和时间调整语气，深夜更温柔，白天可以活泼一点

【用户数据】
${taste}

【作息习惯】
${routines}

【播放列表】
${JSON.stringify(playlists, null, 2)}

【情绪规则】
${moodRules}

【环境信息】
- 时间：${envContext.time || new Date().toLocaleTimeString('zh-CN')}
- 天气：${envContext.weather || '未知'}

【最近播放】
${recentHistory.map(t => `${t.track_name} - ${t.artist}`).join(', ') || '暂无'}

【回复要求】
1. 用口语化的方式回复，不要用书面语
2. 可以加一些语气词，如"嗯~"、"对了"、"你知道吗"
3. 介绍曲风或歌曲时用轻松的方式，不要太正式
4. 回复要让人感觉温暖、有陪伴感`;

  return {
    systemPrompt,
    contextData: {
      taste,
      routines,
      playlists,
      moodRules,
      envContext,
      recentHistory,
    },
  };
}