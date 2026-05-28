import { config } from './config.js';
import { logger } from './logger.js';
import { validateAction, fallbackAction, extractAction } from './actionSchema.js';
import { ask } from './llm.js';

// 主要的 compute 函数 — 直接调用 LLM API
export async function compute(prompt) {
  logger.info('brain.compute 开始', { promptLength: prompt.length });

  try {
    const llmResponse = await ask(prompt, {
      systemPrompt: `你是 Claudio 电台 DJ。请用 JSON 格式回复。

字段说明：
- say：你的播报内容（必填）
- play：播放指令（可选，只有用户明确要求播放音乐时才返回）
- reason：推理过程（可选）

重要规则：
1. 只有当用户明确要求播放音乐、点歌、或者请求"放一首歌"时，才返回 play 字段
2. 如果用户只是聊天、问问题、闲谈，不要返回 play 字段
3. 在你认为有必要的时候，你可以给用户建议播放什么音乐，但不要自作主张建议播放音乐，直到用户有明确指令同意播放
4. play 可以是字符串（歌曲名/搜索词）或对象（包含 query/trackId）`
    });

    const action = extractAction(llmResponse);

    if (validateAction(action)) {
      logger.info('LLM 输出有效动作', { say: action.say?.substring(0, 50) });
      return action;
    }

    logger.warn('LLM 输出无效动作', { llmResponse });
  } catch (e) {
    logger.error('LLM 调用失败', { error: e.message });
  }

  // 降级：返回默认动作
  logger.warn('大脑调用失败，返回默认动作');
  return fallbackAction('llm_failed');
}
