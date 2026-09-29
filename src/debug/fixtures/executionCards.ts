/**
 * T1 执行卡片 fixtures（issue #53）——ExerciseRenderer exercise 分支的动作卡样例。
 *
 * 形态真源：src/types/protocol.ts ExerciseActionSchema + 各执行插件
 * （ResistanceCard / CardioCard / IsometricCard / OutdoorExerciseCardV2）实际
 * 消费的字段。分发键 = exercise.uiHint.cardType（PluginRegistry 的键）。
 *
 * fixtures.schema.test.ts 对每个 exercise 跑 ExerciseActionSchema 校验。
 */
import type { DebugScenario } from './types';

/** 稳定 UUID（执行卡 id 必须是 UUID，固定值保证测试可断言、截图可复现） */
const UUID = {
  bench: '0a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d',
  treadmill: '1b2c3d4e-5f6a-4b7c-9d8e-1f2a3b4c5d6e',
  plank: '2c3d4e5f-6a7b-4c8d-ae9f-2a3b4c5d6e7f',
  outdoorRun: '3d4e5f6a-7b8c-4d9e-bf0a-3b4c5d6e7f8a',
} as const;

export const EXECUTION_CARD_SCENARIOS: DebugScenario[] = [
  {
    id: 'exec-resistance',
    group: 'execution-card',
    label: '执行卡 · 抗阻（卧推）',
    description: 'resistance_standard → ResistanceCard：4 组 × 8 次，带史前完成态与 RPE',
    exercise: {
      protocol_version: '2.0.0',
      id: UUID.bench,
      exerciseId: 'bench_press',
      type: 'resistance',
      uiHint: { cardType: 'resistance_standard' },
      sets: [
        { index: 0, reps: 8, weight: 60, rpe: 7, status: 'COMPLETED' },
        { index: 1, reps: 8, weight: 62.5, rpe: 8, status: 'COMPLETED' },
        { index: 2, reps: 6, weight: 65, rpe: 9, status: 'COMPLETED' },
        { index: 3, reps: 8, weight: 62.5, status: 'PLANNED' },
      ],
      metadata: { name: '杠铃卧推', targetSets: 4, restSeconds: 120 },
    },
  },
  {
    id: 'exec-hiit-cardio',
    group: 'execution-card',
    label: '执行卡 · 有氧计时（跑步机）',
    description: 'hiit_timer → CardioCard：时长计量 + 心率/配速展示位',
    exercise: {
      protocol_version: '2.0.0',
      id: UUID.treadmill,
      exerciseId: 'treadmill_run',
      type: 'cardio',
      uiHint: { cardType: 'hiit_timer' },
      sets: [
        { index: 0, duration: 600, status: 'COMPLETED' },
        { index: 1, duration: 300, status: 'PLANNED' },
      ],
      metadata: { name: '跑步机', targetHeartRateZone: '3' },
    },
  },
  {
    id: 'exec-isometric',
    group: 'execution-card',
    label: '执行卡 · 静力（平板支撑）',
    description: 'isometric_static → IsometricCard：3 组 × 60s 倒计时',
    exercise: {
      protocol_version: '2.0.0',
      id: UUID.plank,
      exerciseId: 'plank',
      type: 'isometric',
      uiHint: { cardType: 'isometric_static' },
      sets: [
        { index: 0, duration: 60, status: 'COMPLETED' },
        { index: 1, duration: 60, status: 'PLANNED' },
        { index: 2, duration: 45, status: 'PLANNED' },
      ],
      metadata: { name: '平板支撑', targetDuration: 60 },
    },
  },
  {
    id: 'exec-outdoor-gps',
    group: 'execution-card',
    label: '执行卡 · 户外 GPS 跑',
    description: 'running_gps → OutdoorExerciseCardV2（懒加载；建议浏览器场景查看，需定位权限）',
    exercise: {
      protocol_version: '2.0.0',
      id: UUID.outdoorRun,
      exerciseId: 'outdoor_running',
      type: 'outdoor',
      uiHint: { cardType: 'running_gps' },
      sets: [{ index: 0, distance: 5000, duration: 1800, status: 'PLANNED' }],
      metadata: { name: '户外跑', targetDistance: 5000 },
    },
  },
];
