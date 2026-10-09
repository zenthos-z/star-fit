/**
 * <user> 实参解析：display_name（人类可读）→ 内部 UUID。
 *
 * 遵循仓库用户标识符规范：AI/用户层使用 display_name，程序内部用 id (UUID)。
 * 解析走 GET /api/admin/users（只读，无副作用 —— 不用 login-or-create，
 * 该端点对未知名字会静默建号，拼错一次就脏一份数据）。
 */

import type { BridgeClient } from "./client.js";

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

export interface AdminUserRow {
  id: string;
  device_id: string | null;
  display_name: string | null;
  created_at: string | number | null;
  session_count: number | null;
}

export class UserResolutionError extends Error {
  /** 候选名单（人读错误信息用） */
  readonly candidates: AdminUserRow[];

  constructor(message: string, candidates: AdminUserRow[] = []) {
    super(message);
    this.name = "UserResolutionError";
    this.candidates = candidates;
  }
}

function asAdminUserRows(data: unknown): AdminUserRow[] {
  if (!Array.isArray(data)) return [];
  return data.filter(
    (r): r is AdminUserRow =>
      r !== null && typeof r === "object" && typeof (r as AdminUserRow).id === "string",
  );
}

/**
 * 解析 <user> 实参：
 * - UUID 直接透传
 * - 否则按 display_name 精确匹配（唯一命中才通过）
 *
 * 未命中/歧义 → UserResolutionError，candidates 带全量名单供上层列出。
 */
export async function resolveUser(
  client: BridgeClient,
  userArg: string,
): Promise<{ userId: string; displayName: string | null }> {
  if (isUuid(userArg)) {
    return { userId: userArg.toLowerCase(), displayName: null };
  }

  const data = await client.api("/admin/users");
  const rows = asAdminUserRows(data);

  const exact = rows.filter((r) => r.display_name === userArg);
  if (exact.length === 1) {
    const hit = exact[0]!;
    return { userId: hit.id, displayName: hit.display_name };
  }
  if (exact.length > 1) {
    const list = exact
      .map((r) => `  ${r.display_name}  id=${r.id}  created=${String(r.created_at)}`)
      .join("\n");
    throw new UserResolutionError(
      `用户名 "${userArg}" 命中 ${exact.length} 个账号（同名注册），请改用 UUID：\n${list}`,
      rows,
    );
  }

  const prefix = rows.filter(
    (r) =>
      r.display_name !== null && r.display_name.startsWith(userArg.slice(0, 2)),
  );
  const pool = prefix.length > 0 ? prefix : rows;
  const names = pool
    .slice(0, 10)
    .map((r) => `  ${r.display_name ?? r.device_id ?? r.id}`)
    .join("\n");
  throw new UserResolutionError(
    `未找到用户 "${userArg}"。可用用户（至多列 10 个）：\n${names}`,
    rows,
  );
}
