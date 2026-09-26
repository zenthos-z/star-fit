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
import { PLAN_ENTRY_DATE_PATTERN } from "shared/contracts";
import { getUserId, MissingUserIdError } from "../utils/requestUtils.js";
import { getPostgresClient } from "../db/postgresql/client/postgres-client.js";
import { createWeeklyPlanRepository } from "../db/postgresql/repository/weeklyPlan.repository.js";
import { createUserRepository } from "../db/postgresql/repository/user.repository.js";
import { SessionRepo } from "../services/sessionRepo.js";
import {
  ScheduleService,
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
