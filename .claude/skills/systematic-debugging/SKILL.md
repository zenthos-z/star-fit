---
name: "systematic-debugging"
description: "用结构化流程做根因分析与修复验证。遇到复杂/偶现/跨模块问题时调用，产出可复现路径与可验证修复。"
---

# Systematic Debugging

## 目标

将“猜测式修 bug”替换为“证据驱动”：复现、最小化、定位、验证。

## 适用场景

- 偶现 bug、跨前后端问题、跨 agent 问题
- 同步链路（WebSocket/Outbox/IDB）不一致
- LangGraph 状态字段冲突、路由异常、HITL interrupt/resume 异常
- Zod 校验失败导致的解析/降级异常

## 四阶段流程

### 1) 复现（Reproduce）

输出一个复现卡片，至少包含：
- 环境：OS、Node 版本、是否移动端/浏览器
- 触发入口：URL/API/命令
- 输入：payload（含 `protocol_version=2.0.0`、时间 ISO8601(UTC)）
- 预期 vs 实际
- 频率：必现/偶现，是否与网络状态相关

### 2) 最小化（Minimize）

- 二分缩小：删掉无关步骤/字段/组件，保留最小触发条件
- 固定随机性与时序：必要时引入可重复的时间源/种子
- 将复现固化为：单测、contract test、或 E2E

### 3) 定位（Localize）

优先顺序：
1. 证据：错误栈、日志、LangSmith trace
2. 入口：状态变更点、I/O 边界（网关、存储、协议解析）
3. 约束检查：
   - L1/L2/L3 层级是否被破坏
   - LangGraph 同一步同字段是否多次写入
   - `currentAgent` 是否被非 routerNode 写入

### 4) 验证（Verify）

- 修复必须附带验证：新增/更新测试 + 运行通过
- 对偶现问题：用压力/重复运行验证（例如多次 E2E、重复 push/pull）
- 对数据一致性：验证回放、幂等与顺序性

## 输出要求

- 根因陈述：哪一行/哪个模块/哪个状态字段导致问题
- 证据列表：与根因直接相关的 3-5 条证据
- 修复说明：为何能修复 + 是否引入新风险
- 验证步骤：可被重复执行的命令/测试路径
