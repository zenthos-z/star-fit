/**
 * Weekly-plan agent tools (E3) tests — get_current_plan / save_weekly_plan.
 *
 * Coverage:
 *   - Structure: both tools registered alongside the nine domain tools,
 *     no forgeable userId parameter (secure by construction).
 *   - Weekly-once semantics on REAL PG: save persists the week atomically,
 *     a second save for the same week is REFUSED (already_exists),
 *     get_current_plan preaches reuse once a plan exists, and the week_id
 *     default resolves server-side to the CURRENT ISO week.
 *   - Contract-invalid input comes back structured (invalid_input), not a crash.
 *
 * Runner: node:test via tsx (same convention as the sibling agent __tests__).
 * Real-PG suite connects to the configured database; if it is unreachable the
 * PG-dependent tests SKIP (honest — they never fake green). The structural
 * suite always runs.
 *
 *   cd backend && npx tsx --test src/services/agent/__tests__/weeklyPlanTools.test.ts
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

import { DynamicStructuredTool } from "@langchain/core/tools";

import { buildMcpToolsWith } from "../mcpTools.js";
import { PostgresClient } from "../../../db/postgresql/client/postgres-client.js";
import { getIsoWeekId } from "shared/contracts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_DB_URL =
  process.env.MCP_TEST_DB_URL ||
  process.env.DATABASE_URL ||
  "postgresql://starfit:starfit@localhost:5432/starfit";

const EXERCISE_ID = "wp-tool-squat-001"; // 18 字符 NanoID 形态（12-24）

const NOW = Date.now();
const TODAY = new Date().toISOString().slice(0, 10);
const WEEK_ID = getIsoWeekId(TODAY);

/** 最小合法周计划载荷 */
function planPayload(overrides: Record<string, unknown> = {}) {
  return {
    split: "upper_lower",
    entries: [
      {
        entry_date: TODAY,
        exercise_id: EXERCISE_ID,
        target_sets: 4,
        target_load: { type: "percent_1rm", min: 70, max: 80 },
      },
    ],
    ...overrides,
  };
}

/** 从 JSON 工具返回中解出对象 */
function parseToolResult(raw: string): Record<string, unknown> {
  return JSON.parse(raw) as Record<string, unknown>;
}

// ===========================================================================
// Structural suite (no PG)
// ===========================================================================

describe("weekly plan tools — structure (no PG)", () => {
  const tools = buildMcpToolsWith(
    {} as never,
    "00000000-0000-0000-0000-0000000000aa",
  );

  it("registers get_current_plan and save_weekly_plan alongside the domain tools", () => {
    const names = new Set(tools.map((t) => t.name));
    assert.ok(names.has("get_current_plan"), "get_current_plan missing");
    assert.ok(names.has("save_weekly_plan"), "save_weekly_plan missing");
  });

  it("both are DynamicStructuredTools with real descriptions", () => {
    for (const name of ["get_current_plan", "save_weekly_plan"]) {
      const tool = tools.find((t) => t.name === name)!;
      assert.ok(tool instanceof DynamicStructuredTool, name);
      assert.ok(
        tool.description.length > 40,
        `${name} needs a real description`,
      );
    }
  });

  it("write tool does NOT expose a forgeable userId parameter (secure by construction)", () => {
    const swp = tools.find((t) => t.name === "save_weekly_plan")!;
    const shape =
      (swp.schema as unknown as { shape?: Record<string, unknown> }).shape ??
      {};
    assert.ok(!("userId" in shape), "save_weekly_plan must not accept userId");
    assert.ok(
      !("user_id" in shape),
      "save_weekly_plan must not accept user_id either",
    );
  });

  it("week_id is optional in both schemas (server resolves the current week)", () => {
    const gcp = tools.find((t) => t.name === "get_current_plan")!;
    assert.strictEqual(
      (
        gcp.schema as { safeParse: (x: unknown) => { success: boolean } }
      ).safeParse({}).success,
      true,
      "get_current_plan must accept an empty input (current-week default)",
    );
    const swp = tools.find((t) => t.name === "save_weekly_plan")!;
    const parsed = (
      swp.schema as {
        safeParse: (x: unknown) => { success: boolean };
      }
    ).safeParse(planPayload());
    assert.strictEqual(
      parsed.success,
      true,
      "save_weekly_plan sans week_id ok",
    );
  });
});

// ===========================================================================
// Real-PG suite
// ===========================================================================

describe("weekly plan tools — real PG", () => {
  let client: PostgresClient;
  let userId: string;
  let getCurrentPlan: DynamicStructuredTool;
  let saveWeeklyPlan: DynamicStructuredTool;
  let pgAvailable = false;

  before(async () => {
    client = new PostgresClient({ connectionString: TEST_DB_URL });
    try {
      await client.connect();
      pgAvailable = true;
    } catch {
      pgAvailable = false; // PG unreachable → skip honestly
    }
    userId = crypto.randomUUID();
    const tools = buildMcpToolsWith(client, userId);
    getCurrentPlan = tools.find((t) => t.name === "get_current_plan")!;
    saveWeeklyPlan = tools.find((t) => t.name === "save_weekly_plan")!;
    if (pgAvailable) {
      await client.query(
        `INSERT INTO users (id, display_name, protocol_version)
         VALUES ($id, 'wp-tools-test-user', '3.0.0')`,
        { id: userId },
      );
      await client.query(
        `INSERT INTO exercises (id, name, exercise_type, difficulty, attributes, tutorials)
         VALUES ($id, $name, 'resistance', 'intermediate', '{}'::jsonb, '{}'::jsonb)`,
        { id: EXERCISE_ID, name: `wp-tools-bench-${NOW}` },
      );
    }
  });

  it("get_current_plan reports no plan for a fresh week (defaults to CURRENT week)", async (t) => {
    if (!pgAvailable) return t.skip("PG unreachable");
    const res = parseToolResult(await getCurrentPlan.invoke({}));
    assert.strictEqual(res.found, false);
    assert.strictEqual(res.week_id, WEEK_ID); // 缺省 = 当前周（服务器推导，Agent 不做日历算术）
  });

  it("save_weekly_plan persists the week atomically", async (t) => {
    if (!pgAvailable) return t.skip("PG unreachable");
    const res = parseToolResult(await saveWeeklyPlan.invoke(planPayload()));
    assert.strictEqual(res.saved, true, JSON.stringify(res));
    assert.strictEqual(res.week_id, WEEK_ID);
    assert.strictEqual(res.entries_count, 1);
  });

  it("get_current_plan now finds the persisted plan and preaches reuse", async (t) => {
    if (!pgAvailable) return t.skip("PG unreachable");
    const res = parseToolResult(await getCurrentPlan.invoke({}));
    assert.strictEqual(res.found, true);
    assert.match(String(res.message), /reuse|复用/i);
  });

  it("save_weekly_plan refuses to overwrite the existing week (already_exists)", async (t) => {
    if (!pgAvailable) return t.skip("PG unreachable");
    const res = parseToolResult(
      await saveWeeklyPlan.invoke(planPayload({ split: "full_body" })),
    );
    assert.strictEqual(res.saved, false);
    assert.strictEqual(res.reason, "already_exists");
  });

  it("save_weekly_plan rejects contract-invalid entries structurally", async (t) => {
    if (!pgAvailable) return t.skip("PG unreachable");
    // rpe max=11 过得了工具入参 schema（宽松 object），被契约 TargetLoadSchema
    // superRefine（rpe ∈ [0,10]）拒绝 → invalid_input 结构化返回
    const res = parseToolResult(
      await saveWeeklyPlan.invoke(
        planPayload({
          entries: [
            {
              entry_date: TODAY,
              exercise_id: EXERCISE_ID,
              target_sets: 3,
              target_load: { type: "rpe", min: 7, max: 11 },
            },
          ],
        }),
      ),
    );
    assert.strictEqual(res.saved, false);
    assert.strictEqual(res.reason, "invalid_input");
  });

  after(async () => {
    if (pgAvailable) {
      // users 级联清 weekly_plans / plan_entries；exercise 单独清
      await client
        .query("DELETE FROM users WHERE id = $id", { id: userId })
        .catch(() => undefined);
      await client
        .query("DELETE FROM exercises WHERE id = $id", { id: EXERCISE_ID })
        .catch(() => undefined);
    }
    await client.close().catch(() => undefined);
  });
});
