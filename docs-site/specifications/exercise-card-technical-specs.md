# 运动卡片技术规格

> **版本**: v2.1
> **最后更新**: 2026-01-23
> **状态**: 已实现

## 概述

运动卡片（ExerciseCard）是 Starfit 应用的核心交互组件，采用插件化架构支持多种运动类型。本文档定义了运动数据的标准格式、显示规范和实现细节。

## 数据结构标准

### ExerciseSet 接口

```typescript
interface ExerciseSet {
  id: string;
  reps?: number;        // 力量训练：重复次数
  weight?: number;      // 力量训练：重量 (kg)
  duration?: number;    // 有氧/静力：实际时长 (秒)
  distance?: number;    // 户外运动：实际距离 (米)
  targetDuration?: number;   // 目标时长 (秒)
  targetDistance?: number;   // 目标距离 (米)

  // 强度参数（有氧运动专用）
  intensityParams?: {
    incline?: number;         // 坡度 (跑步机)
    pace?: string;           // 配速 (跑步/划船)
    resistanceLevel?: number; // 阻力等级 (单车/椭圆机)
    rpm?: number;            // 转速 (单车)
    strokeRate?: number;     // 划频 (划船)
    power?: number;          // 功率 (单车, 瓦特)
  };

  /**
   * @deprecated 使用 `status` 代替。保留用于向后兼容。
   */
  completed?: boolean;

  /**
   * 组状态（遵循 protocol.ts ExerciseAction.sets 规范）
   */
  status?: 'UNKNOWN' | 'PLANNED' | 'ACTIVE' | 'COMPLETED' | 'SKIPPED';

  rpe?: number;          // 实际 RPE (0-10)
  restEndTime?: number;  // 休息结束时间戳 (毫秒)
}
```

### StandardExerciseMetadata 接口

```typescript
interface StandardExerciseMetadata {
  // 有氧运动模式
  cardioMode?: 'TIME_COUNTDOWN' | 'DISTANCE_TARGET' | 'FREE_RUN';
  cardioSubtype?: string;

  // 目标参数（标准命名）
  targetDurationSec?: number;    // 目标时长 (秒)
  targetDistanceMeters?: number;  // 目标距离 (米)
  targetHeartRateZone?: string;   // 目标心率区间 (如 "2", "3")

  // 显示设置
  name?: string;      // 运动显示名称
  targetRpe?: number; // 目标 RPE
}
```

## 运动类型对照表

| 运动类型 | 显示参数 | Sets 字段 | Metadata 字段 |
|---------|---------|-----------|--------------|
| **STRENGTH** (力量训练) | `reps × weight` | `reps`, `weight` | `targetRpe` |
| **CARDIO** (有氧运动) | `duration` + 心率区间 | `duration` | `targetDurationSec`, `targetHeartRateZone`, `cardioMode` |
| **ISOMETRIC** (静力训练) | `duration` + `weight` | `duration`, `weight` | `targetDuration` |
| **OUTDOOR** (户外运动) | `distance` + `duration` | `distance`, `duration` | `targetDistanceMeters`, `targetDurationSec`, `targetHeartRateZone` |

## 运动卡片组件

### ResistanceCard（力量训练）

**文件**: `src/v2/components/execution/plugins/ResistanceCard.tsx`

**功能**:
- 重量 × 次数输入
- 组完成状态切换
- 休息计时器（60秒 + 可扩展）

**更新字段**: `reps`, `weight`, `status`, `restEndTime`

**metadata**: `targetRpe`, `name`

---

### CardioCard（有氧运动/单车）

**文件**: `src/v2/components/execution/plugins/CardioCard.tsx`

**功能**:
- 倒计时/计时器
- 实时心率显示（从 IDB 获取）
- 自动完成逻辑

**更新字段**: `duration`, `status`, `timestamp`

**metadata**: `targetDurationSec`, `targetHeartRateZone`, `cardioMode`

---

### RunningCard（跑步机/自由跑）

**文件**: `src/v2/components/execution/plugins/RunningCard.tsx`

**功能**:
- 支持三种模式: TIME_COUNTDOWN, DISTANCE_TARGET, FREE_RUN
- 大字号计时/距离显示
- 进度条（倒计时模式）

**更新字段**: `duration`, `distance` (当有距离目标时), `status`, `timestamp`

**metadata**: `targetDurationSec`, `targetDistanceMeters`, `cardioMode`, `targetHeartRateZone`

---

### IsometricCard（静力训练）

**文件**: `src/v2/components/execution/plugins/IsometricCard.tsx`

**功能**:
- 倒计时/计时器
- 配重设置
- 自动完成逻辑

**更新字段**: `duration`, `weight`, `status`, `timestamp`

**metadata**: `targetDuration`, `name`

---

### OutdoorExerciseCardV2（户外GPS运动）

**文件**: `src/v2/components/execution/plugins/OutdoorExerciseCardV2.tsx`

**功能**:
- GPS 定位和轨迹记录
- 距离自动计算
- 地图显示（全屏模式）
- 支持三种模式: TIME_COUNTDOWN, DISTANCE_TARGET, FREE_RUN

**更新字段**: `duration`, `distance`, `status`, `timestamp`

**metadata**: `targetDurationSec`, `targetDistanceMeters`, `cardioMode`, `targetHeartRateZone`

## SummaryCard 显示逻辑

**文件**: `src/v2/components/execution/cards/SummaryCard.tsx`

**多态显示函数**:

```typescript
const getSetDisplayInfo = (exercise: any, set: any) => {
  const type = exercise?.type?.toUpperCase() || '';
  const metadata = exercise?.metadata || {};

  // 力量训练: reps × weight
  if (type === 'STRENGTH' || type === 'RESISTANCE' || ...) {
    return {
      primary: `${set.reps || 0} 次 × ${set.weight || 0}kg`,
      secondary: set.rpe ? `RPE ${set.rpe}` : '',
      typeLabel: '力量训练'
    };
  }

  // 有氧运动: duration + 心率区间
  if (type === 'CARDIO') {
    const duration = formatDuration(set.duration);
    const targetHr = metadata.targetHeartRateZone;
    return {
      primary: duration,
      secondary: targetHr ? `目标心率 Zone ${targetHr}` : '有氧运动',
      typeLabel: '有氧训练'
    };
  }

  // 静力训练: duration + weight
  if (type === 'ISOMETRIC') {
    return {
      primary: `${set.duration || 0} 秒`,
      secondary: set.weight ? `${set.weight} kg 配重` : '静力保持',
      typeLabel: '静力训练'
    };
  }

  // 户外运动: distance + duration
  if (type === 'OUTDOOR') {
    const dist = formatDistance(set.distance);
    const dur = formatDuration(set.duration);
    return {
      primary: `${dist} | ${dur}`,
      secondary: metadata.targetHeartRateZone ? `目标心率 Zone ${metadata.targetHeartRateZone}` : '户外运动',
      typeLabel: '户外运动'
    };
  }

  return { primary: '已完成', secondary: '', typeLabel: type || '训练' };
};
```

## 数据流

```
┌─────────────────────────────────────────────────────────────┐
│  运动卡片执行                                                │
│  ↓ onUpdate({ sets: [...] })                                │
├─────────────────────────────────────────────────────────────┤
│  Session 状态 (App.tsx)                                      │
│  session.exercises[i].sets                                   │
│  session.exercises[i].metadata                               │
│  ↓                                                           │
├─────────────────────────────────────────────────────────────┤
│  训练结束 - 构造 localSummaryData (App.tsx:831-845)         │
│  {                                                           │
│    stats: { totalVolume, setsCount, durationMinutes },       │
│    exercises: [{ name, type, sets, metadata }],  ← ✅ 包含  │
│    anomalies                                                 │
│  }                                                           │
│  ↓                                                           │
├─────────────────────────────────────────────────────────────┤
│  Chat API 调用 (SSE 流式)                                    │
│  metadata: { intent_context: localSummaryData }              │
│  ↓                                                           │
├─────────────────────────────────────────────────────────────┤
│  后端返回 ui_hint                                            │
│  { type: 'workout_summary', data: localSummaryData }         │
│  ↓                                                           │
├─────────────────────────────────────────────────────────────┤
│  SummaryCard 显示                                            │
│  动态显示每个运动类型的正确参数                              │
└─────────────────────────────────────────────────────────────┘
```

## 类型兼容性处理

### status vs completed

所有运动卡片在调用 `onUpdate` 时都同时更新 `status` 和 `completed` 字段：

```typescript
// 同步逻辑
if (updates.status === 'COMPLETED') {
  finalUpdates.completed = true;
} else if (updates.status === 'PLANNED') {
  finalUpdates.completed = false;
} else if (updates.completed !== undefined) {
  finalUpdates.status = updates.completed ? 'COMPLETED' : 'PLANNED';
}
```

这确保了：
- **向后兼容**: 使用 `completed` 的旧代码仍然可以工作
- **向前兼容**: 新代码使用 `status` 枚举
- **数据一致性**: 两个字段始终保持同步

## 性能要求

- 首屏渲染时间 < 100ms
- 交互响应时间 < 50ms
- 动画保持 60fps

## 测试规范

### 单元测试
- [ ] 数据转换函数测试
- [ ] 运动类型判断函数测试
- [ ] 每个运动卡片的 onUpdate 测试

### 集成测试
- [ ] 完整训练流程测试（力量训练）
- [ ] 完整训练流程测试（有氧运动）
- [ ] 完整训练流程测试（户外运动）
- [ ] SummaryCard 显示验证

### 回归测试
- [ ] 历史数据兼容性测试
- [ ] 数据库归档格式验证

## 相关文档

- [UI 指南 - 运动卡片系统](../ui-guides/exercise-card-system.md)
- [UI 指南 - 动画交互系统](../ui-guides/animation-interaction-system.md)
- [数据协议标准](../architecture/data-flow.md)
