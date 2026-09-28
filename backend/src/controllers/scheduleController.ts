/**
 * Schedule Controller - 今日课表确定性 API（E2 / issue #1）+ 开始运动路由 summary（B2 / issue #22）
 *
 * 提供：
 * - GET /api/schedule/today?date=YYYY-MM-DD - 今日 plan_entries（JOIN 动作名）
 * - GET /api/schedule/summary?date=YYYY-MM-DD - 开始运动路由判定（has_plan /
 *   today / today_entries / user_stage / onboarding 一发返回）
 *
 * 训练前零容忍等待路径：纯 DB 读，无 LLM、无 AI 依赖、无网络外呼。
 * 无计划时返回结构化 no_plan 状态（前端据此引导），不在本端点调 AI 生成。
 * 契约见 shared/contracts/weekly-plan.ts（TodayScheduleResponseSchema）与
 * shared/contracts/schedule-summary.ts（ScheduleSummaryResponseSchema）。
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import {
  PLAN_ENTRY_DATE_PATTERN,
  WeeklyPlanApplyPayloadSchema,
  getIsoWeekId,
} from "shared/contracts";
import { getUserId, MissingUserIdError } from "../utils/requestUtils.js";
import { getPostgresClient } from "../db/postgresql/client/postgres-client.js";
import { notifySuggestionCacheInvalidation } from "../services/suggestions/suggestionCacheScheduler.js";
import { createWeeklyPlanRepository } from "../db/postgresql/repository/weeklyPlan.repository.js";
import { createUserRepository } from "../db/postgresql/repository/user.repository.js";
import { SessionRepo } from "../services/sessionRepo.js";
import {
  ScheduleService,
  utcToday,
  type SchedulePlanRepoPort,
} from "../services/schedule/scheduleService.js";
import {
  ScheduleSummaryService,
  type ScheduleSummaryRepoPort,
} from "../services/schedule/scheduleSummaryService.js";
import {
  ServiceError,
  ServiceErrorCode,
} from "../services/errors/ServiceError.js";

/** 惰性装配（与 suggestionController 同款：每次请求轻量构造，无单例状态） */
function buildScheduleService(): ScheduleService {
  const repo: SchedulePlanRepoPort =
    createWeeklyPlanRepository(getPostgresClient());
  return new ScheduleService(repo);
}

/** summary 装配：计划读（WeeklyPlanRepository）+ 记录读（SessionRepo）+ 画像读（UserRepository） */
function buildScheduleSummaryService(): ScheduleSummaryService {
  const client = getPostgresClient();
  const planRepo = createWeeklyPlanRepository(client);
  const userRepo = createUserRepository(client);
  const repo: ScheduleSummaryRepoPort = {
    getWeeklyPlanMetaByUserAndWeek: (userId, weekId) =>
      planRepo.getWeeklyPlanMetaByUserAndWeek(userId, weekId),
    getTodayEntriesWithExercise: (userId, entryDate) =>
      planRepo.getTodayEntriesWithExercise(userId, entryDate),
    hasAnyWeeklyPlan: (userId) => planRepo.hasAnyWeeklyPlan(userId),
    hasAnySessions: (userId) => SessionRepo.hasAnySessions(userId),
    hasProfileStatic: (userId) => userRepo.hasProfileStatic(userId),
  };
  return new ScheduleSummaryService(repo);
}

export async function getTodaySchedule(
  req: FastifyRequest,
  reply: FastifyReply,
) {
  try {
    const userId = getUserId(req);
    const query = (req.query ?? {}) as { date?: string };
    if (query.date && !PLAN_ENTRY_DATE_PATTERN.test(query.date)) {
      return reply.status(400).send({
        error: "Invalid date: must be YYYY-MM-DD",
      });
    }

    const service = buildScheduleService();
    const schedule = await service.getTodaySchedule(userId, query.date);
    return reply.status(200).send(schedule);
  } catch (err) {
    // 缺 X-User-Id 是客户端错误：放行给 server.ts 全局处理器映射 400，
    // 不在本地降级为 500（requestUtils 文档承诺的映射契约）
    if (err instanceof MissingUserIdError) throw err;
    // 参数形态错误 → 400（客户端错误）；其余 → 500（log 留痕，不静默）
    if (err instanceof ServiceError) {
      if (err.code === ServiceErrorCode.INVALID_PARAMS) {
        return reply.status(400).send({ error: err.message });
      }
      req.log.error({ err }, "schedule_today_service_error");
      return reply.status(500).send({ error: err.message });
    }
    req.log.error({ err }, "schedule_today_failed");
    return reply.status(500).send({ error: "Failed to load today schedule" });
  }
}

/**
 * GET /api/schedule/summary?date=YYYY-MM-DD - 开始运动路由判定（B2 / issue #22）。
 * 纯 DB 读 + 纯函数判定（今日三态复用 E2），无 AI 参与。
 */
export async function getScheduleSummary(
  req: FastifyRequest,
  reply: FastifyReply,
) {
  try {
    const userId = getUserId(req);
    const query = (req.query ?? {}) as { date?: string };
    if (query.date && !PLAN_ENTRY_DATE_PATTERN.test(query.date)) {
      return reply.status(400).send({
        error: "Invalid date: must be YYYY-MM-DD",
      });
    }

    const service = buildScheduleSummaryService();
    const summary = await service.getSummary(userId, query.date);
    return reply.status(200).send(summary);
  } catch (err) {
    // 缺 X-User-Id 是客户端错误：放行给 server.ts 全局处理器映射 400
    if (err instanceof MissingUserIdError) throw err;
    // 参数形态错误 → 400（客户端错误）；其余 → 500（log 留痕，不静默）
    if (err instanceof ServiceError) {
      if (err.code === ServiceErrorCode.INVALID_PARAMS) {
        return reply.status(400).send({ error: err.message });
      }
      req.log.error({ err }, "schedule_summary_service_error");
      return reply.status(500).send({ error: err.message });
    }
    req.log.error({ err }, "schedule_summary_failed");
    return reply.status(500).send({ error: "Failed to load schedule summary" });
  }
}

/**
 * POST /api/schedule/weekly-plan/apply - weekly_plan 卡确认落库（B5b / issue #38）。
 *
 * 确定性写入端点（对齐 B5a apply-proposals 模式）：前端在用户点「确认启用」后
 * 直调，把 Agent 提案轮算好、随卡携带的 entries 落库——无 LLM、无 Agent 执行轮。
 * 确认前计划不进数据库（提案-确认架构取代 Agent 直接 save_weekly_plan）。
 *
 * scope=week：整周 upsert（weekly_plans 行 + 条目整体替换）；
 * scope=days：单日覆盖（要求该周已有计划，仅替换 dates 所列日期的条目）。
 * 响应携带落库摘要，前端据此回填卡片终态并刷新信息栏。
 */
export async function postApplyWeeklyPlan(
  req: FastifyRequest,
  reply: FastifyReply,
) {
  const userId = getUserId(req);
  const parsed = WeeklyPlanApplyPayloadSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return reply.status(400).send({
      error: "Invalid request body",
      details: parsed.error.issues.map(
        (i) => `${i.path.join(".") || "<root>"}: ${i.message}`,
      ),
    });
  }

  // week_id 缺省 = 当前周（服务器推导单一真源：getIsoWeekId ∘ utcToday）
  const payload = {
    ...parsed.data,
    week_id: parsed.data.week_id ?? getIsoWeekId(utcToday()),
  };

  try {
    const repo = createWeeklyPlanRepository(getPostgresClient());
    const result = await repo.applyWeeklyPlan({ user_id: userId, payload });
    // [B6 issue#39] 计划落库 → 当日已排容量变化 → 静默登记建议缓存空闲重算
    notifySuggestionCacheInvalidation(userId, "plan_updated");
    return reply.status(200).send({
      applied: true,
      week_id: result.plan.week_id,
      plan_id: result.plan.id,
      split: result.plan.split,
      scope: payload.scope,
      entries_count: result.entries.length,
      // 前端消费提示：信息栏（本周计划）此刻已可见新计划
      message:
        payload.scope === "week"
          ? "周计划已落库生效，信息栏已同步"
          : "日计划已覆盖生效，信息栏已同步",
    });
  } catch (err) {
    if (err instanceof MissingUserIdError) throw err;
    if (err instanceof ServiceError) {
      if (err.code === ServiceErrorCode.INVALID_PARAMS) {
        return reply.status(400).send({ error: err.message });
      }
      if (err.code === ServiceErrorCode.BUSINESS_RULE_VIOLATION) {
        // scope=days 但该周无框架：409 语义冲突（前端提示需先确认整周计划）
        return reply.status(409).send({ error: err.message });
      }
      req.log.error({ err }, "weekly_plan_apply_service_error");
      return reply.status(500).send({ error: err.message });
    }
    req.log.error({ err }, "weekly_plan_apply_failed");
    return reply.status(500).send({ error: "Failed to apply weekly plan" });
  }
}
