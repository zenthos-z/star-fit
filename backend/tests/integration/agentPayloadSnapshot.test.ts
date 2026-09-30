/**
 * Agent Payload Snapshot integration tests（issue #96，真实 PostgreSQL）。
 *
 * 覆盖任务书验证门 4：
 * - 快照落库往返：真实链路（upsertSessions → snapshotSessionDeliveries）
 *   写入 → 列表 → 详情读回一致（payload 归一形态逐字段对拍）
 * - 硬校验拒绝样本：引用不存在 / 不可归一 → 快照含失败明细（code + reason）
 *   且 payload 原样冻结（拒付不丢快照）
 * - 列表分页：limit/offset/total + start_time 倒序
 * - 用户隔离：他人列表为空 / 详情 null
 *
 * 无 DATABASE_URL 自动跳过（CI/无 PG 机器）；jest setup 默认指向
 * starfit-test-pg（127.0.0.1:15432）。
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import pg from "pg";

import {
  getPostgresClient,
  closePostgresClient,
} from "../../src/db/postgresql/client/postgres-client.js";
import { SessionRepo } from "../../src/services/sessionRepo.js";
import {
  snapshotSessionDeliveries,
  buildDeliverySnapshotContent,
} from "../../src/services/agent/payloadSnapshotService.js";
import { createAgentPayloadSnapshotRepository } from "../../src/db/postgresql/repository/agentPayloadSnapshot.repository.js";

const connectionString = process.env.DATABASE_URL;
const describeOrSkip = connectionString ? describe : describe.skip;

/** 生成一份真实形态的 legacy Session（前端同步链 payload 形态） */
function makeRawSession(overrides: {
  id: string;
  exerciseIds: string[];
  startTime: number;
  withFeel?: boolean;
  /** badShape=exercise_no_name：动作缺 name——真实可达的 unnormalizable 路径
   *  （upsertSessions 不深校 exercises，行能落库但归一抛「缺少 name」） */
  badShape?: "exercise_no_name" | null;
}): Record<string, unknown> {
  const t0 = overrides.startTime;
  if (overrides.badShape === "exercise_no_name") {
    return {
      id: overrides.id,
      startTime: t0,
      endTime: t0 + 30 * 60_000,
      pausedDuration: 0,
      status: "finished",
      exercises: [
        // 动作缺 name：连归一都不行（unnormalizable）
        { id: overrides.exerciseIds[0], type: "resistance", sets: [] },
      ],
    };
  }
  return {
    id: overrides.id,
    startTime: t0,
    endTime: t0 + 55 * 60_000,
    pausedDuration: 0,
    status: "finished",
    exercises: [
      {
        id: overrides.exerciseIds[0],
        libraryId: overrides.exerciseIds[0],
        name: "杠铃深蹲",
        type: "resistance",
        primaryMuscles: ["quadriceps"],
        sets: [
          {
            id: "set-1",
            weight: 60,
            reps: 8,
            rpe: 7,
            status: "COMPLETED",
            completedAt: t0 + 5 * 60_000,
            restEndTime: t0 + 6 * 60_000,
            ...(overrides.withFeel
              ? { feel: 62, feel_note: "状态不错，最后一组有点吃力" }
              : {}),
          },
          {
            id: "set-2",
            weight: 65,
            reps: 8,
            status: "COMPLETED",
            completedAt: t0 + 12 * 60_000,
            ...(overrides.withFeel ? { feel: 48 } : {}),
          },
        ],
      },
      {
        id: overrides.exerciseIds[1] ?? overrides.exerciseIds[0],
        name: "跑步机慢跑",
        type: "cardio",
        sets: [
          {
            id: "set-c1",
            duration: 900,
            distance: 2400,
            status: "COMPLETED",
            completedAt: t0 + 30 * 60_000,
            ...(overrides.withFeel ? { feel: 70 } : {}),
          },
        ],
      },
    ],
  };
}

describeOrSkip("AgentPayloadSnapshot (real PG)", () => {
  let adminPool!: pg.Pool;
  let userId!: string;
  let realExerciseId!: string;
  let realExerciseId2!: string;
  const now = Date.now();
  const device = `payload-snap-${now}`;

  beforeAll(async () => {
    adminPool = new pg.Pool({ connectionString });
    const ids = await adminPool.query<{ id: string }>(
      "SELECT id FROM exercises ORDER BY id LIMIT 2",
    );
    realExerciseId = ids.rows[0].id;
    realExerciseId2 = ids.rows[1].id;
  });

  afterAll(async () => {
    if (userId) {
      await adminPool.query("DELETE FROM users WHERE id = $1", [userId]);
    }
    await adminPool.end();
    await closePostgresClient();
  });

  it("真实链路：upsertSessions → snapshotSessionDeliveries → 列表/详情读回一致", async () => {
    const sessionId = crypto.randomUUID();
    const raw = makeRawSession({
      id: sessionId,
      exerciseIds: [realExerciseId, realExerciseId2],
      startTime: now - 3 * 3600_000,
      withFeel: true,
    });

    // 真实同步链：先落 sessions 行（含 raw_json），返回解析出的 userId
    const upsert = await SessionRepo.upsertSessions(device, [raw as never]);
    userId = upsert.userId!;
    expect(userId).toBeTruthy();

    const snap = await snapshotSessionDeliveries(userId, [raw]);
    expect(snap.snapshotted).toBe(1);
    expect(snap.failed).toBe(0);

    const repo = createAgentPayloadSnapshotRepository(getPostgresClient());

    // 列表可见（摘要行）
    const list = await repo.listSnapshots(userId, { limit: 10, offset: 0 });
    const summary = list.rows.find((r) => r.session_id === sessionId);
    expect(summary).toBeDefined();
    expect(summary!.validation_passed).toBe(true);
    expect(summary!.validation_code).toBe("ok");
    expect(summary!.exercise_count).toBe(2);
    expect(summary!.title).toBe("杠铃深蹲/跑步机慢跑");

    // 详情读回：payload = 归一形态，逐字段对拍（写读一致）
    const detail = await repo.getSnapshotBySessionId(userId, sessionId);
    expect(detail).not.toBeNull();
    const payload = detail!.payload as Record<string, unknown>;
    expect(payload.session_id).toBe(sessionId);
    expect(payload.start_time).toBe(new Date(now - 3 * 3600_000).toISOString());
    expect(payload.end_time).toBe(
      new Date(now - 3 * 3600_000 + 55 * 60_000).toISOString(),
    );
    const exercises = payload.exercises as Array<Record<string, unknown>>;
    expect(exercises).toHaveLength(2);
    expect(exercises[0].exercise_id).toBe(realExerciseId);
    expect(exercises[0].type).toBe("resistance");
    const sets = exercises[0].sets as Array<Record<string, unknown>>;
    expect(sets).toHaveLength(2);
    expect(sets[0].status).toBe("completed"); // COMPLETED → 归一小写
    expect(sets[0].timestamp).toBe(
      new Date(now - 3 * 3600_000 + 5 * 60_000).toISOString(),
    ); // completedAt → ISO
    expect(sets[0].feel).toBe(62); // 感受序列透传保留
    expect(sets[0].rpe).toBe(7);
    expect(detail!.validation.ok).toBe(true);
    expect(detail!.validation.code).toBe("ok");
    expect(detail!.validation.reference_check).toBe("applied");

    // 预处理标注：set-1 timestamp 来自 completedAt；status COMPLETED → completed
    const note = detail!.preprocess.find(
      (n) => n.exercise_index === 0 && n.set_index === 0,
    );
    expect(note).toBeDefined();
    expect(note!.timestamp_source).toBe("completed_at");
    expect(note!.status_original).toBe("COMPLETED");
    expect(note!.status_normalized).toBe("completed");
  });

  it("重同步 upsert 幂等：同 (user, session) 覆盖为最新交付时点，首冻时刻保留", async () => {
    const sessionId = crypto.randomUUID();
    const raw = makeRawSession({
      id: sessionId,
      exerciseIds: [realExerciseId, realExerciseId2],
      startTime: now - 2 * 3600_000,
    });
    await SessionRepo.upsertSessions(device, [raw as never]);
    await snapshotSessionDeliveries(userId, [raw]);

    const repo = createAgentPayloadSnapshotRepository(getPostgresClient());
    const first = await repo.getSnapshotBySessionId(userId, sessionId);
    expect(first!.validation_passed).toBe(true);

    // 重同步同一条（快照行仍为 1，snapshotted_at 不变）
    await snapshotSessionDeliveries(userId, [raw]);
    const list = await repo.listSnapshots(userId, { limit: 100, offset: 0 });
    const hits = list.rows.filter((r) => r.session_id === sessionId);
    expect(hits).toHaveLength(1);
    const second = await repo.getSnapshotBySessionId(userId, sessionId);
    expect(second!.snapshotted_at).toBe(first!.snapshotted_at);

    const total = await adminPool.query(
      "SELECT count(*) AS c FROM agent_payload_snapshots WHERE user_id = $1 AND session_id = $2",
      [userId, sessionId],
    );
    expect(Number(total.rows[0].c)).toBe(1);
  });

  it("硬校验拒绝样本：动作引用不在库 → 快照含失败明细（reference + 原因）", async () => {
    const sessionId = crypto.randomUUID();
    const bogusId = "not-in-library-" + now;
    const raw = makeRawSession({
      id: sessionId,
      exerciseIds: [bogusId, bogusId],
      startTime: now - 1 * 3600_000,
    });
    await SessionRepo.upsertSessions(device, [raw as never]);
    const snap = await snapshotSessionDeliveries(userId, [raw]);
    expect(snap.snapshotted).toBe(1); // 拒付也落快照（失败可见）

    const repo = createAgentPayloadSnapshotRepository(getPostgresClient());
    const list = await repo.listSnapshots(userId, { limit: 100, offset: 0 });
    const summary = list.rows.find((r) => r.session_id === sessionId);
    expect(summary!.validation_passed).toBe(false);
    expect(summary!.validation_code).toBe("reference");

    const detail = await repo.getSnapshotBySessionId(userId, sessionId);
    expect(detail!.validation.ok).toBe(false);
    expect(detail!.validation.code).toBe("reference");
    expect(detail!.validation.reason).toContain(bogusId);
    // payload = 归一形态原样冻结（拒付的交付候选，未做任何修复）
    const payload = detail!.payload as Record<string, unknown>;
    expect((payload.exercises as unknown[]).length).toBe(2);
  });

  it("硬校验拒绝样本：不可归一（动作缺 name）→ payload 原始输入原样冻结", async () => {
    const sessionId = crypto.randomUUID();
    const raw = makeRawSession({
      id: sessionId,
      exerciseIds: [realExerciseId],
      startTime: now,
      badShape: "exercise_no_name",
    });
    await SessionRepo.upsertSessions(device, [raw as never]);
    await snapshotSessionDeliveries(userId, [raw]);

    const repo = createAgentPayloadSnapshotRepository(getPostgresClient());
    const detail = await repo.getSnapshotBySessionId(userId, sessionId);
    expect(detail!.validation.ok).toBe(false);
    expect(detail!.validation.code).toBe("unnormalizable");
    expect(detail!.validation.reason).toContain("name");
    expect(detail!.exercise_count).toBe(1); // 摘要按原始行防御统计
    // 原始输入原样冻结（非归一形态：无 session_id/exercise_id 派生键改写）
    const payload = detail!.payload as Record<string, unknown>;
    expect(payload.id).toBe(sessionId);
    expect(
      (payload.exercises as Array<Record<string, unknown>>)[0].exercise_id,
    ).toBeUndefined();
    expect(detail!.preprocess).toEqual([]);
  });

  it("列表分页：limit/offset 切片 + total + start_time 倒序", async () => {
    const repo = createAgentPayloadSnapshotRepository(getPostgresClient());
    // 再补 3 条不同时间的快照（连同前述用例共 ≥ 5 条）
    for (let i = 0; i < 3; i++) {
      const sid = crypto.randomUUID();
      const raw = makeRawSession({
        id: sid,
        exerciseIds: [realExerciseId, realExerciseId2],
        startTime: now - (10 + i) * 3600_000,
      });
      await SessionRepo.upsertSessions(device, [raw as never]);
      await snapshotSessionDeliveries(userId, [raw]);
    }

    const page1 = await repo.listSnapshots(userId, { limit: 2, offset: 0 });
    expect(page1.rows).toHaveLength(2);
    expect(page1.total).toBeGreaterThanOrEqual(5);

    const page2 = await repo.listSnapshots(userId, { limit: 2, offset: 2 });
    expect(page2.rows).toHaveLength(2);
    // 两页无重叠
    const ids1 = new Set(page1.rows.map((r) => r.session_id));
    expect(page2.rows.every((r) => !ids1.has(r.session_id))).toBe(true);

    // 倒序：page1 首行 start_time ≥ page2 末行
    const t = (iso: string | null) => (iso ? Date.parse(iso) : -Infinity);
    expect(t(page1.rows[0].start_time)).toBeGreaterThanOrEqual(
      t(page2.rows[1].start_time),
    );

    const last = await repo.listSnapshots(userId, {
      limit: 100,
      offset: page1.total - 1,
    });
    expect(last.rows).toHaveLength(1);
  });

  it("用户隔离：他人列表为空、详情 null（不泄露存在性）", async () => {
    const other = await adminPool.query<{ id: string }>(
      `INSERT INTO users (device_id, display_name, protocol_version)
       VALUES ($1, 'payload-snap-other', '3.0.0') RETURNING id`,
      [`payload-snap-other-${now}`],
    );
    const otherId = other.rows[0].id;
    const repo = createAgentPayloadSnapshotRepository(getPostgresClient());
    const list = await repo.listSnapshots(otherId, { limit: 10, offset: 0 });
    expect(list.rows).toHaveLength(0);
    expect(list.total).toBe(0);

    // 本人有效 sessionId 在他人名下读 = null
    const mine = await repo.listSnapshots(userId, { limit: 1, offset: 0 });
    const scoped = await repo.getSnapshotBySessionId(
      otherId,
      mine.rows[0].session_id,
    );
    expect(scoped).toBeNull();
    await adminPool.query("DELETE FROM users WHERE id = $1", [otherId]);
  });

  it("纯函数：knownExerciseIds 缺省时跳过引用检查并留痕（与 load_history 同策略）", () => {
    const raw = makeRawSession({
      id: crypto.randomUUID(),
      exerciseIds: ["whatever-id"],
      startTime: now,
    });
    const content = buildDeliverySnapshotContent(raw, undefined);
    expect(content.validation.reference_check).toBe("skipped");
    // 结构合法（引用未检）→ 校验通过形态
    expect(content.validation.ok).toBe(true);
    expect(content.validation.code).toBe("ok");
  });
});
