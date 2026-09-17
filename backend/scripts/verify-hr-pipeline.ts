/**
 * HR 链路运行时验证（tsx 直连真库，等价于后端运行时环境）。
 * 用法：DATABASE_URL=... npx tsx backend/scripts/verify-hr-pipeline.ts
 */
import pg from "pg";
import {
  getPostgresClient,
  closePostgresClient,
} from "../src/db/postgresql/client/postgres-client.js";
import { createHeartRateRepository } from "../src/db/postgresql/repository/heartRate.repository.js";
import { buildMcpToolsWith } from "../src/services/agent/mcpTools.js";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const now = Date.now();

async function main() {
  // 1) 造测试用户 + 会话
  const user = await pool.query(
    `INSERT INTO users (device_id, display_name, protocol_version)
     VALUES ($1, 'hr-verify', '3.0.0') RETURNING id`,
    [`hr-verify-${now}`],
  );
  const userId = user.rows[0].id;
  const session = await pool.query(
    `INSERT INTO sessions (user_id, start_time, raw_json)
     VALUES ($1, NOW() - interval '30 minutes', '{}') RETURNING id`,
    [userId],
  );
  const sessionId = session.rows[0].id;
  console.log(
    "created user/session:",
    userId.slice(0, 8),
    sessionId.slice(0, 8),
  );

  // 2) Repository.insertBatch：真实写入 + 幂等
  const repo = createHeartRateRepository(getPostgresClient());
  const samples = Array.from({ length: 12 }, (_, i) => ({
    bpm: 110 + (i % 5) * 4,
    recorded_at: new Date(now - (11 - i) * 5000).toISOString(),
    exercise_index: 0,
    set_index: i < 6 ? 0 : 1,
  }));
  const inserted = await repo.insertBatch(userId, sessionId, samples);
  const replayed = await repo.insertBatch(userId, sessionId, samples);
  console.log(
    "insertBatch: first=%d replay=%d (expect 12 / 0)",
    inserted,
    replayed,
  );

  // 3) getSessionCurve
  const curve = await repo.getSessionCurve(userId, sessionId);
  console.log(
    "curve: samples=%d avg=%d max=%d min=%d",
    curve?.sample_count,
    curve?.avg_bpm,
    curve?.max_bpm,
    curve?.min_bpm,
  );

  // 4) getTrend
  const trend = await repo.getTrend(userId, 7, 1);
  console.log("trend rows:", trend.length, "first avg:", trend[0]?.avg_bpm);

  // 5) mcpTools 两个工具端到端（injectedUserId 测试路径）
  const tools = buildMcpToolsWith(getPostgresClient(), userId);
  const curveTool = tools.find((t) => t.name === "get_session_hr_curve")!;
  const trendTool = tools.find((t) => t.name === "get_hr_trend")!;
  const curveOut = JSON.parse(
    await curveTool.invoke({ session_id: sessionId }),
  );
  const trendOut = JSON.parse(
    await trendTool.invoke({ days: 7, min_samples: 1 }),
  );
  console.log(
    "tool get_session_hr_curve: found=%s samples=%d avg=%d",
    curveOut.found,
    curveOut.curve?.sample_count,
    curveOut.curve?.avg_bpm,
  );
  console.log(
    "tool get_hr_trend: sessions=%d trend=%s",
    trendOut.sessions?.length,
    trendOut.trend,
  );

  // 越权校验：别人的 session 应返回 not found
  const other = await pool.query(
    `INSERT INTO users (device_id, display_name, protocol_version)
     VALUES ($1, 'hr-verify-other', '3.0.0') RETURNING id`,
    [`hr-verify-other-${now}`],
  );
  const otherTools = buildMcpToolsWith(getPostgresClient(), other.rows[0].id);
  const otherCurveTool = otherTools.find(
    (t) => t.name === "get_session_hr_curve",
  )!;
  const otherOut = JSON.parse(
    await otherCurveTool.invoke({ session_id: sessionId }),
  );
  console.log("cross-user guard: found=%s (expect false)", otherOut.found);

  // 清理
  await pool.query("DELETE FROM users WHERE id = $1", [userId]);
  await pool.query("DELETE FROM users WHERE id = $1", [other.rows[0].id]);
  await pool.end();
  await closePostgresClient();
  console.log("CLEANUP OK — verify finished");
}

main().catch((e) => {
  console.error("VERIFY FAILED:", e.message);
  process.exit(1);
});
