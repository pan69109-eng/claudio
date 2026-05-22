# Claudio 个人AI电台 - 项目说明

## 项目概述

Claudio 是一个个人 AI 电台系统，通过自然语言与用户交互，实现音乐搜索、播放和智能对话功能。支持自动连播（LLM 选歌 + DJ 过渡词 + TTS 语音播报）。

**核心技术栈：**
- **后端**：Node.js + Express 4.x
- **LLM**：DeepSeek（deepseek-v4-flash，OpenAI 兼容格式）
- **音乐源**：Spotify Web API + Spotify Web Playback SDK
- **TTS**：Fish Audio (s2-pro 模型，已集成到聊天和自动连播流程)

---

## 目录结构

```
claudio-radio/
├── src/
│   ├── index.js        # 主入口，Express 服务器 + 所有 API 端点
│   ├── config.js       # 配置管理（从 .env 加载）
│   ├── logger.js       # 日志系统（控制台 + 按日期文件）
│   ├── errorHandler.js # 错误处理（AppError + ErrorCodes）
│   ├── db.js           # JSON 文件持久化（db/data.json）
│   ├── router.js       # 意图识别与路由分发
│   ├── context.js      # LLM 系统提示词组装
│   ├── claude.js       # LLM API 适配器（对接 DeepSeek）
│   ├── tts.js          # Fish Audio TTS 适配器（TTSPipeline 类）
│   └── spotify.js      # Spotify API 适配器（Client Credentials + 用户授权）
├── public/
│   ├── player.html     # 主页面（登录+播放器+聊天 三合一）
│   ├── login.html      # 独立登录页（备用）
│   └── chat.html       # 独立聊天页（备用）
├── data/               # 用户偏好数据（taste/routines/playlists/mood-rules，占位状态）
├── db/data.json        # 消息、播放历史和用户偏好持久化
├── audio/              # TTS 音频缓存（启动时自动清理，5分钟后自动删除）
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
# DeepSeek LLM（https://platform.deepseek.com）
LLM_API_KEY=your_deepseek_api_key_here
LLM_MODEL=deepseek-v4-flash
LLM_BASE_URL=https://api.deepseek.com

# Fish Audio TTS（https://fish.audio）
FISH_AUDIO_API_KEY=your_fish_audio_api_key
FISH_AUDIO_REFERENCE_ID=

# Spotify（https://developer.spotify.com/dashboard）
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret

PORT=3000
```

### 3. 启动服务

**命令行启动：**

```bash
npm start
# 或
npm run dev
```

**停止服务：**

按 `Ctrl+C`，或点击页面中的退出按钮。

### 4. 访问应用

启动后浏览器会自动打开 `http://localhost:3000`，无需手动操作。

---

## 使用方式

### 主页面（player.html）

主页面是三合一设计，包含：

1. **左侧 - 播放器面板**
   - 专辑封面显示（1:1 比例）
   - 歌曲名称和艺术家
   - 霓虹灯状态栏（预生成状态：红=选歌中 / 黄=生成过渡词中 / 绿=就绪）
   - 播放控制（上一首/播放暂停/下一首）
   - 播放历史（左侧滑出抽屉，毛玻璃+平滑动画，支持查看/清空/点击切歌）
   - 连播歌单选择器（自定义暗色下拉箭头，支持偏好记忆）

2. **右侧 - 聊天面板**
   - 对话历史
   - 输入框（支持自然语言点歌和对话）

3. **顶部 - 操作栏**
   - 登录/退出按钮（退出需确认，退出后强杀进程并显示退出页面）

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
| `command` | 播放控制指令 | 播放、暂停、下一首、上一首 |
| `music` | 音乐搜索播放 | 播放周杰伦的晴天 |
| `llm` | 通用对话 | 今天天气怎么样 |

**音乐意图子类型（4种）：**
- `playSearch`：直接播放（"播放xxx"）
- `search`：搜索播放（"来首xxx"、"放首xxx"、"点播xxx"）
- `playlist`：歌单播放（"放我的xxx歌单"）
- `mood`：情绪播放（"来点欢快的"、"想听xxx"）

### spotify.js - 音乐搜索与歌单

**Client Credentials 模式（服务端搜索）：**
```javascript
searchTracks(query) → [{ name, artist, album, uri, albumArt, ... }]
getPlaylistTracks(playlistId) → [{ name, artist, album, uri, ... }]
```

**用户授权模式（用户歌单）：**
```javascript
getUserPlaylists(userToken) → [{ id, name, trackCount, uri, tracksHref, ... }]
getUserPlaylistTracks(userToken, playlistId, tracksHref) → [{ ... }]
getLikedSongs(userToken) → [{ ... }]
```

**歌单可读性校验：** 批量检查歌单访问权限（每次5个），自动排除无权限/403歌单。

### claude.js - LLM 适配器

调用 DeepSeek API（OpenAI 兼容格式）进行自然语言处理。已关闭思考模式（`thinking: { type: 'disabled' }`）。

**API 端点：** `{LLM_BASE_URL}/chat/completions`

**文件命名说明：** 文件名 `claude.js` 为历史遗留（最初对接 Claude API，后切换为 MiMo，再切换到 DeepSeek），实际功能为通用 LLM 适配器。

### tts.js - 语音合成

导出 `TTSPipeline` 类，使用 Fish Audio 的 s2-pro 模型将文字转为语音。已集成到聊天（`handleLLM`）、音乐搜索（`handleMusic`）和自动连播（`auto-next`/`generate-speech-tts`）流程。

**特性：**
- 支持 `reference_id` 固定音色（通过 `FISH_AUDIO_REFERENCE_ID` 环境变量配置）
- 支持语速调节：`prosody.speed`（默认 1.0）
- 自动清理：5分钟后删除生成的 mp3 文件
- 文本预处理：自动清除换行符、特殊字符，波浪号替换为逗号

### db.js - 数据持久化

使用 JSON 文件存储，数据保存在 `db/data.json`。内存 + 磁盘双存储模式，启动时从磁盘加载。

**数据结构：**
- 消息历史（`messages`，最多100条，重启时清空）
- 播放历史（`playHistory`，最多100条，重启时清空，支持游标导航）
- 用户偏好（`prefs`，跨会话保留，不受重启影响）

**导出函数：**
`initDb`, `saveMessage`, `getMessages`, `savePlay`, `getRecentPlays`, `getNextTrack`, `getPreviousTrack`, `getCurrentTrack`, `setCurrentTrackByUri`, `setCurrentTrackById`, `clearPlayHistory`, `clearMessages`, `savePlaylistPreference`, `getPlaylistPreference`

---

## 自动连播机制（三阶段状态机）

歌曲播放时自动预生成下一首，三个阶段：

```
阶段1（红）- 选歌中：POST /api/select-next → LLM 从歌单中选下一首
阶段2（黄）- 生成过渡词中：POST /api/generate-speech-tts → LLM 生成 DJ 过渡词 + TTS 语音
阶段3（绿）- 就绪：过渡词和 TTS 已就绪，等待当前歌曲结束
```

**三路径行为：**
- **绿灯（ready）**：播过渡词 → 切歌，无缝衔接
- **黄灯（speech-pending）**：立即切歌，取消后台 LLM/TTS 生成
- **红灯（selecting）**：回退到 `/api/next-track` 随机播放

**竞态保护：** 前端维护 `prepSongId` + `prepCancelled` 标志，防止快速切歌时旧预生成数据污染。

**降级策略：** LLM 选歌失败 → 歌单内随机选歌（不跳到搜索）；LLM 过渡词失败 → 使用简单文字提示。

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
| `/api/chat` | POST | 处理用户聊天消息（含 TTS 语音回复） |
| `/api/command` | POST | 播放命令（play/pause/next/previous） |
| `/api/history` | GET | 获取播放历史 |
| `/api/history` | DELETE | 清空播放历史 |
| `/api/token` | GET | 获取 Spotify 用户 token（支持自动刷新） |
| `/api/auth-status` | GET | 检查登录状态 |
| `/api/device-ready` | POST | 播放器设备就绪通知 |
| `/api/playback-state` | POST | 播放状态更新（前端上报） |
| `/api/player-status` | GET | 获取播放器状态 |
| `/api/play` | POST | 播放指定歌曲（支持 historyId 和 uri） |
| `/api/next-track` | POST | 用户主动点击下一首（不经 LLM/TTS） |
| `/api/auto-next` | POST | 自动连播（歌曲自然结束，含 LLM 过渡词 + TTS） |
| `/api/select-next` | POST | 预生成阶段1：LLM 选歌 |
| `/api/generate-speech-tts` | POST | 预生成阶段2：过渡词 + TTS |
| `/api/user-playlists` | GET | 获取用户歌单列表（含偏好信息） |
| `/api/user-playlists/:id/tracks` | GET | 获取指定歌单曲目 |
| `/api/playlist-preference` | POST | 保存歌单偏好 |
| `/api/shutdown` | POST | 关闭服务并退出程序 |

---

## 启动时自动清理

服务器启动时执行以下清理操作：

1. `tts.clearCache()` — 清理 `audio/` 目录下残留的 mp3 文件
2. `clearMessages()` — 清空上次会话的对话消息
3. `clearPlayHistory()` — 清空上次会话的播放历史

**注意：** 歌单偏好（`prefs`）独立于消息和播放历史，不受启动清理影响。

---

## 依赖项

| 包 | 版本 | 用途 |
|-----|------|------|
| express | ^4.21.0 | Web 服务器 |
| dotenv | ^16.4.5 | 环境变量加载 |
| fish-audio | ^0.1.0 | TTS 语音合成 |
| sql.js | ^1.10.2 | 未使用（冗余依赖，可移除） |

---

## 已知问题

1. **播放器初始化慢**：`spotify-player.js` 在国内网络下加载可能较慢
2. **设备未就绪时无法播放**：必须先完成 Spotify 登录和设备连接
3. **Premium 要求**：Spotify Web Playback SDK 需要 Premium 账号
4. **LLM 限流/失败降级**：DeepSeek 限流或调用失败时，自动连播在歌单内随机选歌（不跳到搜索），过渡词回退到简单文字提示
5. **Liked Songs 歌单不支持连播**：Spotify `/me/tracks` 端点与普通歌单数据结构不同，暂未适配自动连播
6. **`stop` 脚本依赖 Unix 工具**：`npm run stop` 使用 `grep`/`awk`/`xargs`，仅在 Git Bash 等环境下可用
7. **文件名 `claude.js` 过时**：实际对接的是 DeepSeek API（历史遗留命名）
8. **`config.js` 中 `db.path` 未使用**：数据库路径在 `db.js` 中硬编码为 `../db/data.json`

---

## 更新日志

### 2026-05-22 - UI 重构 + 系统优化

- **UI 布局重构**：去掉固定高度限制，Grid 自动填满视口，封面保持 1:1
- **侧边抽屉**：播放历史从展开面板改为左侧滑出抽屉，毛玻璃+平滑动画
- **歌单选择器优化**：自定义暗色下拉箭头、毛玻璃背景、绿色发光焦点环
- **启动自动化**：自动打开浏览器、自动清理残留 mp3 和对话/播放历史
- **歌单偏好记忆**：记住上次选择的歌单，重启自动恢复，不可用时回退默认
- **三阶段预生成**：选歌 → 过渡词+TTS → 就绪，霓虹灯状态指示，竞态保护
- **TTS 打断**：点击下一首立即停止 TTS 语音，直接切歌
- **退出机制**：退出按钮 → 确认 → 强杀进程 → 显示退出页面
- **新增 API**：`/api/shutdown`、`/api/playlist-preference`、`/api/select-next`、`/api/generate-speech-tts`

### 2026-05-21 - 歌单修复 + LLM切换 + 自动播放优化

- **歌单 trackCount 修复**：适配 Spotify API 变更（`tracks` → `items` 字段），修复曲目数显示为0
- **LLM 切换**：智谱 GLM → DeepSeek（deepseek-v4-flash），环境变量全部更新
- **403 歌单处理**：批量校验歌单可读性，自动排除无权限歌单
- **自动播放增强**：LLM 选歌失败时在歌单内随机降级，不再跳到搜索
- **防重复预生成**：前端添加 `isPreGenerating` 锁
- **关闭思考模式**：`thinking: { type: 'disabled' }`

### 2026-05-20 - 提示词与路由优化

- **提示词优化**：LLM 系统提示词改为电台主持人角色设定，回复更有感情和温度
- **路由增强**：新增宽松匹配模式，识别"播放xxx"、"放首xxx"等自然语言输入
- **回复优化**：`handleMusic` 函数使用 LLM 生成回复，不再生成机械的 speech
- **降级处理**：LLM 调用失败时回退到简单回复，保证音乐播放不中断

### 2026-05-19 - 播放控制增强

- **修复上一首/下一首**：改用后端 REST API + 本地播放历史实现切歌
- **新增播放队列**：查看最近 20 首播放历史，点击歌曲可直接播放，支持清空
- **新增 API 端点**：`/api/command`、`/api/history`（GET/DELETE）
- **路由增强**：添加"上一首"/"回退"命令支持

### 2026-05-18 - 项目修复（18项）

- P0安全：删除裸露密钥、移除硬编码Key、清除文档密钥、Git移除node_modules
- P1配置：修正启动脚本、导入路径、.env.example
- P2功能：token刷新、播放控制命令、TTS集成、playlist功能
- P3质量：消除代码重复、绝对路径、db持久化、登录检查
- P4文档：README修正、HTML charset、Express降级到4.x
