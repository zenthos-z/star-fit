---
name: "plan-generation"
description: "计划生成能力包 - 周计划持久化生成、训练容量计算、历史数据加载、计划格式验证"
category: "planning"
version: "4.0.0"
---

# 计划生成能力包 (Plan Generation Skill)

## 概述

本技能包提供训练计划生成所需的基础能力。**4.0 起为周计划生成模式**：
计划是持久化实体（`weekly_plans` + `plan_entries`，E1 落库），每周每用户
一份、默认复用、调整例外——不再是「每次对话现场生成一张丢弃的卡」。

- 用户问「今天练什么」→ 前端直接读确定性 API（`GET /api/schedule/today`，
  纯 DB 读，无 AI 介入）；本技能只服务「给我排一周计划 / 换计划」类请求。
- 训练前零容忍等待：已落库的计划不需要 Agent 在场。

## 能力说明

### 核心能力

1. **周计划生成（每周一次语义）** - 查既有 → 编排一周 → 原子落库 → 复用
2. **训练容量科学计算** - 基于 MEV/MRV 的容量分配（知识见 strength-training-designer 技能）
3. **历史数据加载** - 负荷锚点和健身等级
4. **格式验证与修正** - plan 卡格式自检（uiHint 校验回路打回时修订重试）

## 工具列表

| 工具             | 说明                                                    | 参数                                  | 类别 |
| ---------------- | ------------------------------------------------------- | ------------------------------------- | ---- |
| load_history     | 加载用户历史数据和负荷锚点                              | `include_profile` 等可选              | 数据 |
| list_exercises   | 加载完整动作库 [{id, name, exercise_type, description}] | 无                                    | 数据 |
| get_current_plan | 读本周（或指定周）已持久化的周计划                      | `week_id` 可选（缺省=当前周）         | 数据 |
| save_weekly_plan | 周计划原子落库（计划+全部条目，一次事务）               | `split` + `entries[]`，`week_id` 可选 | 写入 |

**注意**:

- `week_id` 缺省时服务器代为推导当前 ISO 周——**不要自己做日历算术**
  （今天是几号、属于哪一周，交给服务器）。
- `save_weekly_plan` 每周只允许落库一次：该周已有计划会返回
  `already_exists` 并拒绝覆盖（默认复用既有计划）。调整既有条目走对话，
  不重新落一张新周计划。
- 周计划落库后，今日课表由 `GET /api/schedule/today` 确定性直读——
  用户之后问「今天练什么」，不需要重新生成任何东西。

### 周计划数据形态（save_weekly_plan 的 entries[]）

- 每条目: `entry_date`（YYYY-MM-DD，无时区）、`exercise_id`（必须来自
  `list_exercises` 返回的真实条目，禁止编造）、`target_sets`（正整数）、
  `target_load`（`{type: 'rpe'|'percent_1rm', min, max}` 区间）、`sort_order` 可选
- 分化 `split` 按 program-progression 的分化决策表选（每周天数 × 经验等级）；
  决策表已代码化于 `backend/src/services/schedule/progressionPolicy.ts`（真源）
- 覆盖该周用户的所有训练日（每天一组条目）；休息日不建条目

### plan 卡（对话展示层）

落库成功后，仍按既有格式在回复正文输出 plan 卡（```json 围栏包裹的
uiHint JSON，type: "plan"，见 knowledge.md 第九节）展示**当日**条目——
plan 卡是对话展示，weekly_plan/plan_entries 是数据真源，两者并存。

## 使用方式

### 典型流程（周计划生成，每周一次）

```
用户需求 "给我排这周的计划"
  ↓
get_current_plan（先查：本周已有计划？）
  ├─ found: true → 复用既有计划，按用户诉求调整个别条目（对话式），不重新落库
  └─ found: false ↓
load_history（画像/锚点/伤病/器械 → 硬约束）
  ↓
list_exercises（动作库，按器械/伤病过滤）
  ↓
program-progression 技能（分化决策表 + 容量知识 → 一周编排）
  ↓
save_weekly_plan（split + 全周条目，原子落库）
  ↓
输出 plan 卡（今日部分）+ 简短说明
```

### 缺勤顺延（Agent 只解释，不执行）

用户错过某个训练日时：

- **绝不重新生成周计划**，也绝不把错过的容量叠加到今天（不补课）
- 顺延/置换由 Service 查表规则确定性处理
  （`backend/src/services/schedule/planAdjustment.ts`）：
  错过的未完成条目 → 今日休息则顺延并入今日；今日已有训练则置换为跳过
- Agent 的职责：向用户解释这条规则、安抚情绪（漏练不是失败），引导
  按下一次训练正常执行；不重排条目、不做容量算术

## 知识文档

### 主知识文档

详见 `knowledge.md`，包含：

- 动作选择原则 / 容量分配规则 / 重量推算逻辑 / 安全协议
- 周计划模式（第十一节：落库契约、每周一次语义、缺勤顺延）
- plan 卡输出格式

## 依赖服务

- `IProfileService` - 用户画像服务
- `WeeklyPlanRepository` - 周计划持久化（经 mcpTools 暴露，不绕过）

## 红线（本技能内重申）

- 算术永远留 Service：加重步进、容量合计、日期推导均不在 Agent 侧计算
- 数据访问只经 mcpTools（get_current_plan / save_weekly_plan 即入口）
- `exercise_id` 必须来自 `list_exercises`；`user_id` 由服务器注入，不可伪造

## 版本历史

- **4.0.0** (2026-09-26) - 周计划生成模式（E3/issue #2）：新增 get_current_plan / save_weekly_plan 工具，产出写入 weekly_plan/plan_entry 持久实体（每周一次语义，缺勤顺延交 Service 查表）；plan 卡保留为对话展示层
- **3.1.0** (2026-09-11) - 移除幻影工具文档（submit_plan/calculate_capacity 已不在工具表），改为 plan 卡直出链路；weight 允许留 0（首训自选、次训锚定）
- **3.0.0** (2026-03-10) - 精简版：移除 query_exercises（迁移至 strategy_coach）
- **2.1.0** (2026-03-04) - 添加工具参数说明，明确 submit_plan 使用 exercise_list
- **2.0.0** (2026-02-19) - 重构为 Agent 模式，基础能力打包
- **1.0.0** (2026-02-03) - 初始版本，固定流程实现
