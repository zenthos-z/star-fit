/**
 * Admin Token 鉴权（A15-1，issue #15 收窄后管理台人工修改入口）
 *
 * 现状确认（2026-09-28）：仓库内无既有 admin 鉴权中间件——server.ts 仅有
 * 全局 STARFIT_ACCESS_TOKEN 网关（设了才启用、覆盖所有路由），不区分 admin。
 * 按任务书做最小实现：ADMIN_TOKEN 环境变量校验，默认拒绝（未配置即全拒），
 * 不建用户体系。
 *
 * 令牌经 X-Admin-Token 头传入（server.ts CORS allowedHeaders 已放行）；
 * 比较走 sha256 摘要 + timingSafeEqual，规避时序侧信道。
 */

import { createHash, timingSafeEqual } from "crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

export const ADMIN_TOKEN_HEADER = "x-admin-token";

/** sha256 摘相等比较（定长摘要 → timingSafeEqual 长度恒匹配） */
function tokenEquals(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * 管理台路由 preHandler：校验 X-Admin-Token。
 * - ADMIN_TOKEN 未配置 → 默认拒绝（401，提示服务端未启用）
 * - 令牌缺失/不符 → 401
 */
export async function requireAdminAuth(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected || expected.length === 0) {
    req.log.warn("admin_api_disabled_token_not_configured");
    return reply.status(401).send({
      error: "Admin API disabled: ADMIN_TOKEN is not configured on server",
    });
  }

  const provided = req.headers[ADMIN_TOKEN_HEADER];
  if (typeof provided !== "string" || !tokenEquals(provided, expected)) {
    return reply.status(401).send({ error: "Invalid or missing admin token" });
  }
}
