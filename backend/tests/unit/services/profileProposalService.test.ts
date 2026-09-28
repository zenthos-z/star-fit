/**
 * profileProposalService tests (画像提案确定性写入 — B5 / issue #37).
 *
 * 覆盖（内存 fake repo，无 PG 依赖 — 数据路径不 mock 断言，只注入仓库实现）：
 *  - load_anchors 按_key合并：未提及的锚点保留，提及的覆盖
 *  - active_limitations 追加 + 服务端盖章（expire_at/logged_at/auto_heal）+
 *    同 part 同 severity 去重（重试幂等）
 *  - recovery_state 整体替换 + last_assessed 盖章（缺省时）
 *  - memories 按_key合并
 *  - 单请求多字段 → 单次合并写；同字段多条提案逐条叠加
 *  - value 形状非法 → ProposalValidationError（整体拒绝，不动库）
 *  - 空画像（readProfileDynamic → null）从空基线合并
 */

import { describe, it, expect } from "@jest/globals";

import {
  applyProfileProposals,
  ProposalValidationError,
  type ProfileProposalRepo,
} from "../../../src/services/profileProposalService.js";

// ---------------------------------------------------------------------------
// Fake repo：内存实现（结构子集：readProfileDynamic / mergeProfileDynamic）
// ---------------------------------------------------------------------------

function makeFakeRepo(initial: Record<string, unknown> | null = null) {
  const state: { data: Record<string, unknown> | null; writes: number } = {
    data: initial,
    writes: 0,
  };
  const repo: ProfileProposalRepo = {
    async readProfileDynamic() {
      return state.data;
    },
    async mergeProfileDynamic(_userId: string, data: Record<string, unknown>) {
      state.writes += 1;
      state.data = { ...(state.data ?? {}), ...data };
    },
  };
  return { repo, state };
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

describe("applyProfileProposals（画像提案确定性写入）", () => {
  it("load_anchors 按 key 合并：未提及的锚点保留，提及的覆盖", async () => {
    const { repo, state } = makeFakeRepo({
      load_anchors: {
        bench_press: { best_weight: 60 },
        squat: { best_weight: 100 },
      },
    });
    const res = await applyProfileProposals(repo, "u1", {
      proposals: [
        {
          field: "load_anchors",
          value: { bench_press: { best_weight: 65, best_reps: 8 } },
        },
      ],
    });
    expect(res.ok).toBe(true);
    expect(res.applied_fields).toEqual(["load_anchors"]);
    const anchors = state.data!.load_anchors as Record<string, unknown>;
    expect(anchors.bench_press).toEqual({ best_weight: 65, best_reps: 8 });
    expect(anchors.squat).toEqual({ best_weight: 100 }); // 未提及，保留
  });

  it("active_limitations 追加 + 服务端盖章（expire_at/logged_at/auto_heal）", async () => {
    const { repo, state } = makeFakeRepo({
      active_limitations: [{ part: "left_knee", severity: 3 }],
    });
    await applyProfileProposals(repo, "u1", {
      proposals: [
        {
          field: "active_limitations",
          value: [{ part: "right_shoulder", severity: 4 }],
        },
      ],
    });
    const list = state.data!.active_limitations as Array<
      Record<string, unknown>
    >;
    expect(list).toHaveLength(2);
    expect(list[0]).toEqual({ part: "left_knee", severity: 3 }); // 原有条目不动
    const added = list[1];
    expect(added.part).toBe("right_shoulder");
    expect(added.severity).toBe(4);
    expect(added.auto_heal).toBe(true);
    expect(String(added.logged_at)).toMatch(ISO_RE);
    expect(String(added.expire_at)).toMatch(ISO_RE);
    // 默认 7 天过期：expire_at 晚于 logged_at
    expect(new Date(String(added.expire_at)).getTime()).toBeGreaterThan(
      new Date(String(added.logged_at)).getTime(),
    );
  });

  it("active_limitations 同 part 同 severity 去重（重试幂等，不重复追加）", async () => {
    const { repo, state } = makeFakeRepo({
      active_limitations: [
        {
          part: "right_shoulder",
          severity: 4,
          logged_at: "2026-09-01T00:00:00Z",
        },
      ],
    });
    await applyProfileProposals(repo, "u1", {
      proposals: [
        {
          field: "active_limitations",
          value: [{ part: "right_shoulder", severity: 4 }],
        },
      ],
    });
    const list = state.data!.active_limitations as unknown[];
    expect(list).toHaveLength(1); // 未重复追加
  });

  it("recovery_state 整体替换 + last_assessed 缺省盖章", async () => {
    const { repo, state } = makeFakeRepo({
      recovery_state: { total_score: 80, cns_fusing: false },
    });
    await applyProfileProposals(repo, "u1", {
      proposals: [
        {
          field: "recovery_state",
          value: { total_score: 55, cns_fusing: true },
        },
      ],
    });
    const rec = state.data!.recovery_state as Record<string, unknown>;
    expect(rec.total_score).toBe(55);
    expect(rec.cns_fusing).toBe(true);
    expect(String(rec.last_assessed)).toMatch(ISO_RE); // 缺省由系统盖章
  });

  it("memories 按 key 合并", async () => {
    const { repo, state } = makeFakeRepo({
      memories: { old_note: "旧记忆" },
    });
    await applyProfileProposals(repo, "u1", {
      proposals: [
        { field: "memories", value: { shoulder: "右肩刺痛，暂避大重量推类" } },
      ],
    });
    expect(state.data!.memories).toEqual({
      old_note: "旧记忆",
      shoulder: "右肩刺痛，暂避大重量推类",
    });
  });

  it("单请求多字段 → applied_fields 去重列出 + 单次合并写；同字段多条逐条叠加", async () => {
    const { repo, state } = makeFakeRepo(null);
    const res = await applyProfileProposals(repo, "u1", {
      proposals: [
        { field: "load_anchors", value: { bench: { best_weight: 40 } } },
        { field: "recovery_state", value: { total_score: 60 } },
        { field: "load_anchors", value: { squat: { best_weight: 80 } } }, // 同字段第二条
      ],
    });
    expect(state.writes).toBe(1); // 原子：一条 UPDATE
    expect(res.applied_fields).toEqual(["load_anchors", "recovery_state"]);
    const anchors = state.data!.load_anchors as Record<string, unknown>;
    expect(Object.keys(anchors).sort()).toEqual(["bench", "squat"]); // 同轮两条都生效
  });

  it("空画像（null）从空基线合并", async () => {
    const { repo, state } = makeFakeRepo(null);
    await applyProfileProposals(repo, "u1", {
      proposals: [{ field: "memories", value: { k: "v" } }],
    });
    expect(state.data!.memories).toEqual({ k: "v" });
  });

  it("value 形状非法 → ProposalValidationError，整体拒绝不动库", async () => {
    const cases: Array<Record<string, unknown>> = [
      { field: "load_anchors", value: {} }, // 空 map
      { field: "load_anchors", value: "not-an-object" },
      { field: "active_limitations", value: [] }, // 空数组
      { field: "active_limitations", value: [{ part: "x", severity: 11 }] }, // 超范围
      { field: "active_limitations", value: [{ severity: 3 }] }, // 缺 part
      { field: "recovery_state", value: { total_score: "high" } }, // 非数值
      { field: "recovery_state", value: {} }, // 缺 total_score
      { field: "memories", value: { k: 123 } }, // 值非字符串
      { field: "memories", value: "text" },
    ];
    for (const proposal of cases) {
      const { repo, state } = makeFakeRepo({ memories: { keep: "x" } });
      await expect(
        applyProfileProposals(repo, "u1", { proposals: [proposal as never] }),
      ).rejects.toThrow(ProposalValidationError);
      expect(state.writes).toBe(0); // 未动库
    }
  });
});
