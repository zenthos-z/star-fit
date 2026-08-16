![Version](https://img.shields.io/badge/version-2.0.0-blue)
![Node](https://img.shields.io/badge/node-%3E%3D18-green)
![License](https://img.shields.io/badge/license-MIT-green)

<p align="center">
  <img src="docs/cover.png" alt="Starfit cover" width="100%">
</p>

# 🏋️ Starfit — AI 时代的健身搭子

> 快乐至上 · AI 隐形 · 丰俭由人 · 数据主权

Starfit 是一个移动端优先的健身记录与 AI 教练应用：本地优先存储、流式 AI 对话、
uiHint 多态卡片渲染，以及一个可自托管的全栈管理台。

![Starfit 首页](docs/screenshots/frontend-home.png)

---

## 🎯 为什么选择 Starfit？

| 传统健身 APP | Starfit |
|------------|----------|
| ❌ 臃肿的"全家桶"，花里胡哨的界面 | ✅ 简洁专注，只做你需要的功能 |
| ❌ 制造焦虑的"电子教官"，红点打卡 | ✅ 温柔的 AI 搭子，需要时出现 |
| ❌ 数据被绑架，无法导出 | ✅ 数据完全开放，可导出 Markdown |
| ❌ 隐私黑盒，数据上传至云端 | ✅ 本地优先存储，可选同步 |
| ❌ 制定计划复杂，一个个添加动作 | ✅ AI 智能预填，自动调整计划 |
| ❌ 分享正反馈有限 | ✅ 丰富的数据可视化与分享 |

---

## 🎭 设计哲学

### 快乐至上 🌈
- ❌ **拒绝**：红点打卡、断签警告、制造焦虑的"电子教官"
- ✅ **提供**：温柔的 AI 搭子，在你需要时出现，不需要时隐身

### AI 隐形 👻
- ❌ **拒绝**：教你做事的老师、强制推荐的课程
- ✅ **提供**：预填数据的助理，基于你的习惯默默优化

### 丰俭由人 ⚖️
- ❌ **拒绝**：小白被复杂功能淹没、老鸟被固定流程束缚
- ✅ **提供**：小白拿来即用、老鸟掌控细节

### 数据主权 🔐
- ❌ **拒绝**：数据被锁死在服务器、隐私黑盒
- ✅ **提供**：数据完全开放、Markdown 导出、本地优先存储

---

## ✨ 核心特性

### 🤖 AI 教练（Deep Agents 内核）

**功能描述**：智能教练基于 [Deep Agents](https://github.com/langchain-ai/deepagents) 内核——单 Agent + Skill 路由，SSE 流式输出。

**技术实现**：
- **AgentService 端口** + **DeepAgentService** 实现，更换内核只需换一个实现类
- **Skill 路由**：chat / plan / diagnose / card 等场景由技能知识驱动
- **领域技能知识**：训练动作类型指南、计划生成、力量训练设计等知识资产挂载给 Agent
- **MCP 式工具层**：Repository 能力暴露为 Agent 工具，数据访问不越界
- **uiHint 校验回路**：卡片输出经 Zod 校验，不合法自动重试

**用户价值**：
- 💬 流式对话，像真人教练一样即时响应
- 📋 智能生成训练计划，一键应用到训练日
- 🧠 记住你的伤病史、偏好和目标，建议越来越贴身

### 🔄 双轨存储架构

**功能描述**：采用"硬轨 + 软轨"双轨制，兼顾结构化分析与语义化洞察。

**技术实现**：
- **Hard Track**：PostgreSQL 存储组数、次数、重量等结构化数据
- **Soft Track**：用户洞察存储标签、摘要等语义化数据
- **L1-L3 分层**：React State → IndexedDB → PostgreSQL，确保离线可用

**用户价值**：
- 💾 **离线优先**：健身房无网络也能正常记录
- 📊 **深度分析**：结构化数据支持精确计算
- 🧠 **智能记忆**：语义化洞察支持 AI 上下文理解
- 🔄 **自动同步**：网络恢复后自动上传本地数据（Outbox 队列）

### 🎨 多态卡片渲染

**功能描述**：基于 `uiHint` 驱动的多态卡片系统，AI 可以动态渲染不同类型的交互组件。

**技术实现**：
- **ExerciseRenderer** 策略分发逻辑
- **卡片类型**：PLAN、SUMMARY、SURVEY、INSTRUCTION、DEVIATION 等
- **Batch Ops 协议**：卡片操作原子化修改状态
- **Framer Motion** 流畅动画

**用户价值**：
- 📋 **计划卡片**：一键应用 AI 建议的训练计划
- 📊 **总结卡片**：自动生成训练战报，支持保存图片
- 📝 **调查卡片**：动态问题，快速收集体感数据
- 🎯 **所见即所得**：卡片操作直接反映到训练执行页

### 📴 离线优先设计

**功能描述**：优先使用本地存储，确保在健身房等网络环境较差时依然能流畅记录训练。

- **IndexedDB** 本地持久化（Dexie）
- **Outbox 队列**：离线操作暂存、网络恢复重放
- **乐观更新**：UI 立即响应，后台同步
- **增量同步**：Push/Pull 机制

### 🎬 智能视频管理

**功能描述**：完整的视频资源协议支持，自动转码、缩略图生成、多清晰度选择。

- **FFmpeg** 视频处理（360p/720p/1080p 多清晰度压缩）
- 处理进度实时反馈
- 自动缩略图生成
- Video Asset Schema 标准化，移动端自动选择合适清晰度

### 🎛️ 管理控制台

**功能描述**：自托管的后台管理系统，管理动作库、用户数据与视频资源。

- **动作库管理**：可视化编辑、富文本（TipTap）、视频关联
- **用户数据管理**：用户画像查看、数据导出
- **视频资源管理**：上传、转码、缩略图生成
- **系统配置**：AI 模型多 provider 配置（gemini / openai / deepseek…）

---

## 🏗️ 系统架构

### 整体架构

```mermaid
graph TD
    subgraph Frontend ["📱 前端应用 (React 19 + Vite, Capacitor)"]
        direction TB
        UI["🎨 UI + 多态卡片渲染器"]
        IDB["💾 IndexedDB 本地存储"]
        SSE["🔌 SSE 流式客户端"]
    end

    subgraph Backend ["🖥️ 后端服务 (Fastify 5)"]
        direction TB
        CHAT["🎮 /api/chat (SSE)"]
        SYNC["🔄 同步服务"]
        VIDEO["🎬 视频处理服务"]
        ADMIN["⚙️ 管理控制台 API"]
        AGENT["🧠 AgentService 端口"]
        MCP["🔧 MCP 式工具层"]
    end

    subgraph DeepAgent ["🤖 DeepAgentService（Deep Agents 内核）"]
        direction TB
        SKILL["📚 Skill 路由<br/>(chat/plan/diagnose/card)"]
        KNOW["🧠 领域技能知识<br/>(动作指南/计划生成/力量设计)"]
        HINT["🎴 uiHint 提取 + 校验回路"]
        LLM["✨ 多 Provider LLM<br/>(Gemini/OpenAI/DeepSeek…)"]
    end

    subgraph Storage ["💾 PostgreSQL + pgvector"]
        direction TB
        DB[("🗄️ 结构化数据<br/>Hard Track")]
        VEC[("🧠 用户洞察<br/>Soft Track")]
        FILES["📁 文件存储<br/>(视频/图片)"]
    end

    UI -.->|读写| IDB
    UI -->|流式对话| SSE
    SSE <==> CHAT
    CHAT --> AGENT
    AGENT --> DeepAgent
    SKILL --- KNOW
    HINT --- LLM
    AGENT -->|工具调用| MCP
    MCP ==> DB
    SYNC <==> DB
    VIDEO ==> FILES
    ADMIN ==> DB
```

### L1-L3 存储分层

```mermaid
graph LR
    subgraph L1 ["⚡ L1: React State"]
        A["🎯 实时状态<br/>< 16ms UI 响应"]
    end
    subgraph L2 ["💾 L2: IndexedDB"]
        B["📦 离线缓存<br/>事件缓冲"]
        C["📤 Outbox 队列<br/>重放机制"]
    end
    subgraph L3 ["🗄️ L3: PostgreSQL"]
        D[("🗄️ 结构化数据<br/>Hard Track")]
        E[("🧠 用户洞察<br/>Soft Track")]
    end
    A <==>|"实时同步"| B
    B <==>|"增量同步"| D
    C -.->|"后台上传"| D
    B -.->|"语义同步"| E
```

---

## 🛠️ 技术栈

| 层级 | 技术选型 | 用途 |
|------|----------|------|
| **前端框架** | React 19 + Vite 6 | UI 渲染与构建 |
| **状态管理** | React Context | 全局状态管理 |
| **本地存储** | IndexedDB + Dexie | 离线数据持久化 |
| **移动端** | Capacitor 8 | Android 打包 |
| **富文本编辑** | TipTap | 管理控制台内容编辑 |
| **动画库** | Framer Motion | 卡片流畅动画 |
| **后端框架** | Fastify 5 | API 服务 |
| **Agent 内核** | Deep Agents | 单 Agent + Skill 路由 + SSE 流式 |
| **LLM** | Gemini / OpenAI / DeepSeek（多 provider adapter） | 大语言模型 |
| **数据库** | PostgreSQL + pgvector | 结构化数据与向量检索 |
| **测试** | Vitest + Playwright | 单元测试与 E2E |
| **文档** | VitePress | 文档站点 |
| **视频处理** | FFmpeg | 视频转码与压缩 |

---

## 🚀 快速开始

### 环境要求

- **Node.js**: v18 或更高版本
- **PostgreSQL**（含 pgvector 扩展；仅 AI 分析与云同步功能需要）
- **Git**

### 安装步骤

1. **克隆仓库:**

    ```bash
    git clone https://github.com/zenthos-z/star-fit.git
    cd star-fit
    ```

2. **安装依赖:**

    ```bash
    npm install
    ```

3. **配置环境:**

    进入 `backend/` 目录，将 `.env.local.example` 复制为 `.env.local`，
    填入你的 API 密钥与数据库连接：

    ```env
    AI_PROVIDER=gemini
    GOOGLE_API_KEY=your_api_key_here
    DATABASE_URL=postgresql://user:pass@localhost:5432/starfit
    ```

### 运行应用

**后端**（端口 43111）：

```bash
cd backend
npm install
npm run dev
```

**前端**（端口 43112，另开一个终端）：

```bash
npm run dev
```

访问 `http://127.0.0.1:43112` 即可看到应用；管理台入口在 `http://127.0.0.1:43112/admin.html`。

**文档站点**（可选）：

```bash
npm run docs:dev
```

### Android 构建

```bash
npm run build
npx cap sync android
cd android
./gradlew assembleRelease   # 产物在 android/app/build/outputs/apk/
```

> Release 签名：在 `android/` 下放置 `keystore.properties`（不进 git）并在
> `android/app/build.gradle` 中已读取。没有该文件时自动退回 debug 签名，便于本地安装测试。

---

## 📁 项目结构

```
star-fit/
├── src/                    # 前端 React 源码
│   ├── v2/                 #   V2 新架构（components/hooks/services/storage）
│   ├── admin/v2/           #   管理控制台
│   └── components/ai/      #   AI 对话 UI
├── components/             # 过渡期旧组件
├── services/               # 前端服务层
├── storage/                # IndexedDB 适配
├── backend/                # Fastify 后端
│   └── src/
│       ├── controllers/    #   API 控制器
│       ├── services/
│       │   ├── agent/      #   Deep Agents 内核（AgentService/DeepAgentService/skillLoader/mcpTools/uiHint 校验）
│       │   └── mas/skills/ #   领域技能知识（动作指南/计划生成/力量设计）
│       ├── db/postgresql/  #   schema、migrations、repository
│       └── schemas/        #   Zod 数据校验
├── shared/contracts/       # 前后端数据契约（唯一来源）
├── android/                # Capacitor Android 壳
├── docs-site/              # VitePress 文档站点
├── docs/                   # 领域知识与分析资料
├── registry/               # 固化知识库（动作标准库）
├── packages/               # 共享工具包（e2e-link-checker）
├── scripts/                # 工程 scripts
└── tests/                  # 测试
```

---

## 🛠️ 核心接口

### AI 对话

- `POST /api/chat` — SSE 流式对话（uiHint 卡片随流输出）
- `POST /api/agent/plan` — 基于当前状态生成结构化训练计划（JSON）

### 数据同步

- `POST /api/sync/push` — 前端增量数据（Sessions/RPE）上行同步
- `GET /api/sync/pull` — 拉取最新结构化数据与配置

### 内容与媒体

- `GET /api/tutorial` — 获取动作教程（Markdown）与关联媒体引用
- `POST /api/media/upload` — 上传训练视频/图片资源（支持分片上传）
- `GET /api/history/summary` — 获取 AI 聚合的历史训练快照

---

## 📚 文档

完整文档在 VitePress 文档站：**https://zenthos-z.github.io/star-fit/**（本地 `npm run docs:dev`）：

- [项目简介](docs-site/getting-started/introduction.md) · [快速开始](docs-site/getting-started/quick-start.md) · [设计理念](docs-site/getting-started/design-philosophy.md)
- [数据协议](docs-site/concepts/data-protocol.md) · [同步系统](docs-site/concepts/sync-system.md) · [AI 教练](docs-site/concepts/ai-coach.md) · [视频管理](docs-site/concepts/video-management.md)
- [数据流](docs-site/architecture/data-flow.md) · [三态数据流](docs-site/architecture/three-state-data-flow.md)
- [PostgreSQL Schema](docs-site/database/postgresql-schema.md) · [Repository 层](docs-site/database/repository-layer.md) · [迁移指南](docs-site/database/migration-guide.md)
- [UI 设计系统](docs-site/ui-guides/README.md)（颜色 / 字体 / 间距 / 动效 / 卡片 / 气泡）
- [贡献指南](docs-site/development/contributing.md) · [目录规范](docs-site/development/directory-conventions.md) · [部署](docs-site/development/deployment.md)

---

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request。在提交代码前，请确保：

1. 通过类型检查（`npm run typecheck`）
2. 通过单元测试（`npm run test:run`）
3. 更新相关文档（docs-site）

---

## 📜 许可证

[MIT](LICENSE) · Copyright © 2025-2026 zenthos-z

---

**项目版本**: v2.0.0
**维护者**: Starfit Development Team
