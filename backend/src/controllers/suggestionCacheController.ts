/**
 * Suggestion Cache Controller - 建议参数缓存对账 API（issue #39 B6）
 *
 * 提供：
 * - GET /api/suggestions/cache?fingerprint=xxx — 前端打开 App 时的对账+增量拉取：
 *   fingerprint 匹配返回 matched=true（前端沿用本地缓存）；不匹配返回
 *   matched=false + 新指纹 + 全量条目（必要时同步重算，公式层毫秒级）。
 *
 * 契约见 shared/contracts/suggestion-cache.ts；纯公式路径无 LLM，不因
 * Agent 段 5xx（Agent 精调只在空闲重算任务里做，本端点只读缓存/重算公式）。
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import { getUserId } from "../utils/requestUtils.js";
import { getPostgresClient } from "../db/postgresql/client/postgres-client.js";
import {
  createExerciseRepository,
  createSuggestionCacheRepository,
  createUserRepository,
} from "../db/postgresql/repository/index.js";
import { createWeeklyPlanRepository } from "../db/postgresql/repository/weeklyPlan.repository.js";
import { SuggestionCacheService } from "../services/suggestions/suggestionCacheService.js";

export async function getSuggestionsCache(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    const userId = getUserId(req);
    const rawFp = (req.query as Record<string, unknown> | undefined)
      ?.fingerprint;
    const clientFingerprint =
      typeof rawFp === "string" && rawFp.length > 0 ? rawFp : undefined;

    const client = getPostgresClient();
    const service = new SuggestionCacheService(
      createUserRepository(client),
      createWeeklyPlanRepository(client),
      createExerciseRepository(client),
      createSuggestionCacheRepository(client),
      // Agent 精调只在空闲重算任务执行（scheduler 懒装配）；同步 GET 永远公式层
      null,
    );
    const result = await service.getCache(userId, clientFingerprint, req.log);
    return reply.status(200).send(result);
  } catch (err) {
    req.log.error({ err }, "suggestions_cache_failed");
    return reply.status(500).send({
      error: err instanceof Error ? err.message : "Internal Server Error",
    });
  }
}
