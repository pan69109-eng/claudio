import 'dotenv/config';
import { FishAudioClient } from 'fish-audio';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';

const client = new FishAudioClient({ apiKey: process.env.FISH_AUDIO_API_KEY });

function playAudio(audioPath) {
  spawn('powershell', [
    '-c',
    `(New-Object System.Media.SoundPlayer("${audioPath.replace(/\\/g, '\\\\')}")).PlaySync()`
  ]);
}

async function speak(text) {
  try {
    // 直接发送原始文本，让Fish Audio处理情感标签
    const audioData = await client.textToSpeech.convert({
      text,
      format: 'mp3',
      prosody: { speed: 1.0 }
    }, 's2-pro');

    const tempDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'audio');
    const staticFile = path.join(tempDir, `tts_${Date.now()}.mp3`);

    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const chunks = [];
    for await (const chunk of audioData) {
      chunks.push(chunk);
    }
    fs.writeFileSync(staticFile, Buffer.concat(chunks));
    console.log(`[TTS] 已保存: ${staticFile}`);

    playAudio(staticFile);
    console.log(`[TTS] 播放完成: ${text.substring(0, 30)}...`);

    // 5分钟后自动删除mp3文件
    setTimeout(() => {
      try {
        if (fs.existsSync(staticFile)) {
          fs.unlinkSync(staticFile);
          console.log(`[TTS] 已删除: ${staticFile}`);
        }
      } catch (e) { }
    }, 5 * 60 * 1000);
  } catch (error) {
    console.error('[TTS Error]', error.message);
  }
}

const text = process.argv.slice(2).join(' ');
if (text) speak(text);