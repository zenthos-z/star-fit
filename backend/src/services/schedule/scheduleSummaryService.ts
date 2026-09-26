/**
 * Schedule Summary Service — 开始运动路由判定组装（B2 / issue #22）
 *
 * 「开始运动」入口一发返回路由判定所需全部状态（has_plan / today /
 * today_entries / user_stage / onboarding）。与 E2 同族的训练前
 * 零容忍等待路径：纯 DB 读、无 LLM、无网络外呼、AI 零参与
 * （模块 import 链即证明——不经过 agent / mcpTools 任何模块）。
 *
 * 复用红线（issue #22）：今日三态判定**复用 E2 ScheduleService**
 * （确定性课表口径），本 Service 只做口径映射（TODAY_STATUS_TO_SUMMARY
 * 契约查表）+ user_stage / onboarding 两条纯函数判定，禁止另写一套课表判定。
 *
 * 判定规则（issue #22 规格表，纯函数可单测）：
 *   user_stage：
 *     - planner         有任一周计划
 *     - veteran_no_plan 无计划 + 有训练记录
 *     - newcomer        无计划 + 无训练记录
 *   onboarding：
 *     - needed  无计划 + 无记录 + 无画像
 *     - done    其余一切形态
 *
 * 分层红线：数据访问只经 Repository 端口（依赖注入，禁止直连库）；
 * 响应出参经 validateOrThrow(ScheduleSummaryResponseSchema)（失败即抛）。
 */

import {
  validateOrThrow,
  UUIDSchema,
  PLAN_ENTRY_DATE_PATTERN,
  TODAY_STATUS_TO_SUMMARY,
  ScheduleSummaryResponseSchema,
  type ScheduleSummaryResponse,
  type ScheduleUserStage,
  type ScheduleOnboarding,
} from "shared/contracts";

import { ServiceError, ServiceErrorCode } from "../errors/ServiceError.js";
import {
  ScheduleService,
  utcToday,
  type SchedulePlanRepoPort,
} from "./scheduleService.js";

// ---------------------------------------------------------------------------
// 端口定义（依赖注入，便于单测 fake —— scheduleService 同款风格）
// ---------------------------------------------------------------------------

/**
 * 路由判定数据访问端口：E2 今日课表子集 + 三个 EXISTS 判定读。
 * 实现方：WeeklyPlanRepository（计划读）+ SessionRepo（训练记录读）
 * + UserRepository（画像读），由 Controller 装配；禁止绕过 Repository 直连库。
 */
export interface ScheduleSummaryRepoPort extends SchedulePlanRepoPort {
  /** 用户是否持有任一周计划（任意周、任意状态）——has_plan / planner 判定 */
  hasAnyWeeklyPlan(userId: string): Promise<boolean>;
  /** 用户是否有训练记录（sessions 表任一行）——newcomer / veteran 判定 */
  hasAnySessions(userId: string): Promise<boolean>;
  /** 用户画像是否已建档（profile_static 非空对象）——onboarding 判定 */
  hasProfileStatic(userId: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// 纯函数判定（issue #22 规格表；无 IO，单测矩阵直接覆盖）
// ---------------------------------------------------------------------------

/**
 * user_stage 三条规则：
 *   有计划 → planner；无计划看记录 → veteran_no_plan / newcomer。
 */
export function deriveUserStage(
  hasPlan: boolean,
  hasRecords: boolean,
): ScheduleUserStage {
  if (hasPlan) return "planner";
  return hasRecords ? "veteran_no_plan" : "newcomer";
}

/**
 * onboarding 首次使用判定：无计划 + 无记录 + 无画像 → needed，否则 done。
 */
export function deriveOnboarding(
  hasPlan: boolean,
  hasRecords: boolean,
  hasProfile: boolean,
): ScheduleOnboarding {
  return !hasPlan && !hasRecords && !hasProfile ? "needed" : "done";
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ScheduleSummaryService {
  /** E2 今日课表判定复用（同一 Repository 端口喂入，不另写一套三态判定） */
  private readonly schedule: ScheduleService;

  constructor(private readonly repo: ScheduleSummaryRepoPort) {
    this.schedule = new ScheduleService(repo);
  }

  /**
   * 开始运动路由 summary（确定性，纯 DB 读，四路并行查询）。
   *
   * @param userId 用户 UUID（程序内部标识，CLAUDE.md 命名规范）
   * @param date   可选日历日 YYYY-MM-DD；缺省服务器 UTC 当日（同 E2 口径）
   * @throws ServiceError(INVALID_PARAMS) userId / date 形态非法（快速失败）
   */
  async getSummary(
    userId: string,
    date?: string,
  ): Promise<ScheduleSummaryResponse> {
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

    // 四路只读并行：今日课表（E2 复用）+ 三个路由判定探针
    const [todaySchedule, hasPlan, hasRecords, hasProfile] = await Promise.all([
      this.schedule.getTodaySchedule(userId, entryDate),
      this.repo.hasAnyWeeklyPlan(userId),
      this.repo.hasAnySessions(userId),
      this.repo.hasProfileStatic(userId),
    ]);

    return validateOrThrow(
      ScheduleSummaryResponseSchema,
      {
        has_plan: hasPlan,
        today: TODAY_STATUS_TO_SUMMARY[todaySchedule.status],
        today_entries: todaySchedule.entries,
        user_stage: deriveUserStage(hasPlan, hasRecords),
        onboarding: deriveOnboarding(hasPlan, hasRecords, hasProfile),
      },
      "ScheduleSummaryService.getSummary",
    );
  }
}
