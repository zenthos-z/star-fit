---
name: "test-driven-development"
description: "按 RED→GREEN→REFACTOR 方式实现功能或修复 Bug。任何新增/修复开始前调用，优先用测试锁定行为与回归边界。"
---

# Test-Driven Development

## 适用场景

- 修复回归风险高的 Bug
- 新增协议/数据同步/卡片交互等核心功能
- 重构涉及状态字段、同步链路、LangGraph 节点行为

## 基本原则

- 先定义可验证的行为，再写实现
- 测试优先覆盖“协议边界”和“失败路径”（解析失败、弱网、重复提交、幂等）
- 对本仓库，前端偏向类型检查 + E2E；后端偏向单测/contract test

## 工作流

### 1) RED：写一个会失败的测试（或最小可复现用例）

- 写清楚：输入、预期输出、错误码/异常、边界条件
- 失败信息必须能直接指向缺失能力，而不是“环境没配好”

### 2) GREEN：写最小实现让测试通过

- 只实现让测试通过所需的最小逻辑
- 避免引入额外依赖；沿用现有模式与工具（Fastify/LangGraph/Zod 等）

### 3) REFACTOR：重构并保持测试全绿

- 代码结构与命名对齐本仓库风格
- 确保关键约束不被破坏：
  - 新功能进入 `src/v2/`
  - 存储严格 L1→L2→L3，禁止直连 L3
  - 协议 `protocol_version=2.0.0`，时间 ISO8601(UTC)
  - LangGraph 同一步同字段只写一次、`currentAgent` 仅 routerNode 写

## 本仓库测试入口建议

### 后端（优先）

- 运行：`backend` 下 `npm test`（`tsx --test`）
- 合约：`backend` 下 `npm run test:contract`

### 前端（偏集成/端到端）

- 类型：根目录 `npm run typecheck`
- E2E：根目录 `npm run e2e`

## 输出要求

- 输出变更前的行为定义（测试描述）与变更后的验证结果
- 新增的测试必须覆盖：正常路径 + 至少一个失败/降级路径

## 示例指令

### 修复同步链路 Bug

1. 用最小数据集写出可复现用例（含协议版本、时间字段）
2. 让测试先失败（RED）
3. 写最小修复（GREEN）
4. 清理与抽象（REFACTOR），确保 `npm run test:all` 全通过
