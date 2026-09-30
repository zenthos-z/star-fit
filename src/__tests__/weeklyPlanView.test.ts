/**
 * weeklyPlanView — 周计划视图模型纯函数单测（D2/C2 共用层）。
 *
 * 覆盖：ISO 周日期推导（周一锚定/跨月）、负荷区间文案、三态课表 → 详情 VM、
 * AI 卡 → 详情 VM（逐组参数透传）、等参数折叠判定、概览文案、
 * T10/#67 三段式归组与 T9 结构化字段消费（rationale/category/sets，旧数据回落）。
 */
import { describe, it, expect } from 'vitest';
import type { TodayScheduleResponse, WeeklyPlanCardData } from 'shared/contracts';
import {
  formatDateKey,
  dowIndexOf,
  dowFullLabel,
  dowShortLabel,
  dayNumber,
  getWeekDates,
  formatTargetLoad,
  splitLabelZh,
  todayScheduleDayToVM,
  weeklyCardDayToVM,
  weeklyCardRows,
  dayVolumeSummary,
  exerciseNameLine,
  groupExercisesByCategory,
  isUniformSetBlock,
} from '../utils/weeklyPlanView';

const rpe = (min: number, max: number) => ({ type: 'rpe' as const, min, max });
const pct = (min: number, max: number) => ({ type: 'percent_1rm' as const, min, max });

const plannedDay = (date: string): TodayScheduleResponse => ({
  date,
  week_id: '2026-W39',
  status: 'planned',
  split: 'push_pull_legs',
  entries: [
    {
      entry_id: 'e1',
      exercise_id: 'V1StGXR8_Z5jdHi6',
      exercise_name: '杠铃深蹲',
      target_sets: 3,
      target_load: rpe(7, 8),
      status: 'planned',
      sort_order: 0,
    },
    {
      entry_id: 'e2',
      exercise_id: 'a1b2c3d4e5f6',
      exercise_name: '腿举',
      target_sets: 4,
      target_load: pct(70, 80),
      status: 'planned',
      sort_order: 1,
    },
  ],
});

describe('formatDateKey / dow / dayNumber', () => {
  it('formats local calendar day without timezone drift', () => {
    expect(formatDateKey(new Date(2026, 8, 21))).toBe('2026-09-21');
    expect(formatDateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('maps dates to Monday-first dow indices', () => {
    // 2026-09-21 是周一
    expect(dowIndexOf('2026-09-21')).toBe(0);
    expect(dowFullLabel('2026-09-21')).toBe('周一');
    // 2026-09-27 是周日
    expect(dowIndexOf('2026-09-27')).toBe(6);
    expect(dowFullLabel('2026-09-27')).toBe('周日');
    expect(dowShortLabel('2026-09-25')).toBe('五');
    expect(dayNumber('2026-09-26')).toBe(26);
    // 非法日期
    expect(dowIndexOf('2026-9-21')).toBeNull();
  });
});

describe('getWeekDates', () => {
  it('returns Mon-Sun of the anchor week', () => {
    // 2026-09-23（周三）所在周
    expect(getWeekDates(new Date(2026, 8, 23))).toEqual([
      '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24',
      '2026-09-25', '2026-09-26', '2026-09-27',
    ]);
  });

  it('anchors Sunday back into its Monday-start week', () => {
    // 2026-09-27 是周日 → 本周从 09-21 开始
    const days = getWeekDates(new Date(2026, 8, 27));
    expect(days[0]).toBe('2026-09-21');
    expect(days[6]).toBe('2026-09-27');
  });

  it('handles month boundaries', () => {
    // 2026-10-01（周四）→ 本周从 2026-09-28（周一）开始
    const days = getWeekDates(new Date(2026, 9, 1));
    expect(days[0]).toBe('2026-09-28');
    expect(days[6]).toBe('2026-10-04');
  });
});

describe('formatTargetLoad / splitLabelZh', () => {
  it('formats rpe and percent ranges', () => {
    expect(formatTargetLoad(rpe(7, 8))).toBe('RPE 7–8');
    expect(formatTargetLoad(pct(70, 80))).toBe('70–80% 1RM');
  });

  it('collapses single-point ranges', () => {
    expect(formatTargetLoad(rpe(8, 8))).toBe('RPE 8');
  });

  it('maps split enums to Chinese labels', () => {
    expect(splitLabelZh('push_pull_legs')).toBe('推拉腿');
    expect(splitLabelZh('upper_lower')).toBe('上下');
    expect(splitLabelZh('full_body')).toBe('全身');
    expect(splitLabelZh('hybrid')).toBe('混合');
    expect(splitLabelZh('custom')).toBe('自定义');
  });
});

describe('todayScheduleDayToVM', () => {
  it('expands per-set rows with load text for planned days', () => {
    const vm = todayScheduleDayToVM(plannedDay('2026-09-25'), '2026-W39 · 推拉腿');
    expect(vm.rest).toBe(false);
    expect(vm.title).toBe('周五 · 推拉腿');
    expect(vm.exercises).toHaveLength(2);
    expect(vm.exercises[0].sets).toHaveLength(3);
    expect(vm.exercises[0].sets[0]).toMatchObject({ setNo: 1, loadText: 'RPE 7–8' });
    expect(vm.exercises[1].sets[2]).toMatchObject({ setNo: 3, loadText: '70–80% 1RM' });
  });

  it('treats rest_day / no_plan as rest with empty exercises', () => {
    const rest: TodayScheduleResponse = {
      date: '2026-09-22', week_id: '2026-W39', status: 'rest_day',
      split: 'push_pull_legs', entries: [],
    };
    const noPlan: TodayScheduleResponse = {
      date: '2026-09-22', week_id: '2026-W39', status: 'no_plan',
      split: null, entries: [],
    };
    expect(todayScheduleDayToVM(rest).rest).toBe(true);
    expect(todayScheduleDayToVM(rest).exercises).toEqual([]);
    expect(todayScheduleDayToVM(noPlan, 'm').metaLine).toBe('m');
  });
});

describe('weeklyCardDayToVM / weeklyCardRows', () => {
  const cardData: WeeklyPlanCardData = {
    week_label: '第 2 周',
    phase_label: '力量块',
    split_summary: '推拉腿 · 每周 3 练 · 主项渐进 +1 档',
    days: [
      {
        entry_date: '2026-09-25',
        split_label: '腿',
        focus: '腿臀，4 动作',
        rest: false,
        exercises: [
          {
            exercise_id: 'V1StGXR8_Z5jdHi6',
            name: '杠铃深蹲',
            sets: [
              { set: 1, weight: 60, reps: 8, set_type: 'working' },
              { set: 2, weight: 65, reps: 6, set_type: 'working' },
            ],
          },
        ],
      },
      { entry_date: '2026-09-22', rest: true, exercises: [] },
    ],
  };

  it('passes per-set params through verbatim', () => {
    const vm = weeklyCardDayToVM(cardData.days[0], '第 2 周 · 力量块');
    expect(vm.title).toBe('周五 · 腿');
    expect(vm.splitLabel).toBe('腿臀，4 动作');
    expect(vm.exercises[0].sets[0]).toMatchObject({ setNo: 1, weightKg: 60, reps: 8 });
    expect(vm.exercises[0].sets[1]).toMatchObject({ setNo: 2, weightKg: 65, reps: 6 });
  });

  it('sorts rows by date and carries splitTag/focus separately', () => {
    const rows = weeklyCardRows(cardData);
    expect(rows.map((r) => r.entryDate)).toEqual(['2026-09-22', '2026-09-25']);
    expect(rows[1].splitTag).toBe('腿');
    expect(rows[1].focus).toBe('腿臀，4 动作');
    expect(rows[0].rest).toBe(true);
  });
});

describe('overview / uniform collapse helpers', () => {
  it('summarizes action and set counts', () => {
    const vm = todayScheduleDayToVM(plannedDay('2026-09-25'));
    expect(dayVolumeSummary(vm.exercises)).toBe('2 动作 · 7 组');
    expect(exerciseNameLine(vm.exercises)).toBe('杠铃深蹲 · 腿举');
    expect(dayVolumeSummary([])).toBeUndefined();
  });

  it('detects uniform set blocks (no per-set variance)', () => {
    const uniform = [
      { setNo: 1, loadText: 'RPE 7–8' },
      { setNo: 2, loadText: 'RPE 7–8' },
      { setNo: 3, loadText: 'RPE 7–8' },
    ];
    const varied = [
      { setNo: 1, weightKg: 60, reps: 8 },
      { setNo: 2, weightKg: 65, reps: 6 },
    ];
    expect(isUniformSetBlock(uniform)).toBe(true);
    expect(isUniformSetBlock(varied)).toBe(false);
    expect(isUniformSetBlock([{ setNo: 1, loadText: 'RPE 7' }])).toBe(false);
    // 逐组 RPE 有差异 → 不折叠（T9 金字塔/递减处方必须逐组可见）
    expect(isUniformSetBlock([
      { setNo: 1, reps: 8, rpe: 6 },
      { setNo: 2, reps: 8, rpe: 8 },
    ])).toBe(false);
  });
});

// ============================================================================
// T10/#67 — T9 结构化字段消费 + 三段式归组
// ============================================================================

/** T9 结构化课表日：三段式 + 逐组处方 + day_focus/rationale 随行 */
const structuredDay = (date: string): TodayScheduleResponse => ({
  date,
  week_id: '2026-W40',
  status: 'planned',
  split: 'push_pull_legs',
  entries: [
    {
      entry_id: 's1',
      exercise_id: 'V1StGXR8_Z5jdHi6',
      exercise_name: '髋部动态热身',
      target_sets: 1,
      target_load: rpe(5, 5),
      status: 'planned',
      sort_order: 0,
      day_focus: '腿',
      rationale: '腿日安排在力量块中段，深蹲与辅助动作按 60→65kg 递增；注意蹲深。',
      category: 'warmup',
      sets: [{ set_no: 1, reps: 10, rpe: 5 }],
    },
    {
      entry_id: 's2',
      exercise_id: 'a1b2c3d4e5f6',
      exercise_name: '杠铃深蹲',
      target_sets: 2,
      target_load: rpe(7, 8),
      status: 'planned',
      sort_order: 1,
      day_focus: '腿',
      rationale: '腿日安排在力量块中段，深蹲与辅助动作按 60→65kg 递增；注意蹲深。',
      category: 'main',
      sets: [
        { set_no: 1, weight_kg: 60, reps: 8, rpe: 7 },
        { set_no: 2, weight_kg: 65, reps: 6, rpe: 8 },
      ],
    },
    {
      entry_id: 's3',
      exercise_id: 'b2c3d4e5f6a1',
      exercise_name: '股四头肌静态拉伸',
      target_sets: 1,
      target_load: rpe(4, 4),
      status: 'planned',
      sort_order: 2,
      day_focus: '腿',
      rationale: '腿日安排在力量块中段，深蹲与辅助动作按 60→65kg 递增；注意蹲深。',
      category: 'cooldown',
      sets: [{ set_no: 1, reps: 30, rpe: 4 }],
    },
  ],
});

describe('todayScheduleDayToVM — T9 结构化字段（T10/#67）', () => {
  it('carries rationale（同日冗余同值取首个非空）', () => {
    const vm = todayScheduleDayToVM(structuredDay('2026-09-25'));
    expect(vm.rationale).toBe('腿日安排在力量块中段，深蹲与辅助动作按 60→65kg 递增；注意蹲深。');
  });

  it('expands per-set prescriptions verbatim（配重×次数×RPE）', () => {
    const vm = todayScheduleDayToVM(structuredDay('2026-09-25'));
    const squat = vm.exercises[1];
    expect(squat.sets).toHaveLength(2);
    expect(squat.sets[0]).toMatchObject({ setNo: 1, weightKg: 60, reps: 8, rpe: 7 });
    expect(squat.sets[1]).toMatchObject({ setNo: 2, weightKg: 65, reps: 6, rpe: 8 });
    // 逐组处方行无区间文案（不与 target_load 区间混排）
    expect(squat.sets[0].loadText).toBeUndefined();
    // 无配重动作（热身/拉伸）：rpe 随行作为负荷锚
    expect(vm.exercises[0].sets[0]).toMatchObject({ setNo: 1, reps: 10, rpe: 5 });
    expect(vm.exercises[0].sets[0].weightKg).toBeUndefined();
  });

  it('maps categories through resolvePlanEntryCategory（warmup/main/cooldown）', () => {
    const vm = todayScheduleDayToVM(structuredDay('2026-09-25'));
    expect(vm.exercises.map((e) => e.category)).toEqual(['warmup', 'main', 'cooldown']);
  });

  it('falls back for legacy plans（无 T9 字段：rationale 缺省、category 回落 main、sets 回落区间文案）', () => {
    const vm = todayScheduleDayToVM(plannedDay('2026-09-25'));
    expect(vm.rationale).toBeUndefined();
    expect(vm.exercises.map((e) => e.category)).toEqual(['main', 'main']);
    expect(vm.exercises[0].sets[0]).toMatchObject({ setNo: 1, loadText: 'RPE 7–8' });
    expect(vm.exercises[0].sets[0].weightKg).toBeUndefined();
  });
});

describe('groupExercisesByCategory — 三段式归组（T10/#67）', () => {
  it('groups in fixed warmup→main→cooldown order', () => {
    const vm = todayScheduleDayToVM(structuredDay('2026-09-25'));
    const groups = groupExercisesByCategory(vm.exercises);
    expect(groups.map((g) => g.category)).toEqual(['warmup', 'main', 'cooldown']);
    expect(groups.map((g) => g.label)).toEqual(['热身动作', '正式动作', '收尾动作（拉伸）']);
    expect(groups[0].exercises).toHaveLength(1);
    expect(groups[1].exercises).toHaveLength(1);
    expect(groups[2].exercises).toHaveLength(1);
  });

  it('omits empty sections（旧计划全 main → 单段）', () => {
    const vm = todayScheduleDayToVM(plannedDay('2026-09-25'));
    const groups = groupExercisesByCategory(vm.exercises);
    expect(groups).toHaveLength(1);
    expect(groups[0].category).toBe('main');
    expect(groups[0].exercises).toHaveLength(2);
  });
});

describe('weeklyCardDayToVM — T9 字段透传（rationale/category）', () => {
  it('carries day rationale and per-exercise category', () => {
    const cardData: WeeklyPlanCardData = {
      week_label: '第 2 周',
      split_summary: '推拉腿 · 每周 3 练',
      days: [
        {
          entry_date: '2026-09-25',
          split_label: '腿',
          rationale: '力量块中段安排腿日，主项递增。',
          rest: false,
          exercises: [
            {
              exercise_id: 'V1StGXR8_Z5jdHi6',
              name: '杠铃深蹲',
              category: 'main',
              sets: [{ set: 1, weight: 60, reps: 8, set_type: 'working' as const }],
            },
          ],
        },
      ],
    };
    const vm = weeklyCardDayToVM(cardData.days[0]);
    expect(vm.rationale).toBe('力量块中段安排腿日，主项递增。');
    expect(vm.exercises[0].category).toBe('main');
  });

  it('legacy card without T9 fields falls back（rationale 缺省、category 回落 main）', () => {
    const cardData: WeeklyPlanCardData = {
      week_label: '第 1 周',
      split_summary: '全身 · 每周 2 练',
      days: [
        {
          entry_date: '2026-09-25',
          rest: false,
          exercises: [
            { exercise_id: 'V1StGXR8_Z5jdHi6', name: '杠铃深蹲', sets: [{ set: 1, weight: 60, reps: 8, set_type: 'working' as const }] },
          ],
        },
      ],
    };
    const vm = weeklyCardDayToVM(cardData.days[0]);
    expect(vm.rationale).toBeUndefined();
    expect(vm.exercises[0].category).toBe('main');
  });
});
