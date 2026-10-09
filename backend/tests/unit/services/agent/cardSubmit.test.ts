/**
 * cardSubmit 内核单测（#151 S2）— submit_card 工具通道。
 *
 * 覆盖四块核心语义（任务书验收门「新增 submit_card 单测」）：
 *  1. JSON Schema 派生：三卡型 schema 齐全、宽松化（无 $schema /
 *     additionalProperties）、plan_card {data:[...]} 包装、survey intent 形态；
 *  2. 通道解析：readConfig 替身驱动 DB > env > 默认 + 非法值回落；
 *  3. 闸门链：SCHEMA / UNKNOWN_EXERCISE_ID / EXERCISE_DB_UNAVAILABLE /
 *     SURVEY_OFF_BANK / QUALITY / NO_THREAD_CONTEXT 结构化错误形状 +
 *     survey 题库收敛在工具内完成（intent → 题库全文卡）；
 *  4. 卡汇幂等：同 thread 同卡型 last-write-wins（一轮只发一张卡），
 *     不同卡型并存。
 *
 * DeepAgentStream 侧的发射（classifyAgentStream 排水 → uiHint 事件）在
 * src/services/agent/__tests__/cardChannelStream.test.ts（tsx/node:test——
 * DeepAgentService 顶层 import 链 jest CJS 加载不了，与既有分工一致）。
 *
 * Runner: jest（tests/unit/**，npm run test:unit 计入）。
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";

import { PROFILE_INTAKE_QUESTIONS } from "shared/contracts";
import {
  DEFAULT_CARD_CHANNELS,
  __resetCardSinkForTests,
  buildCardSubmitTools,
  channelSignature,
  collectExerciseIds,
  deriveCardSubmitJsonSchemas,
  drainCardsFromSink,
  makeCardSubmitTool,
  resolveCardChannels,
  type CardSubmitToolDeps,
} from "../../../../src/services/agent/cardSubmit.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** 合法 UUID v4（quality gate 的 userId 断言与 mcpTools 同规则）。 */
const UUID_V4 = "11111111-1111-4111-8111-111111111111";

/** 动作库全集替身（id 长度对齐 NanoID 12-24 合法区间）。 */
const UNIVERSE = new Set(["fake-ex-0001", "fake-ex-0002", "fake-ex-0003"]);

const baseDeps = (
  overrides: Partial<CardSubmitToolDeps> = {},
): CardSubmitToolDeps => ({
  listExerciseIds: async () => new Set(UNIVERSE),
  injectedThreadId: "jest:thread-1",
  ...overrides,
});

/** 最小合法 weekly_plan 卡数据（对齐 tests/contract-tests.ts 同款形态）。 */
const WEEKLY_DATA = {
  week_label: "第 1 周",
  split_summary: "全身 · 每周 3 练",
  days: [
    {
      entry_date: "2026-10-12",
      rest: false,
      exercises: [
        {
          exercise_id: "fake-ex-0001",
          name: "杠铃深蹲",
          sets: [{ set: 1, weight: 40, reps: 8 }],
        },
      ],
    },
    { entry_date: "2026-10-13", rest: true, exercises: [] },
  ],
};

/** 解析工具返回的 JSON 字符串。 */
async function callTool(
  tool: ReturnType<typeof makeCardSubmitTool>,
  input: unknown,
  config?: unknown,
): Promise<Record<string, unknown>> {
  const raw = await tool.invoke(input, config as never);
  return JSON.parse(String(raw)) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// JSON Schema 派生
// ---------------------------------------------------------------------------

describe("deriveCardSubmitJsonSchemas — zod 真源 → 传输层描述", () => {
  const schemas = deriveCardSubmitJsonSchemas();

  it("三卡型 schema 齐全且为 object 形（OpenAI tool parameters 约定）", () => {
    for (const t of ["survey_card", "weekly_plan", "plan_card"] as const) {
      expect(schemas[t]).toBeTruthy();
      expect(schemas[t].type).toBe("object");
      expect(schemas[t].properties).toBeTruthy();
    }
  });

  it("宽松化：深层无 $schema / additionalProperties 残留", () => {
    const scan = (node: unknown): string | null => {
      if (Array.isArray(node)) {
        for (const n of node) {
          const hit = scan(n);
          if (hit) return hit;
        }
        return null;
      }
      if (node !== null && typeof node === "object") {
        for (const [k, v] of Object.entries(node)) {
          if (k === "$schema" || k === "additionalProperties") return k;
          const hit = scan(v);
          if (hit) return hit;
        }
      }
      return null;
    };
    for (const t of Object.keys(schemas)) {
      expect(scan(schemas[t as keyof typeof schemas])).toBeNull();
    }
  });

  it("plan_card 包装为 { data: [...] }（数组 data 面 → object schema）", () => {
    const dataProp = schemas.plan_card.properties?.data as
      { type?: string } | undefined;
    expect(dataProp?.type).toBe("array");
  });

  it("survey intent：purpose 枚举可见；question_ids 可选（.default 宽松化）", () => {
    const props = schemas.survey_card.properties as Record<string, unknown>;
    expect(Array.isArray((props.purpose as { enum?: unknown[] }).enum)).toBe(
      true,
    );
    expect(schemas.survey_card.required).not.toContain("question_ids");
  });
});

// ---------------------------------------------------------------------------
// 通道解析（DB > env > 默认）
// ---------------------------------------------------------------------------

describe("resolveCardChannels — plan_card 专属 feature flag（#151 S4）", () => {
  const ENV_KEYS = [
    "CARD_CHANNEL_SURVEY_CARD",
    "CARD_CHANNEL_WEEKLY_PLAN",
    "CARD_CHANNEL_PLAN_CARD",
  ] as const;
  let saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved = {};
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("无 DB 无 env → 默认（survey/weekly=tool 锁定，plan=fence）", async () => {
    expect(await resolveCardChannels({ readConfig: async () => null })).toEqual(
      DEFAULT_CARD_CHANNELS,
    );
  });

  it("DB 值优先于 env 与默认（S4 后仅 plan_card 可翻转）", async () => {
    process.env.CARD_CHANNEL_PLAN_CARD = "fence";
    const channels = await resolveCardChannels({
      readConfig: async (key) =>
        key === "card_channel_plan_card" ? "tool" : null,
    });
    expect(channels.plan_card).toBe("tool");
    expect(channels.survey_card).toBe("tool"); // 锁定卡型不读 flag
  });

  it("DB 非法值回落 env；env 非法值回落默认（不炸组装）", async () => {
    process.env.CARD_CHANNEL_PLAN_CARD = "tool";
    const channels = await resolveCardChannels({
      readConfig: async () => "maybe",
    });
    expect(channels.plan_card).toBe("tool"); // DB 非法 → env 命中
    delete process.env.CARD_CHANNEL_PLAN_CARD;
    const channels2 = await resolveCardChannels({
      readConfig: async (key) =>
        key === "card_channel_plan_card" ? "sms" : null,
    });
    expect(channels2.plan_card).toBe("fence"); // DB/env 都非法 → 默认
  });

  it("S4 通道锁：survey/weekly 的 DB/env fence 值一律忽略（恒 tool）", async () => {
    process.env.CARD_CHANNEL_SURVEY_CARD = "fence";
    process.env.CARD_CHANNEL_WEEKLY_PLAN = "fence";
    const channels = await resolveCardChannels({
      readConfig: async (key) =>
        key === "card_channel_survey_card" ? "fence" : null,
    });
    expect(channels.survey_card).toBe("tool"); // DB fence 忽略
    expect(channels.weekly_plan).toBe("tool"); // env fence 忽略
    expect(channels.plan_card).toBe("fence"); // plan_card 的 flag 语义不受影响
  });

  it("channelSignature 随通道翻转而变（agent 缓存失效判据）", () => {
    const a = channelSignature({
      survey_card: "tool",
      weekly_plan: "tool",
      plan_card: "fence",
    });
    const b = channelSignature({
      survey_card: "fence",
      weekly_plan: "tool",
      plan_card: "fence",
    });
    expect(a).toBe("survey_card=tool|weekly_plan=tool|plan_card=fence");
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// exercise id 收集
// ---------------------------------------------------------------------------

describe("collectExerciseIds — 展示面 + 落库面全收集", () => {
  it("weekly_plan：days[].exercises 与 apply.entries 两处都收", () => {
    const ids = collectExerciseIds("weekly_plan", {
      days: [
        {
          entry_date: "2026-10-12",
          rest: false,
          exercises: [{ exercise_id: "fake-ex-0001", sets: [] }],
        },
      ],
      apply: { entries: [{ exercise_id: "fake-ex-0002" }] },
    });
    expect(ids.sort()).toEqual(["fake-ex-0001", "fake-ex-0002"]);
  });

  it("plan_card：data[].exerciseId（camelCase）", () => {
    expect(
      collectExerciseIds("plan_card", [
        { exerciseId: "fake-ex-0003", name: "x", sets: 3, reps: 10 },
      ]),
    ).toEqual(["fake-ex-0003"]);
  });

  it("survey_card 不携带动作 id", () => {
    expect(collectExerciseIds("survey_card", { questions: [] })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 闸门链（makeCardSubmitTool.invoke）
// ---------------------------------------------------------------------------

describe("makeCardSubmitTool — 三层闸门 + 卡汇推入", () => {
  beforeEach(() => {
    __resetCardSinkForTests();
  });

  describe("survey_card（intent → 题库收敛在工具内完成）", () => {
    it("profile_intake 省略 question_ids → 收敛为题库全量卡", async () => {
      const tool = makeCardSubmitTool("survey_card", baseDeps());
      const res = await callTool(tool, {
        purpose: "profile_intake",
        title: "训练画像问卷",
        message: "先了解你的基本情况",
      });
      expect(res.ok).toBe(true);
      expect(res.channel).toBe("tool");
      const cards = drainCardsFromSink("jest:thread-1");
      expect(cards).toHaveLength(1);
      const card = cards[0] as {
        type: string;
        data: {
          purpose: string;
          questions: Array<{ id: string; question: string }>;
        };
      };
      expect(card.type).toBe("survey_card");
      expect(card.data.purpose).toBe("profile_intake");
      expect(card.data.questions).toHaveLength(PROFILE_INTAKE_QUESTIONS.length);
      // 题面 = 共享题库原文（canonicalize 替换桩文本），id 全部在库。
      for (let i = 0; i < PROFILE_INTAKE_QUESTIONS.length; i++) {
        expect(card.data.questions[i].id).toBe(PROFILE_INTAKE_QUESTIONS[i].id);
        expect(card.data.questions[i].question).toBe(
          PROFILE_INTAKE_QUESTIONS[i].question,
        );
      }
    });

    it("plan_gap 传题库 id 子集 → 只收敛该子集", async () => {
      const [id1, id2] = [
        PROFILE_INTAKE_QUESTIONS[0].id,
        PROFILE_INTAKE_QUESTIONS[1].id,
      ];
      const tool = makeCardSubmitTool("survey_card", baseDeps());
      const res = await callTool(tool, {
        purpose: "plan_gap",
        question_ids: [id1, id2],
      });
      expect(res.ok).toBe(true);
      const cards = drainCardsFromSink("jest:thread-1");
      expect(cards).toHaveLength(1);
      const questions = (
        cards[0] as {
          data: { questions: Array<{ id: string; question: string }> };
        }
      ).data.questions;
      expect(questions.map((q) => q.id)).toEqual([id1, id2]);
      const bank1 = PROFILE_INTAKE_QUESTIONS.find((q) => q.id === id1);
      expect(questions[0].question).toBe(bank1?.question);
    });

    it("plan_gap 题外 id → SURVEY_OFF_BANK 结构化错误，卡不进汇", async () => {
      const tool = makeCardSubmitTool("survey_card", baseDeps());
      const res = await callTool(tool, {
        purpose: "plan_gap",
        question_ids: ["not-in-bank"],
      });
      expect(res.ok).toBe(false);
      expect(res.code).toBe("SURVEY_OFF_BANK");
      expect(Array.isArray(res.errors)).toBe(true);
      expect(drainCardsFromSink("jest:thread-1")).toHaveLength(0);
    });

    it("workout_feedback 自由出题原样进卡", async () => {
      const tool = makeCardSubmitTool("survey_card", baseDeps());
      const res = await callTool(tool, {
        purpose: "workout_feedback",
        sessionId: "sess-1",
        questions: [{ id: "fb-1", question: "今天练完感觉如何？" }],
      });
      expect(res.ok).toBe(true);
      const cards = drainCardsFromSink("jest:thread-1");
      const questions = (cards[0] as { data: { questions: unknown[] } }).data
        .questions;
      // canonicalizeSurveyCard 对自由出题也做对象归一（required 显式化）——
      // 与围栏管道到达前端时的形态逐字段一致（parity）。
      expect(questions).toEqual([
        { id: "fb-1", question: "今天练完感觉如何？", required: false },
      ]);
    });

    it("purpose 非法 → 绑定层前置校验拒绝（宽松 JSON Schema 的 enum 面）", async () => {
      const tool = makeCardSubmitTool("survey_card", baseDeps());
      // enum 是 JSON Schema 可表达约束 → @cfworker 前置校验先行拒绝
      // （ToolInputParsingException → ToolNode 转工具错误回注模型），
      // func 内 zod 回路兜 JSON Schema 表达不了的跨字段校验（分层设计）。
      await expect(tool.invoke({ purpose: "not-a-purpose" })).rejects.toThrow();
      expect(drainCardsFromSink("jest:thread-1")).toHaveLength(0);
    });
  });

  describe("weekly_plan（动作库存在性 #136）", () => {
    it("合法卡（id 全在库）→ ok + 进汇", async () => {
      const tool = makeCardSubmitTool("weekly_plan", baseDeps());
      const res = await callTool(tool, WEEKLY_DATA);
      expect(res.ok).toBe(true);
      const cards = drainCardsFromSink("jest:thread-1");
      expect(cards).toHaveLength(1);
      expect((cards[0] as { type: string }).type).toBe("weekly_plan");
    });

    it("伪造 exercise_id → UNKNOWN_EXERCISE_ID + ids 清单 + hint", async () => {
      const tool = makeCardSubmitTool("weekly_plan", baseDeps());
      const res = await callTool(tool, {
        ...WEEKLY_DATA,
        days: [
          {
            entry_date: "2026-10-12",
            rest: false,
            exercises: [
              {
                exercise_id: "made-up-99999",
                name: "编造动作",
                sets: [{ set: 1, reps: 8 }],
              },
            ],
          },
        ],
      });
      expect(res.ok).toBe(false);
      expect(res.code).toBe("UNKNOWN_EXERCISE_ID");
      expect(res.ids).toEqual(["made-up-99999"]);
      expect(String(res.hint)).toContain("list_exercises");
      expect(drainCardsFromSink("jest:thread-1")).toHaveLength(0);
    });

    it("动作库读不到 → EXERCISE_DB_UNAVAILABLE（不静默放行）", async () => {
      const tool = makeCardSubmitTool(
        "weekly_plan",
        baseDeps({
          listExerciseIds: async () => {
            throw new Error("db down");
          },
        }),
      );
      const res = await callTool(tool, WEEKLY_DATA);
      expect(res.ok).toBe(false);
      expect(res.code).toBe("EXERCISE_DB_UNAVAILABLE");
    });

    it("zod 深校验失败（全空 set 组）→ SCHEMA 结构化错误", async () => {
      // {set:1} 无 weight/reps/duration/note —— JSON Schema 层合法（字段全
      // 可选），zod superRefine 打回 → 宽松绑定 + 深校验分层的正例。
      const tool = makeCardSubmitTool("weekly_plan", baseDeps());
      const res = await callTool(tool, {
        ...WEEKLY_DATA,
        days: [
          {
            entry_date: "2026-10-12",
            rest: false,
            exercises: [
              {
                exercise_id: "fake-ex-0001",
                name: "杠铃深蹲",
                sets: [{ set: 1 }],
              },
            ],
          },
        ],
      });
      expect(res.ok).toBe(false);
      expect(res.code).toBe("SCHEMA");
      expect(Array.isArray(res.errors)).toBe(true);
    });
  });

  describe("plan_card（{data:[...]} 包装）", () => {
    it("合法数组经包装进卡，exerciseId 全集校验", async () => {
      const tool = makeCardSubmitTool("plan_card", baseDeps());
      const res = await callTool(tool, {
        data: [
          {
            exerciseId: "fake-ex-0002",
            name: "俯卧撑",
            exercise_type: "bodyweight",
            sets: 3,
            reps: 12,
          },
        ],
      });
      expect(res.ok).toBe(true);
      const cards = drainCardsFromSink("jest:thread-1");
      expect((cards[0] as { type: string; data: unknown[] }).data).toHaveLength(
        1,
      );
    });

    it("伪造 exerciseId → UNKNOWN_EXERCISE_ID（camelCase 收集路径）", async () => {
      const tool = makeCardSubmitTool("plan_card", baseDeps());
      const res = await callTool(tool, {
        data: [
          {
            exerciseId: "ghost-ex-00009",
            name: "幻影动作",
            exercise_type: "bodyweight",
            sets: 3,
            reps: 12,
          },
        ],
      });
      expect(res.code).toBe("UNKNOWN_EXERCISE_ID");
      expect(res.ids).toEqual(["ghost-ex-00009"]);
    });
  });

  describe("Q1 质检（workout_complete 场景闸，与校验回路同口径）", () => {
    const qualityDeps = (
      facts: unknown,
      scenario?: string,
    ): CardSubmitToolDeps =>
      baseDeps({
        injectedUserId: UUID_V4,
        injectedScenario: scenario,
        loadSessionFacts: async () => facts as never,
      });

    it("场景命中 + 数字与真值不符 → QUALITY 结构化错误", async () => {
      const tool = makeCardSubmitTool(
        "survey_card",
        qualityDeps({ stats: { totalVolume: 2400 } }, "workout_complete"),
      );
      const res = await callTool(tool, {
        purpose: "workout_feedback",
        sessionId: "sess-1",
        message: "本次总容量 9999 kg，干得漂亮！",
        questions: [{ id: "fb-1", question: "感觉如何？" }],
      });
      expect(res.ok).toBe(false);
      expect(res.code).toBe("QUALITY");
      expect(JSON.stringify(res.errors)).toContain("9999");
      expect(drainCardsFromSink("jest:thread-1")).toHaveLength(0);
    });

    it("场景不命中（chat）→ 同样的数字不触发质检", async () => {
      const tool = makeCardSubmitTool(
        "survey_card",
        qualityDeps({ stats: { totalVolume: 2400 } }, "chat"),
      );
      const res = await callTool(tool, {
        purpose: "workout_feedback",
        sessionId: "sess-1",
        message: "本次总容量 9999 kg，干得漂亮！",
        questions: [{ id: "fb-1", question: "感觉如何？" }],
      });
      expect(res.ok).toBe(true);
    });

    it("facts 为 null（库内无 session）→ 跳过数值校验", async () => {
      const tool = makeCardSubmitTool(
        "survey_card",
        qualityDeps(null, "workout_complete"),
      );
      const res = await callTool(tool, {
        purpose: "workout_feedback",
        sessionId: "sess-1",
        message: "本次总容量 9999 kg",
        questions: [{ id: "fb-1", question: "感觉如何？" }],
      });
      expect(res.ok).toBe(true);
    });
  });

  describe("线程上下文 + 幂等", () => {
    it("无线程锚点 → NO_THREAD_CONTEXT（引导回退围栏，不静默丢卡）", async () => {
      const tool = makeCardSubmitTool(
        "survey_card",
        baseDeps({ injectedThreadId: undefined }),
      );
      const res = await callTool(tool, { purpose: "profile_intake" });
      expect(res.ok).toBe(false);
      expect(res.code).toBe("NO_THREAD_CONTEXT");
      expect(String(res.hint)).toContain("围栏");
    });

    it("显式 RunnableConfig 的 configurable.thread_id 是生产主路径", async () => {
      const tool = makeCardSubmitTool(
        "survey_card",
        baseDeps({ injectedThreadId: undefined }),
      );
      const res = await callTool(
        tool,
        { purpose: "profile_intake" },
        { configurable: { thread_id: "cfg:thread-9" } },
      );
      expect(res.ok).toBe(true);
      expect(drainCardsFromSink("cfg:thread-9")).toHaveLength(1);
    });

    it("同 thread 同卡型两次提交 → 排水只出 1 张卡（last-write-wins）", async () => {
      const tool = makeCardSubmitTool("survey_card", baseDeps());
      await callTool(tool, {
        purpose: "plan_gap",
        question_ids: [PROFILE_INTAKE_QUESTIONS[0].id],
        title: "第一版",
      });
      await callTool(tool, {
        purpose: "plan_gap",
        question_ids: [PROFILE_INTAKE_QUESTIONS[1].id],
        title: "第二版",
      });
      const cards = drainCardsFromSink("jest:thread-1");
      expect(cards).toHaveLength(1);
      expect((cards[0] as { data: { title?: string } }).data.title).toBe(
        "第二版",
      );
    });

    it("同 thread 不同卡型并存 → 排水各出一张", async () => {
      const survey = makeCardSubmitTool("survey_card", baseDeps());
      const weekly = makeCardSubmitTool("weekly_plan", baseDeps());
      await callTool(survey, { purpose: "profile_intake" });
      await callTool(weekly, WEEKLY_DATA);
      const cards = drainCardsFromSink("jest:thread-1");
      expect(cards.map((c) => (c as { type: string }).type).sort()).toEqual([
        "survey_card",
        "weekly_plan",
      ]);
    });
  });

  describe("buildCardSubmitTools — 通道筛选", () => {
    it("channel=tool 的卡型才暴露工具（默认下 survey+weekly 两件）", () => {
      const tools = buildCardSubmitTools(baseDeps(), {
        ...DEFAULT_CARD_CHANNELS,
      });
      expect(tools.map((t) => t.name).sort()).toEqual([
        "submit_survey",
        "submit_weekly_plan",
      ]);
    });

    it("全 fence 输入 → 零工具（builder 契约；survey/weekly 的 fence 已不可达，见 resolveCardChannels 通道锁）", () => {
      const tools = buildCardSubmitTools(baseDeps(), {
        survey_card: "fence",
        weekly_plan: "fence",
        plan_card: "fence",
      });
      expect(tools).toHaveLength(0);
    });
  });
});
