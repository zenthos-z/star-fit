/**
 * startOnboarding — B3「开始运动」子菜单 + 首次使用预调研（issue #23）
 *
 * 纯逻辑（便于单测）：
 * 1. resolveTodayPlanMenuState：开始菜单第三选项三态判定（T8 #65）。
 *    优先级规则：**今日排期优先，本地暂存 nextPlan 兜底**。
 * 2. buildStartMenuOptions：TimerCapsule 分裂菜单选项构建。
 *    ready 态第三选项「载入计划」（选中即预填当日计划进会话，预填语义
 *    唯一路径，复用 buildExercisesFromPlan，#58 后不再分叉）；
 *    rest 态第三选项「今日休息」不可点（休息态呈现）；none 态回落两选项。
 * 3. scheduleEntriesToPlanItems：今日课表条目 → 预填原始条目
 *    （AI plan_card 数据同形状），exercise_type 经 resolveType 回查动作库。
 * 4. resolveFirstUseTriage：首次打开 AI 教练的分流决策。
 *    训练历史为空才算新用户；有周计划 → 引导发送资料/截图（AI 解析既有计划）；
 *    纯新手 → 基础调研引导卡片（画像四项：经验/目标/器材/频次）。
 *    卡片走 survey_card uiHint 多态回路（SurveyCard 渲染），不新造组件。
 * 5. resolveUserHasHistory [fix #23]：训练历史判定改用户维度（后端该用户记录数
 *    优先，后端不可达回退设备本地历史），杜绝同设备他人历史误判老用户。
 */
import React from 'react';
import type { TodayScheduleEntry, TodayScheduleResponse } from 'shared/contracts';
import type { StartMenuOption } from '../components/TimerCapsule';

// ---------------------------------------------------------------------------
// 分裂菜单选项
// ---------------------------------------------------------------------------

export interface StartMenuActions {
  onPickLibrary: () => void;
  onOpenCoach: () => void;
  /** 「载入计划」（T8 #65）：今日排期或本地暂存 → 预填进会话 */
  onLoadPlan: () => void;
}

export const START_OPTION_KEYS = {
  library: 'library',
  aiCoach: 'ai-coach',
  loadPlan: 'load-plan',
  restToday: 'rest-today',
} as const;

// ---------------------------------------------------------------------------
// 第三选项三态判定（T8 / issue #65）
// ---------------------------------------------------------------------------

/**
 * 开始菜单第三选项三态：
 *  - ready：可点「载入计划」（source 记录数据来自今日排期还是本地暂存）
 *  - rest：休息日，第三选项呈现「今日休息」不可点
 *  - none：无排期且无本地暂存 → 回落两选项（接入周计划前的现状）
 */
export type TodayPlanMenuState =
  | { kind: 'ready'; source: 'schedule' | 'local' }
  | { kind: 'rest' }
  | { kind: 'none' };

/**
 * [T8 #65] 三态判定。**优先级规则（注释即规范）：今日排期优先，本地暂存
 * nextPlan 兜底。**
 * 1. 今日排期（GET /schedule/today）status=planned 且有条目 → ready（schedule）
 * 2. 排期在场但今日=rest_day → rest（排期对当日权威，本地暂存不越权覆盖课表）
 * 3. 无排期（no_plan / 课表不可得 / planned 形态异常无条目）→ 本地暂存
 *    nextPlan 兜底（ready·local；接入周计划前「下一次训练」暂存的行为保留）
 * 4. 两者皆无 → none（回落两选项）
 */
export function resolveTodayPlanMenuState(
  schedule: TodayScheduleResponse | null | undefined,
  nextPlan: readonly unknown[] | null | undefined,
): TodayPlanMenuState {
  if (schedule?.status === 'planned' && schedule.entries.length > 0) {
    return { kind: 'ready', source: 'schedule' };
  }
  if (schedule?.status === 'rest_day') return { kind: 'rest' };
  if (Array.isArray(nextPlan) && nextPlan.length > 0) {
    return { kind: 'ready', source: 'local' };
  }
  return { kind: 'none' };
}

/**
 * 今日课表条目 → 预填原始条目（AI plan_card 数据同形状，供
 * buildExercisesFromPlan 消费——预填路径唯一，排期条目不分叉）。
 * 逐组处方（T9）取首组作整卡默认（预填只是脚手架，用户可逐组改）；
 * 旧计划无 sets（null）→ reps/weight 置 0、rpe 缺省由消费侧兜底；
 * exercise_type 课表契约不携带，由 resolveType 按动作 id 回查动作库，
 * 查不到/未传 → undefined，消费侧回落 'resistance'。
 */
export function scheduleEntriesToPlanItems(
  entries: readonly TodayScheduleEntry[],
  resolveType?: (exerciseId: string) => string | undefined,
): Array<Record<string, unknown>> {
  return entries.map((e) => {
    const firstSet = e.sets?.[0];
    return {
      id: e.exercise_id,
      name: e.exercise_name,
      sets: e.target_sets,
      reps: firstSet?.reps ?? 0,
      weight: firstSet?.weight_kg ?? 0,
      targetRpe: firstSet?.rpe,
      exercise_type: resolveType?.(e.exercise_id),
    };
  });
}

export function buildStartMenuOptions(plan: TodayPlanMenuState, actions: StartMenuActions): StartMenuOption[] {
  return [
    {
      key: START_OPTION_KEYS.library,
      label: '挑选动作',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
          <path d="M4 6h16M4 12h16M4 18h10" />
        </svg>
      ),
      onSelect: actions.onPickLibrary,
    },
    {
      key: START_OPTION_KEYS.aiCoach,
      label: 'AI 教练',
      icon: (
        <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2L14.85 9.15L22 12L14.85 14.85L12 22L9.15 14.85L2 12L9.15 9.15L12 2Z" />
        </svg>
      ),
      onSelect: actions.onOpenCoach,
    },
    // 第三选项（ready 态）：T8 #65 文案定稿「载入计划」——动词开头，与
    // 「挑选动作」「AI 教练」结构对齐；选中直接预填进会话
    ...(plan.kind === 'ready'
      ? [
          {
            key: START_OPTION_KEYS.loadPlan,
            label: '载入计划',
            icon: (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <path d="M16 2v4M8 2v4M3 10h18" />
              </svg>
            ),
            onSelect: actions.onLoadPlan,
          },
        ]
      : []),
    // 第三选项（rest 态）：休息态呈现「今日休息」不可点——让用户知道周计划
    // 在场且今天轮休，而非静默退化为两选项造成「计划丢了」的错觉
    ...(plan.kind === 'rest'
      ? [
          {
            key: START_OPTION_KEYS.restToday,
            label: '今日休息',
            icon: (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
                <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8Z" />
              </svg>
            ),
            onSelect: () => {},
            disabled: true,
          },
        ]
      : []),
  ];
}

// ---------------------------------------------------------------------------
// 首次使用预调研分流
// ---------------------------------------------------------------------------

export type FirstUseTriage = 'none' | 'plan_guide' | 'newbie_survey';

/** /schedule/today 的 status 形态（不可得传 null，按纯新手兜底） */
export type ScheduleStatus = 'planned' | 'rest_day' | 'no_plan' | null;

/**
 * [fix #23] 用户维度训练历史判定入参：
 * - backendSessionCount  后端该用户训练记录总数（GET /sessions/recent 的 count，
 *                        users 表按 userId 隔离，天然用户维度）；null = 后端不可达
 * - deviceHistoryCount   本地设备历史条数（historyForDevice(deviceId)，设备维度
 *                        含他人记录，仅后端不可达时兜底）
 */
export interface UserHasHistoryInput {
  backendSessionCount: number | null;
  deviceHistoryCount: number;
}

/**
 * [fix #23] hasHistory 改用户维度：本地 SessionLite 无 userId 字段（设备维度），
 * 同设备换新用户会误读他人历史 → 误判老用户。判定优先级：
 * 1. 后端该用户记录数：>0 即老用户；=0 即真新手（设备上他人历史不算数）
 * 2. 后端不可达 → 回退本地设备历史（精度损失：同设备他人历史误判为老用户，
 *    退化至修复前行为；首次分流卡片本身可跳过，代价可控）
 */
export function resolveUserHasHistory(input: UserHasHistoryInput): boolean {
  if (input.backendSessionCount !== null) return input.backendSessionCount > 0;
  return input.deviceHistoryCount > 0;
}

/**
 * 首次打开 AI 教练的分流：
 * - 有训练历史 → 老用户不打扰（none）
 * - 无历史 + 周计划在身 → 引导发送资料/截图，AI 解析既有计划（plan_guide）
 * - 无历史 + 无计划（纯新手）→ 基础调研引导卡片（newbie_survey）
 */
export function resolveFirstUseTriage(hasHistory: boolean, scheduleStatus: ScheduleStatus): FirstUseTriage {
  if (hasHistory) return 'none';
  if (scheduleStatus === 'planned') return 'plan_guide';
  return 'newbie_survey';
}

/** 已有计划：引导话术（发送资料或截图，AI 解析既有计划） */
export const PLAN_GUIDE_TEXT =
  '看到你已经带着训练计划来了。可以把现有计划**截图或文字发给我**，我来解析内容，' +
  '把它迁移成可执行、可记录的训练安排；想先调整目标或强度，直接告诉我就好。';

/** 纯新手：调研引导话术（卡片可跳过） */
export const NEWBIE_SURVEY_TEXT =
  '欢迎来到你的第一节训练课。先用 30 秒回答几个小问题，我给你的建议会更贴合你；' +
  '不想填也可以直接跳过，随时把你的情况告诉我。';

export interface NewbieSurveyQuestion {
  id: string;
  question: string;
  required: boolean;
  options: Array<{ label: string; value: string }>;
}

/** 画像四项：经验 / 目标 / 器材 / 频次（issue #23 定稿口径） */
export const NEWBIE_SURVEY_QUESTIONS: NewbieSurveyQuestion[] = [
  {
    id: 'experience',
    question: '你的训练经验',
    required: true,
    options: [
      { label: '纯新手，没系统练过', value: 'beginner_zero' },
      { label: '初级，3 个月以内', value: 'beginner' },
      { label: '中级，半年到两年', value: 'intermediate' },
      { label: '资深，两年以上', value: 'advanced' },
    ],
  },
  {
    id: 'goal',
    question: '当前最想达成的目标',
    required: true,
    options: [
      { label: '减脂塑形', value: 'fat_loss' },
      { label: '增肌变壮', value: 'muscle_gain' },
      { label: '提升力量与体能', value: 'strength' },
      { label: '保持健康', value: 'health' },
    ],
  },
  {
    id: 'equipment',
    question: '能用的训练条件',
    required: true,
    options: [
      { label: '健身房，器械齐全', value: 'gym_full' },
      { label: '家里有哑铃或弹力带', value: 'home_dumbbell' },
      { label: '只有自重', value: 'bodyweight' },
    ],
  },
  {
    id: 'frequency',
    question: '每周能练几次',
    required: true,
    options: [
      { label: '1-2 次', value: '1-2' },
      { label: '3-4 次', value: '3-4' },
      { label: '5 次以上', value: '5+' },
    ],
  },
];
