# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目简介

Starfit — 移动端优先的健身记录与 AI 教练应用。前端 React 19 + Vite（Capacitor 打包 Android），
后端 Fastify 5 + PostgreSQL(pgvector)，Agent 内核为 Deep Agents（单 Agent + Skill 路由 + SSE 流式）。

────────────────────────────────────────
│ 0. 核心红线 (不可违反)
────────────────────────────────────────

### 数据契约红线

1. **类型导入**: 所有与后端交互的类型从 `shared/contracts` 导入
2. **Repository边界**: 禁止绕过Repository层直连数据库
3. **命名规范**: 数据库层与应用层统一使用 snake_case（简化数据流，避免不必要的字段名转换）
4. **安全解析**: JSON解析必须使用 `parseJSONSafe()`（由 `shared/contracts/validation.ts` 导出）
5. **验证要求**: Zod验证失败必须抛错或记录日志

### AI与代码边界

- AI负责：意图理解、话术生成、创意组合
- Service负责：算术计算、安全过滤、数据校验
- 红线：AI绝对禁止介入算术计算

### Agent 内核约定（Deep Agents）

- 单 Agent + Skill 路由：新能力以 **Skill**（`backend/src/services/mas/skills/` 下的知识）形式扩展，不新增独立智能体
- 数据访问：Repository 能力经 `backend/src/services/agent/mcpTools.ts` 暴露给 Agent，不绕过
- Chat 传输统一 **SSE 流式**（`/api/chat`），不新增 WebSocket 实时进度通道
- uiHint 卡片输出必须过 `uiHintValidator`（Zod）校验回路

### 用户标识符规范 (users表)

| 字段             | 类型   | 用途       | 使用场景              |
| -------------- | ---- | -------- | ----------------- |
| `id`           | UUID | 程序内部唯一标识 | 数据库查询、程序内部逻辑      |
| `display_name` | TEXT | 用户自定义ID  | 给用户展示、AI上下文（人类可读） |
| `device_id`    | TEXT | 设备标识符    | 区别同一用户的不同设备       |

**命名规范**：

- 变量名表示程序内部ID时 → `Id` (UUID)
- 变量名表示用户展示ID时 → `displayName` 或 `userDisplayName` (TEXT)
- 禁止使用 `user_id` 命名（容易与 display_name 混淆）

**数据流原则**：

- AI/用户层：使用 `display_name`（人类可读）
- 程序内部：使用 `id` (UUID) 进行数据库查询
- 工具调用：程序自动注入 UUID，AI 不需要感知

────────────────────────────────────────
│ 1. 事实与文档
────────────────────────────────────────
裁决序: 可执行事实 > 代码 > 文档
证据链: "完成"必须附Network截图或测试脚本

- docs-site/ 是唯一真理源
- shared/contracts/ 是数据契约唯一定义源

────────────────────────────────────────
│ 2. 常用命令
────────────────────────────────────────

**前端（根目录）**

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | Vite 开发服务器（端口 43112） |
| `npm run build` | 生产构建 |
| `npm run typecheck` | `tsc --noEmit` 类型检查 |
| `npm test` / `npm run test:run` | Vitest 单元测试 |
| `npm run docs:dev` | VitePress 文档站点（docs-site） |

**后端（`cd backend`）**

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 先构建 shared，再 `tsx src/preload.ts` 启动（端口 43111） |
| `npm run build` | 构建 shared + `tsc` 编译 |
| `npm run lint` / `npm run lint:all` | ESLint + 自定义 lint（data-format / state-race / api-consistency） |
| `npm test` | `tsx --test tests/*.ts` |
| `npm run test:unit` / `test:integration` / `test:contract` / `test:e2e` | 分层测试 |
| `npm run db:migrate` / `db:migrate:status` | PostgreSQL 迁移 |

**Android**

```bash
npm run build && npx cap sync android
cd android && ./gradlew assembleRelease
```

**调试端口表（源自 `dev.ps1`）**

| 服务 | 端口 |
| --- | --- |
| 前端（Vite） | 43112 |
| 后端（Fastify） | 43111 |
| Port Manager | 43113 |
| Chrome 调试 | 9222 |

────────────────────────────────────────
│ 3. 目录结构 (核心)
────────────────────────────────────────

| 目录 | 说明 |
| --- | --- |
| `src/` | 前端应用（Vite + React）；`src/v2/` 为新组件目录 |
| `backend/src/` | 后端服务 |
| `backend/src/services/agent/` | Agent 内核：AgentService 端口 + DeepAgentService + skillLoader + mcpTools + uiHint 校验回路 |
| `backend/src/services/mas/skills/` | 领域技能知识（动作类型指南、计划生成、力量训练设计等），由 skillLoader 挂载 |
| `backend/src/db/postgresql/repository/` | Repository 层（禁止绕过直连库） |
| `shared/contracts/` | 数据契约唯一来源：`index.ts` 扁平导出，按 `database` / `logging` / `mapping` 分子模块 |
| `packages/` | 共享工具包（如 `e2e-link-checker`） |
| `android/` | Capacitor Android 壳 |
| `docs-site/` | 架构文档（VitePress） |
| `docs/` | 领域知识与分析资料 |

────────────────────────────────────────
│ 4. 技能系统（项目内置 .claude/skills）
────────────────────────────────────────

| 技能 | 触发词 |
| --- | --- |
| starfit-conventions | database, schema, API, 颜色, 动画 |
| data-contract-check | 修改 Schema / 数据契约 |
| port-manager | 端口分配 / 冲突 |
| test-driven-development | TDD |
| webapp-testing | 浏览器调试, UI 测试, 表单验证 |
| systematic-debugging | 系统调试, 根因分析 |

> 完整列表见 `.claude/skills/`（另含 frontend-design / mcp-builder / mermaid-visualizer / backend-dev-guidelines 等）。

────────────────────────────────────────
│ 5. 协作规范
────────────────────────────────────────
- 去人化描述（"系统"而非"我"）
- 同一步内同字段只写一次

────────────────────────────────────────
│ 6. 重构规则
────────────────────────────────────────
- **前端解耦**：逻辑入 `src/hooks/useAICoach.ts`，UI 入 `src/components/ai/`；多态用 `ExerciseRenderer.tsx` + `uiHint`，禁止硬编码卡片；事件式埋点纠错

────────────────────────────────────────
│ 7. 调试工具
────────────────────────────────────────
- 前端: `webapp-testing` 技能 | 数据库: `psql $DATABASE_URL`

────────────────────────────────────────
│ 8. 文档索引
────────────────────────────────────────
数据架构: docs-site/database/postgresql-schema.md
Repository层: docs-site/database/repository-layer.md
数据流: docs-site/architecture/three-state-data-flow.md
共享类型: docs-site/api/shared-types.md
