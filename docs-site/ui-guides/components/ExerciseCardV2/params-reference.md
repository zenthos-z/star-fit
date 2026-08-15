# 运动卡片参数参考

> **版本**: v2.1
> **最后更新**: 2026-01-23

## 概述

本文档详细列出了每种运动卡片的参数规范，包括：
- 更新的 Sets 字段
- 使用的 Metadata 字段
- 显示格式

---

## ResistanceCard（力量训练）

**文件**: `src/v2/components/execution/plugins/ResistanceCard.tsx`

### Sets 字段

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `reps` | `number` | ✅ | 重复次数 |
| `weight` | `number` | ✅ | 重量 (kg) |
| `status` | `'PLANNED' \| 'COMPLETED'` | ✅ | 组状态 |
| `completed` | `boolean` | ⚠️ | 兼容字段，自动同步 |
| `rpe` | `number` | - | 实际 RPE (0-10) |
| `restEndTime` | `number` | - | 休息结束时间戳 |

### Metadata 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | `string` | 运动显示名称 |
| `targetRpe` | `number` | 目标 RPE |

### 显示格式

```
第 N 组: X 次 × Ykg | RPE Z
```

---

## CardioCard（有氧运动/单车）

**文件**: `src/v2/components/execution/plugins/CardioCard.tsx`

### Sets 字段

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `duration` | `number` | ✅ | 实际时长 (秒) |
| `status` | `'PLANNED' \| 'COMPLETED'` | ✅ | 组状态 |
| `completed` | `boolean` | ⚠️ | 兼容字段，自动同步 |
| `timestamp` | `string` | ✅ | ISO 8601 时间戳 |

### Metadata 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `targetDurationSec` | `number` | 目标时长 (秒) |
| `targetHeartRateZone` | `string` | 目标心率区间 (如 "2", "3") |
| `cardioMode` | `'TIME_COUNTDOWN' \| 'FREE_RUN'` | 运动模式 |
| `name` | `string` | 运动显示名称 |

### 显示格式

```
第 N 组: M:SS | 目标心率 Zone X
```

---

## RunningCard（跑步机/自由跑）

**文件**: `src/v2/components/execution/plugins/RunningCard.tsx`

### Sets 字段

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `duration` | `number` | ✅ | 实际时长 (秒) |
| `distance` | `number` | - | 实际距离 (米) - 仅当有距离目标时 |
| `status` | `'PLANNED' \| 'COMPLETED'` | ✅ | 组状态 |
| `completed` | `boolean` | ⚠️ | 兼容字段，自动同步 |
| `timestamp` | `string` | ✅ | ISO 8601 时间戳 |

### Metadata 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `cardioMode` | `'TIME_COUNTDOWN' \| 'DISTANCE_TARGET' \| 'FREE_RUN'` | 运动模式 |
| `targetDurationSec` | `number` | 目标时长 (秒) - TIME_COUNTDOWN 模式 |
| `targetDistanceMeters` | `number` | 目标距离 (米) - DISTANCE_TARGET 模式 |
| `targetHeartRateZone` | `string` | 目标心率区间 |
| `cardioSubtype` | `string` | 运动子类型 |
| `name` | `string` | 运动显示名称 |

### 显示格式

| 模式 | 显示 |
|------|------|
| TIME_COUNTDOWN | `第 N 组: M:SS | 目标心率 Zone X` |
| DISTANCE_TARGET | `第 N 组: X.XX km | M:SS | 目标心率 Zone X` |
| FREE_RUN | `第 N 组: M:SS | 目标心率 Zone X` |

---

## IsometricCard（静力训练）

**文件**: `src/v2/components/execution/plugins/IsometricCard.tsx`

### Sets 字段

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `duration` | `number` | ✅ | 实际时长 (秒) |
| `weight` | `number` | - | 配重 (kg) |
| `status` | `'PLANNED' \| 'COMPLETED'` | ✅ | 组状态 |
| `completed` | `boolean` | ⚠️ | 兼容字段，自动同步 |
| `timestamp` | `string` | ✅ | ISO 8601 时间戳 |

### Metadata 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `targetDuration` | `number` | 目标时长 (秒) |
| `name` | `string` | 运动显示名称 |

### 显示格式

```
第 N 组: X 秒 | Y kg 配重
```

---

## OutdoorExerciseCardV2（户外GPS运动）

**文件**: `src/v2/components/execution/plugins/OutdoorExerciseCardV2.tsx`

### Sets 字段

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `duration` | `number` | ✅ | 实际时长 (秒) |
| `distance` | `number` | ✅ | 实际距离 (米) - GPS 自动计算 |
| `status` | `'PLANNED' \| 'COMPLETED'` | ✅ | 组状态 |
| `completed` | `boolean` | ⚠️ | 兼容字段，自动同步 |
| `timestamp` | `string` | ✅ | ISO 8601 时间戳 |

### Metadata 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `cardioMode` | `'TIME_COUNTDOWN' \| 'DISTANCE_TARGET' \| 'FREE_RUN'` | 运动模式 |
| `targetDurationSec` | `number` | 目标时长 (秒) |
| `targetDistanceMeters` | `number` | 目标距离 (米) |
| `targetHeartRateZone` | `string` | 目标心率区间 |
| `name` | `string` | 运动显示名称 |

### 显示格式

| 模式 | 显示 |
|------|------|
| TIME_COUNTDOWN | `第 N 组: X.XX km \| M:SS \| 目标心率 Zone Z` |
| DISTANCE_TARGET | `第 N 组: X.XX km \| M:SS \| 目标心率 Zone Z` |
| FREE_RUN | `第 N 组: X.XX km \| M:SS \| 目标心率 Zone Z` |

---

## 数据传递链路

```
运动卡片
  └─ onUpdate({ sets: [...] })
       ↓
Session.exercises[i].sets
Session.exercises[i].metadata
       ↓
localSummaryData.exercises = [{
  name,
  type,
  sets,      ← Sets 数据
  metadata   ← Metadata 数据
}]
       ↓
Chat API (metadata.intent_context)
       ↓
SummaryCard (getSetDisplayInfo)
```

---

## 字段命名规范

### Sets 字段

| 英文字段 | 中文说明 | 单位 | 适用类型 |
|---------|---------|------|---------|
| `reps` | 重复次数 | 次 | 力量训练 |
| `weight` | 重量 | kg | 力量训练、静力训练 |
| `duration` | 时长 | 秒 | 有氧、静力、户外 |
| `distance` | 距离 | 米 | 户外运动 |
| `status` | 状态 | 枚举 | 所有类型 |
| `completed` | 完成标记 | 布尔 | 所有类型 (兼容) |
| `rpe` | RPE | 0-10 | 所有类型 |
| `restEndTime` | 休息结束时间 | 毫秒时间戳 | 力量训练 |

### Metadata 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `targetDurationSec` | `number` | 标准命名：目标时长（秒） |
| `targetDistanceMeters` | `number` | 标准命名：目标距离（米） |
| `targetHeartRateZone` | `string` | 目标心率区间 |
| `cardioMode` | 枚举 | 有氧运动模式 |
| `targetRpe` | `number` | 目标 RPE |
| `name` | `string` | 运动显示名称 |

⚠️ **注意**: 避免使用 `targetDuration` 或 `targetDistance` (不带单位后缀)，应使用标准命名 `targetDurationSec` 和 `targetDistanceMeters`。

---

## 运动类型枚举

```typescript
type ExerciseType =
  | 'resistance'   // 力量训练
  | 'cardio'       // 有氧运动
  | 'bodyweight'   // 自重训练
  | 'isometric'    // 静力训练
  | 'assisted'     // 辅助训练
  | 'unilateral'   // 单侧训练
  | 'weight_only'  // 仅重量
  | 'reps_only'    // 仅次数
  | 'outdoor';     // 户外运动
```

---

## 相关文档

- [运动卡片技术规格](../specifications/exercise-card-technical-specs.md)
- [UI 指南 - 运动卡片系统](../ui-guides/exercise-card-system.md)
