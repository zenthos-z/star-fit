---
name: "plan-generation"
description: "计划生成能力包 - 训练容量计算、历史数据加载、计划格式验证"
category: "planning"
version: "3.1.0"
---

# 计划生成能力包 (Plan Generation Skill)

## 概述

本技能包提供智能训练计划生成所需的基础能力，专注于计划参数计算和验证。

## 能力说明

### 核心能力

1. **训练容量科学计算** - 基于 MEV/MRV 的容量分配（知识见 strength-training-designer 技能）
2. **历史数据加载** - 负荷锚点和健身等级
3. **格式验证与修正** - 计划卡格式自检（uiHint 校验回路打回时修订重试）

## 工具列表

| 工具           | 说明                                                    | 参数                | 类别 |
| -------------- | ------------------------------------------------------- | ------------------- | ---- |
| load_history   | 加载用户历史数据和负荷锚点                              | `id` (系统自动注入) | 数据 |
| list_exercises | 加载完整动作库 [{id, name, exercise_type, description}] | 无                  | 数据 |

**注意**: 本技能没有提交/计算工具——不存在 `submit_plan` 和 `calculate_capacity`。
计划完成后直接在回复正文中输出 plan 卡（```json 围栏包裹的 uiHint JSON，
见 knowledge.md 第九节）；三大项容量按 `strength-training-designer` 技能的
知识在上下文中推演。

### plan 卡数据格式

计划以 ```json 围栏包裹的 plan 卡直出（type: "plan"），data 为动作数组：

- 每个动作包含: `exerciseId`, `name`, `exercise_type`, `sets`, `reps`, `weight`
- `exerciseId` 必须来自 `list_exercises` 返回的真实条目（禁止编造）
- `weight` 允许为 0：无 load_anchor 的动作留 0 并在正文说明
  「首次尝试请自选重量」——首训重量由用户自选，该次实际重量即成为下次
  计划的锚点（load_history 会随训练落库更新）

```typescript
// ✅ 正确：data 数组中的动作对象
{ exerciseId: "V1StGXR8_Z5jdHi6", name: "杠铃深蹲", exercise_type: "resistance", sets: 4, reps: 12, weight: 60 }

// ❌ 错误：data 写成 JSON 字符串
"{...}"

// ❌ 错误：调用不存在的 submit_plan / create_exercise / calculate_capacity
submit_plan({ exercise_list: [...] })
```

## 使用方式

Agent 通过 `load_history` 取画像与锚点、`list_exercises` 取动作库，在上下文中
完成容量与动作选择，最后直接输出 plan 卡。格式错误会被 uiHint 校验回路
打回重试（被拒轮次以 thinking 事件呈现，按错误信息修正后重新输出整张卡片）。

### 典型流程

```
用户需求 "练胸"
  ↓
load_history (获取历史负荷锚点)
  ↓
list_exercises (获取动作库，按器械/伤病过滤)
  ↓
strength-training-designer 技能 (如涉及三大项容量推演)
  ↓
直接输出 plan 卡 (json 围栏, type: "plan")
```

## 知识文档

### 主知识文档

详见 `knowledge.md`，包含：

- 动作选择原则
- 容量分配规则
- 重量推算逻辑
- plan 卡输出格式

## 依赖服务

- `IProfileService` - 用户画像服务

## 版本历史

- **3.1.0** (2026-09-11) - 移除幻影工具文档（submit_plan/calculate_capacity 已不在工具表），改为 plan 卡直出链路；weight 允许留 0（首训自选、次训锚定）
- **3.0.0** (2026-03-10) - 精简版：移除 query_exercises（迁移至 strategy_coach）
- **2.1.0** (2026-03-04) - 添加工具参数说明，明确 submit_plan 使用 exercise_list
- **2.0.0** (2026-02-19) - 重构为 Agent 模式，基础能力打包
- **1.0.0** (2026-02-03) - 初始版本，固定流程实现
