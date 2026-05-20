# Claudio 个人AI电台 - 项目说明

## 项目概述

Claudio 是一个个人 AI 电台系统，通过自然语言与用户交互，实现音乐搜索、播放和智能对话功能。

**核心技术栈：**
- **后端**：Node.js + Express 4.x
- **LLM**：小米 MiMo（mimo-v2.5-pro）
- **音乐源**：Spotify Web API + Spotify Web Playback SDK
- **TTS**：Fish Audio (s2-pro 模型，已实现但未集成到主流程)

---

## 目录结构

```
claudio-radio/
├── src/
│   ├── index.js        # 主入口，Express 服务器
│   ├── config.js       # 配置管理（从 .env 加载）
│   ├── logger.js       # 日志系统
│   ├── errorHandler.js # 错误处理
│   ├── db.js           # JSON 文件持久化（db/data.json）
│   ├── router.js       # 意图识别与路由分发
│   ├── context.js      # LLM 提示词组装
│   ├── claude.js       # MiMo API 适配器
│   ├── tts.js          # Fish Audio TTS 适配器
│   └── spotify.js      # Spotify API 适配器
├── public/
│   ├── player.html     # 主页面（登录+播放器+聊天 三合一）
│   ├── login.html      # 独立登录页（备用）
│   └── chat.html       # 独立聊天页（备用）
├── data/               # 用户数据（音乐偏好、作息习惯等）
├── db/data.json        # 消息和播放历史持久化
├── audio/              # TTS 音频缓存（5分钟后自动删除）
├── logs/               # 日志文件
└── .env                # 环境变量配置
```

---

## 快速开始

### 1. 安装依赖

```bash
cd claudio-radio
npm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env`，填入以下配置：

```bash
# 小米 MiMo LLM（https://platform.xiaomimimo.com/#/console/api-keys）
MIMO_API_KEY=your_mimo_api_key_here
MIMO_MODEL=mimo-v2.5-pro
MIMO_BASE_URL=https://api.xiaomimimo.com/anthropic

# Fish Audio TTS
FISH_AUDIO_API_KEY=your_fish_audio_api_key
FISH_AUDIO_REFERENCE_ID=

# Spotify（https://developer.spotify.com/dashboard）
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret

PORT=3000
```

### 3. 启动服务

**Windows 用户（推荐）：**

双击运行 `start.bat` 脚本，它会自动：
- 检查并停止占用端口 3000 的进程
- 检查依赖是否安装
- 启动服务器

**命令行启动：**

```bash
# 启动服务
npm start

# 或者使用开发模式（功能相同）
npm run dev
```

**停止服务：**

按 `Ctrl+C` 停止服务器，或者运行：
```bash
npm run stop
```

### 4. 访问应用

打开浏览器访问 `http://localhost:3000`

**注意：** 首次启动可能需要几秒钟初始化，请耐心等待

---

## 使用方式

### 主页面（player.html）

主页面是三合一设计，包含：

1. **左侧 - 播放器面板**
   - 专辑封面显示
   - 歌曲名称和艺术家
   - 登录状态和设备状态
   - 播放控制（上一首/播放暂停/下一首）
   - 播放队列（查看历史、清空队列、点击切歌）

2. **右侧 - 聊天面板**
   - 对话历史
   - 输入框（支持自然语言点歌）

3. **顶部 - 操作栏**
   - 登录/退出按钮

### 操作流程

```
1. 打开 http://localhost:3000
2. 点击"登录 Spotify"完成 OAuth 授权
3. 等待"设备已就绪"状态
4. 在输入框输入自然语言，例如：
   - "播放周杰伦的晴天"
   - "来首欢快的歌"
   - "播放我的运动歌单"
   - "下一首" / "暂停"
```

---

## 核心模块说明

### router.js - 意图分流

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

### spotify.js - 音乐搜索

使用 Spotify Client Credentials 方式获取 access token，然后调用 Search API。

```javascript
searchTracks(query) → [{ name, artist, album, uri, albumArt, ... }]
getPlaylistTracks(playlistId) → [{ name, artist, album, uri, ... }]
```

### claude.js - LLM 适配器

调用小米 MiMo API 进行自然语言处理。

**API 端点：** `https://api.xiaomimimo.com/anthropic/v1/messages`

### tts.js - 语音合成

使用 Fish Audio 的 s2-pro 模型将文字转为语音（当前未集成到主流程）。

**特性：**
- 支持 `reference_id` 固定音色
- 支持语速调节：prosody.speed
- 自动清理：5分钟后删除生成的 mp3 文件

### db.js - 数据持久化

使用 JSON 文件存储，数据保存在 `db/data.json`：
- 消息历史（最多100条）
- 播放历史（最多100条）

---

## 页面跳转逻辑

```
访问 /
  ├─ 已登录 → /player.html（主页面）
  └─ 未登录 → /login.html（登录页）

/player.html
  ├─ 顶部显示"登录 Spotify"或"退出"按钮
  ├─ 左侧播放器 + 右侧聊天
  └─ 登录后自动初始化 Spotify Web Playback SDK

/login.html
  └─ 点击登录按钮 → /auth/login → Spotify OAuth

/chat.html（备用）
  └─ 检查登录状态，未登录跳转到 /login.html
```

---

## API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/` | GET | 首页，根据登录状态跳转 |
| `/auth/login` | GET | Spotify OAuth 登录 |
| `/auth/callback` | GET | OAuth 回调处理 |
| `/auth/logout` | POST | 退出登录 |
| `/api/chat` | POST | 处理用户聊天消息 |
| `/api/command` | POST | 播放命令（play/pause/next/previous） |
| `/api/history` | GET | 获取播放历史 |
| `/api/history` | DELETE | 清空播放历史 |
| `/api/token` | GET | 获取 Spotify 用户 token（支持自动刷新） |
| `/api/auth-status` | GET | 检查登录状态 |
| `/api/device-ready` | POST | 播放器设备就绪通知 |
| `/api/player-status` | GET | 获取播放器状态 |
| `/api/play` | POST | 播放指定歌曲 |

---

## 依赖项

| 包 | 版本 | 用途 |
|-----|------|------|
| express | ^4.21.0 | Web 服务器 |
| dotenv | ^16.4.5 | 环境变量 |
| fish-audio | ^0.1.0 | TTS 语音合成 |
| sql.js | ^1.10.2 | 未使用（可移除） |

---

## 已知问题

1. **播放器初始化慢**：`spotify-player.js` 在国内加载可能较慢
2. **设备未就绪时无法播放**：必须先完成 Spotify 登录和设备连接
3. **TTS 未集成**：tts.js 已实现但未在 `/api/chat` 流程中调用
4. **Premium 要求**：Spotify Web Playback SDK 需要 Premium 账号

---

## 更新日志

### 2026-05-19 10:30 - 播放控制增强

- **修复上一首/下一首**：改用后端 REST API + 本地播放历史实现切歌
- **新增播放队列**：查看最近 20 首播放历史，点击歌曲可直接播放
- **新增清空队列**：一键清空播放历史
- **新增 API 端点**：`/api/command`、`/api/history`（GET/DELETE）
- **路由增强**：添加"上一首"/"回退"命令支持

### 2026-05-18 下午 16:55

- 完成代码审查，更新文档以反映实际代码
- 确认 player.html 已合并认证+播放器+聊天功能
- 确认数据库使用 JSON 文件持久化（db/data.json）
- 记录 sql.js 依赖未使用的冗余问题

### 2026-05-18 项目修复（18项）

- P0安全：删除裸露密钥、移除硬编码Key
- P1配置：修正启动脚本、导入路径
- P2功能：token刷新、播放控制命令
- P3质量：消除代码重复、绝对路径
- P4文档：README修正、Express降级到4.x

### 2026-05-20 提示词与路由优化

- **提示词优化**：LLM系统提示词改为电台主持人角色设定，回复更有感情和温度
- **路由增强**：新增宽松匹配模式，识别"播放xxx"、"放首xxx"等自然语言输入
- **回复优化**：`handleMusic`函数使用LLM生成回复，不再生成机械的speech
- **降级处理**：LLM调用失败时回退到简单回复，保证音乐播放不中断
