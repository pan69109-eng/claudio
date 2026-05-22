import { config } from './config.js';
import { logger } from './logger.js';

export async function ask(prompt, context) {
  const apiKey = config.llm?.apiKey;
  const baseUrl = config.llm?.baseUrl?.replace(/\/$/, '');
  const model = config.llm?.model;

  if (!apiKey) {
    throw new Error('LLM_API_KEY 未配置，请在 .env 中填写');
  }

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        thinking: { type: 'disabled' },
        messages: [
          { role: 'system', content: context.systemPrompt },
          { role: 'user', content: prompt }
        ]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      logger.error('LLM API错误', { status: response.status, error: err });
      throw new Error(`API错误: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

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
