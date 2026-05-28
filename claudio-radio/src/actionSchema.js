// 动作类型定义
export const ActionTypes = {
  SAY: 'say',
  PLAY: 'play',
  REASON: 'reason',
  SEGUE: 'segue',
  PLAN: 'plan',
  NEEDS_TOOL: 'needsTool',
};

// 验证动作是否合法
export function validateAction(action) {
  if (!action || typeof action !== 'object') {
    return false;
  }

  // 至少要有 say 或 play 中的一个
  if (!action.say && !action.play && !action.segue) {
    return false;
  }

  // 如果有 play，检查结构
  if (action.play) {
    if (typeof action.play === 'string') {
      // play 可以是字符串（歌曲名或搜索词）
      return true;
    }
    if (typeof action.play === 'object') {
      // play 可以是对象，包含 query、trackId、playlistId
      return true;
    }
    return false;
  }

  return true;
}

// 生成降级动作
export function fallbackAction(errorReason) {
  return {
    say: '我刚刚有点没听清，我们换一种方式来。',
    reason: errorReason || 'brain_parse_failed',
  };
}

// 从 LLM 响应中提取动作
export function extractAction(llmResponse) {
  if (!llmResponse || typeof llmResponse !== 'object') {
    return fallbackAction('invalid_response');
  }

  // 如果已经是标准动作格式
  if (llmResponse.say || llmResponse.play || llmResponse.segue) {
    return llmResponse;
  }

  // 如果是旧格式（response_type: speak）
  if (llmResponse.response_type === 'speak' && llmResponse.speech) {
    return {
      say: llmResponse.speech,
      reason: llmResponse.reason || '',
    };
  }

  // 如果是旧格式（speech 字段）
  if (llmResponse.speech) {
    return {
      say: llmResponse.speech,
      reason: llmResponse.reason || '',
    };
  }

  return fallbackAction('unknown_format');
}
