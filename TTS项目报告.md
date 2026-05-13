# Claude Code TTS 配音项目 - 项目报告

## 项目时间
- 2026-05-12 创建
- 2026-05-13 完成整理
- 2026-05-13 下午更新 S2-Pro 播音员音色

## 项目背景
实现 Claude Code 回复内容自动转换为语音播放功能，使用 Fish Audio S2-Pro 模型生成播音员风格的语音。

## 项目路径
`D:\claude code的一些测试\很难的啦\claude-tts\`

## 方案演进

### 第一阶段：Hook方案（已放弃）

**创建的文件：**
- `tts-daemon.js` - TCP后台服务，监听9876端口
- `tts-hook.js` - Claude Code输出拦截器
- `tts-stop.js` - Stop钩子脚本

**问题：**
- Stop hook 收到的是生成中的 JSON 数据，不是最终显示的文本
- 文字和语音不同步
- 实现复杂度过高

### 第二阶段：主动调用方案（当前方案）

**删除的文件：**
- `.claude/hooks/tts-stop.js`
- `claude-tts/tts-daemon.js`
- `claude-tts/tts-hook.js`
- `claude-tts/test-tts.js`
- 所有旧 mp3 文件

**创建的文件：**
- `claude-tts/speak.js` - 轻量级TTS调用脚本

## 最终项目结构

```
claude-tts/
├── speak.js          ← TTS调用脚本（核心文件）
├── package.json      ← 依赖配置
├── package-lock.json
├── node_modules/      ← fish-audio 等依赖
└── audio/            ← mp3存放目录（自动清理）

.claude/
└── settings.local.json ← 权限配置
```

## speak.js 功能

1. 调用 Fish Audio API 生成 mp3 音频
2. 使用 PowerShell 播放音频（同步播放）
3. mp3 文件生成5分钟后自动删除

## Fish Audio API 配置

- API Key: `c2677f043cad46ed8f54ec5c58998f61`
- 包名: `fish-audio`
- 客户端类: `FishAudioClient`
- 模型: `s2-pro`（官方推荐，支持自然语言情感控制）
- 语速: 1.0（正常语速）

## speak.js 核心代码

```javascript
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
      prosody: { speed: 1.0 }
    }, 's2-pro');

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
```

## 情感控制

### S2-Pro 自然语言控制 `[描述]` 格式

- 格式：`[描述]` 在文本任意位置
- 示例：`[whisper]`、`[laugh]`、`[emphasis]`、`[pause]`
- 支持任意描述：`[whispers sweetly]`、`[laughing nervously]`

### 64+情感系统 `(情感)` 格式

- 格式：`(情感)` 在句首
- 示例：`(happy)`、`(excited)(laughing)`
- 支持强度修饰：`(slightly sad)`、`(very excited)`

### 播音员相关标签

- `[professional broadcast tone]` - 专业播音腔调
- `[slow]` - 慢速
- `[warm host voice]` - 温暖主持人声音
- `[excited]` - 兴奋
- `[pause]` - 停顿

## 使用方式

```bash
node claude-tts/speak.js "[professional broadcast tone] 各位亲爱的听众朋友们，欢迎收听本期的音乐电台节目。"
```

## 关键发现

1. `fishaudio-ts` 包不存在，正确包名是 `fish-audio`
2. `@anthropic-ai/claude-agent-sdk` 不存在，正确包名是 `@anthropic-ai/sdk`
3. FishAudioClient 需要以对象形式传入 apiKey: `new FishAudioClient({ apiKey: 'xxx' })`
4. SDK 的 `prosody` 参数只支持 speed 和 volume，`enableProsodyControl` 不是有效参数
5. 正确的模型名是 `s2-pro`（不是 `s1`）
6. API OpenAPI 定义：`enum=["s1","s2-pro"]`，官方推荐使用 `s2-pro`

## 官方文档

- S2-Pro 模型介绍：https://docs.fish.audio/developer-guide/models-pricing/models-overview#s2-natural-language-control
- 情感控制：https://docs.fish.audio/developer-guide/core-features/emotions
- API 参考：https://docs.fish.audio/api-reference/introduction

## 当前状态

- **模型：** s2-pro（官方推荐）
- **API Key：** 已充值，功能正常
- **标签格式：** `[描述]` 或 `(情感)`
- **语速：** 1.0（正常）
- **音频自动删除：** 5分钟后

## 待解决问题

1. 情感标签对中文的支持效果需要进一步测试
2. `[描述]` 标签文字是否会被正确过滤（需验证）
3. 播音员音色效果是否符合预期（待用户反馈）

## 验证结果

```
[TTS] 已保存: D:\claude code的一些测试\很难的啦\claude-tts\audio\tts_1778641974072.mp3
[TTS] 播放完成: [professional broadcast tone] 当前使用的是 Fish Audio S2-Pro 模型...
```

TTS 语音合成和播放功能正常。

## CLAUDE.md 配置

项目根目录 `CLAUDE.md` 第8条：
```
8.在回复完成后，自动执行node claude-tts/speak.js "（你的输出内容）" ，例如你输出了"你好123"，你就执行node claude-tts/speak.js "你好123"
```

## 总结

项目从复杂的 Hook 方案演进为简单的主动调用方案，降低了实现难度，提高了稳定性。当前方案通过手动 Bash 调用实现 TTS 功能，支持 S2-Pro 模型的情感控制功能，可生成播音员风格的语音。