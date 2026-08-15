# Starfit 数据流对接与闭环规范 (DATA_FLOW_CLOSED_LOOP)


**版本**: v2.0.0（重构清理版）
**状态**: 概念参考

---

## 0. 概述
本文定义 Starfit 中数据从产生（用户交互 / 传感器）、到持久化（PostgreSQL）、再到消费（应用层 / AI 层）的全链路流转机制。本文描述的是**与 Agent 内核无关的通用数据流**；Agent 内核（Deep Agents）的内部编排不在本文范围。

---

## 1. 核心数据实体 (Core Data Entities)

系统的核心数据及其**物理分布**：

| 数据类别 | 实体名称 | 描述 | 前端存储/组件 (Client) | 后端存储/组件 (Server) | 传输协议 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **事实层 (Truth)** | `Workout Facts` | 训练计划的实时状态。支持**多态参数**（抗阻：重量/组数；有氧：距离/配速）。 | React State (L1) / IndexedDB (L2) | PostgreSQL (L3) | HTTP/REST (Batch Ops) |
| **记忆层 (Memory)** | `User Profile` | 用户的生理标签与偏好。 | Local Storage (Snapshot) | PostgreSQL / Vector DB | REST |
| **遥测层 (Telemetry)** | `Session Events` | 传感器数据 (心率/步频)、用户 RPE。 | In-Memory Buffer / Outbox | PostgreSQL (TimescaleDB) | HTTP |
| **元数据层 (Metadata)** | `Exercise Library` | 动作百科知识库。 | Service Worker Cache | CDN / JSON Library | HTTP (Lazy Load) |
| **存储层 (Repository)** | `Repository Layer` | 数据访问边界，处理 JSONB 解析和数据验证。统一使用 snake_case 格式。 | N/A | PostgreSQL Repository Pattern | Internal Access |

> 注：旧版本的「上下文层 (Context) — LangGraph Checkpoints」已随旧编排内核一并移除。

---

## 2. 存储架构与同步策略 (Storage Architecture)

Starfit 采用 **L1-L3 分层存储架构**。

### 2.1 存储分层模型
- **L1: 内存状态 (UI Context)**：React Context、Hook。毫秒级响应，随页面销毁。
- **L2: 边缘持久化 (Client Persistence)**：IndexedDB, LocalStorage。离线支持，崩溃恢复。缓存 `Exercise Library` 避免重复下载。
- **L3: 云端真相 (Cloud Truth)**：PostgreSQL、Vector DB。全局一致性。

### 2.2 数据同步原则
1. **乐观更新 (Optimistic UI)**：前端修改 `Workout Facts` 时，先更新 L1/L2，UI 立即反馈。
2. **异步确认 (Async Confirmation)**：L1 变更通过 `Batch Ops` 发送至 L3，成功后 L3 返回最新 Version 覆盖 L1。
3. **冲突判定**：若 L3 写入失败（版本冲突），L1 必须强制执行 **"感知-重算-覆盖"** 流程。

### 2.3 Repository 层集成

Repository 层是应用层与数据库层之间的**唯一转换边界**：

```
┌─────────────────────────────────────────────────────────────┐
│                    应用层 (Application)                       │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  前端 UI (React) │ API 层 │ 服务层                      │  │
│  └───────────────────────────────────────────────────────┘  │
│                         │ snake_case                          │
│                         ▼                                    │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              Repository 层 (数据访问边界)                │  │
│  │  - parseJSONB(): JSONB 解析与验证                     │  │
│  │  - stringifyJSONB(): 数据序列化                        │  │
│  │  - Zod Schema 验证                                     │  │
│  └───────────────────────────────────────────────────────┘  │
│                         │ snake_case + JSONB                  │
│                         ▼                                    │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              PostgreSQL (数据库层)                     │  │
│  │  - profile_static: { basic_info, fitness_level, ... }  │  │
│  │  - profile_dynamic: { load_anchors, ... }             │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**详细参考**: [PostgreSQL Schema 文档](../database/postgresql-schema.md) | [Repository 层架构文档](../database/repository-layer.md)

### 2.4 传输层

传输层是数据流的"血管"，负责协议适配、原子性与弹性：

- **前端部分 (Client-side)**：`Outbox Queue` (离线队列)、`Event Bus`。职责：乐观更新落盘、断网自动重连、请求合帧。
- **后端部分 (Server-side)**：`API Gateway`。职责：身份校验 (Auth)、流式响应。

传输层独立的价值：
- **多协议适配 (Protocol Agnostic)**：前端可能通过 HTTP/REST 提交 `Batch Ops`，通过 SSE 接收流式响应。传输层屏蔽底层协议，对业务层提供统一的"数据管线"抽象。
- **原子性与弹性保障 (Resilience)**：处理 `Idempotency-Key` 的重试逻辑、离线消息队列（Outbox Pattern）的落盘与恢复。
- **流量治理 (Traffic Control)**：传感器高频数据进入应用层前进行**背压处理 (Backpressure)** 和**合帧 (Batching)**。

---

## 3. 前后端交互数据映射 (FE-BE Data Relationship)

前端 UI 状态与后端数据上下文之间的映射关系：

> **架构说明**: 前后端数据交互通过 Repository 层进行：
> - **统一命名**: 数据库层、Repository 层、应用层统一使用 snake_case 格式
> - **示例字段**: `basic_info`, `fitness_level`, `load_anchors`, `red_flags`
> - **简化数据流**: 无需字段名转换，减少映射错误
> - **数据库存储**: JSONB 格式存储复杂结构

| 交互场景 | 前端 (App/UI) 数据 | 后端数据上下文 | 同步触发点 |
| :--- | :--- | :--- | :--- |
| **进入动作页** | `current_exercise_id` | 对应的动作上下文 | 页面挂载 (onMount) |
| **完成一组** | `set_result` (reps, weight) | 特征提取 -> 更新 `Workout Facts` | 按钮点击 (onComplete) |
| **AI 聊天** | `chat_message` + `ui_state` | 语义分发 + `Snapshot` 注入 | 消息发送 (onSubmit) |
| **计划调整** | `pending_changes` 预览 | 生成的 `Batch Ops` | AI 建议卡片展示 |
| **动作配置** | `selected_exercise_metadata` | 动作参数覆盖与 RPE 模型更新 | 动作配置弹窗 (ExerciseSettingsModal) |

---

## 4. 状态同步与冲突处理 (Consistency & Conflict Resolution)

### 4.1 版本校验与乐观锁 (OCC)
- **规则**：所有针对 `Workout Facts` 的 `Batch Ops` 必须携带 `preconditions.version`。
- **流程**：前端提交 L1 变更 -> 后端校验 L3 版本 -> 若匹配则写入并下发新版本 -> 前端同步 L1/L2。
- **冲突失败**：若服务器版本已更新，返回 `60001: BATCH_PRECONDITION_FAILED`，触发重新感知当前 L3 状态并生成新指令。

### 4.2 因果一致性 (Causal Consistency)
- **事件溯源**：所有事件必须关联 `traceId`，确保跨 L1-L3 的追踪。
- **因果链**：如果事件 B 是由事件 A 触发的，B 的元数据中必须包含 `parent_event_id`。

---

## 5. 异常流处理 (Exception Flows)

| 异常场景 | 处理策略 | 数据流向 |
| :--- | :--- | :--- |
| **后端响应超时** | 降级为本地预设逻辑 | 触发超时事件 -> UI 切换至 L2 离线缓存模式 |
| **传感器数据断流** | 维持最后已知状态 | 标记 `fit://sensor/is_active=false` -> 提醒用户检查物理连接 |
| **指令执行部分失败** | 原子性回滚 | 触发 `ATOMIC_ROLLBACK` -> L3 回滚版本，同步通知 L1 撤销乐观更新 |
| **网络中断** | 离线队列 (Outbox) | L1 变更暂存于 L2 IndexedDB -> 网络恢复后按序重发 `Batch Ops` |

---

## 6. 稳定性与健壮性保障 (Stability & Robustness)

系统通过以下支柱确保运行的稳定性，应对健身场景下**弱网环境、高频遥测**等挑战：

### 6.1 分层解耦 (Tiered Decoupling)
- **原理**：UI 只对接 L1 (State)，不直接对接 L3 (DB)。
- **收益**：即使后端响应延迟 2 秒，前端通过"乐观更新 (Optimistic UI)"依然能提供丝滑的操作反馈。

### 6.2 幂等性与弹性同步 (Idempotency & Outbox)
- **原理**：所有指令（Batch Ops）携带唯一 ID。
- **收益**：弱网环境下即便请求因网络抖动发送多次，后端也只会执行一次，离线期间的操作会在联网后通过 `Outbox` 自动按序重放。

### 6.3 版本锁与冲突消除 (Version OCC)
- **原理**：数据修改必须携带版本号。
- **收益**：当多个写请求同时尝试修改训练计划时，版本锁会强制竞争，确保最后入库的数据逻辑自洽，不会出现数据覆盖或状态错乱。

### 6.4 流量稳压器 (Backpressure Buffer)
- **原理**：高频传感器数据先进入传输层的 Buffer。
- **收益**：即便传感器每秒产生大量数据，后端也只会接收经过压缩和特征提取后的有效帧。
