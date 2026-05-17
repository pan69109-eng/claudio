# Claudio 个人AI电台 - 项目说明

## 项目概述

Claudio 是一个个人 AI 电台系统，通过自然语言与用户交互，实现音乐搜索、播放和智能对话功能。

**核心技术栈：**
- **后端**：Node.js + Express
- **LLM**：MiniMax-M2.7 模型
- **音乐源**：Spotify Web API + Spotify Web Playback SDK
- **TTS**：Fish Audio (s2-pro 模型)

---

## 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         用户端                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   chat.html ←─────→ /api/chat ←─────→ index.js (主服务器)       │
│                                       │                          │
│   player.html ←──→ /auth/*           │                          │
│                  ←──→ /api/*         │                          │
│                                       │                          │
│                              ┌────────┴─────────┐                │
│                              │                  │                │
│                         router.js         spotify.js             │
│                              │                  │                │
│                         context.js         searchTracks()         │
│                              │                  │                │
│                         claude.js              ↓                │
│                              │           Spotify API              │
│                         tts.js (TTS)                                │
│                              │                                      │
│                         fish-audio (s2-pro)                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 目录结构

```
claudio-radio/
├── src/
│   ├── index.js       # 主入口，Express 服务器
│   ├── config.js       # 配置管理（从 .env 加载）
│   ├── logger.js      # 日志系统
│   ├── errorHandler.js # 错误处理
│   ├── db.js          # 内存数据库（消息存储、播放历史）
│   ├── router.js      # 意图识别与路由分发
│   ├── context.js     # LLM 提示词组装
│   ├── claude.js      # MiniMax API 适配器
│   ├── tts.js         # Fish Audio TTS 适配器
│   └── spotify.js     # Spotify API 适配器
├── public/
│   ├── index.html     # 首页（自动跳转）
│   ├── chat.html      # 聊天测试页面
│   ├── player.html    # Spotify 播放器页面
│   └── login.html     # 登录页面
├── data/              # 用户数据（音乐偏好、作息习惯等）
├── audio/             # TTS 音频缓存（5分钟后自动删除）
├── logs/              # 日志文件
└── .env               # 环境变量配置
```

---

## 核心模块说明

### 1. router.js - 意图分流

将用户输入分为三类：

| 类型 | 说明 | 示例 |
|------|------|------|
| `command` | 播放控制指令 | 播放、暂停、下一首 |
| `music` | 音乐搜索播放 | 播放周杰伦的晴天 |
| `llm` | 通用对话 | 今天天气怎么样 |

**音乐意图子类型：**
- `playSearch`：直接播放（"播放xxx"）
- `search`：搜索播放（"来首xxx"、"放首xxx"）
- `playlist`：歌单播放（"放我的xxx歌单"）
- `mood`：情绪播放（"来点欢快的"）

### 2. spotify.js - 音乐搜索

使用 Spotify Client Credentials 方式获取 access token，然后调用 Search API。

**主要函数：**
```javascript
searchTracks(query) → [{ name, artist, album, uri, ... }]
```

**注意：** 搜索时自动在查询词后添加空格，例如 "周杰伦 晴天"

### 3. claude.js - LLM 适配器

调用 MiniMax-M2.7 API 进行自然语言处理。

**API 端点：** `https://api.minimaxi.com/anthropic/v1/messages`

**请求格式：**
```javascript
{
  model: 'MiniMax-M2.7',
  max_tokens: 1024,
  system: systemPrompt,  // 包含用户偏好、上下文等
  messages: [{ role: 'user', content: prompt }]
}
```

### 4. tts.js - 语音合成

使用 Fish Audio 的 s2-pro 模型将文字转为语音。

**特性：**
- 支持情感标签：`[happy]`、`[sad]`、`[professional broadcast tone]`
- 可调语速：prosody.speed (默认 1.0)
- 自动清理：5分钟后删除生成的 mp3 文件

### 5. index.js - 主服务器

**API 端点：**

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/chat` | POST | 处理用户聊天消息 |
| `/api/token` | GET | 获取 Spotify 用户 token |
| `/api/device-ready` | POST | 播放器设备就绪通知 |
| `/auth/login` | GET | Spotify OAuth 登录 |
| `/auth/callback` | GET | OAuth 回调处理 |

**播放流程：**
1. 用户发送"播放周杰伦的晴天"
2. router 识别为 `music` + `playSearch`
3. spotify.js 搜索歌曲，获取 uri
4. 调用 `/v1/me/player/play?device_id={deviceId}` 播放
5. TTS 播报"现在播放：晴天，来自 Jay Chou"

---

## 用户交互流程

### 方式一：播放器页面（推荐）

```
1. 打开 http://127.0.0.1:3000/player.html
2. 点击"使用 Spotify 登录"
3. 完成 OAuth 授权
4. 等待"✓ 设备已就绪"
5. 在同一页面可控制播放/暂停/切歌
```

### 方式二：聊天页面

```
1. 先在 player.html 完成登录和设备连接
2. 打开 http://127.0.0.1:3000/chat.html
3. 输入"播放周杰伦的晴天"
4. 系统自动搜索并通过 Spotify 播放
```

---

## 配置说明 (.env)

```bash
# MiniMax LLM
MINIMAX_API_KEY=your_minimax_api_key

# Fish Audio TTS
FISH_AUDIO_API_KEY=your_fish_audio_api_key
FISH_AUDIO_REFERENCE_ID=optional_reference_id

# Spotify
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
```

---

## 依赖项

| 包 | 版本 | 用途 |
|-----|------|------|
| express | ^5.2.1 | Web 服务器 |
| fish-audio | ^0.1.0 | TTS 语音合成 |
| dotenv | ^16.4.5 | 环境变量 |

---

## 已知问题

1. **播放器初始化慢**：`spotify-player.js` 在国内加载可能较慢
2. **设备未就绪时无法播放**：必须先在 player.html 完成 Spotify 登录和设备连接
3. **中文编码**：日志中中文可能显示为乱码，但不影响实际功能
4. **TTS 暂未集成**：目前 chat.html 流程中 TTS 未启用

---

## 启动方式

```bash
cd claudio-radio
node src/index.js
```

服务启动后访问：
- http://127.0.0.1:3000/ - 自动跳转到登录或播放器
- http://127.0.0.1:3000/player.html - Spotify 播放器
- http://127.0.0.1:3000/chat.html - 聊天测试页面