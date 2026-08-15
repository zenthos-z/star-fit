import type { FastifyReply, FastifyRequest } from "fastify";

export async function getHistorySummary(req: FastifyRequest, reply: FastifyReply) {
  const q = (req.query ?? {}) as Record<string, string>;
  const days = Number(q.days || 30);
  const now = Date.now();
  const from = new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
  // 轻量占位汇总：结构稳定，后续可接入真实日志聚合
  const summary = {
    rangeDays: days,
    from,
    generatedAt: new Date().toISOString(),
    sessionsCount: 0,
    exercisesCount: 0,
    last3Days: [
      { date: new Date(now - 2 * 24 * 60 * 60 * 1000).toLocaleDateString(), text: "—" },
      { date: new Date(now - 1 * 24 * 60 * 60 * 1000).toLocaleDateString(), text: "—" },
      { date: new Date(now).toLocaleDateString(), text: "—" }
    ]
  };
  return reply.status(200).send(summary);
}

