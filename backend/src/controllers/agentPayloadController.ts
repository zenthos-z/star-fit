/**
 * Agent Payload Controller - 交付载荷快照回看 API（issue #96 调试入口）
 *
 * 提供调试台「Payload 审计」页的数据面：
 * - GET /api/debug/agent-payloads           快照列表（时间/动作数/校验状态徽标 + 分页）
 * - GET /api/debug/agent-payloads/:sessionId 单次训练的完整交付 payload 快照
 *
 * 鉴权：与全部 /api 路由同链——STARFIT_ACCESS_TOKEN 全局门（若配置）+
 * X-User-Id 头（getUserId 缺头即抛 MissingUserIdError→400）；快照含用户
 * 数据，读路径一律按 userId 限定（他人快照 404，不泄露存在性）。
 *
 * 定位：训练后审计（只读）。不提供任何写/改端点——快照即交付时点的真实样子。
 */

import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { getUserId } from "../utils/requestUtils.js";
import { getPostgresClient } from "../db/postgresql/client/postgres-client.js";
import { createAgentPayloadSnapshotRepository } from "../db/postgresql/repository/agentPayloadSnapshot.repository.js";

const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * 快照列表（摘要行）。分页参数 limit（1-100，默认 20）/ offset（≥0）。
 */
export async function listAgentPayloadSnapshots(
  request: FastifyRequest<{ Querystring: { limit?: string; offset?: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const userId = getUserId(request);
  const parsed = ListQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    reply.status(400).send({
      error: "Invalid query parameters",
      details: parsed.error.flatten(),
    });
    return;
  }

  try {
    const repo = createAgentPayloadSnapshotRepository(getPostgresClient());
    const { rows, total } = await repo.listSnapshots(userId, {
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });
    reply.status(200).send({
      snapshots: rows,
      total,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });
  } catch (error) {
    request.log.error({
      msg: "Failed to list agent payload snapshots",
      userId,
      error: (error as Error).message,
    });
    reply.status(500).send({
      error: "Failed to list agent payload snapshots",
      message: (error as Error).message,
    });
  }
}

/**
 * 快照详情：完整交付 payload + 校验结果 + 预处理标注。
 * 未命中（不存在/他人会话）→ 404（无兜底空态，分册4 §5.2）。
 */
export async function getAgentPayloadSnapshot(
  request: FastifyRequest<{ Params: { sessionId: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const userId = getUserId(request);
  const { sessionId } = request.params;

  try {
    const repo = createAgentPayloadSnapshotRepository(getPostgresClient());
    const snapshot = await repo.getSnapshotBySessionId(userId, sessionId);
    if (!snapshot) {
      reply.status(404).send({
        error: "Snapshot not found",
        session_id: sessionId,
      });
      return;
    }
    reply.status(200).send(snapshot);
  } catch (error) {
    request.log.error({
      msg: "Failed to fetch agent payload snapshot",
      userId,
      sessionId,
      error: (error as Error).message,
    });
    reply.status(500).send({
      error: "Failed to fetch agent payload snapshot",
      message: (error as Error).message,
    });
  }
}
