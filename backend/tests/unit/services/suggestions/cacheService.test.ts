/**
 * Unit tests for SuggestionCacheService（建议参数缓存，issue #39 B6）。
 *
 * 钉死的行为（fake Repository，零 DB / 零 LLM）：
 * - 指纹确定性：同一 DB 快照 → 同一指纹；计划/锚点变化 → 指纹变化
 * - 整批重算落库：全动作库行数、行内容过 CachedSuggestionSchema 等价校验
 * - B6 gate d：当日已排 3 个胸动作 → 第 4 个胸动作（不在计划内）容量严格
 *   低于第 1 个（同 est_1rm 锚点下的可比基线，2.5kg 取整网格仍单调）
 * - GET 对账语义：指纹匹配 matched=true 不重算；不匹配 matched=false 回全量
 *   （缓存新鲜时不重复计算，缺失时同步重算落库）
 * - Agent 精调只作用于计划涉及动作（hybrid），Agent 故障降级 formula
 */

import { describe, it, expect, afterEach } from "@jest/globals";
import type {
  AdjustmentIntent,
  ExerciseLibraryItem,
  ProfileDynamic,
  ProfileStatic,
} from "shared/contracts";

import {
  SuggestionCacheService,
  type SuggestionCacheReadPortRow,
  type SuggestionCacheWritePortRow,
  type SuggestionCacheUserRepoPort,
} from "../../../../src/services/suggestions/suggestionCacheService.js";
import type { PlanContextEntry } from "../../../../src/services/suggestions/suggestionPlanContext.js";
import type { SuggestionAgentPort } from "../../../../src/services/suggestions/suggestionService.js";

// ============================================================================
// Fake repos
// ============================================================================

const USER = "22222222-2222-4222-8222-222222222222";

/** 4 个胸动作（resistance，同一 est_1rm 锚点 → 数值可比）+ 1 个有氧 */
function buildLibrary(): ExerciseLibraryItem[] {
  return [
    lib("e1", "Bench Press", "resistance", ["chest"]),
    lib("e2", "Incline Press", "resistance", ["chest"]),
    lib("e3", "Cable Fly", "resistance", ["chest"]),
    lib("e4", "Dumbbell Fly", "resistance", ["chest"]),
    lib("run1", "Treadmill Run", "cardio", []),
  ];
}

function lib(
  id: string,
  name: string,
  type: string,
  muscles: string[],
): ExerciseLibraryItem {
  return {
    id,
    name,
    exercise_type: type,
    primary_muscles: muscles,
  } as unknown as ExerciseLibraryItem;
}

function planEntry(
  id: string,
  name: string,
  sortOrder: number,
): PlanContextEntry {
  return {
    exercise_id: id,
    exercise_name: name,
    exercise_type: "resistance",
    primary_muscles: ["chest"],
    target_sets: 3,
    sort_order: sortOrder,
  };
}

function makeUserRepo(
  anchors: Record<string, unknown> | null,
): SuggestionCacheUserRepoPort {
  const profileStatic = {
    preferences: { goal: "muscle_gain" },
    weight: 75,
  } as unknown as ProfileStatic;
  const profileDynamic = (anchors
    ? { load_anchors: anchors }
    : null) as unknown as ProfileDynamic | null;
  return {
    getProfileStatic: async () => profileStatic,
    getProfileDynamic: async () => profileDynamic,
    getHistorySummary: async () => null,
  };
}

/** 同一 est_1rm=120kg 锚点盖满全部负重动作 → 建议重量只差计划上下文因子 */
function uniformAnchors(library: ExerciseLibraryItem[], at: number) {
  const anchors: Record<string, unknown> = {};
  for (const item of library) {
    if (item.exercise_type === "resistance") {
      anchors[item.name] = {
        best_weight: 100,
        best_reps: 5,
        est_1rm: 120,
        last_updated: at,
      };
    }
  }
  return anchors;
}

function makeCacheRepo() {
  const store = new Map<string, SuggestionCacheWritePortRow[]>();
  return {
    store,
    replaceCalls: 0,
    async replaceUserCache(
      userId: string,
      fingerprint: string,
      rows: readonly SuggestionCacheWritePortRow[],
    ) {
      store.set(`${userId}:${fingerprint}`, [...rows]);
      store.set(userId, [...rows]); // 最新一批（无论指纹）
      this.replaceCalls += 1;
      return rows.length;
    },
    async getByUserAndFingerprint(userId: string, fingerprint: string) {
      const rows = store.get(`${userId}:${fingerprint}`) ?? [];
      return rows.map((r): SuggestionCacheReadPortRow => ({
        exercise_name: r.exercise_name,
        exercise_type: r.exercise_type,
        baseline_rpe: r.baseline_rpe,
        values: r.values,
        profile: r.profile,
        adjustment: r.adjustment,
        plan_context: r.plan_context,
        source: r.source,
        generated_at: 1_700_000_000_000,
      }));
    },
  };
}

function makeService(overrides?: {
  planEntries?: PlanContextEntry[];
  anchorsAt?: number | null;
  agent?: SuggestionAgentPort | null;
  library?: ExerciseLibraryItem[];
}) {
  const library = overrides?.library ?? buildLibrary();
  const anchorsAt =
    overrides?.anchorsAt === undefined
      ? 1_700_000_000_000
      : overrides.anchorsAt;
  const anchors =
    anchorsAt === null ? null : uniformAnchors(library, anchorsAt);
  const cacheRepo = makeCacheRepo();
  const service = new SuggestionCacheService(
    makeUserRepo(anchors),
    {
      getTodayMuscleContextEntries: async () => overrides?.planEntries ?? [],
    },
    { getItemsVisibleToUser: async () => library },
    cacheRepo,
    overrides?.agent === undefined ? null : overrides.agent,
  );
  return { service, cacheRepo, library };
}

// ============================================================================
// Tests
// ============================================================================

describe("SuggestionCacheService", () => {
  afterEach(() => {
    delete process.env.SUGGESTION_AGENT_MODE;
  });

  it("fingerprint is deterministic for the same snapshot and shifts on plan/profile change", async () => {
    const a = makeService({ planEntries: [] });
    const b = makeService({ planEntries: [] });
    expect(await a.service.computeFingerprint(USER)).toBe(
      await b.service.computeFingerprint(USER),
    );

    const withPlan = makeService({
      planEntries: [planEntry("e1", "Bench Press", 0)],
    });
    expect(await withPlan.service.computeFingerprint(USER)).not.toBe(
      await a.service.computeFingerprint(USER),
    );

    const newAnchorTime = makeService({ anchorsAt: 1_700_000_001_000 });
    expect(await newAnchorTime.service.computeFingerprint(USER)).not.toBe(
      await a.service.computeFingerprint(USER),
    );
  });

  it("recompute writes the full library batch with plan-context factors", async () => {
    const { service, cacheRepo, library } = makeService({
      planEntries: [
        planEntry("e1", "Bench Press", 0),
        planEntry("e2", "Incline Press", 1),
        planEntry("e3", "Cable Fly", 2),
      ],
    });
    const { fingerprint, rowCount } = await service.recomputeUserCache(USER);
    expect(rowCount).toBe(library.length);
    expect(cacheRepo.replaceCalls).toBe(1);

    const rows = cacheRepo.store.get(USER)!;
    expect(rows).toHaveLength(library.length);
    const byName = new Map(rows.map((r) => [r.exercise_name, r]));
    const bench = byName.get("Bench Press")!;
    const fourth = byName.get("Dumbbell Fly")!; // 不在计划内 → prior=3

    // B6 gate d：第 4 个胸动作容量严格低于第 1 个（同锚点可比基线）
    expect(bench.plan_context.factor).toBe(1);
    expect(bench.plan_context.prior_same_muscle_exercises).toBe(0);
    expect(fourth.plan_context.factor).toBeCloseTo(0.85, 10);
    expect(fourth.plan_context.prior_same_muscle_exercises).toBe(3);
    expect(fourth.values.weight!).toBeLessThan(bench.values.weight!);
    expect(fourth.values.weight!).toBeGreaterThan(0);

    // 计划内顺序单调降载：e1 > e2 > e3
    const w1 = bench.values.weight!;
    const w2 = byName.get("Incline Press")!.values.weight!;
    const w3 = byName.get("Cable Fly")!.values.weight!;
    expect(w2).toBeLessThan(w1);
    expect(w3).toBeLessThan(w2);

    // 有氧（无主肌群）不调制 + 全部行 formula（agent 关）
    expect(byName.get("Treadmill Run")!.plan_context.factor).toBe(1);
    expect(rows.every((r) => r.source === "formula")).toBe(true);
    // 落库行指纹一致（整批同指纹）
    expect(rows.every((r) => r.baseline_rpe === 7)).toBe(true);
    expect(fingerprint).toHaveLength(8);
  });

  it("GET reconciliation: matching fingerprint returns cache without recompute", async () => {
    const { service, cacheRepo } = makeService();
    const first = await service.getCache(USER); // 缓存缺失 → 同步重算
    expect(first.matched).toBe(false);
    expect(first.suggestions).toHaveLength(5);
    expect(cacheRepo.replaceCalls).toBe(1);

    const second = await service.getCache(USER, first.fingerprint);
    expect(second.matched).toBe(true);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(cacheRepo.replaceCalls).toBe(1); // 未重复计算
    expect(second.suggestions).toHaveLength(first.suggestions.length);
  });

  it("GET reconciliation: stale client fingerprint returns full cache as matched=false", async () => {
    const { service, cacheRepo } = makeService();
    await service.getCache(USER); // 预热
    const stale = await service.getCache(USER, "deadbeef");
    expect(stale.matched).toBe(false);
    expect(stale.suggestions).toHaveLength(5);
    expect(cacheRepo.replaceCalls).toBe(1); // 缓存仍新鲜 → 不重算
  });

  it("GET without fingerprint on a cold cache recomputes synchronously", async () => {
    const { service, cacheRepo } = makeService({
      planEntries: [planEntry("e1", "Bench Press", 0)],
    });
    const result = await service.getCache(USER);
    expect(result.matched).toBe(false);
    expect(cacheRepo.replaceCalls).toBe(1);
    expect(
      result.suggestions.every(
        (s) => s.context_fingerprint === result.fingerprint,
      ),
    ).toBe(true);
    // 计划上下文元数据随响应下发（前端 derive 校验用）
    expect(result.suggestions[0].plan_context).toBeDefined();
  });

  it("agent tunes only plan-involved exercises in hybrid mode; failures degrade to formula", async () => {
    process.env.SUGGESTION_AGENT_MODE = "hybrid";
    const intent: AdjustmentIntent = {
      exercise_name: "Bench Press",
      actions: [{ field: "weight", mode: "multiply", value: 1.1 }],
      reason: "锚点新鲜，轻度上探",
    };
    const calls: unknown[] = [];
    const agent: SuggestionAgentPort = {
      adjust: async (input) => {
        calls.push(input);
        return [intent];
      },
    };
    const { service, cacheRepo } = makeService({
      planEntries: [planEntry("e1", "Bench Press", 0)],
      agent,
    });
    const { rowCount } = await service.recomputeUserCache(USER);
    expect(rowCount).toBe(5);
    expect(calls).toHaveLength(1);
    // Agent 只看到计划涉及的动作（1/5）
    const tunedInput = calls[0] as { items: { name: string }[] };
    expect(tunedInput.items.map((i) => i.name)).toEqual(["Bench Press"]);

    const rows = cacheRepo.store.get(USER)!;
    const byName = new Map(rows.map((r) => [r.exercise_name, r]));
    expect(byName.get("Bench Press")!.source).toBe("hybrid");
    expect(byName.get("Bench Press")!.adjustment).toEqual(intent);
    expect(byName.get("Dumbbell Fly")!.source).toBe("formula");
    expect(byName.get("Dumbbell Fly")!.adjustment).toBeNull();
  });

  it("agent failure degrades every row to formula (cache path never throws)", async () => {
    process.env.SUGGESTION_AGENT_MODE = "hybrid";
    const agent: SuggestionAgentPort = {
      adjust: async () => {
        throw new Error("LLM 5xx");
      },
    };
    const { service, cacheRepo } = makeService({
      planEntries: [planEntry("e1", "Bench Press", 0)],
      agent,
    });
    const { rowCount } = await service.recomputeUserCache(USER);
    expect(rowCount).toBe(5);
    expect(
      cacheRepo.store.get(USER)!.every((r) => r.source === "formula"),
    ).toBe(true);
  });
});
