---
name: "plan_generation"
description: "计划生成能力包 - 训练容量计算、历史数据加载、计划格式验证"
category: "planning"
version: "3.0.0"
---

# 计划生成能力包 (Plan Generation Skill)

## 概述

本技能包提供智能训练计划生成所需的基础能力，专注于计划参数计算和验证。动作查询功能已移至 `strategy_coach` 技能。

## 能力说明

### 核心能力

1. **训练容量科学计算** - 基于 MEV/MRV 的容量分配
2. **历史数据加载** - 负荷锚点和健身等级
3. **格式验证与修正** - 自动重试机制

## 工具列表

| 工具 | 说明 | 参数 | 类别 |
|------|------|------|------|
| load_history | 加载用户历史数据和负荷锚点 | `id` (系统自动注入) | 数据 |
| submit_plan | 验证并提交计划（终止器） | `exercise_list`, `explanation` | 验证 |

**注意**: `calculate_capacity` 已移至 `strength_training_designer` skill。
如需三大项容量计算，请先激活 `load_skill({ skillName: "strength_training_designer" })`。

### submit_plan 参数说明

- **exercise_list**: 动作数组（必须是数组，不是 JSON 字符串）
  - 每个动作包含: `id`, `name`, `exercise_type`, `sets`, `reps`, `weight`
- **explanation**: 训练计划说明文字

```typescript
// ✅ 正确调用方式
submit_plan({
  exercise_list: [
    { id: "V1StGXR8_Z5jdHi6", name: "杠铃深蹲", exercise_type: "resistance", sets: 4, reps: 12, weight: 60 }
  ],
  explanation: "训练计划说明"
})

// ❌ 错误：参数名使用 plan
submit_plan({ plan: [...] })

// ❌ 错误：exercise_list 写成 JSON 字符串
submit_plan({ exercise_list: "[...]" })
```

## 使用方式

Agent 通过调用这些工具来完成计划生成，最后必须调用 `submit_plan` 验证格式。

### 典型流程

```
用户需求 "练胸"
  ↓
load_history (获取历史负荷锚点)
  ↓
load_skill({ skillName: "strength_training_designer" }) (如涉及三大项)
  ↓
calculate_capacity (计算三大项容量)
  ↓
submit_plan (验证并提交)
```

## 知识文档

### 主知识文档
详见 `knowledge.md`，包含：
- 动作选择原则
- 容量分配规则
- 重量推算逻辑

### 工具专属知识
按工具拆分的知识文档（更详细）：
- `tools/submit_plan/knowledge.md` - 格式验证规则、NanoID 来源
- `tools/load_history/knowledge.md` - 重量推算逻辑、用户画像适配

**注意**: `calculate_capacity` 相关知识已移至 `strength_training_designer` skill。

## 依赖服务

- `IProfileService` - 用户画像服务
- `strength_calculator` - 三大项科学计算

## 版本历史

- **3.0.0** (2026-03-10) - 精简版：移除 query_exercises（迁移至 strategy_coach）
- **2.1.0** (2026-03-04) - 添加工具参数说明，明确 submit_plan 使用 exercise_list
- **2.0.0** (2026-02-19) - 重构为 Agent 模式，基础能力打包
- **1.0.0** (2026-02-03) - 初始版本，固定流程实现
