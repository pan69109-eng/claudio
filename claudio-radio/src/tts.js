import { FishAudioClient } from 'fish-audio';
import { fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';
import { config } from './config.js';
import { logger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let client = null;

function getClient() {
  if (!client) {
    client = new FishAudioClient({ apiKey: config.fishAudio?.apiKey });
  }
  return client;
}
const TEMP_DIR = path.join(__dirname, '../audio');

// 清理文本，避免 TTS 读出特殊字符
function cleanText(text) {
  return String(text || '')
    .replace(/\\n/gi, ' ')    // \n 字面量
    .replace(/\\r/gi, ' ')
    .replace(/\\t/gi, ' ')
    .replace(/\n/g, ' ')      // 真实换行
    .replace(/\r/g, ' ')
    .replace(/\t/g, ' ')
    .replace(/~/g, '，')      // 波浪号替换为逗号（自然停顿）
    .replace(/[_]{2,}/g, ' ') // 多个下划线
    .replace(/\s{2,}/g, ' ')  // 多个空格合并
    .trim();
}

export class TTSPipeline {
  constructor() {
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
    }
  }

  async generate(text, options = {}) {
    try {
      const referenceId = options.referenceId || config.fishAudio.referenceId;
      const requestOptions = {
        text: cleanText(text),
        format: 'mp3',
        prosody: { speed: options.speed || 1.0 },
      };

      if (referenceId) {
        requestOptions.reference_id = referenceId;
      }

      const audioData = await getClient().textToSpeech.convert(requestOptions, 's2-pro');

      const filename = `tts_${Date.now()}.mp3`;
      const filePath = path.join(TEMP_DIR, filename);
      const chunks = [];
      for await (const chunk of audioData) {
        chunks.push(chunk);
      }
      fs.writeFileSync(filePath, Buffer.concat(chunks));

      logger.info('TTS音频生成完成', { file: filePath, text: text.substring(0, 30) });

      return `/audio/${filename}`;
    } catch (error) {
      logger.error('TTS生成失败', { error: error.message });
      throw error;
    }
  }

  clearCache() {
    const files = fs.readdirSync(TEMP_DIR);
    for (const file of files) {
      if (file.endsWith('.mp3')) {
        fs.unlinkSync(path.join(TEMP_DIR, file));
      }
    }
  }
}