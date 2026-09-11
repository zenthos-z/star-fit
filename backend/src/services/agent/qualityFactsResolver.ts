/**
 * qualityFactsResolver — 质量检测的真值解析器
 *
 * 从 DB 读取指定用户的最新训练 session（与 load_history 相同的 Repository
 * 路径，禁止绕过），供 workoutQualityGate 做数据一致性比对。
 *
 * 真值源是 sessions 表本身（每次 sync/push 都写的权威数据），不再读
 * users.history_summary 压缩摘要——摘要无人维护且丢细节，会让质量门
 * 静默降级成空比。
 *
 * 任何读取失败都返回 null（质量检测静默降级），绝不抛错打断主聊天流程。
 */

import { getPostgresClient } from "../../db/postgresql/client/postgres-client.js";
import type { WorkoutSessionFacts } from "./workoutQualityGate.js";
import { extractSessionFacts } from "./workoutQualityGate.js";

/**
 * 读取用户 sessions 表最新一条 session 作为质量检测真值。
 * 无用户 / 无 session / DB 异常 → null。
 */
export async function getLatestSessionFacts(
  userId: string,
): Promise<WorkoutSessionFacts | null> {
  try {
    const client = getPostgresClient();
    const rows = await client.queryMany<{ raw_json: unknown }>(
      `SELECT raw_json FROM sessions
        WHERE user_id = $userId
        ORDER BY start_time DESC
        LIMIT 1`,
      { userId },
    );
    if (rows.length === 0) return null;
    // extractSessionFacts 读 history 形状 { sessions: [...] }，取最后一条为最新。
    return extractSessionFacts({ sessions: [rows[0].raw_json] });
  } catch {
    return null;
  }
}
