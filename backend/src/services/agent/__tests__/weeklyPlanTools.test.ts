/**
 * Weekly-plan agent tools + apply path (E3 → B5b) tests.
 *
 * Coverage:
 *   - Structure: get_current_plan registered alongside the domain tools with
 *     no forgeable userId parameter; [B5b] save_weekly_plan is REMOVED
 *     (proposal-confirm architecture — persistence only via the deterministic
 *     apply endpoint, never an agent write tool).
 *   - Real PG: the confirm-apply repository path (applyWeeklyPlan) —
 *     scope=week upserts and whole-week replaces, scope=days covers single
 *     days and rejects when the week framework is missing.
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
import { createWeeklyPlanRepository } from "../../../db/postgresql/repository/weeklyPlan.repository.js";
import { ServiceError } from "../../../services/errors/ServiceError.js";
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

/** 最小合法整周落库载荷（scope=week；Repository 入参为 z.infer 完整形态） */
function weekPayload(overrides: Record<string, unknown> = {}) {
  return {
    scope: "week" as const,
    dates: [] as string[],
    split: "upper_lower" as const,
    entries: [
      {
        entry_date: TODAY,
        exercise_id: EXERCISE_ID,
        target_sets: 4,
        target_load: { type: "percent_1rm" as const, min: 70, max: 80 },
        status: "planned" as const,
        sort_order: 0,
      },
    ],
    ...overrides,
  };
}

// ===========================================================================
// Structural suite (no PG)
// ===========================================================================

describe("weekly plan tools — structure (no PG)", () => {
  const tools = buildMcpToolsWith(
    {} as never,
    "00000000-0000-0000-0000-0000000000aa",
  );

  it("registers get_current_plan alongside the domain tools", () => {
    const names = new Set(tools.map((t) => t.name));
    assert.ok(names.has("get_current_plan"), "get_current_plan missing");
  });

  it("[B5b] save_weekly_plan is REMOVED — persistence is proposal-confirm only", () => {
    const names = new Set(tools.map((t) => t.name));
    assert.ok(
      !names.has("save_weekly_plan"),
      "save_weekly_plan must not exist: the app writes via the apply endpoint after user confirm",
    );
  });

  it("get_current_plan is a DynamicStructuredTool with a real description", () => {
    const tool = tools.find((t) => t.name === "get_current_plan")!;
    assert.ok(tool instanceof DynamicStructuredTool);
    assert.ok(
      tool.description.length > 40,
      "get_current_plan needs a real description",
    );
  });

  it("get_current_plan does NOT expose a forgeable userId parameter (secure by construction)", () => {
    const gcp = tools.find((t) => t.name === "get_current_plan")!;
    const shape =
      (gcp.schema as unknown as { shape?: Record<string, unknown> }).shape ??
      {};
    assert.ok(!("userId" in shape), "get_current_plan must not accept userId");
    assert.ok(
      !("user_id" in shape),
      "get_current_plan must not accept user_id either",
    );
  });

  it("week_id is optional in get_current_plan (server resolves the current week)", () => {
    const gcp = tools.find((t) => t.name === "get_current_plan")!;
    assert.strictEqual(
      (
        gcp.schema as { safeParse: (x: unknown) => { success: boolean } }
      ).safeParse({}).success,
      true,
      "get_current_plan must accept an empty input (current-week default)",
    );
  });
});

// ===========================================================================
// Real-PG suite — applyWeeklyPlan（确认落库路径，B5b）
// ===========================================================================

describe("weekly plan apply path — real PG", () => {
  let client: PostgresClient;
  let userId: string;
  let repo: ReturnType<typeof createWeeklyPlanRepository>;
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
    repo = createWeeklyPlanRepository(client);
    if (pgAvailable) {
      await client.query(
        `INSERT INTO users (id, display_name, protocol_version)
         VALUES ($id, 'wp-apply-test-user', '3.0.0')`,
        { id: userId },
      );
      // 002 retired the attributes JSONB — seed without it (test-schema drift
      // repair, 42b drive-by).
      await client.query(
        `INSERT INTO exercises (id, name, exercise_type, difficulty, tutorials)
         VALUES ($id, $name, 'resistance', 'intermediate', '{}'::jsonb)`,
        { id: EXERCISE_ID, name: `wp-apply-bench-${NOW}` },
      );
    }
  });

  it("scope=days without a week framework is refused (framework first)", async (t) => {
    if (!pgAvailable) return t.skip("PG unreachable");
    await assert.rejects(
      () =>
        repo.applyWeeklyPlan({
          user_id: userId,
          payload: {
            scope: "days",
            week_id: WEEK_ID,
            dates: [TODAY],
            entries: [
              {
                entry_date: TODAY,
                exercise_id: EXERCISE_ID,
                target_sets: 3,
                target_load: { type: "rpe", min: 6, max: 7 },
                status: "planned",
                sort_order: 0,
              },
            ],
          },
        }),
      (err: unknown) => err instanceof ServiceError,
    );
  });

  it("scope=week creates the framework atomically (first confirm)", async (t) => {
    if (!pgAvailable) return t.skip("PG unreachable");
    const result = await repo.applyWeeklyPlan({
      user_id: userId,
      payload: weekPayload({ week_id: WEEK_ID }),
    });
    assert.strictEqual(result.plan.week_id, WEEK_ID);
    assert.strictEqual(result.plan.split, "upper_lower");
    assert.strictEqual(result.entries.length, 1);
    assert.strictEqual(result.entries[0]?.exercise_id, EXERCISE_ID);
  });

  it("scope=week REPLACES the whole week on re-confirm (整周重算)", async (t) => {
    if (!pgAvailable) return t.skip("PG unreachable");
    const result = await repo.applyWeeklyPlan({
      user_id: userId,
      payload: weekPayload({
        week_id: WEEK_ID,
        split: "full_body",
        entries: [
          {
            entry_date: TODAY,
            exercise_id: EXERCISE_ID,
            target_sets: 5,
            target_load: { type: "rpe", min: 7, max: 8 },
            status: "planned",
            sort_order: 0,
          },
        ],
      }),
    });
    assert.strictEqual(result.plan.split, "full_body", "split updated");
    assert.strictEqual(result.entries.length, 1, "old entries replaced");
    assert.strictEqual(result.entries[0]?.target_sets, 5, "new entry in place");
  });

  it("scope=days covers ONLY the listed dates (雨天改居家单日)", async (t) => {
    if (!pgAvailable) return t.skip("PG unreachable");
    // 先把另一天也排上（scope=week 整周重排为两天）
    const week = await repo.applyWeeklyPlan({
      user_id: userId,
      payload: weekPayload({
        week_id: WEEK_ID,
        entries: [
          {
            entry_date: TODAY,
            exercise_id: EXERCISE_ID,
            target_sets: 4,
            target_load: { type: "rpe", min: 7, max: 8 },
            status: "planned",
            sort_order: 0,
          },
          {
            entry_date: "2099-01-01", // 「另一天」：today-API 按用户+日期直读，
            // 契约对 scope=week 的日期不设周界（与 CreateWeeklyPlanInput 同口径）
            exercise_id: EXERCISE_ID,
            target_sets: 3,
            target_load: { type: "rpe", min: 6, max: 7 },
            status: "planned",
            sort_order: 0,
          },
        ],
      }),
    });
    assert.strictEqual(week.entries.length, 2);

    // 只覆盖 TODAY：另一天的条目保留
    const result = await repo.applyWeeklyPlan({
      user_id: userId,
      payload: {
        scope: "days",
        week_id: WEEK_ID,
        dates: [TODAY],
        entries: [
          {
            entry_date: TODAY,
            exercise_id: EXERCISE_ID,
            target_sets: 2,
            target_load: { type: "rpe", min: 5, max: 6 },
            status: "planned",
            sort_order: 0,
          },
        ],
      },
    });
    const todayEntry = result.entries.find((e) => e.entry_date === TODAY);
    const otherEntry = result.entries.find(
      (e) => e.entry_date === "2099-01-01",
    );
    assert.strictEqual(todayEntry?.target_sets, 2, "covered day replaced");
    assert.strictEqual(otherEntry?.target_sets, 3, "other day untouched");
  });

  it("contract-invalid entries are rejected before any write (Zod 红线)", async (t) => {
    if (!pgAvailable) return t.skip("PG unreachable");
    await assert.rejects(
      () =>
        repo.applyWeeklyPlan({
          user_id: userId,
          payload: weekPayload({
            week_id: WEEK_ID,
            entries: [
              {
                entry_date: TODAY,
                exercise_id: EXERCISE_ID,
                target_sets: 3,
                // rpe max=11 违反 TargetLoadSchema superRefine（rpe ∈ [0,10]）
                target_load: { type: "rpe", min: 7, max: 11 },
                status: "planned",
                sort_order: 0,
              },
            ],
          }),
        }),
      // Zod 契约校验走 validateOrThrow → ValidationError（框架级拒绝才是
      // ServiceError，见上例；此断言曾因 before-hook 漂移被掩盖，42b 修复）。
      // 按 name 断言：shared/contracts（tsx 源码态）与 shared/dist（repo 直引）
      // 是两个类实例，instanceof 不可靠。
      (err: unknown) => (err as Error).name === "ValidationError",
    );
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
