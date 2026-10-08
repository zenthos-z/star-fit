/**
 * planTemplates 真实 PG 对拍（#151 S3 / #136 L1 live 套件）。
 *
 * Coverage:
 *   - #136 L1 实测证据：全部模板 exercise_id ⊆ 真实 exercises 表（零 miss），
 *     并对拍「全集抽走探针 id → 报损显式命中」（启动/CI 对拍的可证伪性）；
 *   - instantiate_weekly_plan 工具真实 profile 回填：seed 用户画像（器械面/
 *     性别/训练龄/周频率/已登记伤病）→ 经 buildMcpToolsWith 生产装配面调用
 *     （UserRepository 真 profile 双读，非桩），展开结果并集可见。
 *
 * Runner: node:test via tsx（与兄弟 agent __tests__ 同约定）。PG 不可达时
 * PG 依赖用例诚实 skip（从不伪造绿）。
 *
 *   cd backend && npx tsx --test src/services/agent/__tests__/planTemplatesLive.test.ts
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { PostgresClient } from "../../../db/postgresql/client/postgres-client.js";
import { ExerciseQuery, buildMcpToolsWith } from "../mcpTools.js";
import {
  collectTemplateExerciseIds,
  loadWeeklyPlanTemplates,
} from "../planTemplates.js";
import { auditWeeklyPlanTemplates } from "../templateTools.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_DB_URL =
  process.env.MCP_TEST_DB_URL ||
  process.env.DATABASE_URL ||
  "postgresql://starfit:starfit@localhost:5432/starfit";

/** T1 伤替锚点：哑铃高脚杯深蹲（膝伤禁区）→ 臀桥。 */
const GLUTE_BRIDGE_ID = "a3vf4Tfqw3CHAGc-ND0bv";

describe("planTemplates — real PG（#136 L1 对拍 + profile 回填）", () => {
  let client: PostgresClient;
  let pgAvailable = false;

  before(async () => {
    client = new PostgresClient({ connectionString: TEST_DB_URL });
    try {
      await client.connect();
      pgAvailable = true;
    } catch {
      pgAvailable = false; // PG unreachable → skip honestly
    }
  });

  after(async () => {
    if (client) await client.close().catch(() => undefined);
  });

  // -------------------------------------------------------------------------
  // #136 L1：模板 id ↔ 动作库全集实测
  // -------------------------------------------------------------------------

  it("L1 对拍：全部模板 exercise_id ⊆ 真实动作库（零 miss）", async (t) => {
    if (!pgAvailable) return t.skip("PG unreachable");
    const report = await auditWeeklyPlanTemplates(() =>
      new ExerciseQuery(client).listAllIds(),
    );
    // 报损清单为空 = 主选/器械替代/伤病替代全部在库（伪造 id 从源头不可能）
    assert.deepEqual(report, []);
  });

  it("L1 引用规模证据：模板引用的真实动作 id 总数（PR 验证数字）", async (t) => {
    if (!pgAvailable) return t.skip("PG unreachable");
    const universe = await new ExerciseQuery(client).listAllIds();
    const allIds = loadWeeklyPlanTemplates().flatMap((tpl) =>
      collectTemplateExerciseIds(tpl),
    );
    const distinct = new Set(allIds);
    assert.ok(
      distinct.size >= 40,
      `expected >=40 distinct ids, got ${distinct.size}`,
    );
    // distinct 集合必须整体落在真实库内（与零 miss 断言互为印证）
    for (const id of distinct)
      assert.ok(universe.has(id), `${id} not in library`);
  });

  it("L1 可证伪性：全集抽走探针 id → 报损显式命中（miss 非空）", async (t) => {
    if (!pgAvailable) return t.skip("PG unreachable");
    const universe = await new ExerciseQuery(client).listAllIds();
    const probe = collectTemplateExerciseIds(loadWeeklyPlanTemplates()[0]!)[0]!;
    assert.ok(universe.has(probe), "probe id must exist in the real library");
    universe.delete(probe);
    const report = await auditWeeklyPlanTemplates(async () => universe);
    const hit = report.find((r) => r.misses.includes(probe));
    assert.ok(
      hit,
      `damage report must hit probe ${probe}: ${JSON.stringify(report)}`,
    );
  });

  // -------------------------------------------------------------------------
  // instantiate_weekly_plan 工具：真实 profile 回填（生产装配面）
  // -------------------------------------------------------------------------

  describe("instantiate_weekly_plan — 真实 UserRepository profile 双读", () => {
    let userId: string;

    before(async () => {
      if (!pgAvailable) return;
      userId = crypto.randomUUID();
      await client.query(
        `INSERT INTO users (id, display_name, protocol_version)
         VALUES ($id, 'tpl-live-test-user', '3.0.0')`,
        { id: userId },
      );
      // 居家新手画像：哑铃+自重+凳面 / 男 / 训龄 3 月 / 周 3 练 / 长期膝伤
      await client.query(
        `UPDATE users
           SET profile_static = $static, profile_dynamic = $dynamic
         WHERE id = $id`,
        {
          id: userId,
          static: JSON.stringify({
            basic_info: { gender: "male", training_age: 3 },
            preferences: {
              equipment: ["dumbbell", "bodyweight", "bench"],
              weekly_frequency_days: 3,
            },
          }),
          dynamic: JSON.stringify({
            active_limitations: [
              {
                part: "膝盖",
                severity: 3,
                expire_at: "2999-12-31T00:00:00.000Z",
                logged_at: "2026-01-01T00:00:00.000Z",
                auto_heal: false, // 长期旧伤不过期（#114 OQ4 拍板 A）
              },
            ],
          }),
        },
      );
    });

    after(async () => {
      if (!pgAvailable || !userId) return;
      await client
        .query(`DELETE FROM users WHERE id = $id`, { id: userId })
        .catch(() => {});
    });

    it("profile 全回填：膝伤并入（高脚杯深蹲→臀桥 id 对拍）+ 回填清单可见", async (t) => {
      if (!pgAvailable) return t.skip("PG unreachable");
      const tools = buildMcpToolsWith(client, userId);
      const inst = tools.find(
        (tool) => tool.name === "instantiate_weekly_plan",
      );
      assert.ok(
        inst,
        "instantiate_weekly_plan must be in the production tool list",
      );

      const r = JSON.parse(
        (await inst!.invoke({
          template_key: "t1-novice-fullbody-home",
        })) as string,
      ) as {
        ok: boolean;
        tier: string;
        days_per_week: number;
        adjustments: string[];
        profile_defaults_applied: string[];
        card: { days: Array<{ exercises: Array<{ exercise_id: string }> }> };
      };

      assert.equal(r.ok, true);
      assert.equal(r.tier, "novice");
      assert.equal(r.days_per_week, 3); // ← profile weekly_frequency_days
      // 膝伤并入：伤替臀桥出现在展开卡中（id 对拍，非名称匹配）
      const ids = r.card.days.flatMap((d) =>
        d.exercises.map((e) => e.exercise_id),
      );
      assert.ok(
        ids.includes(GLUTE_BRIDGE_ID),
        "glute-bridge substitute must appear",
      );
      assert.ok(
        r.adjustments.some((a) => a.includes("伤病禁区") && a.includes("臀桥")),
        `injury adjustment missing: ${JSON.stringify(r.adjustments)}`,
      );
      assert.ok(r.profile_defaults_applied.length > 0);
    });

    it("显式器械面替换 profile：bodyweight-only 周展开成立", async (t) => {
      if (!pgAvailable) return t.skip("PG unreachable");
      const tools = buildMcpToolsWith(client, userId);
      const inst = tools.find(
        (tool) => tool.name === "instantiate_weekly_plan",
      );
      const r = JSON.parse(
        (await inst!.invoke({
          template_key: "t1-novice-fullbody-home",
          equipment: ["bodyweight"],
        })) as string,
      ) as { ok: boolean; adjustments: string[] };
      assert.equal(r.ok, true);
      assert.ok(
        r.adjustments.some((a) => a.includes("器械约束")),
        `equipment adjustment missing: ${JSON.stringify(r.adjustments)}`,
      );
    });
  });
});
