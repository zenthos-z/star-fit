/**
 * Suggestion Controller - 动作建议值 API
 *
 * 提供：
 * - POST /api/suggestions - 批量生成动作建议值（公式基准 + 可选 Agent 调整）
 *
 * 契约见 shared/contracts/suggestions.ts；Agent 段故障一律降级 source='formula'，
 * 本端点不因 LLM 故障 5xx（红线）。
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import { SuggestionRequestSchema } from "shared/contracts";
import { getUserId } from "../utils/requestUtils.js";
import { getPostgresClient } from "../db/postgresql/client/postgres-client.js";
import { createUserRepository } from "../db/postgresql/repository/user.repository.js";
import { SuggestionService } from "../services/suggestions/suggestionService.js";
import { SuggestionAgentAdapter } from "../services/suggestions/suggestionAgentAdapter.js";
import { deepAgentService } from "../services/agent/DeepAgentService.js";

export async function postSuggestions(req: FastifyRequest, reply: FastifyReply) {
  try {
    const parsed = SuggestionRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid suggestion request",
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const userId = getUserId(req);
    const repo = createUserRepository(getPostgresClient());
    // hybrid 模式经 adapter 走 DeepAgent（独立 threadId）；off 模式 service 不会调用
    const service = new SuggestionService(repo, new SuggestionAgentAdapter(deepAgentService));
    const result = await service.generateBatch(userId, parsed.data, req.log);
    return reply.status(200).send(result);
  } catch (err: any) {
    req.log.error({ err }, "suggestions_failed");
    return reply.status(500).send({ error: err?.message || "Internal Server Error" });
  }
}
