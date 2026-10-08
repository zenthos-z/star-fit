/**
 * templateTools 接线层单测（#151 S3 接线批）。
 *
 * 覆盖（工具面，内核算术已在 planTemplatesInstantiate.test.ts 全测）：
 *  1. 工具装配：buildTemplateTools 双件 + mcpTools 组装面（十三件）；
 *  2. pick_template：目录载荷（4 条目 + usage 指引）；
 *  3. profile 缺省提取/合并：显式替换 vs 并集 vs 回填清单（纯函数直测）；
 *  4. instantiate_weekly_plan 工具回路：profile 注入路径（loadProfile 桩）、
 *     结构化错误（UNKNOWN_TEMPLATE / INVALID_PARAMS 含未知键点名 / 空参回退）。
 *
 * Runner: jest（tests/unit/**）。真实 PG（ExerciseQuery 全集对拍 + UserRepository
 * profile 读取）在 tsx live 测试 src/services/agent/__tests__/planTemplatesLive.test.ts。
 */
import { describe, expect, it } from "@jest/globals";

import {
  InstantiateWeeklyPlanToolArgsSchema,
  buildTemplateTools,
  extractProfilePlanDefaults,
  makePickTemplateTool,
  mergeProfilePlanDefaults,
  type ProfilePlanDefaults,
  type TemplateToolDeps,
} from "../../../../src/services/agent/templateTools.js";
import {
  TURN_CACHEABLE_TOOLS,
  buildMcpToolsWith,
} from "../../../../src/services/agent/mcpTools.js";

/** 无 DB 依赖位（client 仅在 loadProfile 缺省时触库；测试恒注入桩）。 */
const NO_DB = {} as never;

const TEST_USER = "00000000-0000-0000-0000-0000000000aa";

/** 组装 instantiate 工具（profile 桩注入 + 用户解析直通）。 */
const makeTool = (profile?: { static?: unknown; dynamic?: unknown } | null) => {
  const deps: TemplateToolDeps = {
    client: NO_DB,
    injectedUserId: TEST_USER,
    resolveUserId: (opts) => opts.injectedUserId ?? TEST_USER,
    loadProfile: async () => profile ?? null,
  };
  return buildTemplateTools(deps)[1];
};

/** 调工具 → 解析 JSON（工具面全部 JSON 字符串出参）。 */
const call = async (
  tool: ReturnType<typeof makeTool>,
  args: Record<string, unknown>,
) => JSON.parse(await tool.invoke(args)) as Record<string, unknown>;

// ---------------------------------------------------------------------------
// 1. 装配面
// ---------------------------------------------------------------------------

describe("templateTools — 装配", () => {
  it("buildTemplateTools 返回 pick_template + instantiate_weekly_plan", () => {
    const tools = buildTemplateTools({
      client: NO_DB,
      resolveUserId: () => TEST_USER,
    });
    expect(tools.map((t) => t.name).sort()).toEqual([
      "instantiate_weekly_plan",
      "pick_template",
    ]);
  });

  it("mcpTools 组装面含模板双件（不传 cardChannels = 十三件基础面）", () => {
    const names = buildMcpToolsWith(NO_DB, TEST_USER).map((t) => t.name);
    expect(names).toContain("pick_template");
    expect(names).toContain("instantiate_weekly_plan");
  });

  it("pick_template 进同轮缓存白名单（幂等目录读）", () => {
    expect(TURN_CACHEABLE_TOOLS.has("pick_template")).toBe(true);
    expect(TURN_CACHEABLE_TOOLS.has("instantiate_weekly_plan")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. pick_template 载荷
// ---------------------------------------------------------------------------

describe("pick_template — 目录载荷", () => {
  it("返回 4 条模板目录 + usage 指引（下一步 instantiate → submit）", async () => {
    const payload = JSON.parse(await makePickTemplateTool().invoke({}));
    expect(payload.templates).toHaveLength(4);
    for (const t of payload.templates) {
      expect(t.key).toMatch(/^t\d-/);
      expect(t.split).toMatch(/full_body|upper_lower|push_pull_legs/);
    }
    expect(payload.usage).toContain("instantiate_weekly_plan");
    expect(payload.usage).toContain("submit_weekly_plan");
  });
});

// ---------------------------------------------------------------------------
// 3. profile 缺省提取 + 合并（纯函数）
// ---------------------------------------------------------------------------

describe("extractProfilePlanDefaults — 防御式提取", () => {
  it("标准 profile：器械面/性别/训练龄/周频率全提取", () => {
    const d = extractProfilePlanDefaults(
      {
        basic_info: { gender: "female", training_age: 14 },
        preferences: {
          equipment: ["dumbbell", "bodyweight", "bench"],
          weekly_frequency_days: 3,
        },
      },
      {
        active_limitations: [
          {
            part: "左膝",
            severity: 3,
            expire_at: "2999-12-31T00:00:00.000Z",
            logged_at: "2026-01-01T00:00:00.000Z",
            auto_heal: false,
          },
        ],
      },
    );
    expect(d.equipment).toEqual(["dumbbell", "bodyweight", "bench"]);
    expect(d.sex).toBe("female");
    expect(d.training_age_months).toBe(14);
    expect(d.days_per_week).toBe(3);
    expect(d.active_limitations).toEqual(["左膝"]); // auto_heal:false 不过期
  });

  it("越枚举器械剔除；gender=other 不回填", () => {
    const d = extractProfilePlanDefaults(
      {
        basic_info: { gender: "other" },
        preferences: {
          equipment: ["dumbbell", "smith-machine"],
          weekly_frequency_days: 3,
        },
      },
      null,
    );
    expect(d.equipment).toEqual(["dumbbell"]); // smith-machine 越枚举剔除
    expect(d.sex).toBeUndefined(); // other 不参与步进修正
  });

  it("preferences 整体越契（周频率 9 > max 7）→ static 全不回填（防御式整体弃用）", () => {
    const d = extractProfilePlanDefaults(
      {
        basic_info: { gender: "male" },
        preferences: { equipment: ["dumbbell"], weekly_frequency_days: 9 },
      },
      null,
    );
    expect(d).toEqual({}); // 契约层炸整段 → 建议性输入整体不采信
  });

  it("已过期伤病过滤（auto_heal 窗口过了不参与）", () => {
    const d = extractProfilePlanDefaults(null, {
      active_limitations: [
        {
          part: "膝",
          severity: 2,
          expire_at: "2020-01-01T00:00:00.000Z",
          logged_at: "2019-12-01T00:00:00.000Z",
          auto_heal: true,
        },
      ],
    });
    expect(d.active_limitations).toBeUndefined();
  });

  it("坏形状 profile 不炸（safeParse 吞掉 → 空缺省）", () => {
    expect(extractProfilePlanDefaults("garbage", 42)).toEqual({});
    expect(extractProfilePlanDefaults(null, null)).toEqual({});
  });
});

describe("mergeProfilePlanDefaults — 合并语义", () => {
  const defaults: ProfilePlanDefaults = {
    equipment: ["dumbbell", "bodyweight"],
    active_limitations: ["膝盖"],
    sex: "female",
    training_age_months: 8,
    days_per_week: 3,
  };

  it("缺省回填：全字段落 profile 并记 applied 清单", () => {
    const { params, applied } = mergeProfilePlanDefaults({}, defaults);
    expect(params.equipment).toEqual(["dumbbell", "bodyweight"]);
    expect(params.sex).toBe("female");
    expect(params.training_age_months).toBe(8);
    expect(params.days_per_week).toBe(3);
    expect(params.active_limitations).toEqual(["膝盖"]);
    expect(applied).toHaveLength(5);
  });

  it("显式替换：equipment/sex/训练龄/天数显式值胜出（Agent 可刻意改面）", () => {
    const { params, applied } = mergeProfilePlanDefaults(
      { equipment: ["bodyweight"], sex: "male", days_per_week: 2 },
      defaults,
    );
    expect(params.equipment).toEqual(["bodyweight"]);
    expect(params.sex).toBe("male");
    expect(params.days_per_week).toBe(2);
    expect(applied.some((a) => a.startsWith("equipment"))).toBe(false);
  });

  it("伤病恒并集：Agent 新提及部位追加，[] 不豁免已登记伤病", () => {
    const { params, applied } = mergeProfilePlanDefaults(
      { active_limitations: ["肩"] },
      defaults,
    );
    expect(params.active_limitations).toEqual(["肩", "膝盖"]);
    expect(applied.some((a) => a.includes("active_limitations"))).toBe(true);

    const waived = mergeProfilePlanDefaults(
      { active_limitations: [] },
      defaults,
    );
    expect(waived.params.active_limitations).toEqual(["膝盖"]); // 硬约束不豁免
  });

  it("并集去重（同部位中英文/大小写变体只计一次）", () => {
    const { params } = mergeProfilePlanDefaults(
      { active_limitations: ["KNEE"] },
      { active_limitations: ["knee", "腰"] },
    );
    expect(params.active_limitations).toEqual(["KNEE", "腰"]);
  });

  it("双方皆空 → active_limitations 键删除（内核走模板默认）", () => {
    const { params } = mergeProfilePlanDefaults({}, {});
    expect("active_limitations" in params).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. instantiate_weekly_plan 工具回路（loadProfile 桩注入）
// ---------------------------------------------------------------------------

describe("instantiate_weekly_plan — 工具回路", () => {
  const HOME_PROFILE = {
    static: {
      basic_info: { gender: "male", training_age: 3 },
      preferences: {
        equipment: ["dumbbell", "bodyweight", "bench"],
        weekly_frequency_days: 3,
      },
    },
    dynamic: {
      active_limitations: [
        {
          part: "膝盖",
          severity: 3,
          expire_at: "2999-12-31T00:00:00.000Z",
          logged_at: "2026-01-01T00:00:00.000Z",
          auto_heal: false,
        },
      ],
    },
  };

  it("profile 全回填路径：器械面/性别/训练龄/天数/伤病并入展开", async () => {
    const r = await call(makeTool(HOME_PROFILE), {
      template_key: "t1-novice-fullbody-home",
    });
    expect(r.ok).toBe(true);
    expect(r.tier).toBe("novice");
    expect(r.days_per_week).toBe(3);
    // 膝伤 → 高脚杯深蹲换臀桥（profile 伤病并入的证据位）
    expect(
      (
        r.card as { days: Array<{ exercises: Array<{ exercise_id: string }> }> }
      ).days
        .flatMap((d) => d.exercises.map((e) => e.exercise_id))
        .includes("a3vf4Tfqw3CHAGc-ND0bv"),
    ).toBe(true);
    expect(
      (r.profile_defaults_applied as string[]).some((a) =>
        a.includes("active_limitations"),
      ),
    ).toBe(true);
    expect(
      (r.adjustments as string[]).some((a) => a.includes("伤病禁区")),
    ).toBe(true);
  });

  it("无 profile（新用户）：显式参数独立成立，applied 为空", async () => {
    const r = await call(makeTool(null), {
      template_key: "t1-novice-fullbody-home",
      days_per_week: 2,
    });
    expect(r.ok).toBe(true);
    expect(r.days_per_week).toBe(2);
    expect(r.profile_defaults_applied).toEqual([]);
  });

  it("显式器械面替换 profile（出差自重周）", async () => {
    const r = await call(makeTool(HOME_PROFILE), {
      template_key: "t1-novice-fullbody-home",
      equipment: ["bodyweight"],
    });
    expect(r.ok).toBe(true);
    expect(
      (r.adjustments as string[]).some((a) => a.includes("器械约束")),
    ).toBe(true);
  });

  it("UNKNOWN_TEMPLATE：未知键回注可用键清单", async () => {
    const r = await call(makeTool(null), { template_key: "t9-nope" });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("UNKNOWN_TEMPLATE");
    expect(r.hint).toContain("t1-novice-fullbody-home");
  });

  it("INVALID_PARAMS：越界值回注问题清单（宽松绑定层不拦，严格回路点名）", async () => {
    const r = await call(makeTool(null), {
      template_key: "t1-novice-fullbody-home",
      week_offset: 13,
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("INVALID_PARAMS");
    expect(JSON.stringify(r.errors)).toContain("week_offset");
  });

  it("INVALID_PARAMS：未知键（typo）passthrough 进严格回路被点名", async () => {
    const r = await call(makeTool(null), {
      template_key: "t1-novice-fullbody-home",
      week_offst: 1,
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("INVALID_PARAMS");
    expect(JSON.stringify(r.errors)).toContain("week_offst");
  });

  it("坏枚举值（tier）经严格回路拒绝而非绑定层裸抛", async () => {
    const r = await call(makeTool(null), {
      template_key: "t1-novice-fullbody-home",
      tier: "advanced",
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("INVALID_PARAMS");
  });
});

// ---------------------------------------------------------------------------
// 5. 绑定层 schema（passthrough + 描述可见性）
// ---------------------------------------------------------------------------

describe("InstantiateWeeklyPlanToolArgsSchema — 宽松绑定层", () => {
  it("passthrough：未知键存活（严格回路点名的前提）", () => {
    const parsed = InstantiateWeeklyPlanToolArgsSchema.safeParse({
      template_key: "t1-novice-fullbody-home",
      week_offst: 1,
    });
    expect(parsed.success).toBe(true);
  });

  it("类型面仍硬卡：template_key 缺失 / 非数值 week_offset 拒绝", () => {
    expect(InstantiateWeeklyPlanToolArgsSchema.safeParse({}).success).toBe(
      false,
    );
    expect(
      InstantiateWeeklyPlanToolArgsSchema.safeParse({
        template_key: "t1",
        week_offset: "next",
      }).success,
    ).toBe(false);
  });
});
