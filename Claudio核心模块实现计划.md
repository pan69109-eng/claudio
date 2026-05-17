# Claudio 个人AI电台 - 核心模块实现计划

## Context

构建一个个人 AI 电台系统，能够读懂用户听歌习惯、规划声音、像 DJ 那样播报。当前 TTS 模块已实现（S2-Pro 模型），但其他核心模块还未开发。架构基于四层设计，本次仅实现 Layer 2 本地大脑核心模块。

**用户确认方案：**
- 音乐源：Spotify Web API（官方 API，版权清晰）
- TTS 音色：reference_id（需先在 Fish Audio 平台创建音色）
- 实现范围：仅核心模块（无定时任务）

---

## 项目结构

```
claude-radio/
├── src/
│   ├── router.js      # 意图分流（入口）
│   ├── context.js     # 提示词组装
│   ├── claude.js      # 大脑适配器
│   ├── tts.js         # 声音管线
│   ├── spotify.js     # Spotify 适配器
│   ├── db.js          # SQLite 封装
│   └── index.js       # 主入口
├── data/              # 用户数据目录
│   ├── taste.md        # 音乐品味
│   ├── routines.md     # 作息习惯
│   ├── playlists.json  # 歌单
│   └── mood-rules.md   # 情绪规则
├── db/                # 数据库
└── audio/             # TTS 缓存
```

---

## 模块实现方案

### 1. router.js（意图分流）

**职责：** 用户输入的第一道处理关口，负责意图识别和任务分发。

**接口：**
```javascript
route(input: string): { type: 'command' | 'music' | 'llm', payload: any }
```

**算法：**
- 简单指令匹配（播放、暂停、下一首、音量等）
- 音乐意图匹配（搜索歌曲、播放歌单、风格需求）
- 兜底给 LLM 处理

```javascript
const COMMAND_PATTERNS = {
  play: /^(播放|开始|放歌)/i,
  pause: /^(暂停|stop)/i,
  next: /^(下一首|切歌)/i,
};

const MUSIC_PATTERNS = {
  search: /(来首|放首|点播)(.+)/i,
  playlist: /(放|播放)(我的|这个)?(.+)歌单/i,
  mood: /(来点|想听|放点)(.+)/i,
};
```

---

### 2. context.js（提示词组装）

**职责：** 将分散的用户数据聚合为 LLM 可理解的系统提示词。

**接口：**
```javascript
buildContext(userInput: string, env: EnvContext): Promise<PromptContext>
// 返回 { systemPrompt: string, contextData: object }
```

**数据源读取顺序：**
1. taste.md → 音乐品味
2. routines.md → 作息习惯
3. playlists.json → 歌单
4. mood-rules.md → 情绪规则
5. envContext → 环境注入（天气、时间）
6. recentHistory → 最近播放历史

---

### 3. claude.js（大脑适配器）

**职责：** 封装 Claude API 调用，处理流式输出和错误恢复。

**接口：**
```javascript
ask(prompt: string, context: PromptContext): Promise<ClaudeResponse>
askStream(prompt: string, context: PromptContext): AsyncGenerator<StreamChunk>
```

**LLM 返回结构（JSON）：**
```json
{
  "response_type": "music" | "speak" | "mixed",
  "speech": "DJ 播报文本",
  "actions": [
    { "type": "play", "track_id": "xxx" },
    { "type": "search", "query": "关键词" }
  ],
  "should_speak": true
}
```

**Fallback 机制：**
- 429 速率限制 → 等5秒重试
- 503 服务不可用 → 等2秒重试
- 最终 fallback → TTS 播报错误

---

### 4. tts.js（声音管线）

**职责：** 封装 Fish Audio TTS，支持 reference_id 音色克隆。

**接口：**
```javascript
class TTSPipeline {
  speak(text: string, options?: SpeakOptions): Promise<void>
  setVoice(referenceId: string): void
  clearCache(): void
}
```

**reference_id 实现：**
```javascript
const audioData = await client.textToSpeech.convert({
  text,
  format: 'mp3',
  reference_id: this.voiceId
}, 's2-pro');
```

---

### 5. spotify.js（音乐源适配器）

**职责：** 封装 Spotify Web API（搜索、播放控制）。

**接口：**
```javascript
class SpotifyAdapter {
  searchTracks(query: string): Promise<Track[]>
  searchPlaylists(query: string): Promise<Playlist[]>
  getPlaylistTracks(playlistId: string): Promise<Track[]>
  play(trackId: string): Promise<void>  // 需要 Premium
  pause(): Promise<void>
}
```

**Token 管理：** Client Credentials Flow，自动刷新

---

### 6. db.js（状态记忆）

**职责：** SQLite 持久化存储（WAL 模式）。

**接口：**
```javascript
class Database {
  saveMessage(role: string, content: string): number
  getMessages(limit: number): Message[]
  savePlay(track: Track): number
  getRecentPlays(limit: number): Track[]
}
```

**表结构：** messages, play_history, preferences

---

## 数据流

```
用户输入 → router.route()
              ├─ command → 直接执行 → tts.speak()
              ├─ music → spotify.search() → claude.ask() → tts.speak() + spotify.play()
              └─ llm → context.build() → claude.ask() → tts.speak()
```

---

## 关键文件参考

| 文件 | 说明 |
|------|------|
| `claude-tts/speak.js` | 现有 TTS 实现，改造为 tts.js 模块 |
| `claude-tts/package.json` | 现有依赖配置 |
| `TTS项目报告.md` | reference_id 使用说明 |

---

## 依赖安装

```bash
cd "D:\claude code的一些测试\很难的啦"
mkdir claude-radio && cd claude-radio
npm init -y
npm install fish-audio @anthropic-ai/sdk better-sqlite3
```

---

## 验证计划

### 单元测试
1. **router** - 指令匹配、模糊匹配、边界输入
2. **context** - 文件缺失降级、模板填充
3. **claude** - JSON 解析、流式输出、错误重试
4. **tts** - reference_id 音色切换
5. **db** - 并发读写、WAL 模式
6. **spotify** - Token 刷新、搜索结果

### 集成测试
1. 完整对话流程：输入 → 路由 → LLM → TTS 播放
2. 音乐播放：搜索 → 播放 → 历史记录

---

## 待用户确认

1. **reference_id 获取**：需要用户在 Fish Audio 平台上传参考音频创建音色
2. **Spotify API 凭证**：需要提供 Client ID 和 Client Secret（或授权）
3. **数据文件初始化**：taste.md、routines.md、playlists.json、mood-rules.md 的初始内容