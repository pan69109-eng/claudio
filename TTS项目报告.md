# Claude Code TTS 配音项目 - 项目报告

## 项目时间
- 2026-05-12 创建
- 2026-05-13 完成整理

## 项目背景
实现 Claude Code 回复内容自动转换为语音播放功能

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

## 使用方式

```bash
node claude-tts/speak.js "你想要听的文字"
```

## Fish Audio API 配置

- API Key: `c2677f043cad46ed8f54ec5c58998f61`
- 包名: `fish-audio`
- 客户端类: `FishAudioClient`
- 语速: 1.1（略快）

## 验证结果

```
[TTS] 已保存: D:\claude code的一些测试\很难的啦\claude-tts\audio\tts_1778633065602.mp3
[TTS] 播放完成: 主人~，我是 Claude Code，一只由 Anthrop...
```

TTS 语音合成和播放功能正常。

## CLAUDE.md 配置

项目根目录 `CLAUDE.md` 第8条：
```
8.在回复完成后，自动执行node claude-tts/speak.js "（你的输出内容）" ，例如你输出了"你好123"，你就执行node claude-tts/speak.js "你好123"
```

## 总结

项目从复杂的 Hook 方案演进为简单的主动调用方案，降低了实现难度，提高了稳定性。当前方案通过手动 Bash 调用实现 TTS 功能，满足基本需求。