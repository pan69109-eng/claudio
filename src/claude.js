import { config } from './config.js';
import { logger } from './logger.js';

export async function ask(prompt, context) {
  const apiKey = config.minimax?.apiKey;

  if (!apiKey) {
    throw new Error('MINIMAX_API_KEY 未配置');
  }

  try {
    const response = await fetch('https://api.minimaxi.com/anthropic/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'MiniMax-M2.7',
        max_tokens: 1024,
        system: context.systemPrompt,
        messages: [
          { role: 'user', content: prompt }
        ]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      logger.error('MiniMax API错误', { status: response.status, error: err });
      throw new Error(`API错误: ${response.status}`);
    }

    const data = await response.json();

    // 解析响应
    const content = data.content?.[0]?.text || '';

    // 尝试解析JSON响应
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      // 不是JSON，返回普通文本
    }

    return {
      response_type: 'speak',
      speech: content.trim(),
      should_speak: true
    };
  } catch (err) {
    logger.error('LLM调用失败', { error: err.message });
    throw err;
  }
}

export async function askStream(prompt, context, onChunk) {
  throw new Error('流式输出暂不支持');
}