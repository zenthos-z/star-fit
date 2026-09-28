/**
 * Profile Proposal Controller (画像提案确定性写入 — B5 / issue #37)
 *
 * POST /api/profile/apply-proposals
 * 前端在用户点「确认更新」后直调本端点：把 profile_update_confirm 卡片里
 * Agent 提案轮算好的最终值写入 profile_dynamic。确定性路径——无 LLM、
 * 无 Agent 执行轮，毫秒级完成（写入语义见 profileProposalService 头注）。
 *
 * - 请求经 ProfileApplyRequestSchema（shared/contracts 单一真源）校验；
 * - value 深校验失败 → 400 ProposalValidationError（整体拒绝，不写半截）；
 * - DB 故障 → 500。
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import { ProfileApplyRequestSchema } from "shared/contracts";
import { getUserId } from "../utils/requestUtils.js";
import { getPostgresClient } from "../db/postgresql/index.js";
import { UserScopedWriteRepository } from "../services/agent/mcpTools.js";
import {
  applyProfileProposals,
  ProposalValidationError,
} from "../services/profileProposalService.js";

export async function postApplyProfileProposals(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const userId = getUserId(req);
  const parsed = ProfileApplyRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    reply.status(400).send({
      error: "Invalid request body",
      details: parsed.error.issues.map(
        (i) => `${i.path.join(".") || "<root>"}: ${i.message}`,
      ),
    });
    return;
  }

  try {
    const repo = new UserScopedWriteRepository(getPostgresClient());
    const result = await applyProfileProposals(repo, userId, parsed.data);
    reply.send(result);
  } catch (err) {
    if (err instanceof ProposalValidationError) {
      reply
        .status(400)
        .send({ error: "Invalid proposal values", details: err.issues });
      return;
    }
    console.error("[profileProposalController] apply failed:", err);
    reply.status(500).send({
      error: "Failed to apply profile proposals",
      details: err instanceof Error ? err.message : String(err),
    });
  }
}
