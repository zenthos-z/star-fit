/**
 * Schedule Summary Contracts (开始运动路由 summary — B2 / issue #22)
 *
 * GET /api/schedule/summary 一发返回「开始运动」路由判定所需的全部状态。
 * 与 E2 今日课表同族的训练前零容忍等待路径：纯 DB 读、无 LLM、AI 零参与
 * （Service 模块 import 链即证明）。
 *
 * 判定口径（Service 真源 backend/src/services/schedule/scheduleSummaryService.ts，
 * 今日三态复用 E2 ScheduleService，不另写一套判定）：
 *  - has_plan      用户是否持有任一周计划（任意周、任意状态；与 user_stage
 *                  的「计划用户」判定同源。今日是否在计划内由 today 单独表达，
 *                  has_plan=true + today=none 是合法形态——计划用户新周未排）
 *  - today         今日课表三态，E2 TodayScheduleStatus 的路由口径映射：
 *                    E2 planned  → scheduled（今日有条目）
 *                    E2 rest_day → rest    （本周有计划、今日无条目）
 *                    E2 no_plan  → none    （本周无计划）
 *  - today_entries 今日条目（E2 TodayScheduleEntry 投影：动作名 + 组数，
 *                  B1 预填文案数据源；rest / none 时空数组）
 *  - user_stage    用户阶段三态（issue #22 三条规则）：
 *                    newcomer        无计划 + 无训练记录（纯新手）
 *                    veteran_no_plan 无计划 + 有训练记录（老手无计划）
 *                    planner         有计划（计划用户）
 *  - onboarding    首次使用判定：无计划 + 无记录 + 无画像 → needed，否则 done
 *
 * 命名：数据库与应用层统一 snake_case（CLAUDE.md 红线），
 * 条目形态复用 weekly-plan.ts 的 TodayScheduleEntrySchema（单一真源）。
 *
 * @version 1.0.0
 * @created 2026-09-26
 */

import { z } from 'zod';
import {
  TodayScheduleEntrySchema,
  type TodayScheduleStatus,
} from './weekly-plan.js';

// ============================================================================
// 枚举 (Route Decision Domains)
// ============================================================================

/** 今日课表三态（路由口径；判定复用 E2，映射表见 TODAY_STATUS_TO_SUMMARY） */
export const ScheduleSummaryTodaySchema = z.enum([
  'scheduled', // 今日有条目（E2 planned）
  'rest',      // 本周有计划、今日无条目（E2 rest_day）
  'none',      // 本周无计划（E2 no_plan）
]);

export type ScheduleSummaryToday = z.infer<typeof ScheduleSummaryTodaySchema>;

/** 用户阶段三态（issue #22：纯新手 / 老手无计划 / 计划用户） */
export const ScheduleUserStageSchema = z.enum([
  'newcomer',        // 无计划 + 无记录
  'veteran_no_plan', // 无计划 + 有记录
  'planner',         // 有计划
]);

export type ScheduleUserStage = z.infer<typeof ScheduleUserStageSchema>;

/** 首次使用判定（needed = 无计划 + 无记录 + 无画像） */
export const ScheduleOnboardingSchema = z.enum(['needed', 'done']);

export type ScheduleOnboarding = z.infer<typeof ScheduleOnboardingSchema>;

// ============================================================================
// E2 口径映射（单一真源）
// ============================================================================

/**
 * E2 TodayScheduleStatus → summary today 的映射表。
 * Service 组装时查表，禁止在 Service / 前端各自内联 if-else 漂移。
 */
export const TODAY_STATUS_TO_SUMMARY: Readonly<
  Record<TodayScheduleStatus, ScheduleSummaryToday>
> = {
  planned: 'scheduled',
  rest_day: 'rest',
  no_plan: 'none',
};

// ============================================================================
// 响应契约 (Response)
// ============================================================================

/**
 * GET /api/schedule/summary 响应契约（B2）。
 * ?date=YYYY-MM-DD 可选（客户端本地日历日，缺省服务器 UTC 当日，同 E2 口径）。
 *
 * superRefine 锁定跨字段形态（兜底不漂移，风格同 TodayScheduleResponse）：
 *  ① today 三态与 today_entries 形态互锁
 *     （none 必空、scheduled 必非空、rest 必空）
 *  ② user_stage=planner ⟺ has_plan（同一判定的两种表达，不允许矛盾）
 *  ③ onboarding=needed 仅允许出现在纯新手形态（无计划 + newcomer）
 */
export const ScheduleSummaryResponseSchema = z
  .object({
    has_plan: z.boolean(),
    today: ScheduleSummaryTodaySchema,
    today_entries: z.array(TodayScheduleEntrySchema),
    user_stage: ScheduleUserStageSchema,
    onboarding: ScheduleOnboardingSchema,
  })
  .superRefine((res, ctx) => {
    // ① 今日三态 ↔ 条目形态
    if (res.today === 'none' && res.today_entries.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'today=none 时 today_entries 必须为空数组（本周无计划，不存在条目）',
        path: ['today_entries'],
      });
    }
    if (res.today === 'scheduled' && res.today_entries.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'today=scheduled 时 today_entries 不能为空（今日有条目才有此状态）',
        path: ['today_entries'],
      });
    }
    if (res.today === 'rest' && res.today_entries.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'today=rest 时 today_entries 必须为空数组（休息日无条目）',
        path: ['today_entries'],
      });
    }

    // ② planner ⟺ has_plan
    if (res.user_stage === 'planner' && !res.has_plan) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'user_stage=planner 时 has_plan 必须为 true（计划用户判定同源）',
        path: ['has_plan'],
      });
    }
    if (res.user_stage !== 'planner' && res.has_plan) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `user_stage=${res.user_stage} 时 has_plan 必须为 false（无计划阶段不得与有计划矛盾）`,
        path: ['has_plan'],
      });
    }

    // ③ onboarding=needed 仅限纯新手形态
    if (res.onboarding === 'needed' && (res.has_plan || res.user_stage !== 'newcomer')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'onboarding=needed 仅允许 has_plan=false 且 user_stage=newcomer（首次使用=无计划+无记录+无画像）',
        path: ['onboarding'],
      });
    }
  });

export type ScheduleSummaryResponse = z.infer<typeof ScheduleSummaryResponseSchema>;
