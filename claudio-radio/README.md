# Claudio 个人AI电台 - 项目说明

## 项目概述

Claudio 是一个沉浸式个人 AI 电台系统，通过自然语言与用户交互，实现智能选歌、自动连播和情感陪伴。DJ 能感知天气、时间、用户情绪，生成富有温度的过渡词，并与音乐同步播放。

**核心技术栈：**
- **后端**：Node.js + Express 4.x
- **LLM**：小米 MiMo（mimo-v2-flash，OpenAI 兼容格式）
- **音乐源**：Spotify Web API + Spotify Web Playback SDK
- **TTS**：Fish Audio（s2-pro 模型，集成到聊天和自动连播流程）
- **天气**：OpenWeather API（10 分钟缓存，DJ 播报融入天气）

---

## 目录结构

```
claudio-radio/
├── src/
│   ├── index.js            # 主入口，Express 服务器 + 所有 API 端点
│   ├── config.js           # 配置管理（从 .env 加载，含 LLM/TTS/Spotify/天气配置）
│   ├── logger.js           # 日志系统（控制台 + 按日期文件）
│   ├── errorHandler.js     # 错误处理（AppError + ErrorCodes）
│   ├── db.js               # JSON 文件持久化（消息/历史/偏好/计划/环境）
│   ├── router.js           # 意图识别与路由分发
│   ├── context.js          # Prompt 六片段组装（系统人设/用户资料/环境/历史/输入/轨迹）
│   ├── llm.js              # LLM API 适配器（对接 MiMo，api-key 认证）
│   ├── brain.js            # 大脑决策模块（LLM → 结构化动作 {say, play, reason}）
│   ├── actionSchema.js     # 动作类型定义、校验与降级（ActionTypes 枚举）
│   ├── weather.js          # OpenWeather 天气获取（10 分钟内存缓存）
│   ├── tts.js              # Fish Audio TTS 适配器（TTSPipeline 类）
│   ├── spotify.js          # Spotify 底层 API（fetchWithRetry 重试机制）
│   └── music/              # 音乐服务抽象层
│       ├── index.js        # 统一接口（策略模式，可扩展多平台）
│       └── spotifyProvider.js  # Spotify 适配器（标准化 track 结构）
├── prompts/
│   └── dj-persona.md       # DJ 角色人设 prompt（外部化管理）
├── public/
│   ├── player.html         # 主页面（播放器 + 聊天 + 播放历史 三合一）
│   ├── login.html          # 独立登录页（备用）
│   └── chat.html           # 独立聊天页（备用）
├── data/
│   ├── taste.md            # 音乐品味画像（7 维度分析结果）
│   ├── taste-meta.json     # 品味分析元数据（歌单 ID、歌曲数、更新时间）
│   ├── routines.md         # 日常习惯（用户自定义）
│   └── mood-rules.md       # 情绪规则（用户自定义）
├── user/                   # 用户自定义语料（优先级高于 data/）
├── db/data.json            # 消息、播放历史和用户偏好持久化
├── audio/                  # TTS 音频缓存
├── logs/                   # 日志文件
└── .env                    # 环境变量配置
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
# MiMo LLM（https://platform.xiaomimimo.com）
LLM_API_KEY=your_mimo_api_key_here
LLM_MODEL=mimo-v2-flash
LLM_BASE_URL=https://api.xiaomimimo.com/v1

# Fish Audio TTS（https://fish.audio）
FISH_AUDIO_API_KEY=your_fish_audio_api_key
FISH_AUDIO_REFERENCE_ID=

# Spotify（https://developer.spotify.com/dashboard）
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret

# 天气（可选，https://openweathermap.org）
OPENWEATHER_API_KEY=your_openweather_api_key
WEATHER_CITY=Beijing
WEATHER_LAT=39.9042
WEATHER_LON=116.4074

PORT=3000
```

### 3. 启动服务

```bash
npm start
# 或
npm run dev
```

启动后浏览器自动打开 `http://localhost:3000`。按 `Ctrl+C` 或点击退出按钮停止服务。

---

## 架构设计

```
用户输入 → router.js（意图分流）
              ├─ command → 播放控制
              ├─ music   → 搜索播放
              └─ llm     → brain.js（大脑决策）
                              ↓
                     llm.js → MiMo LLM
                              ↓
                     actionSchema.js（动作校验）
                              ↓
                     { say, play, reason, plan }
                              ↓
                     tts.js → Fish Audio（语音合成）
                     music/ → spotify.js（音乐播放）
```

**Prompt 组装（context.js）：** 六片段结构
1. 系统人设（从 `prompts/dj-persona.md` 加载）
2. 用户资料（taste 品味画像 + routines 日常习惯）
3. 环境注入（天气 + 时间 + 日程）
4. 播放历史（最近播放记录）
5. 用户输入
6. 执行轨迹

**语料优先级：** `user/` 目录 > `data/` 目录（用户可自定义覆盖默认模板）

---

## 核心功能

### 1. 智能选歌（情绪感知）

LLM 驱动的选歌系统，综合多维上下文：

- **对话历史**：最近 5 条用户对话，感知当前情绪
- **播放历史**：最近 10 首已播放，避免重复
- **用户品味**：从 `data/taste.md` 读取 7 维度品味画像
- **排除逻辑**：自动排除最近 15 首已播放歌曲
- **输出结构**：`{ trackId, reason, mood }`（mood 为判断的用户情绪）

### 2. 品味分析（Taste Analysis）

通过 Spotify Audio Features 分析用户音乐品味：

- 分页遍历整个歌单（上限 500 首，每页 50 首）
- 批量获取 Audio Features（每批 100 首）
- LLM 生成 7 维度品味画像：整体画像、流派偏好、艺术家偏好、地域语言、情绪氛围、风格标签、选歌建议
- **智能更新**：歌曲数变化 >10 首 或 距上次更新 >10 天才触发；支持 `force: true` 强制更新
- 元数据记录在 `taste-meta.json`，避免重复计算

### 3. 沉浸式过渡词

DJ 过渡词注入多种环境信息：

| 信息源 | 说明 |
|--------|------|
| 天气播报 | 首次播放强制包含，之后每小时检查变化后注入 |
| 整点提醒 | 检测跨越整点小时，生成中文时间段描述（凌晨/早上/中午/下午/晚上/深夜） |
| 创作背景 | 从 Spotify 获取专辑详情，LLM 生成 2-3 句创作背景和歌手故事 |
| 歌名同步 | LLM 用《》包裹歌名，计算语音中歌名出现的时间点 |

### 4. 歌名同步播放

TTS 过渡词中提到歌名时，小声开始播放下一首，TTS 结束后渐变回正常音量：

```
LLM 生成："上一首《晴天》很经典，接下来这首《七里香》..."
                                    ↑ 第二个 》 位置
                                    ÷ 4字/秒 = songNameDelayMs
                                    ↓
前端：TTS 播放到 songNameDelayMs 时 → 音量 0.08 开始播放下一首
TTS 结束 → 渐变回 0.5 正常音量
```

### 5. 三阶段预生成状态机

```
阶段1（红灯）- 选歌中    → POST /api/select-next（LLM 情绪选歌）
阶段2（黄灯）- 生成中    → POST /api/generate-speech-tts（过渡词 + TTS）
阶段3（绿灯）- 就绪     → 等待当前歌曲结束，无缝衔接
```

**三路径行为：**
- 绿灯：播过渡词 → 切歌
- 黄灯：立即切歌，取消后台生成
- 红灯：随机播放降级

**竞态保护：** `prepSongId` + `prepCancelled` 标志防止快速切歌时旧数据污染。

### 6. 天气感知

- OpenWeather API 实时获取（中文返回）
- 10 分钟内存缓存，避免频繁请求
- 启动时后台预读天气
- DJ 过渡词自动融入天气信息（如"外面正在下雨，来首温暖的歌"）

---

## 核心模块说明

### brain.js - 大脑决策

接收用户意图 prompt，调用 LLM 生成结构化动作响应。

```javascript
compute(prompt) → { say, play, reason, plan }
```

- `say`：DJ 播报文字
- `play`：播放指令（字符串=搜索词，对象=含 query/trackId/playlistId）
- `reason`：推理说明
- `plan`：计划信息
- 内置降级：LLM 失败时返回默认安慰话术

### actionSchema.js - 动作类型

6 种动作类型枚举：`say`、`play`、`reason`、`segue`、`plan`、`needsTool`

提供 `validateAction()` 校验、`extractAction()` 格式提取（兼容旧格式）、`fallbackAction()` 降级。

### music/ - 音乐服务抽象层

策略模式设计，通过 `options.provider` 选择底层实现（目前仅 Spotify）。

**统一接口：**
- `searchTracks(query)` — 搜索歌曲
- `getPlaylistTracks(playlistId)` — 获取歌单歌曲
- `getUserPlaylists(options)` — 获取用户歌单列表
- `getAllPlaylistTracks(playlistId)` — 分页获取整个歌单（上限 500 首）
- `getLikedSongs(options)` — 获取喜欢的歌曲
- `getAudioFeatures(trackIds)` — 获取 audio features
- `normalizeTrack(rawTrack)` — 标准化 track 结构

**标准 track 结构：**
```javascript
{ id, source, name, artist, album, albumArt, uri, playUrl, durationMs, raw }
```

### weather.js - 天气模块

```javascript
getWeather() → { provider, city, tempC, feelsLikeC, condition, humidity, updatedAt }
```

- 10 分钟内存缓存
- API Key 未配置或请求失败时返回占位对象，不抛异常

### llm.js - LLM 适配器

调用 MiMo API（OpenAI 兼容格式），使用 `api-key` header 认证。

**API 端点：** `{LLM_BASE_URL}/chat/completions`

### spotify.js - Spotify 底层 API

**重试机制：** `fetchWithRetry()` 带指数退避 + jitter，503/429 自动重试（最多 3 次），尊重 `Retry-After` header。

**新增能力：**
- `getAllPlaylistTracks()` — 分页获取整个歌单（上限 500 首）
- `getAllLikedSongs()` — 分页获取喜欢的歌曲
- `getAudioFeatures()` — 批量获取 audio features（每批 100 首）

### context.js - Prompt 组装

六片段组装架构，支持 `buildFragments()` + `buildPrompt()` 分离调用：

1. 系统提示词（从 `prompts/dj-persona.md` 文件加载）
2. 用户资料（taste + routines，优先从 `user/` 读取）
3. 环境注入（天气 + 时间 + 日程）
4. 播放历史
5. 用户输入
6. 执行轨迹

### db.js - 数据持久化

JSON 文件存储（`db/data.json`），内存 + 磁盘双存储。

**数据结构：**
- 消息历史（`messages`，最多 100 条）
- 播放历史（`playHistory`，最多 100 条，支持游标导航）
- 用户偏好（`prefs`，跨会话保留）
- 当天计划（`plans`，按日期索引）
- 环境状态（`environment`，天气/日程/更新时间）

---

## 自动连播机制

### 选歌流程

```
当前歌曲播放中
  ↓
POST /api/select-next
  ├─ 歌单全量缓存（首次拉取，内存缓存，歌单切换时刷新）
  ├─ 排除最近 15 首已播放
  ├─ 注入上下文：对话历史 + 播放历史 + 用户品味
  └─ LLM 返回 { trackId, reason, mood }
  ↓
POST /api/generate-speech-tts
  ├─ researchTrackBackground()：获取专辑详情 + LLM 生成创作背景
  ├─ 检查天气变化（每小时一次）
  ├─ 检查整点跨越（自动注入时间提醒）
  ├─ LLM 生成过渡词（用《》包裹歌名）
  └─ 计算 songNameDelayMs
  ↓
绿灯就绪 → 等待歌曲结束
```

### 歌曲结束处理

```
歌曲自然结束 / 用户点下一首
  ├─ 绿灯：playTTSWithMusic() → TTS + 歌名同步播放
  ├─ 黄灯：立即切歌，取消后台生成
  └─ 红灯：/api/next-track 随机播放
```

### 降级策略

- LLM 选歌失败 → 歌单内随机选歌
- LLM 过渡词失败 → 简单文字提示
- Spotify API 失败 → fetchWithRetry 自动重试（指数退避）

---

## API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/` | GET | 首页，根据登录状态跳转 |
| `/auth/login` | GET | Spotify OAuth 登录 |
| `/auth/callback` | GET | OAuth 回调处理 |
| `/api/token` | GET | 获取 Spotify 用户 token（支持自动刷新） |
| `/api/auth-status` | GET | 检查登录状态 |
| `/api/device-ready` | POST | 播放器设备就绪通知 |
| `/api/chat` | POST | 聊天消息（含 TTS 语音回复） |
| `/api/command` | POST | 播放命令（play/pause/next/previous） |
| `/api/play` | POST | 播放指定歌曲（支持 track 对象自动保存历史） |
| `/api/next-track` | POST | 用户主动下一首（排除最近 10 首，不经 LLM） |
| `/api/auto-next` | POST | 自动连播（含 LLM 过渡词 + TTS + songNameDelayMs） |
| `/api/select-next` | POST | 预生成阶段1：LLM 情绪选歌 |
| `/api/generate-speech-tts` | POST | 预生成阶段2：过渡词 + TTS + 歌名延迟 |
| `/api/user-playlists` | GET | 用户歌单列表 |
| `/api/playlist-preference` | POST | 保存歌单偏好 |
| `/api/history` | GET | 获取播放历史 |
| `/api/history` | DELETE | 清空播放历史 |
| `/api/analyze-taste` | POST | 音乐品味分析（智能增量更新） |
| `/api/shutdown` | POST | 关闭服务并退出程序 |

---

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `LLM_API_KEY` | 是 | MiMo API 密钥 |
| `LLM_MODEL` | 否 | 模型名（默认 `mimo-v2-flash`） |
| `LLM_BASE_URL` | 否 | API 地址（默认 `https://api.xiaomimimo.com/v1`） |
| `FISH_AUDIO_API_KEY` | 是 | Fish Audio TTS 密钥 |
| `FISH_AUDIO_REFERENCE_ID` | 否 | 固定音色 ID |
| `SPOTIFY_CLIENT_ID` | 是 | Spotify 应用 Client ID |
| `SPOTIFY_CLIENT_SECRET` | 是 | Spotify 应用 Client Secret |
| `OPENWEATHER_API_KEY` | 否 | OpenWeather 天气 API 密钥 |
| `WEATHER_CITY` | 否 | 城市名（默认 Beijing） |
| `WEATHER_LAT` | 否 | 纬度 |
| `WEATHER_LON` | 否 | 经度 |
| `PORT` | 否 | 服务端口（默认 3000） |

---

## 启动时自动清理

1. `tts.clearCache()` — 清理 `audio/` 目录下残留的 mp3 文件
2. `clearMessages()` — 清空上次会话的对话消息
3. `clearPlayHistory()` — 清空上次会话的播放历史
4. `refreshWeatherInBackground()` — 后台预读天气数据

**注意：** 歌单偏好（`prefs`）、计划（`plans`）和品味分析（`taste.md`）不受启动清理影响。

---

## 依赖项

| 包 | 版本 | 用途 |
|-----|------|------|
| express | ^4.21.0 | Web 服务器 |
| dotenv | ^16.4.5 | 环境变量加载 |
| fish-audio | ^0.1.0 | TTS 语音合成 |

---

## 已知问题

1. **播放器初始化慢**：`spotify-player.js` 在国内网络下加载可能较慢
2. **设备未就绪时无法播放**：必须先完成 Spotify 登录和设备连接
3. **Premium 要求**：Spotify Web Playback SDK 需要 Premium 账号
4. **LLM 限流/失败降级**：MiMo 限流或调用失败时，自动连播在歌单内随机选歌，过渡词回退到简单文字提示
5. **Liked Songs 歌单**：Spotify `/me/tracks` 端点已适配分页获取，但品味分析暂不支持
6. **`stop` 脚本依赖 Unix 工具**：`npm run stop` 使用 `grep`/`awk`/`xargs`，仅在 Git Bash 等环境下可用

---

## 暂缓功能

- **UPnP 家庭音响推送**：暂不实现设备发现和音频推送
- **飞书日程接入**：暂不接入飞书 API，环境注入中的日程字段标注为"暂未接入"

---

## 更新日志

### 2026-05-27 - 架构重构 + 智能选歌 + 沉浸式体验

**架构重构：**
- **LLM 切换**：DeepSeek → 小米 MiMo（mimo-v2-flash），认证方式改为 `api-key` header
- **模块重命名**：`claude.js` → `llm.js`，消除历史命名混淆
- **音乐抽象层**：新建 `src/music/` 目录，策略模式统一接口，解耦 Spotify 实现
- **大脑模块**：新建 `brain.js` + `actionSchema.js`，LLM 响应从纯文本升级为结构化动作 `{say, play, reason}`
- **Prompt 外部化**：系统人设从硬编码提取到 `prompts/dj-persona.md`
- **Context 重构**：六片段组装架构（系统人设/用户资料/环境/历史/输入/轨迹），支持 `user/` 目录自定义覆盖
- **天气模块**：新建 `weather.js`，OpenWeather API 集成，10 分钟缓存
- **API 重试**：`fetchWithRetry()` 指数退避 + jitter，503/429 自动重试

**智能选歌增强：**
- **情绪感知**：注入最近 5 条对话 + 播放历史 + 用户品味画像，LLM 返回 `{trackId, reason, mood}`
- **品味分析**：新增 `/api/analyze-taste` 端点，基于 Audio Features 生成 7 维度品味画像
- **歌单全量缓存**：首次拉取整个歌单（上限 500 首），内存缓存，歌单切换时刷新
- **排除逻辑**：选歌排除最近 15 首，随机播放排除最近 10 首

**沉浸式过渡词：**
- **天气播报**：首次播放强制包含，之后每小时检查变化后注入
- **整点提醒**：检测跨越整点小时，自动生成中文时间段描述
- **创作背景**：从 Spotify 获取专辑详情，LLM 生成创作背景和歌手故事
- **歌名同步播放**：LLM 用《》包裹歌名 → 计算时间点 → TTS 播放到该时刻小声开始播放下一首 → 渐变回正常音量

**前端增强：**
- **Taste 分析缓存**：10 分钟内不重复调用 `/api/analyze-taste`
- **DRM 错误自动重试**：检测到 widevine/license/DRM 错误时自动断开重连
- **歌曲结束双重检测**：`player_state_changed` 事件 + 1 秒进度轮询
- **播放历史修复**：封面丢失修复、过早写入修复、歌名同步修复

**清理：**
- 删除根目录冗余 `data/` 语料文件（代码只读取 `claudio-radio/data/`）
- 移除 3 个冗余 API 端点（`/api/playback-state`、`/api/player-status`、`/api/user-playlists/:id/tracks`）

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
