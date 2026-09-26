/**
 * Tests for coachPrefill — AI 教练入口预填文案（B1 / issue #5）
 *
 * 覆盖三场景路由 + 文案组装 + 形态异常兜底：
 *   A 有周计划（今日有条目）→ 今日计划摘要
 *   B 新手（无训练记录 + 无周计划 / 课表不可得）→ 引导预填
 *   C 老用户无今日计划 → 轻预填 / 不预填（课表不可得时不猜）
 */
import { describe, expect, it } from 'vitest';
import type { TodayScheduleResponse } from 'shared/contracts';
import {
  buildPlannedPrefill,
  LIGHT_PREFILL,
  NEWBIE_PREFILL,
  resolveCoachPrefill,
} from './coachPrefill';

const UUID = '00000000-0000-4000-8000-000000000001';

const mkEntry = (
  name: string,
  target_sets: number,
  load: { type: 'rpe' | 'percent_1rm'; min: number; max: number },
  sort_order = 0,
) => ({
  entry_id: UUID,
  exercise_id: 'abcd1234efgh',
  exercise_name: name,
  target_sets,
  target_load: load,
  status: 'planned' as const,
  sort_order,
});

const mkSchedule = (
  overrides: Partial<TodayScheduleResponse> = {},
): TodayScheduleResponse => ({
  date: '2026-09-26',
  week_id: '2026-W39',
  status: 'planned',
  split: 'push_pull_legs',
  entries: [],
  ...overrides,
});

describe('buildPlannedPrefill（场景 A：计划日摘要）', () => {
  it('组装分化标签 + 动作条目 + 收尾语（RPE 区间）', () => {
    const text = buildPlannedPrefill(
      mkSchedule({
        entries: [
          mkEntry('杠铃卧推', 4, { type: 'rpe', min: 7, max: 8 }),
          mkEntry('哑铃肩推', 3, { type: 'rpe', min: 7, max: 8 }, 1),
          mkEntry('绳索下压', 4, { type: 'rpe', min: 8, max: 8 }, 2),
        ],
      }),
    );
    expect(text).toBe(
      '今天是我的推拉腿：杠铃卧推 4组·RPE 7–8 / 哑铃肩推 3组·RPE 7–8 / 绳索下压 4组·RPE 8，带我练',
    );
  });

  it('%1RM 区间按同源 formatTargetLoad 文案输出', () => {
    const text = buildPlannedPrefill(
      mkSchedule({
        split: 'upper_lower',
        entries: [mkEntry('Barbell Back Squat', 4, { type: 'percent_1rm', min: 70, max: 80 })],
      }),
    );
    expect(text).toBe('今天是我的上下：Barbell Back Squat 4组·70–80% 1RM，带我练');
  });

  it('条目超过 6 个时折叠为计数', () => {
    const entries = Array.from({ length: 9 }, (_, i) =>
      mkEntry(`动作${i + 1}`, 3, { type: 'rpe', min: 7, max: 8 }, i),
    );
    const text = buildPlannedPrefill(mkSchedule({ entries }));
    expect(text).toContain('动作6');
    expect(text).not.toContain('动作7');
    expect(text).toContain('等 9 个动作，带我练');
  });

  it('status=planned 但 entries 意外为空（形态异常）→ 空串交由路由兜底', () => {
    expect(buildPlannedPrefill(mkSchedule())).toBe('');
  });
});

describe('resolveCoachPrefill（三场景路由）', () => {
  it('场景 A：今日有条目 → 计划摘要', () => {
    const schedule = mkSchedule({
      entries: [mkEntry('杠铃卧推', 4, { type: 'rpe', min: 7, max: 8 })],
    });
    expect(resolveCoachPrefill(schedule, true)).toContain('今天是我的推拉腿');
    expect(resolveCoachPrefill(schedule, false)).toContain('带我练');
  });

  it('场景 B：无周计划 + 本地无训练记录 → 新手引导预填', () => {
    expect(resolveCoachPrefill(mkSchedule({ status: 'no_plan', split: null }), false)).toBe(
      NEWBIE_PREFILL,
    );
    // 有计划但今日休息 → 不算新手（issue 判定要求无周计划）
    expect(
      resolveCoachPrefill(mkSchedule({ status: 'rest_day' }), false),
    ).not.toBe(NEWBIE_PREFILL);
  });

  it('场景 C：老用户无今日计划 → 轻预填「今天练什么？」', () => {
    expect(resolveCoachPrefill(mkSchedule({ status: 'rest_day' }), true)).toBe(LIGHT_PREFILL);
    expect(
      resolveCoachPrefill(mkSchedule({ status: 'no_plan', split: null }), true),
    ).toBe(LIGHT_PREFILL);
  });

  it('课表不可得（null）：老用户不猜（空串不预填），无记录者仍按新手引导', () => {
    expect(resolveCoachPrefill(null, true)).toBe('');
    expect(resolveCoachPrefill(null, false)).toBe(NEWBIE_PREFILL);
  });

  it('planned 形态异常（摘要为空串）→ 轻预填兜底，不静默失败', () => {
    expect(resolveCoachPrefill(mkSchedule(), true)).toBe(LIGHT_PREFILL);
  });
});
