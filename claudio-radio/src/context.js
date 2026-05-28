import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../data');
const USER_DIR = path.join(__dirname, '../user');
const PROMPTS_DIR = path.join(__dirname, '../prompts');

// 读取文件，优先从 user/ 目录，不存在则从 data/ 目录
function readFile(filename, defaultContent = '') {
  // 优先从 user/ 目录读取
  const userPath = path.join(USER_DIR, filename);
  if (fs.existsSync(userPath)) {
    return fs.readFileSync(userPath, 'utf-8');
  }

  // 降级到 data/ 目录
  const dataPath = path.join(DATA_DIR, filename);
  if (fs.existsSync(dataPath)) {
    return fs.readFileSync(dataPath, 'utf-8');
  }

  return defaultContent;
}

// 读取 prompt 文件
function readPrompt(filename) {
  const filePath = path.join(PROMPTS_DIR, filename);
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf-8');
  }
  return '';
}

// 六片段组装
export function buildFragments(input, runtime = {}) {
  const { recentHistory = [], envContext = {}, trace = {} } = runtime;

  // 片段 1：系统提示词
  const system = readPrompt('dj-persona.md') || '你是 Claudio，一位温暖治愈的深夜电台 DJ。';

  // 片段 2：用户资料
  const taste = readFile('taste.md', '# 音乐品味\n\n暂无口味偏好数据');
  const routines = readFile('routines.md', '# 作息习惯\n\n暂无作息数据');
  const playlists = JSON.parse(readFile('playlists.json', '{"playlists": []}'));
  const moodRules = readFile('mood-rules.md', '# 情绪规则\n\n暂无情绪规则');
  const user = `${taste}\n\n${routines}\n\n${moodRules}\n\n播放列表：${JSON.stringify(playlists, null, 2)}`;

  // 片段 3：环境注入
  const time = envContext.time || new Date().toLocaleTimeString('zh-CN');
  const weather = envContext.weather || '未知';
  const calendar = envContext.calendar || '暂未接入飞书日程';
  const environment = `时间：${time}\n天气：${weather}\n日程：${calendar}`;

  // 片段 4：已播记录
  const history = recentHistory.length > 0
    ? recentHistory.map(t => `${t.track_name} - ${t.artist}`).join('\n')
    : '暂无播放记录';

  // 片段 5：用户输入和工具结果
  const userInput = input || '';

  // 片段 6：执行轨迹
  const traceInfo = trace.lastAction
    ? `上一轮动作：${JSON.stringify(trace.lastAction)}`
    : '暂无执行轨迹';

  return {
    system,
    user,
    environment,
    history,
    input: userInput,
    trace: traceInfo,
  };
}

// 拼接为完整 prompt
export function buildPrompt(fragments) {
  return `${fragments.system}

【用户资料】
${fragments.user}

【环境信息】
${fragments.environment}

【播放历史】
${fragments.history}

【用户输入】
${fragments.input}

【执行轨迹】
${fragments.trace}`;
}

// 向后兼容：保留原 buildContext 函数
export function buildContext(userInput, envContext = {}, recentHistory = []) {
  const fragments = buildFragments(userInput, { recentHistory, envContext });
  const systemPrompt = buildPrompt(fragments);

  return {
    systemPrompt,
    contextData: {
      fragments,
      envContext,
      recentHistory,
    },
  };
}

// 获取 fragments 摘要（用于 API）
export function getFragmentsSummary(userInput, runtime = {}) {
  const fragments = buildFragments(userInput, runtime);

  return {
    fragments: [
      { name: 'system', ok: !!fragments.system, preview: fragments.system.substring(0, 100) },
      { name: 'user', ok: !!fragments.user, preview: fragments.user.substring(0, 100) },
      { name: 'environment', ok: !!fragments.environment, preview: fragments.environment.substring(0, 100) },
      { name: 'history', ok: !!fragments.history, preview: fragments.history.substring(0, 100) },
      { name: 'input', ok: !!fragments.input, preview: fragments.input.substring(0, 100) },
      { name: 'trace', ok: !!fragments.trace, preview: fragments.trace.substring(0, 100) },
    ],
  };
}
