/**
 * Schedule Service — 今日课表确定性读编排（E2 / issue #1）
 *
 * 训练前零容忍等待路径（AI 隐形架构）：纯 DB 读、无 LLM、无网络外呼、
 * 无任何 AI 依赖（模块 import 链即证明）。职责仅三件事：
 *
 *   ① 解析「今天」：显式 ?date=（客户端本地日历日）或服务器 UTC 当日
 *   ② getIsoWeekId 推导 week_id（契约单一真源，Service 不做日历算术变体）
 *   ③ 三态判定：no_plan（本周无计划，确定性兜底，前端引导生成）
 *              / rest_day（本周有计划、今日无条目）
 *              / planned（今日有条目，join exercises 取动作名）
 *
 * 分层红线：数据访问只经 Repository 端口（依赖注入，禁止直连库）；
 * 响应出参经 validateOrThrow(TodayScheduleResponseSchema)（Zod 失败即抛）。
 * 本 Service 绝不在 no_plan 分支触发 AI 生成——那是 /api/chat 的职责。
 */

import {
  validateOrThrow,
  getIsoWeekId,
  TodayScheduleResponseSchema,
  PLAN_ENTRY_DATE_PATTERN,
  UUIDSchema,
  type WeeklyPlan,
  type TodayScheduleEntry,
  type TodayScheduleResponse,
} from "shared/contracts";

import { ServiceError, ServiceErrorCode } from "../errors/ServiceError.js";

// ---------------------------------------------------------------------------
// 端口定义（依赖注入，便于单测 fake —— suggestionService 同款风格）
// ---------------------------------------------------------------------------

/** 周计划数据访问端口（WeeklyPlanRepository 的今日课表子集） */
export interface SchedulePlanRepoPort {
  /** 周计划元数据（不含条目）；本周无计划返回 null */
  getWeeklyPlanMetaByUserAndWeek(
    userId: string,
    weekId: string,
  ): Promise<WeeklyPlan | null>;
  /** 当日条目（JOIN exercises 取动作名），按 sort_order 升序 */
  getTodayEntriesWithExercise(
    userId: string,
    entryDate: string,
  ): Promise<TodayScheduleEntry[]>;
}

// ---------------------------------------------------------------------------
// 日期解析
// ---------------------------------------------------------------------------

/** 服务器 UTC 当日（YYYY-MM-DD）——缺省日期；移动端应显式传本地日期 */
export function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ScheduleService {
  constructor(private readonly planRepo: SchedulePlanRepoPort) {}

  /**
   * 今日课表（确定性，纯 DB 读）。
   *
   * @param userId 用户 UUID（程序内部标识，CLAUDE.md 命名规范）
   * @param date   可选日历日 YYYY-MM-DD；缺省服务器 UTC 当日
   * @throws ServiceError(INVALID_PARAMS) userId / date 形态非法（快速失败）
   */
  async getTodaySchedule(
    userId: string,
    date?: string,
  ): Promise<TodayScheduleResponse> {
    if (!UUIDSchema.safeParse(userId).success) {
      throw new ServiceError(
        ServiceErrorCode.INVALID_PARAMS,
        `userId 必须为 UUID（当前: ${userId}）`,
        { userId },
      );
    }
    const entryDate = date ?? utcToday();
    if (!PLAN_ENTRY_DATE_PATTERN.test(entryDate)) {
      throw new ServiceError(
        ServiceErrorCode.INVALID_PARAMS,
        `date 必须为 YYYY-MM-DD（当前: ${entryDate}）`,
        { date: entryDate },
      );
    }

    // week_id 推导走契约单一真源（周四规则），Service 不内联日历算法
    const weekId = getIsoWeekId(entryDate);

    const plan = await this.planRepo.getWeeklyPlanMetaByUserAndWeek(
      userId,
      weekId,
    );
    if (!plan) {
      // 确定性兜底：结构化 no_plan，前端据此引导（本路径不调 AI 生成）
      return validateOrThrow(
        TodayScheduleResponseSchema,
        {
          date: entryDate,
          week_id: weekId,
          status: "no_plan",
          split: null,
          entries: [],
        },
        "ScheduleService.getTodaySchedule(no_plan)",
      );
    }

    const entries = await this.planRepo.getTodayEntriesWithExercise(
      userId,
      entryDate,
    );
    const status = entries.length > 0 ? "planned" : "rest_day";
    return validateOrThrow(
      TodayScheduleResponseSchema,
      {
        date: entryDate,
        week_id: weekId,
        status,
        split: plan.split,
        entries,
      },
      "ScheduleService.getTodaySchedule",
    );
  }
}
