# Starfit

Starfit 是一个移动端优先的健身记录与 AI 教练应用：快乐至上、AI 隐形、丰俭由人、数据主权。

## 它是什么

- **健身记录**：组数、次数、重量、RPE，流畅的计时器与录入体验
- **AI 教练**：基于 [Deep Agents](https://github.com/langchain-ai/deepagents) 的单 Agent + Skill 路由内核，SSE 流式输出，把健身领域技能知识（动作类型指南、计划生成、力量训练设计）挂载给模型
- **多态卡片**：`uiHint` 驱动的卡片协议，AI 可以渲染训练计划、总结、调查、指导等交互组件
- **本地优先**：L1 React State → L2 IndexedDB → L3 PostgreSQL 三层存储，健身房断网也能记录
- **数据主权**：训练数据可导出为 Markdown，永远属于你自己

## 架构一览

```
前端 (React 19 + Vite, Capacitor 打包 Android)
  ├─ uiHint 卡片渲染（核心交互协议）
  └─ SSE 流式消费 /api/chat
        │
后端 (Fastify 5 + PostgreSQL/pgvector)
  ├─ AgentService 端口 ── DeepAgentService（Deep Agents 内核）
  │    ├─ Skill 路由（chat / plan / diagnose / card）
  │    ├─ 领域技能知识（挂载 services/mas/skills/ 下的 knowledge）
  │    └─ uiHint 提取 + 校验回路（Zod）
  ├─ MCP 式工具层：Repository 能力暴露为 Agent 工具
  └─ 动作库 / 用户画像 / 训练会话 / 视频处理 / 同步
```

## 下一步

- [快速开始](./quick-start.md) — 在本地跑起来
- [设计理念](./design-philosophy.md) — 为什么做 Starfit
- [数据协议](../concepts/data-protocol.md) — 数据契约与存储分层
- [数据流](../architecture/data-flow.md) — 同步与离线策略
