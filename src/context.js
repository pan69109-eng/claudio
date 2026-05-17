import fs from 'fs';
import path from 'path';

const DATA_DIR = './data';

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

  const systemPrompt = `你是Claudio，一个个人AI电台的DJ。你需要：
1. 理解用户的音乐偏好和当前情绪
2. 决定播放什么音乐
3. 用自然语言播报你的推荐理由

用户数据：
${taste}

作息习惯：
${routines}

播放列表：
${JSON.stringify(playlists, null, 2)}

情绪规则：
${moodRules}

环境信息：
- 时间：${envContext.time || new Date().toLocaleTimeString('zh-CN')}
- 天气：${envContext.weather || '未知'}

最近播放：${recentHistory.map(t => `${t.track_name} - ${t.artist}`).join(', ') || '暂无'}`;

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