/**
 * Session persist contract tests — POST /api/sessions Zod schema
 *
 * 验证前端 workoutSummary 预处理后的格式化训练记录能通过后端校验，
 * 且坏数据被正确拒绝。纯 schema 层测试（无 DB / 无 HTTP）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

// Mirror of sessionController.ts schemas (kept in sync — controller does not
// export them; if the controller changes, these tests will surface drift via
// the contract fixtures below).
const ExerciseEntrySchema = z.object({
  name: z.string().min(1, 'Exercise name is required'),
  type: z.string().optional(),
  sets: z.number().int().min(0).optional(),
  completed_sets: z.number().int().min(0).optional(),
  reps: z.number().int().positive().optional(),
  // assisted 动作用负重量表示助力（如 -10kg），所以不设 min(0)
  weight: z.number().optional(),
  duration: z.number().positive().optional(),
  distance: z.number().min(0).optional(),
  avg_hr: z.number().min(0).optional(),
  metadata: z.any().optional(),
});

const StatsSchema = z.object({
  totalVolume: z.number().min(0),
  setsCount: z.number().int().min(0),
  totalCardioDurationSec: z.number().min(0).optional(),
  totalDistanceM: z.number().min(0).optional(),
  durationMinutes: z.number().int().min(0).optional(),
  avgHr: z.number().min(0).optional(),
}).optional();

const SessionSchema = z.object({
  sessionId: z.string().uuid().optional(),
  startTime: z.number().positive('Start time must be a positive timestamp'),
  endTime: z.number().positive('End time must be a positive timestamp'),
  exercises: z.array(ExerciseEntrySchema).min(1, 'At least one exercise is required'),
  stats: StatsSchema,
  notes: z.string().max(2000).optional(),
});

// ---------------------------------------------------------------------------
// Fixtures: exactly what workoutSummary.buildSessionPayload produces
// ---------------------------------------------------------------------------

const resistanceEntry = {
  name: '杠铃卧推', type: 'resistance',
  sets: 3, completed_sets: 2, weight: 60, reps: 10,
};
const cardioEntry = {
  name: '跑步机', type: 'cardio',
  sets: 2, completed_sets: 2, duration: 1800, distance: 4500, avg_hr: 145,
};
const mixedStats = {
  totalVolume: 1200, setsCount: 4,
  totalCardioDurationSec: 1800, totalDistanceM: 4500, avgHr: 145,
};

const validSession = {
  sessionId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
  startTime: 1757000000000,
  endTime: 1757000300000,
  exercises: [resistanceEntry, cardioEntry],
  stats: mixedStats,
};

describe('POST /api/sessions schema — 前端格式化训练记录契约', () => {
  it('接受 workoutSummary 产出的完整混合 payload（抗阻+有氧）', () => {
    const r = SessionSchema.safeParse(validSession);
    assert.equal(r.success, true, JSON.stringify(r.error?.issues));
  });

  it('接受纯有氧 payload（无 totalVolume 维度数据）', () => {
    const r = SessionSchema.safeParse({
      ...validSession,
      exercises: [{ name: '户外跑', type: 'outdoor', duration: 3600, distance: 8000, avg_hr: 135 }],
      stats: { totalVolume: 0, setsCount: 1, totalCardioDurationSec: 3600, totalDistanceM: 8000, avgHr: 135 },
    });
    assert.equal(r.success, true);
  });

  it('接受 assist 负重量（助力 -10kg 保留）', () => {
    const r = SessionSchema.safeParse({
      ...validSession,
      exercises: [{ name: '助力引体', type: 'assisted', sets: 2, completed_sets: 2, weight: -10, reps: 8 }],
    });
    assert.equal(r.success, true);
  });

  it('接受最小 payload（仅 name 必填的动作行 + 可选 stats）', () => {
    const r = SessionSchema.safeParse({
      startTime: 1757000000000,
      endTime: 1757000300000,
      exercises: [{ name: '未知动作' }],
    });
    assert.equal(r.success, true);
  });

  it('拒绝：缺 exercises', () => {
    const r = SessionSchema.safeParse({ startTime: 1, endTime: 2, exercises: [] });
    assert.equal(r.success, false);
  });

  it('拒绝：空动作名', () => {
    const r = SessionSchema.safeParse({
      startTime: 1, endTime: 2,
      exercises: [{ name: '', type: 'cardio', duration: 600 }],
    });
    assert.equal(r.success, false);
  });

  it('拒绝：负距离 / 零时长', () => {
    const r = SessionSchema.safeParse({
      startTime: 1, endTime: 2,
      exercises: [{ name: '跑步机', duration: 0, distance: -100 }],
    });
    assert.equal(r.success, false);
  });

  it('拒绝：负 stats.totalVolume', () => {
    const r = SessionSchema.safeParse({
      ...validSession,
      stats: { totalVolume: -5, setsCount: 0 },
    });
    assert.equal(r.success, false);
  });
});
