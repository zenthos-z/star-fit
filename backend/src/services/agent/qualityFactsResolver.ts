/**
 * qualityFactsResolver — 质量检测的真值解析器
 *
 * 从 DB 读取指定用户的最新训练 session（与 load_history 相同的 Repository
 * 路径，禁止绕过），供 workoutQualityGate 做数据一致性比对。
 *
 * 任何读取失败都返回 null（质量检测静默降级），绝不抛错打断主聊天流程。
 */

import { getPostgresClient } from '../../db/postgresql/client/postgres-client.js';
import { createUserRepository } from '../../db/postgresql/repository/index.js';
import type { WorkoutSessionFacts } from './workoutQualityGate.js';
import { extractSessionFacts } from './workoutQualityGate.js';

/**
 * 读取用户 history_summary 中最新一条 session 作为质量检测真值。
 * 无用户 / 无 session / DB 异常 → null。
 */
export async function getLatestSessionFacts(
  userId: string,
): Promise<WorkoutSessionFacts | null> {
  try {
    const client = getPostgresClient();
    const repo = createUserRepository(client);
    const history = await repo.getHistorySummary(userId);
    if (!history) return null;
    return extractSessionFacts(history);
  } catch {
    return null;
  }
}
