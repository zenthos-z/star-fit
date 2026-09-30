/**
 * B3 开始运动子菜单 + 首次使用预调研分流（issue #23）单测
 * 覆盖：三选项条件渲染（有/无计划）、分流决策四象限、画像四题口径、
 *       文案红线（无 emoji / 无禁色值）
 * T8 #65：开始菜单三态（ready 载入计划 / rest 今日休息 / none 两选项回落）、
 *         优先级规则（今日排期优先，本地暂存 nextPlan 兜底）、课表条目→预填映射
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  buildStartMenuOptions,
  resolveFirstUseTriage,
  resolveTodayPlanMenuState,
  scheduleEntriesToPlanItems,
  resolveUserHasHistory,
  NEWBIE_SURVEY_QUESTIONS,
  PLAN_GUIDE_TEXT,
  NEWBIE_SURVEY_TEXT,
  START_OPTION_KEYS,
} from '../startOnboarding';
import type { TodayScheduleResponse } from 'shared/contracts';
import { Keys } from '@/storage/schemas';

const noop = () => {};
const actions = {
  onPickLibrary: noop,
  onOpenCoach: noop,
  onLoadPlan: noop,
};

// --- 今日课表 fixture（TodayScheduleResponse 形态，契约 superRefine 同构） ---
const mkSchedule = (
  overrides: Partial<TodayScheduleResponse> & { status: TodayScheduleResponse['status'] },
): TodayScheduleResponse => ({
  date: '2026-09-30',
  week_id: '2026-W40',
  split: overrides.status === 'no_plan' ? null : 'push_pull_legs',
  entries: [],
  ...overrides,
});
const plannedSchedule = mkSchedule({
  status: 'planned',
  entries: [
    {
      entry_id: '11111111-1111-4111-8111-111111111111',
      exercise_id: 'abc123def456',
      exercise_name: '杠铃卧推',
      target_sets: 4,
      target_load: { type: 'rpe', min: 7, max: 8 },
      status: 'planned',
      sort_order: 0,
    },
    {
      entry_id: '22222222-2222-4222-8222-222222222222',
      exercise_id: 'xyz789ghi012',
      exercise_name: '绳索下压',
      target_sets: 3,
      target_load: { type: 'rpe', min: 8, max: 8 },
      status: 'planned',
      sort_order: 1,
    },
  ],
});

describe('resolveTodayPlanMenuState · 三态判定与优先级（T8 #65）', () => {
  it('今日排期 planned 且有条目 → ready（排期优先）', () => {
    expect(resolveTodayPlanMenuState(plannedSchedule, null)).toEqual({ kind: 'ready', source: 'schedule' });
    // 排期与本地暂存并存：仍是排期优先
    expect(resolveTodayPlanMenuState(plannedSchedule, [{ name: 'x' }])).toEqual({ kind: 'ready', source: 'schedule' });
  });

  it('今日=休息日 → rest（排期在场即权威，本地暂存不越权覆盖课表）', () => {
    const restSchedule = mkSchedule({ status: 'rest_day' });
    expect(resolveTodayPlanMenuState(restSchedule, null)).toEqual({ kind: 'rest' });
    expect(resolveTodayPlanMenuState(restSchedule, [{ name: 'x' }])).toEqual({ kind: 'rest' });
  });

  it('无排期（no_plan）→ 本地暂存 nextPlan 兜底（ready·local）', () => {
    const noPlan = mkSchedule({ status: 'no_plan' });
    expect(resolveTodayPlanMenuState(noPlan, [{ name: 'x' }])).toEqual({ kind: 'ready', source: 'local' });
    expect(resolveTodayPlanMenuState(noPlan, null)).toEqual({ kind: 'none' });
    expect(resolveTodayPlanMenuState(noPlan, [])).toEqual({ kind: 'none' });
  });

  it('课表不可得（null）→ 本地暂存兜底；两者皆无 → none（两选项回落现状）', () => {
    expect(resolveTodayPlanMenuState(null, [{ name: 'x' }])).toEqual({ kind: 'ready', source: 'local' });
    expect(resolveTodayPlanMenuState(null, null)).toEqual({ kind: 'none' });
  });

  it('planned 形态异常（entries 意外为空）→ 不按训练日算，回落暂存/none', () => {
    const broken = mkSchedule({ status: 'planned', entries: [] });
    expect(resolveTodayPlanMenuState(broken, [{ name: 'x' }])).toEqual({ kind: 'ready', source: 'local' });
    expect(resolveTodayPlanMenuState(broken, null)).toEqual({ kind: 'none' });
  });
});

describe('buildStartMenuOptions · 三选项条件渲染（T8 #65 三态）', () => {
  it('none = 两选项回落现状（挑选动作 + AI 教练）', () => {
    const opts = buildStartMenuOptions({ kind: 'none' }, actions);
    expect(opts).toHaveLength(2);
    expect(opts.map(o => o.key)).toEqual([START_OPTION_KEYS.library, START_OPTION_KEYS.aiCoach]);
    expect(opts.map(o => o.label)).toEqual(['挑选动作', 'AI 教练']);
  });

  it('ready = 三选项，第三选项为「载入计划」且置末位（文案 T8 #65 定稿）', () => {
    const opts = buildStartMenuOptions({ kind: 'ready', source: 'schedule' }, actions);
    expect(opts).toHaveLength(3);
    expect(opts[2].key).toBe(START_OPTION_KEYS.loadPlan);
    expect(opts[2].label).toBe('载入计划');
    expect(opts[2].disabled).toBeFalsy();
    // 前两项保持现状不动
    expect(opts[0].label).toBe('挑选动作');
    expect(opts[1].label).toBe('AI 教练');
  });

  it('rest = 三选项，第三选项为「今日休息」且不可点（休息态呈现）', () => {
    const opts = buildStartMenuOptions({ kind: 'rest' }, actions);
    expect(opts).toHaveLength(3);
    expect(opts[2].key).toBe(START_OPTION_KEYS.restToday);
    expect(opts[2].label).toBe('今日休息');
    expect(opts[2].disabled).toBe(true);
  });

  it('选项形状满足 TimerCapsule StartMenuOption（key/label/icon/onSelect）', () => {
    for (const plan of [
      { kind: 'none' } as const,
      { kind: 'ready', source: 'local' } as const,
      { kind: 'rest' } as const,
    ]) {
      for (const o of buildStartMenuOptions(plan, actions)) {
        expect(typeof o.key).toBe('string');
        expect(typeof o.label).toBe('string');
        expect(o.icon).toBeTruthy();
        expect(typeof o.onSelect).toBe('function');
      }
    }
  });

  it('onSelect 动作透传（选中「载入计划」触发 onLoadPlan）', () => {
    let picked = '';
    const spyActions = {
      onPickLibrary: () => { picked = 'library'; },
      onOpenCoach: noop,
      onLoadPlan: () => { picked = 'plan'; },
    };
    const opts = buildStartMenuOptions({ kind: 'ready', source: 'schedule' }, spyActions);
    opts[2].onSelect();
    expect(picked).toBe('plan');
  });
});

describe('scheduleEntriesToPlanItems · 课表条目 → 预填原始条目（T8 #65）', () => {
  it('逐组处方（T9）取首组作整卡默认；exercise_type 经 resolveType 回查', () => {
    const entries = [
      {
        ...plannedSchedule.entries[0],
        sets: [
          { set_no: 1, weight_kg: 60, reps: 8, rpe: 7 },
          { set_no: 2, weight_kg: 62.5, reps: 6, rpe: 8 },
        ],
      },
    ];
    const items = scheduleEntriesToPlanItems(entries, id => (id === 'abc123def456' ? 'resistance' : undefined));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'abc123def456',
      name: '杠铃卧推',
      sets: 4,
      reps: 8,
      weight: 60,
      targetRpe: 7,
      exercise_type: 'resistance',
    });
  });

  it('旧计划无 sets（null）→ reps/weight 置 0、rpe/type 缺省交消费侧兜底', () => {
    const items = scheduleEntriesToPlanItems(plannedSchedule.entries);
    expect(items[0]).toMatchObject({ name: '杠铃卧推', sets: 4, reps: 0, weight: 0 });
    expect(items[0].targetRpe).toBeUndefined();
    expect(items[0].exercise_type).toBeUndefined();
    // 未传 resolveType 同样安全（App 侧库不可得路径）
  });
});

describe('resolveFirstUseTriage · 首次分流决策', () => {
  it('有训练历史 → 老用户不打扰（none）', () => {
    expect(resolveFirstUseTriage(true, 'planned')).toBe('none');
    expect(resolveFirstUseTriage(true, 'no_plan')).toBe('none');
    expect(resolveFirstUseTriage(true, null)).toBe('none');
  });

  it('无历史 + 周计划在身 → 引导发送资料/截图（plan_guide）', () => {
    expect(resolveFirstUseTriage(false, 'planned')).toBe('plan_guide');
  });

  it('纯新手（无历史无计划）→ 调研卡片（newbie_survey）', () => {
    expect(resolveFirstUseTriage(false, 'no_plan')).toBe('newbie_survey');
    expect(resolveFirstUseTriage(false, 'rest_day')).toBe('newbie_survey');
    expect(resolveFirstUseTriage(false, null)).toBe('newbie_survey');
  });
});

// ---------------------------------------------------------------------------
// [fix #23] 用户维度判定：同设备新用户不得误读他人历史
// ---------------------------------------------------------------------------

describe('resolveUserHasHistory · 用户维度历史判定', () => {
  it('后端该用户记录数 >0 → 老用户（本人有历史）', () => {
    expect(resolveUserHasHistory({ backendSessionCount: 1, deviceHistoryCount: 0 })).toBe(true);
    expect(resolveUserHasHistory({ backendSessionCount: 42, deviceHistoryCount: 99 })).toBe(true);
  });

  it('后端该用户记录数 =0 → 新手：设备上有他人历史也不算数', () => {
    expect(resolveUserHasHistory({ backendSessionCount: 0, deviceHistoryCount: 7 })).toBe(false);
    expect(resolveUserHasHistory({ backendSessionCount: 0, deviceHistoryCount: 0 })).toBe(false);
  });

  it('后端不可达（null）→ 回退设备本地历史（精度损失：含他人记录）', () => {
    expect(resolveUserHasHistory({ backendSessionCount: null, deviceHistoryCount: 3 })).toBe(true);
    expect(resolveUserHasHistory({ backendSessionCount: null, deviceHistoryCount: 0 })).toBe(false);
  });
});

describe('resolveUserHasHistory × resolveFirstUseTriage · 用户维度分流闭环 [fix #23]', () => {
  // 判定链与 useAICoach.maybeRunFirstUseTriage 一致：
  // hasHistory = resolveUserHasHistory(...) → resolveFirstUseTriage(hasHistory, schedule)
  const triageFor = (backendSessionCount: number | null, deviceHistoryCount: number, schedule: Parameters<typeof resolveFirstUseTriage>[1]) =>
    resolveFirstUseTriage(
      resolveUserHasHistory({ backendSessionCount, deviceHistoryCount }),
      schedule,
    );

  it('新用户 + 设备上有他人历史 → newbie_survey（修复主场景：不误判老用户）', () => {
    expect(triageFor(0, 5, 'no_plan')).toBe('newbie_survey');
    expect(triageFor(0, 5, null)).toBe('newbie_survey');
  });

  it('本人有历史（后端记录 >0）→ none（老用户不打扰）', () => {
    expect(triageFor(3, 0, null)).toBe('none');
    // 设备维度旧口径会误判的场景：新设备登录老账号 → 仍正确识别老用户
    expect(triageFor(3, 0, 'planned')).toBe('none');
  });

  it('新用户 + 周计划在身 → plan_guide', () => {
    expect(triageFor(0, 0, 'planned')).toBe('plan_guide');
    // 设备有他人历史但本人在后端无记录 + 有计划 → 仍走计划引导
    expect(triageFor(0, 9, 'planned')).toBe('plan_guide');
  });

  it('后端不可达回退设备历史：他人历史误判老用户（精度损失，与修复前行为一致）', () => {
    expect(triageFor(null, 5, 'no_plan')).toBe('none');
  });
});

describe('Keys.firstUseCoachTriage · 首次标志按用户落键 [fix #23]', () => {
  it('工厂键：不同 userId 得到不同键（切换用户重新分流）', () => {
    expect(Keys.firstUseCoachTriage('u-aaa')).toBe('starfit_coach_first_use_triage:u-aaa');
    expect(Keys.firstUseCoachTriage('u-bbb')).toBe('starfit_coach_first_use_triage:u-bbb');
    expect(Keys.firstUseCoachTriage('u-aaa')).not.toBe(Keys.firstUseCoachTriage('u-bbb'));
  });
});

describe('NEWBIE_SURVEY_QUESTIONS · 画像四项口径', () => {
  it('四题依次为 经验/目标/器材/频次，均必填且有选项', () => {
    expect(NEWBIE_SURVEY_QUESTIONS.map(q => q.id)).toEqual([
      'experience', 'goal', 'equipment', 'frequency',
    ]);
    for (const q of NEWBIE_SURVEY_QUESTIONS) {
      expect(q.required).toBe(true);
      expect(q.options.length).toBeGreaterThanOrEqual(3);
      for (const o of q.options) {
        expect(o.label.length).toBeGreaterThan(0);
        expect(o.value.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('引导话术 · 红线自查', () => {
  it('无 emoji，无禁色值字面量', () => {
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    for (const text of [PLAN_GUIDE_TEXT, NEWBIE_SURVEY_TEXT, ...NEWBIE_SURVEY_QUESTIONS.flatMap(q => [q.question, ...q.options.map(o => o.label)])]) {
      expect(emoji.test(text)).toBe(false);
      expect(text).not.toContain('#F3F3F3');
      expect(text).not.toContain('#EA580C');
    }
  });

  it('调研卡结构渲染SurveyCard 兼容形态（title + questions 可达）', () => {
    // 形状防御：注入的 uiHint.data 与 SurveyCard props 的结构契约一致
    const uiHint = {
      type: 'survey_card' as const,
      data: { title: '训练画像调研', questions: NEWBIE_SURVEY_QUESTIONS },
    };
    expect(uiHint.data.questions).toHaveLength(4);
    render(
      <ul>
        {uiHint.data.questions.map(q => (
          <li key={q.id}>{q.question}</li>
        ))}
      </ul>
    );
    expect(screen.getByText('你的训练经验')).toBeInTheDocument();
    expect(screen.getByText('每周能练几次')).toBeInTheDocument();
  });
});
