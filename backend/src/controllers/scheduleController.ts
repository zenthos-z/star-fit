/**
 * Schedule Controller - 今日课表确定性 API（E2 / issue #1）
 *
 * 提供：
 * - GET /api/schedule/today?date=YYYY-MM-DD - 今日 plan_entries（JOIN 动作名）
 *
 * 训练前零容忍等待路径：纯 DB 读，无 LLM、无 AI 依赖、无网络外呼。
 * 无计划时返回结构化 no_plan 状态（前端据此引导），不在本端点调 AI 生成。
 * 契约见 shared/contracts/weekly-plan.ts（TodayScheduleResponseSchema）。
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import { PLAN_ENTRY_DATE_PATTERN } from "shared/contracts";
import { getUserId } from "../utils/requestUtils.js";
import { getPostgresClient } from "../db/postgresql/client/postgres-client.js";
import { createWeeklyPlanRepository } from "../db/postgresql/repository/weeklyPlan.repository.js";
import {
  ScheduleService,
  type SchedulePlanRepoPort,
} from "../services/schedule/scheduleService.js";
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
