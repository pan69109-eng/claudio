import { FishAudioClient } from 'fish-audio';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const client = new FishAudioClient({ apiKey: 'c2677f043cad46ed8f54ec5c58998f61' });

function playAudio(audioPath) {
  spawn('powershell', [
    '-c',
    `(New-Object System.Media.SoundPlayer("${audioPath.replace(/\\/g, '\\\\')}")).PlaySync()`
  ]);
}

async function speak(text) {
  try {
    const audioData = await client.textToSpeech.convert({
      text,
      format: 'mp3',
      prosody: { speed: 1.1 }
    });

    const tempDir = 'D:\\claude code的一些测试\\很难的啦\\claude-tts\\audio';
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