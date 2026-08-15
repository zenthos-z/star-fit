---
name: "strength_training_designer"
description: "三大项训练容量科学计算 - 基于MEV/MRV算法"
category: "planning"
version: "3.1.0"
---

# 力量训练设计器 (Strength Training Designer)

## 概述

本技能包提供**深蹲/卧推/硬拉**三大项的科学训练容量计算。

## 三大项说明

**三大项**是指力量训练的核心复合动作：
- **深蹲 (squat)**：下肢蹲类动作（深蹲、腿举、箭步蹲等）
- **卧推 (bench)**：上肢推类动作（卧推、上斜卧推、哑铃推胸等）
- **硬拉 (deadlift)**：髋部铰链动作（硬拉、罗马尼亚硬拉、架拉等）

**注意**：仅三大项需要调用 `calculate_capacity` 进行科学计算。其他动作使用简化规则。

---

## 工具：calculate_capacity

### 调用时机

**必须调用**：当训练计划包含以下任一动作时
- 深蹲、杠铃深蹲、颈前深蹲、箱式深蹲
- 卧推、杠铃卧推、上斜卧推、哑铃卧推
- 硬拉、杠铃硬拉、罗马尼亚硬拉、相扑硬拉

**无需调用**：其他动作（孤立动作、辅助动作）

### 参数说明

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| exerciseName | string | ✅ | 动作名称（如 "杠铃深蹲"） |
| exerciseType | enum | ✅ | 动作类型：`squat` / `bench` / `deadlift` |
| phase | enum | ❌ | 训练周期：`hypertrophy`(默认) / `strength` / `peaking` |

### 调用示例

```javascript
// 深蹲增肌期
calculate_capacity({
  exerciseName: "杠铃深蹲",
  exerciseType: "squat",
  phase: "hypertrophy"
})

// 卧推力量期
calculate_capacity({
  exerciseName: "杠铃卧推",
  exerciseType: "bench",
  phase: "strength"
})

// 硬拉巅峰期
calculate_capacity({
  exerciseName: "传统硬拉",
  exerciseType: "deadlift",
  phase: "peaking"
})
```

### 返回值

自然语言格式，包含：
- **推荐组数**：基于 MEV 和 MRV 的中间值
- **推荐次数**：基于训练周期
- **MEV**：最小有效容量（组）
- **MRV**：最大可恢复容量（组）

```
杠铃深蹲建议11组8次。科学计算：MEV 6.0组，MRV 16组。
```

### 训练周期与次数对应

| 周期 | 目标 | 次数 |
|------|------|------|
| hypertrophy | 肌肉增长 | 8 次 |
| strength | 力量提升 | 5 次 |
| peaking | 巅峰表现 | 3 次 |

---

## 使用流程

```
判断是否属于三大项？
        │
   是────┴────否
   │          │
   ▼          ▼
calculate_capacity  使用简化规则（3-4组，8-12次）
   │
   ▼
获取科学推荐组数和次数
```

---

## 计算原理

### MEV (Minimum Effective Volume)
产生训练效果的最小容量阈值。低于此值无法刺激进步。

### MRV (Maximum Recoverable Volume)
身体能够恢复的最大容量。超过此值会导致过度训练。

### 推荐值
取 MEV 和 MRV 的中间值，确保训练有效且可恢复。

---

## 版本历史

- **3.1.0** (2026-03-05) - 补充 calculate_capacity 调用说明
- **3.0.0** (2026-03-02) - 重构为标准 skill 格式
