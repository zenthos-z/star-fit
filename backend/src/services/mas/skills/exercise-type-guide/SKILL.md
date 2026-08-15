---
name: "exercise_type_guide"
description: "动作类型指南 - 提供动作类型规范查询和参数设置指导"
category: "knowledge"
version: "1.1.0"
---

# 动作类型指南技能包 (Exercise Type Guide Skill)

## 概述

本技能包提供动作类型的详细规范查询功能，使 AI Agent 能够了解不同类型动作的参数要求，避免因缺少必需字段导致验证失败。

## 问题背景

当前 MAS 计划生成节点存在的问题：

1. **动作类型参数缺失**：生成的动作计划中，不同类型的动作缺少对应的必需参数
2. **AI 缺乏动作类型规范知识**：系统提示词中缺少详细的动作类型规范说明

## 解决方案

本技能包提供：
1. **知识库文档**：详细的动作类型规范（参数要求、示例、最佳实践）
2. **查询工具**：`get_exercise_type_knowledge` - 供 AI 主动查询特定类型的规范
3. **按需加载架构**：只在需要时加载详细知识，避免 token 浪费

## 动作类型规范

### 10 种动作类型及其参数要求

| 类型 | 名称 | 必需字段 | 可选字段 | 典型示例 |
|------|------|----------|----------|----------|
| `resistance` | 抗阻力训练 | weight > 0 | - | 深蹲: weight=60 |
| `unilateral` | 单侧训练 | weight >= 0 | - | 箭步蹲: weight=20 |
| `bodyweight` | 自重训练 | - | weight=0 | 俯卧撑: weight=0 |
| `assisted` | 辅助训练 | weight > 0 | - | 助力引体: weight=-10 |
| `isometric` | 等长收缩 | duration > 0 | weight | 平板支撑: duration=30 |
| `cardio` | 有氧训练 | duration > 0 | distance | 跑步: duration=600 |
| `flexibility` | 柔韧性训练 | - | duration | 拉伸: duration=30 |
| `heavy_weight` | 大重量训练 | weight > 0 | - | 硬拉: weight=100 |
| `rep_training` | 次数训练 | weight >= 0 | - | 次数训练: weight=0 |
| `outdoor` | 户外运动 | distance > 0 | duration | 户外跑: distance=3000 |

## 工具列表

| 工具 | 说明 | 类别 |
|------|------|------|
| load_skill | 按需加载技能知识文档 | 查询 |

## 按需加载 (Progressive Loading)

本技能支持通过 `load_skill` 工具按需加载详细知识：

### 加载完整技能文档
```javascript
load_skill({ skillName: "exercise_type_guide" })
```

### 加载知识索引（轻量级）
```javascript
load_skill({ skillName: "exercise_type_guide", knowledgePath: "knowledge-index.md" })
```

### 加载特定动作类型的详细知识
```javascript
// 抗阻力训练
load_skill({ skillName: "exercise_type_guide", knowledgePath: "knowledge/resistance.md" })

// 自重训练
load_skill({ skillName: "exercise_type_guide", knowledgePath: "knowledge/bodyweight.md" })

// 等长收缩
load_skill({ skillName: "exercise_type_guide", knowledgePath: "knowledge/isometric.md" })

// 有氧训练
load_skill({ skillName: "exercise_type_guide", knowledgePath: "knowledge/cardio.md" })

// 户外运动
load_skill({ skillName: "exercise_type_guide", knowledgePath: "knowledge/outdoor.md" })

// 单侧训练
load_skill({ skillName: "exercise_type_guide", knowledgePath: "knowledge/unilateral.md" })

// 辅助训练
load_skill({ skillName: "exercise_type_guide", knowledgePath: "knowledge/assisted.md" })

// 柔韧性训练
load_skill({ skillName: "exercise_type_guide", knowledgePath: "knowledge/flexibility.md" })

// 大重量训练
load_skill({ skillName: "exercise_type_guide", knowledgePath: "knowledge/heavy_weight.md" })

// 次数训练
load_skill({ skillName: "exercise_type_guide", knowledgePath: "knowledge/rep_training.md" })
```

### Token 使用估算
| 操作 | Token 消耗 |
|------|------------|
| 加载知识索引 | ~500 tokens |
| 加载单个类型详细知识 | ~1000-2000 tokens |
| 加载完整 SKILL.md | ~2000 tokens |

## 使用方式

### 典型流程

```
1. 用户需求 "练胸"
2. list_exercises (拿全量动作库，在上下文里筛胸部动作)
3. get_exercise_type_knowledge({type: "resistance"}) → 了解 resistance 类型需要 weight 字段
4. load_history (获取历史负荷锚点)
5. 生成包含 weight 字段的动作计划
6. submit_plan (验证并提交)
```

### 工具使用示例

```javascript
// 查询单个类型 - 返回该类型的详细知识（~1000-2000 tokens）
get_exercise_type_knowledge({ type: "cardio", includeExamples: true })

// 查询多个类型 - 返回多个类型的概要（~300 tokens/类型）
get_exercise_type_knowledge({ types: ["resistance", "bodyweight"] })

// 不传参数 - 返回轻量级索引（所有类型概要，~500 tokens）
get_exercise_type_knowledge()
```

## 知识文档结构

```
exercise-type-guide/
├── knowledge-index.md       # 轻量级索引（~500 tokens）
├── knowledge/
│   ├── resistance.md        # 抗阻力训练详细知识
│   ├── bodyweight.md        # 自重训练详细知识
│   ├── isometric.md         # 等长收缩详细知识
│   ├── cardio.md            # 有氧训练详细知识
│   ├── outdoor.md           # 户外运动详细知识
│   ├── unilateral.md        # 单侧训练详细知识
│   ├── assisted.md          # 辅助训练详细知识
│   ├── flexibility.md       # 柔韧性训练详细知识
│   ├── heavy_weight.md      # 大重量训练详细知识
│   └── rep_training.md      # 次数训练详细知识
└── data/
    └── exerciseTypeMetadata.ts  # 类型元数据
```

## 依赖服务

- 无外部服务依赖

## 版本历史

- **1.1.0** (2026-03-01) - 迁移到 DeepAgents Skills 模式，支持 load_skill 工具按需加载
- **1.0.0** (2026-02-22) - 初始版本，实现按需加载架构
