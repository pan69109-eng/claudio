import { FishAudioClient } from 'fish-audio';
import { spawn } from 'child_process';
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

function playAudio(audioPath) {
  return spawn('powershell', [
    '-c',
    `Start-Process -FilePath wmplayer -ArgumentList '${audioPath.replace(/'/g, "''")}','/Play','/Close' -WindowStyle Hidden`
  ]);
}

export class TTSPipeline {
  constructor() {
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
    }
  }

  async speak(text, options = {}) {
    try {
      const referenceId = options.referenceId || config.fishAudio.referenceId;
      const requestOptions = {
        text,
        format: 'mp3',
        prosody: { speed: options.speed || 1.0 },
      };

      if (referenceId) {
        requestOptions.reference_id = referenceId;
      }

      const audioData = await getClient().textToSpeech.convert(requestOptions, 's2-pro');

      const staticFile = path.join(TEMP_DIR, `tts_${Date.now()}.mp3`);
      const chunks = [];
      for await (const chunk of audioData) {
        chunks.push(chunk);
      }
      fs.writeFileSync(staticFile, Buffer.concat(chunks));

      logger.info('TTS生成完成', { file: staticFile, text: text.substring(0, 30) });

      playAudio(staticFile);
      logger.info('TTS播放中', { text: text.substring(0, 30) });

      setTimeout(() => {
        try {
          if (fs.existsSync(staticFile)) {
            fs.unlinkSync(staticFile);
          }
        } catch (e) { }
      }, 5 * 60 * 1000);

      return staticFile;
    } catch (error) {
      logger.error('TTS失败', { error: error.message });
      throw error;
    }
  }

  async generate(text, options = {}) {
    try {
      const referenceId = options.referenceId || config.fishAudio.referenceId;
      const requestOptions = {
        text,
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

      setTimeout(() => {
        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        } catch (e) { }
      }, 5 * 60 * 1000);

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