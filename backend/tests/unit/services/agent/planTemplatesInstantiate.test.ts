/**
 * instantiateWeeklyPlan 内核单测（#151 S3 实例化批）。
 *
 * 覆盖 spec §5.2 五个参数化维度的确定性验证（时钟注入 → 全部断言可复现）：
 *  1. 日期对齐：week_offset → week_id（ISO 年界边界）→ 周一 → entry_date
 *  2. 天数裁剪：rank 升序取前 K（T4 5 练去腿容量日）；越界回落 + 记录
 *  3. 容量档位：tier 剂量查表（组数/重量锚随档切换）
 *  4. 器械替换 + 伤病过滤：主选→变体→删槽；伤替优先于器械；中文别名归一
 *  5. 周次递进：progressionPolicy 步进链（linear/double/女性上肢步进）
 * 外加：RPE 爬坡 0.5 步进、duration 槽位双面（展示 duration / 落库无 sets）、
 * apply payload 落库契约（WeeklyPlanApplyPayloadSchema 独立复验）、参数负例。
 *
 * Runner: jest（tests/unit/**）。真实 PG 零 miss 对拍在 tsx live 测试。
 */
import { describe, expect, it } from "@jest/globals";

import { WeeklyPlanApplyPayloadSchema } from "shared/contracts";

import {
  __resetTemplateCacheForTests,
  instantiateWeeklyPlan,
  type WeeklyPlanInstantiation,
} from "../../../../src/services/agent/planTemplates.js";

/** 固定时钟：2026-10-08 周四（本周 = 2026-W41，周一 2026-10-05）。 */
const NOW_W41 = () => new Date("2026-10-08T10:00:00Z");
/** 固定时钟：2026-01-01 周四（本周 = 2026-W01，周一 2025-12-29——ISO 年界）。 */
const NOW_W01 = () => new Date("2026-01-01T10:00:00Z");

const t1 = (params: unknown = {}, now = NOW_W41) =>
  instantiateWeeklyPlan("t1-novice-fullbody-home", params, now);

const findExercise = (r: WeeklyPlanInstantiation, name: string) =>
  r.card.days.flatMap((d) => d.exercises).find((e) => e.name === name);

const findEntry = (r: WeeklyPlanInstantiation, id: string, date: string) =>
  r.card.apply!.entries.find(
    (e) => e.exercise_id === id && e.entry_date === date,
  );

beforeEach(() => {
  __resetTemplateCacheForTests();
});

// ---------------------------------------------------------------------------
// 1. 日期对齐（Agent 零日历算术——全部由内核推导）
// ---------------------------------------------------------------------------

describe("instantiateWeeklyPlan — 日期对齐", () => {
  it("周四锚定本周：2026-10-08 → W41，训练日落在周一/三/五", () => {
    const r = t1();
    expect(r.week_id).toBe("2026-W41");
    expect(r.card.days).toHaveLength(7);
    expect(r.card.days[0].entry_date).toBe("2026-10-05"); // 周一
    const training = r.card.days.filter((d) => !d.rest);
    expect(training.map((d) => d.entry_date)).toEqual([
      "2026-10-05",
      "2026-10-07",
      "2026-10-09",
    ]);
  });

  it("week_offset=1 → W42；周一跨旬正确", () => {
    const r = t1({ week_offset: 1 });
    expect(r.week_id).toBe("2026-W42");
    expect(r.card.days[0].entry_date).toBe("2026-10-12");
  });

  it("ISO 年界：2026-01-01 属 2026-W01，周一在 2025-12-29", () => {
    const r = t1({}, NOW_W01);
    expect(r.week_id).toBe("2026-W01");
    expect(r.card.days[0].entry_date).toBe("2025-12-29");
    // W01 的周日 2026-01-04 仍在本周内
    expect(r.card.days[6].entry_date).toBe("2026-01-04");
  });

  it("整周卡覆盖周一至周日（休息日 rest=true 占位）", () => {
    const r = t1({ days_per_week: 2 });
    expect(r.card.days.filter((d) => d.rest)).toHaveLength(5);
    for (const rest of r.card.days.filter((d) => d.rest)) {
      expect(rest.exercises).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. 天数裁剪（rank 升序取前 K）
// ---------------------------------------------------------------------------

describe("instantiateWeeklyPlan — 天数裁剪", () => {
  it("T4 5 练：rank6「腿 · 容量」被省略且记录 adjustment", () => {
    const r = instantiateWeeklyPlan(
      "t4-int-ppl",
      { days_per_week: 5 },
      NOW_W41,
    );
    expect(r.card.days.filter((d) => !d.rest)).toHaveLength(5);
    expect(
      r.adjustments.some((a) => a.includes("省略") && a.includes("腿 · 容量")),
    ).toBe(true);
    // 剩余训练日：推/拉/腿力量 + 推容量 + 拉容量（offset 0,1,2,4,5）
    expect(r.card.days.filter((d) => !d.rest).map((d) => d.entry_date)).toEqual(
      ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-09", "2026-10-10"],
    );
  });

  it("越界回落：T1 请求 7 练 → 回落 3 练并记录", () => {
    const r = t1({ days_per_week: 7 });
    expect(r.days_per_week).toBe(3);
    expect(r.card.days.filter((d) => !d.rest)).toHaveLength(3);
    expect(r.adjustments.some((a) => a.includes("回落为 3"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. 容量档位（tier 剂量查表）
// ---------------------------------------------------------------------------

describe("instantiateWeeklyPlan — tier 查表", () => {
  const GOBLET_ID = "a3vRrJ9qIk1gQvR8xrmDg"; // 哑铃高脚杯深蹲

  it("缺省 = 模板 tier_default（T1 → novice：3 组 × 10 次 × 10kg）", () => {
    const r = t1();
    expect(r.tier).toBe("novice");
    const goblet = findExercise(r, "哑铃高脚杯深蹲")!;
    expect(goblet.sets).toHaveLength(3);
    expect(goblet.sets[0]).toMatchObject({ weight: 10, reps: 10 });
  });

  it("显式 intermediate：4 组 × 18kg", () => {
    const r = t1({ tier: "intermediate" });
    expect(r.tier).toBe("intermediate");
    const goblet = findExercise(r, "哑铃高脚杯深蹲")!;
    expect(goblet.sets).toHaveLength(4);
    expect(goblet.sets[0].weight).toBe(18);
    // T3 tier_default=intermediate（不传即进阶档）
    const t3 = instantiateWeeklyPlan("t3-int-upper-lower", {}, NOW_W41);
    expect(t3.tier).toBe("intermediate");
    expect(findExercise(t3, "杠铃后深蹲")!.sets[0].weight).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// 4. 器械替换 + 伤病过滤
// ---------------------------------------------------------------------------

describe("instantiateWeeklyPlan — 器械/伤病槽位解析", () => {
  it("器械约束：哑铃不可用 → 徒手深蹲（变体无重量锚 → 不处方重量）", () => {
    const r = t1({ equipment: ["bodyweight"] });
    const squat = findExercise(r, "徒手深蹲")!;
    expect(squat.exercise_id).toBe("a3vB-c8QqleJZMyWpmB3z");
    expect(squat.sets[0].weight).toBeUndefined();
    expect(squat.sets[0].reps).toBe(10);
  });

  it("器械约束无替代 → 删槽并记录（哑铃硬拉）", () => {
    const r = t1({ equipment: ["bodyweight"] });
    expect(findExercise(r, "哑铃硬拉")).toBeUndefined();
    expect(
      r.adjustments.some(
        (a) => a.includes("哑铃硬拉") && a.includes("无可用替代，已删除"),
      ),
    ).toBe(true);
  });

  it("band 热身不在器械面 → 热身槽删减（T3 上肢日）", () => {
    const r = instantiateWeeklyPlan(
      "t3-int-upper-lower",
      { equipment: ["barbell", "bodyweight", "machine", "cable"] },
      NOW_W41,
    );
    expect(findExercise(r, "弹力带肩部热身拉伸")).toBeUndefined();
    expect(r.adjustments.some((a) => a.includes("弹力带肩部热身拉伸"))).toBe(
      true,
    );
  });

  it("伤病伤替：膝 → 高脚杯深蹲换臀桥（id 对拍）", () => {
    const r = t1({ active_limitations: ["膝盖"] });
    const sub = r.card.days
      .flatMap((d) => d.exercises)
      .find((e) => e.exercise_id === "a3vf4Tfqw3CHAGc-ND0bv");
    expect(sub).toBeDefined();
    expect(
      r.adjustments.some((a) => a.includes("伤病禁区") && a.includes("臀桥")),
    ).toBe(true);
  });

  it("伤病无替代 → 删槽：肩 → 推类全删", () => {
    const r = t1({ active_limitations: ["shoulder"] });
    expect(findExercise(r, "哑铃仰卧对握推")).toBeUndefined();
    expect(findExercise(r, "坐姿哑铃肩推举")).toBeUndefined();
  });

  it("伤替优先于器械：T3 杠铃俯身划船（下背伤）→ 坐姿绳索划船（cable 在面）", () => {
    const r = instantiateWeeklyPlan(
      "t3-int-upper-lower",
      { active_limitations: ["腰"] },
      NOW_W41,
    );
    const row = r.card.days
      .flatMap((d) => d.exercises)
      .find((e) => e.exercise_id === "a3vY7aqLWVNg-92S37kMv");
    expect(row).toBeDefined();
    expect(
      r.adjustments.some((a) => a.includes("下背") || a.includes("lower_back")),
    ).toBe(true);
  });

  it("未识别部位：不影响过滤，只记录", () => {
    const r = t1({ active_limitations: ["颈椎"] });
    expect(
      r.adjustments.some((a) => a.includes("颈椎") && a.includes("未命中")),
    ).toBe(true);
    expect(findExercise(r, "哑铃高脚杯深蹲")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 5. 周次递进（progressionPolicy 步进链——算术全在程序层）
// ---------------------------------------------------------------------------

describe("instantiateWeeklyPlan — 周次递进", () => {
  it("novice 线性：10kg 下肢 +5%/周（W+1 → 10.5；W+2 → 11）", () => {
    expect(t1({ week_offset: 1 }).tier).toBe("novice");
    const w1 = findExercise(t1({ week_offset: 1 }), "哑铃高脚杯深蹲")!;
    expect(w1.sets[0].weight).toBe(10.5);
    const w2 = findExercise(t1({ week_offset: 2 }), "哑铃高脚杯深蹲")!;
    expect(w2.sets[0].weight).toBe(11);
    expect(t1().progression.strategy).toBe("linear"); // 训龄代表值 4 个月
  });

  it("intermediate 双重递进：18kg 下肢 +5（W+1 → 23）", () => {
    const r = t1({ tier: "intermediate", week_offset: 1 });
    expect(r.progression.strategy).toBe("double_progression");
    expect(findExercise(r, "哑铃高脚杯深蹲")!.sets[0].weight).toBe(23);
  });

  it("女性上肢步进：T3 卧推 50 → 51.25", () => {
    const r = instantiateWeeklyPlan(
      "t3-int-upper-lower",
      { week_offset: 1, sex: "female" },
      NOW_W41,
    );
    expect(findExercise(r, "平板杠铃卧推")!.sets[0].weight).toBe(51.25);
  });

  it("训练年龄入参可切策略：intermediate + 3 个月 → linear", () => {
    const r = instantiateWeeklyPlan(
      "t3-int-upper-lower",
      { training_age_months: 3 },
      NOW_W41,
    );
    expect(r.progression.strategy).toBe("linear");
  });

  it("自重/拉伸槽位不参与递进（无重量锚 → 组内无 weight）", () => {
    const r = instantiateWeeklyPlan(
      "t3-int-upper-lower",
      { week_offset: 4 },
      NOW_W41,
    );
    const chin = findExercise(r, "引体向上（正手/反手）")!;
    expect(chin.sets[0].weight).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 6. 逐组展开细节（RPE 爬坡 / duration 双面语义）
// ---------------------------------------------------------------------------

describe("instantiateWeeklyPlan — 逐组展开", () => {
  it("RPE 线性爬坡 0.5 步进：novice 3 组 [6, 7, 7.5]", () => {
    const r = t1();
    const entry = findEntry(r, "a3vRrJ9qIk1gQvR8xrmDg", "2026-10-05")!;
    expect(entry.sets!.map((s) => s.rpe)).toEqual([6, 7, 7.5]);
  });

  it("intermediate 4 组 [7, 7.5, 8, 8.5]", () => {
    const r = t1({ tier: "intermediate" });
    const entry = findEntry(r, "a3vRrJ9qIk1gQvR8xrmDg", "2026-10-05")!;
    expect(entry.sets!.map((s) => s.rpe)).toEqual([7, 7.5, 8, 8.5]);
  });

  it("duration 槽位：展示面 duration=40，落库面不带逐组 sets（reps 语义不适用）", () => {
    const r = t1();
    const plank = findExercise(r, "正面平板支撑")!;
    expect(plank.sets[0].duration).toBe(40);
    expect(plank.sets[0].weight).toBeUndefined();
    const plankEntry = r.card.apply!.entries.find(
      (e) => e.exercise_id === "a3vQyEYYuUxg3Q0palN2h",
    )!;
    expect(plankEntry.sets).toBeUndefined();
    expect(plankEntry.target_sets).toBe(3);
    expect(plankEntry.category).toBe("main");
  });

  it("热身段 set_type=warmup、正式段 working；category 三段齐全", () => {
    const r = t1();
    const day1 = r.card.days[0];
    const cats = day1.exercises.map((e) => e.category);
    expect(cats).toEqual([
      "warmup",
      "warmup",
      "main",
      "main",
      "main",
      "cooldown",
      "cooldown",
    ]);
    const warm = day1.exercises[0];
    expect(warm.sets[0].set_type).toBe("warmup");
    expect(day1.exercises[2].sets[0].set_type).toBe("working");
  });
});

// ---------------------------------------------------------------------------
// 7. 落库契约（apply payload 独立复验 + 结构不变量）
// ---------------------------------------------------------------------------

describe("instantiateWeeklyPlan — apply 落库面", () => {
  it("apply payload 过 WeeklyPlanApplyPayloadSchema（独立复验，非内核自检独断）", () => {
    for (const [key, params] of [
      ["t1-novice-fullbody-home", {}],
      ["t2-novice-fullbody-gym", { days_per_week: 2 }],
      ["t3-int-upper-lower", { active_limitations: ["膝", "肩", "腰"] }],
      [
        "t4-int-ppl",
        { days_per_week: 5, equipment: ["barbell", "bodyweight"] },
      ],
    ] as const) {
      const r = instantiateWeeklyPlan(key, params, NOW_W41);
      const parsed = WeeklyPlanApplyPayloadSchema.safeParse(r.card.apply);
      expect({ key, ok: parsed.success, issues: parsed.error?.issues }).toEqual(
        {
          key,
          ok: true,
          issues: undefined,
        },
      );
    }
  });

  it("条目日期全部落在本周一至周日；同日 sort_order 从 0 连续", () => {
    const r = t1();
    const week = new Set(r.card.days.map((d) => d.entry_date));
    for (const e of r.card.apply!.entries) {
      expect(week.has(e.entry_date)).toBe(true);
    }
    for (const date of new Set(
      r.card.apply!.entries.map((e) => e.entry_date),
    )) {
      const orders = r.card
        .apply!.entries.filter((e) => e.entry_date === date)
        .map((e) => e.sort_order);
      expect(orders).toEqual(orders.map((_, i) => i));
    }
  });

  it("逐组 sets 与 target_sets 对齐（契约 superRefine 同款约束）", () => {
    const r = t1();
    for (const e of r.card.apply!.entries) {
      if (e.sets) expect(e.sets).toHaveLength(e.target_sets);
    }
  });

  it("200 条上限护栏：T4 六练全展开远低于上限", () => {
    const r = instantiateWeeklyPlan("t4-int-ppl", {}, NOW_W41);
    expect(r.card.apply!.entries.length).toBeLessThan(200);
  });
});

// ---------------------------------------------------------------------------
// 8. 参数负例（显式抛错，不静默）
// ---------------------------------------------------------------------------

describe("instantiateWeeklyPlan — 负例", () => {
  it("未知模板键 → 抛错（携带可用键清单）", () => {
    expect(() => instantiateWeeklyPlan("t9-nope", {}, NOW_W41)).toThrow(
      /t1-novice-fullbody-home/,
    );
  });

  it("未知参数字段（strict）→ 抛错", () => {
    expect(() => t1({ week_offst: 1 })).toThrow();
  });

  it("器械值越枚举 → 抛错", () => {
    expect(() => t1({ equipment: ["smith-machine"] })).toThrow();
  });

  it("week_offset 越界（13）→ 抛错", () => {
    expect(() => t1({ week_offset: 13 })).toThrow();
  });
});
