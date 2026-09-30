/**
 * 流层吞卡回归（2026-09-30，refs #73 T9b）。
 *
 * 背景（T9 验收量化回放实锤）：GLM「边调工具边出卡」——计划卡写在携带
 * tool_calls 的消息正文里。classifyAgentStream 的 hasTools 分支把该步缓冲
 * 正文整段归为 thinking，11,980 字符的 weekly_plan 卡被吞进思考链（回放二
 * 92,277 thinking 字符中 42,851 即此），卡片永远到不了 uiHint 提取器与校验
 * 回路，用户端收不到卡。
 *
 * 修复契约（双向断言）：
 *  - 下限（吞卡修复）：tool_calls 消息正文里的卡片段（完整围栏且 body 解析
 *    为 uiHint 卡 / 平衡 inline 卡对象）必须以 token 事件放行 →
 *    uiHintExtractor 提取成 uiHint（≥1 张）；thinking 不得含卡内容。
 *  - 上限（泄漏治理回归，2026-09-23 铁律不破）：tool_calls 步的叙述、非卡
 *    围栏（```markdown 技能复述）、无顶层 type 的工具返回 JSON 复述仍零
 *    token；卡片围栏若逐字出现在此前工具返回里（read_file 复述
 *    plan-generation knowledge.md §9 的示例卡围栏）→ 判复述不救，照旧
 *    thinking，防止把技能文档示例卡当真卡送给用户。
 *
 * Runner: node:test via tsx（与 __tests__ 其余文件一致）。
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { classifyAgentStream } from "../DeepAgentService.js";
import { extractUiHintEvents, splitCardSegments } from "../uiHintExtractor.js";
import type { AgentEvent } from "shared/contracts";

// ---------------------------------------------------------------------------
// 合成流构造（与 streamToolLeak.test.ts 同款）
// ---------------------------------------------------------------------------

/** messages delta: [AIMessageChunk, metadata]，chunk 仅需 .content。 */
function msgDelta(text: string): unknown {
  return ["messages", [{ content: text }, {}]];
}

/** updates 快照：model_request 节点的最后一条消息决定 step 分类。 */
function modelRequestUpdate(ai: unknown): unknown {
  return ["updates", { model_request: { messages: [ai] } }];
}

/** tools 节点快照：工具返回（ToolMessage）——吞卡修复的复述判别锚来源。 */
function toolUpdate(content: string): unknown {
  return [
    "updates",
    { tools: { messages: [{ _getType: () => "tool", content }] } },
  ];
}

/** 带 tool_calls 的 AI 消息（中间步）。 */
function aiWithTools(toolNames: string[]): unknown {
  return {
    _getType: () => "ai",
    content: "",
    tool_calls: toolNames.map((name) => ({ name, args: "{}" })),
  };
}

/** 无 tool_calls 的 AI 消息（终步）。 */
function aiTerminal(content: string): unknown {
  return { _getType: () => "ai", content, tool_calls: [] };
}

/** 把合成流喂进 classifyAgentStream，收集全部事件。 */
async function classify(stream: AsyncIterable<unknown>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const e of classifyAgentStream(stream)) events.push(e);
  return events;
}

/** 抽取某类型事件的文本拼接（token / thinking）。 */
function texts(events: AgentEvent[], type: AgentEvent["type"]): string {
  return events
    .filter((e) => e.type === type && e.text)
    .map((e) => e.text as string)
    .join("");
}

/** 把 classifyAgentStream 产出的事件流再喂进 uiHintExtractor，收集卡片类型。 */
async function collectHints(events: AgentEvent[]): Promise<string[]> {
  const hints: string[] = [];
  for await (const e of extractUiHintEvents(
    (async function* () {
      for (const ev of events) yield ev;
    })(),
  )) {
    if (e.type === "uiHint" && e.card) hints.push(String(e.card.type));
  }
  return hints;
}

// ---------------------------------------------------------------------------
// 样本：T9 契约形态的 weekly_plan 卡（结构化四件套 day_focus/rationale/
// category/sets，见 plan-generation knowledge.md §9.3）
// ---------------------------------------------------------------------------

const weeklyCardJson = JSON.stringify(
  {
    type: "weekly_plan",
    data: {
      week_label: "第 1 周",
      split_summary: "上下分化 · 每周 4 练 · 复合动作优先",
      days: [
        {
          entry_date: "2026-09-28",
          split_label: "上肢推",
          focus: "胸肩三头",
          rationale: "首个推日以复合动作为主建立基础力量",
          rest: false,
          exercises: [
            {
              exercise_id: "ex_1",
              name: "杠铃卧推",
              category: "main",
              target_sets: 4,
              sets: [
                { set_no: 1, reps: 8, rpe: 7 },
                { set_no: 2, reps: 8, rpe: 7 },
              ],
            },
            {
              exercise_id: "ex_2",
              name: "哑铃肩上推举",
              category: "main",
              target_sets: 3,
              sets: [{ set_no: 1, reps: 10, rpe: 6 }],
            },
          ],
        },
        {
          entry_date: "2026-09-29",
          split_label: "休息",
          rest: true,
          exercises: [],
        },
      ],
    },
  },
  null,
  2,
);
const weeklyCardFence = "```json\n" + weeklyCardJson + "\n```";

// ---------------------------------------------------------------------------
// 红测主场景：tool_calls 消息正文含 weekly_plan 围栏卡
// ---------------------------------------------------------------------------

describe("吞卡修复：tool_calls 消息正文里的卡片必须走正常卡路径", () => {
  it("红测主场景：正文 = 引导语 + weekly_plan 围栏卡 + tool_calls → 卡进 token/uiHint、thinking 不含卡", async () => {
    // GLM「边调工具边出卡」实测形态：模型在同一消息里写卡片正文并发起
    // 补充检索（hasTools 快照触发）。修复前整段正文被归 thinking。
    const leadIn = "这是为你定制的本周训练计划：";
    const narration = "我再确认一下动作库里的可用动作。";
    const body = leadIn + "\n\n" + weeklyCardFence + "\n\n" + narration;
    const raws = [
      msgDelta(body),
      modelRequestUpdate(aiWithTools(["find_exercises"])),
      toolUpdate('{"count":1,"exercises":[{"id":"ex_1","name":"杠铃卧推"}]}'),
      msgDelta("计划已生成，确认后开始训练。"),
      modelRequestUpdate(aiTerminal("计划已生成，确认后开始训练。")),
    ];

    const events = await classify(
      (async function* () {
        for (const r of raws) yield r;
      })(),
    );
    const tokens = texts(events, "token");
    const thinking = texts(events, "thinking");

    // 下限 ①：卡片围栏必须到达 token 流（uiHintExtractor 只扫 token）。
    assert.ok(
      tokens.includes("```json"),
      `卡片围栏必须进 token 流（实际 token: ${JSON.stringify(tokens.slice(0, 80))}）`,
    );
    // 下限 ②：卡片必须被 uiHintExtractor 提取成 uiHint 事件（≥1 张）。
    const hints = await collectHints(events);
    assert.ok(
      hints.includes("weekly_plan"),
      `weekly_plan 卡必须被提取成 uiHint（实际 ${hints.join(",") || "无"}）`,
    );
    // 上限 ①：thinking 不得包含被吞的卡内容。
    assert.equal(
      thinking.includes('"weekly_plan"'),
      false,
      "卡片内容不得整体进 thinking（吞卡）",
    );
    assert.equal(
      thinking.includes(weeklyCardFence),
      false,
      "卡片围栏不得整体进 thinking（吞卡）",
    );
    // 上限 ②：泄漏治理不变——叙述照旧进 thinking、零散文 token。
    assert.ok(thinking.includes(narration), "中间步叙述照旧进 thinking");
    assert.ok(
      thinking.includes(leadIn),
      "卡片前的引导语照旧进 thinking（中间步零散文 token 铁律）",
    );
    assert.equal(
      tokens.includes(narration),
      false,
      "中间步叙述绝不进 token（泄漏治理回归）",
    );
    // 终步答案照常放行。
    assert.ok(tokens.includes("计划已生成"), "终步答案正常放行");
  });

  it("卡片围栏跨 delta 切碎 → 快照时按完整缓冲判定，仍完整救出", async () => {
    // SSE 增量不保证围栏完整到达一个 delta——切碎喂入，快照后整段缓冲判定。
    const pieces = [
      "周计划如下：\n\n```",
      'json\n{\n  "type": "we',
      'ekly_plan",\n  "data": { "week_label": "第 1 周", "days": [] }',
      "\n}\n```",
    ];
    const raws = [
      ...pieces.map((p) => msgDelta(p)),
      modelRequestUpdate(aiWithTools(["load_history"])),
      msgDelta("好了。"),
      modelRequestUpdate(aiTerminal("好了。")),
    ];

    const events = await classify(
      (async function* () {
        for (const r of raws) yield r;
      })(),
    );
    const hints = await collectHints(events);
    assert.ok(
      hints.includes("weekly_plan"),
      `切碎 delta 的围栏卡仍被完整救出（实际 ${hints.join(",") || "无"}）`,
    );
    const thinking = texts(events, "thinking");
    assert.equal(
      thinking.includes("weekly_plan"),
      false,
      "切碎的卡内容不得进 thinking",
    );
  });

  it("inline 卡对象（未包围栏）→ 同样救出（与提取器 inline 回退对齐）", async () => {
    const inlineCard =
      '{"type":"plan_card","title":"明日训练","data":[{"exerciseId":"ex_1","name":"深蹲","exercise_type":"resistance","sets":3,"reps":8,"weight":60}]}';
    const raws = [
      msgDelta("明天的安排：" + inlineCard),
      modelRequestUpdate(aiWithTools(["find_exercises"])),
      msgDelta("收到。"),
      modelRequestUpdate(aiTerminal("收到。")),
    ];

    const events = await classify(
      (async function* () {
        for (const r of raws) yield r;
      })(),
    );
    const hints = await collectHints(events);
    assert.ok(
      hints.includes("plan_card"),
      `inline 卡对象必须被救出（实际 ${hints.join(",") || "无"}）`,
    );
    const thinking = texts(events, "thinking");
    assert.equal(
      thinking.includes("plan_card"),
      false,
      "inline 卡内容不得进 thinking",
    );
  });

  it("同一 tool_calls 步多张卡 → 全部救出", async () => {
    const surveyFence =
      '```json\n{"type":"survey_card","title":"补充确认","data":{"questions":[{"id":"q1","question":"每周练几次？"}]}}\n```';
    const raws = [
      msgDelta(surveyFence + "\n\n" + weeklyCardFence),
      modelRequestUpdate(aiWithTools(["load_history"])),
      msgDelta("完。"),
      modelRequestUpdate(aiTerminal("完。")),
    ];

    const events = await classify(
      (async function* () {
        for (const r of raws) yield r;
      })(),
    );
    const hints = await collectHints(events);
    assert.ok(hints.includes("survey_card"), "第一张卡（survey）被救出");
    assert.ok(hints.includes("weekly_plan"), "第二张卡（weekly_plan）被救出");
  });
});

// ---------------------------------------------------------------------------
// 上限保护：泄漏治理与复述判别（修复不得误放行）
// ---------------------------------------------------------------------------

describe("吞卡修复上限保护：tool_calls 步其余内容仍零 token", () => {
  it("无卡 tool_calls 步：行为与修复前一致（全 thinking、零 token）", async () => {
    const narration =
      "好的，我先查看动作库中可用的动作列表，确认用户目前掌握的动作。";
    const raws = [
      msgDelta(narration),
      modelRequestUpdate(aiWithTools(["list_exercises"])),
      msgDelta("明天计划：深蹲 3×8。"),
      modelRequestUpdate(aiTerminal("明天计划：深蹲 3×8。")),
    ];

    const events = await classify(
      (async function* () {
        for (const r of raws) yield r;
      })(),
    );
    const tokens = texts(events, "token");
    const thinking = texts(events, "thinking");
    assert.equal(tokens, "明天计划：深蹲 3×8。", "仅终步答案进 token");
    assert.ok(thinking.includes(narration), "中间步叙述照旧进 thinking");
  });

  it("非卡围栏（```markdown 技能复述）不救 → 零 token（泄漏治理不变）", async () => {
    const skillEcho = [
      "我已阅读计划生成技能，要点如下：",
      "```markdown",
      "# Plan generation skill",
      "五要素：目标 / 经验 / 器械 / 频率 / 恢复。",
      "```",
    ].join("\n\n");
    const raws = [
      msgDelta(skillEcho),
      modelRequestUpdate(aiWithTools(["read_file"])),
      msgDelta("好的，明天计划已生成。"),
      modelRequestUpdate(aiTerminal("好的，明天计划已生成。")),
    ];

    const events = await classify(
      (async function* () {
        for (const r of raws) yield r;
      })(),
    );
    const tokens = texts(events, "token");
    const hints = await collectHints(events);
    assert.equal(
      tokens.includes("Plan generation skill"),
      false,
      "技能复述围栏不得泄漏进 token",
    );
    assert.equal(hints.length, 0, "非卡围栏不得产生 uiHint");
    assert.ok(tokens.includes("明天计划已生成"), "终步答案正常放行");
  });

  it("无顶层 type 的围栏 JSON（工具返回形态）不救 → 零 token", async () => {
    const fencedJson =
      '```json\n{\n  "plan": { "goal": "增肌", "days": 4 }\n}\n```';
    const raws = [
      msgDelta("计划参数：" + fencedJson),
      modelRequestUpdate(aiWithTools(["read_file"])),
      msgDelta("好的。"),
      modelRequestUpdate(aiTerminal("好的。")),
    ];

    const events = await classify(
      (async function* () {
        for (const r of raws) yield r;
      })(),
    );
    const tokens = texts(events, "token");
    const hints = await collectHints(events);
    assert.equal(hints.length, 0, "无顶层 type 的 JSON 不是卡，不产生 uiHint");
    assert.equal(
      tokens.includes("```json"),
      false,
      "非卡围栏 JSON 不得进 token",
    );
    const thinking = texts(events, "thinking");
    assert.ok(
      thinking.includes('"goal"'),
      "非卡围栏内容照旧进 thinking（不丢失）",
    );
  });

  it("带 type 字段的工具返回复述（list_exercises 行对象）不救 → 零 token（白名单判别）", async () => {
    // 回归实锤：动作库行对象 {id, name, type:"compound"} 自带非空字符串
    // type——宽松 tryParseCard 会把它当卡救出（streamToolLeak 套件击穿）。
    // 救卡判别必须过 ALLOWED_UIHINT_TYPES 白名单：compound 不是卡类型。
    const libEcho = JSON.stringify(
      [
        { id: "ex-1", name: "深蹲", type: "compound" },
        { id: "ex-2", name: "卧推", type: "compound" },
        { id: "ex-3", name: "硬拉", type: "compound" },
      ],
      null,
      2,
    );
    const raws = [
      msgDelta("动作库如下：\n"),
      msgDelta(libEcho),
      modelRequestUpdate(aiWithTools(["list_exercises"])),
      msgDelta("这是最终计划。"),
      modelRequestUpdate(aiTerminal("这是最终计划。")),
    ];

    const events = await classify(
      (async function* () {
        for (const r of raws) yield r;
      })(),
    );
    const tokens = texts(events, "token");
    const hints = await collectHints(events);
    assert.equal(hints.length, 0, "带非卡 type 的行对象不得产生 uiHint");
    assert.equal(
      tokens.includes("ex-1"),
      false,
      "动作库行对象复述不得泄漏进 token",
    );
    const thinking = texts(events, "thinking");
    assert.ok(thinking.includes('"ex-1"'), "复述照旧进 thinking（不丢失）");
    assert.ok(tokens.includes("这是最终计划"), "终步答案正常放行");
  });

  it("复述判别：卡围栏逐字出现在此前工具返回（knowledge.md 示例卡）→ 不救，照旧 thinking", async () => {
    // 防误伤场景：模型 read_file 了 plan-generation knowledge.md（§9 含完整
    // 示例卡围栏），随后在带 tool_calls 的消息里复述文档——示例卡不得被
    // 当成真卡送给用户。
    const knowledgeDoc = [
      "## 九、输出格式规范",
      "",
      "```json",
      weeklyCardJson,
      "```",
      "",
      "**常见错误**：调不存在的工具。",
    ].join("\n");
    const echoBody = "文档里的示例卡：" + weeklyCardFence;
    const raws = [
      msgDelta("我先读一下计划技能。"),
      modelRequestUpdate(aiWithTools(["read_file"])),
      toolUpdate(knowledgeDoc),
      msgDelta(echoBody),
      modelRequestUpdate(aiWithTools(["find_exercises"])),
      msgDelta("好的，计划来了。"),
      modelRequestUpdate(aiTerminal("好的，计划来了。")),
    ];

    const events = await classify(
      (async function* () {
        for (const r of raws) yield r;
      })(),
    );
    const hints = await collectHints(events);
    assert.equal(
      hints.length,
      0,
      `复述的示例卡不得被当成真卡提取（实际 ${hints.join(",") || "无"}）`,
    );
    const thinking = texts(events, "thinking");
    assert.ok(
      thinking.includes("weekly_plan"),
      "复述内容照旧进 thinking（不丢失）",
    );
    const tokens = texts(events, "token");
    assert.equal(tokens.includes("```json"), false, "复述围栏不得进 token");
  });

  it("真卡 vs 复述同轮共存：真卡（不在工具返回里）救出、复述卡不救", async () => {
    // 同一轮里模型先复述示例卡（在工具返回里），再写真卡（自组合、不在
    // 任何工具返回里）——只有真卡被救出。
    const knowledgeDoc = "```json\n" + weeklyCardJson + "\n```";
    const realCard =
      '```json\n{"type":"weekly_plan","data":{"week_label":"第 9 周","days":[]}}\n```';
    const raws = [
      msgDelta("读技能。"),
      modelRequestUpdate(aiWithTools(["read_file"])),
      toolUpdate(knowledgeDoc),
      msgDelta("示例：" + weeklyCardFence + "\n\n真卡：" + realCard),
      modelRequestUpdate(aiWithTools(["find_exercises"])),
      msgDelta("好了。"),
      modelRequestUpdate(aiTerminal("好了。")),
    ];

    const events = await classify(
      (async function* () {
        for (const r of raws) yield r;
      })(),
    );
    const hints = await collectHints(events);
    assert.equal(hints.length, 1, "只有真卡被提取");
    const tokens = texts(events, "token");
    assert.ok(tokens.includes("第 9 周"), "真卡内容进 token 流");
    assert.equal(tokens.includes("第 1 周"), false, "复述的示例卡不进 token");
  });
});

// ---------------------------------------------------------------------------
// splitCardSegments 直接单测（切分边界契约）
// ---------------------------------------------------------------------------

describe("splitCardSegments 直接单测（切分边界契约）", () => {
  const cardFence = '```json\n{"type":"weekly_plan","data":{"days":[]}}\n```';
  const inlineCard = '{"type":"survey_card","title":"先确认"}';

  it("引导语 + 围栏卡 + 叙述 → 卡切出、其余保留", () => {
    const text = "这是计划：\n\n" + cardFence + "\n\n我再去查一下动作。";
    const { cards, rest } = splitCardSegments(text);
    assert.deepEqual(cards, [cardFence]);
    assert.ok(rest.includes("这是计划："), "引导语保留在 rest");
    assert.ok(rest.includes("我再去查一下动作"), "叙述保留在 rest");
    assert.equal(rest.includes("weekly_plan"), false, "卡内容不在 rest");
  });

  it("inline 卡对象（未包围栏）→ 切出", () => {
    const text = "明天的安排：" + inlineCard + " 请确认。";
    const { cards, rest } = splitCardSegments(text);
    assert.deepEqual(cards, [inlineCard]);
    assert.ok(rest.includes("请确认"), "inline 卡后的叙述保留");
  });

  it("多张卡（围栏 + inline 混合）→ 全部切出，rest 按原位衔接", () => {
    const text =
      "先确认：" + inlineCard + "\n\n计划：" + cardFence + "\n\n完。";
    const { cards, rest } = splitCardSegments(text);
    assert.equal(cards.length, 2, "两张卡都切出");
    assert.ok(rest.includes("先确认："), "卡前文本保留");
    assert.ok(rest.includes("计划："), "卡间文本保留");
    assert.ok(rest.includes("完。"), "卡尾文本保留");
  });

  it("非卡围栏（markdown）与无 type JSON → 不切，全留在 rest", () => {
    const mdFence = "```markdown\n# skill doc\n内容\n```";
    const jsonFence = '```json\n{"plan":{"goal":"增肌"}}\n```';
    const { cards, rest } = splitCardSegments(
      "文档：" + mdFence + "\n\n参数：" + jsonFence,
    );
    assert.equal(cards.length, 0);
    assert.ok(rest.includes("# skill doc"), "markdown 围栏保留在 rest");
    assert.ok(rest.includes('"goal"'), "无 type JSON 保留在 rest");
  });

  it("非卡类型白名单外的 type（compound 行对象）→ 不切", () => {
    const row = '{"id":"ex-1","name":"深蹲","type":"compound"}';
    const { cards, rest } = splitCardSegments("动作：" + row);
    assert.equal(cards.length, 0, "非卡 type 不救");
    assert.ok(rest.includes("ex-1"), "行对象保留在 rest");
  });

  it("isEcho 命中 → 卡段降级回 rest（复述豁免）", () => {
    const text = "示例：" + cardFence;
    const { cards, rest } = splitCardSegments(text, () => true);
    assert.equal(cards.length, 0, "复述卡不救");
    assert.ok(rest.includes(cardFence), "复述卡完整留在 rest（不丢失）");
  });

  it("isEcho 未命中（真卡）→ 正常切出", () => {
    const text = "真卡：" + cardFence;
    const { cards } = splitCardSegments(text, () => false);
    assert.deepEqual(cards, [cardFence]);
  });

  it("未闭合围栏 → 围栏头留在 rest，body 内平衡卡对象尽力救出", () => {
    const unclosed =
      '```json\n{"type":"plan_card","title":"明日训练","data":[]}';
    const { cards, rest } = splitCardSegments("开头：\n\n" + unclosed);
    assert.equal(cards.length, 1, "body 内 inline 卡对象被救出");
    assert.ok(
      cards[0]!.includes("plan_card"),
      "救出的是卡对象本体（无围栏标记）",
    );
    assert.ok(rest.includes("```json"), "围栏头留在 rest");
    assert.ok(rest.includes("开头："), "围栏前文本保留");
  });

  it("空文本 / 纯叙述 → 零卡，rest 原样", () => {
    assert.deepEqual(splitCardSegments(""), { cards: [], rest: "" });
    const prose = "好的，明天练腿。";
    const { cards, rest } = splitCardSegments(prose);
    assert.deepEqual(cards, []);
    assert.equal(rest, prose);
  });
});

// ---------------------------------------------------------------------------
// 吞卡修复 II：终步「复述+卡」单换行粘接（refs #73 验收回放实锤）
// ---------------------------------------------------------------------------

describe("吞卡修复 II：终步工具复述与围栏卡粘接 → 复述摘除、卡送达", () => {
  // v3 回放 ROUND2 turn1 实锤形态：终步（无 tool_calls）消息正文 =
  // read_file 自检清单文档的编号行复述（3060 字符）+ survey_card 围栏
  // （1092 字符）被「单换行」粘接成同一块——stripToolEchoPrefix B 分支把
  // 复述连卡整块吞进 thinking（echo=4149），零 token 零卡送达。
  const numberedDocEcho = [
    "121\t自检清单（输出 plan 卡前逐项核对）：",
    "122\t",
    "123\t- id 来自 `find_exercises`/`list_exercises` 返回的真实条目（禁止编造）",
    "124\t- exercise_type 与动作库中该动作的类型一致",
    '125\t- sets/reps 为整数（reps 不能是 "8-12" 这类范围字符串）',
    "126\t- resistance 类 weight > 0（bodyweight/assisted 除外）",
    "127\t- 明日计划带 target 日期标记",
    "128\t",
  ].join("\n");
  const surveyFence =
    '```json\n{"type":"survey_card","title":"训练档案 · 初始问卷","data":{"questions":[{"id":"goal","question":"目标？","options":[{"label":"增肌","value":"muscle_gain"}],"required":true}]}}\n```';

  it("红测：粘接（单换行无空行）时卡必须送达、复述进 thinking", async () => {
    const glued = numberedDocEcho + "\n" + surveyFence; // ★单换行粘接
    const raws = [
      msgDelta("我先读一下技能的自检清单。"),
      modelRequestUpdate(aiWithTools(["read_file"])),
      toolUpdate(numberedDocEcho),
      msgDelta(glued),
      modelRequestUpdate(aiTerminal(glued)),
    ];

    const events = await classify(
      (async function* () {
        for (const r of raws) yield r;
      })(),
    );
    const hints = await collectHints(events);
    assert.ok(
      hints.includes("survey_card"),
      `粘接的卡必须被提取成 uiHint（实际 ${hints.join(",") || "无"}）`,
    );
    const tokens = texts(events, "token");
    assert.ok(
      tokens.includes("```json"),
      "卡围栏必须进 token 流（不得连复述一起被摘进 thinking）",
    );
    const thinking = texts(events, "thinking");
    assert.ok(
      thinking.includes("自检清单"),
      "复述部分照旧进 thinking（不泄漏）",
    );
    assert.equal(
      thinking.includes('"survey_card"'),
      false,
      "卡内容不得整体进 thinking（吞卡）",
    );
  });

  it("有空行分隔（既有形态）→ 行为不变：复述摘除、卡送达", async () => {
    const separated = numberedDocEcho + "\n\n" + surveyFence;
    const raws = [
      msgDelta(separated),
      modelRequestUpdate(aiTerminal(separated)),
    ];
    const events = await classify(
      (async function* () {
        for (const r of raws) yield r;
      })(),
    );
    const hints = await collectHints(events);
    assert.ok(hints.includes("survey_card"), "空行分隔形态卡照常送达");
    const thinking = texts(events, "thinking");
    assert.ok(thinking.includes("自检清单"), "复述照旧摘进 thinking");
  });
});

// ---------------------------------------------------------------------------
// 终步路径不受影响（回归防破坏）
// ---------------------------------------------------------------------------

describe("吞卡修复回归：终步卡片路径不受影响", () => {
  it("终步消息（无 tool_calls）含围栏卡 → 照常放行 + 提取", async () => {
    const answer =
      "这是你本周的计划：\n\n" + weeklyCardFence + "\n\n确认后开始。";
    const raws = [msgDelta(answer), modelRequestUpdate(aiTerminal(answer))];

    const events = await classify(
      (async function* () {
        for (const r of raws) yield r;
      })(),
    );
    const hints = await collectHints(events);
    assert.ok(hints.includes("weekly_plan"), "终步卡片照常提取");
    const tokens = texts(events, "token");
    assert.ok(tokens.includes("这是你本周的计划"), "终步散文照常放行");
    assert.ok(tokens.includes("确认后开始"), "终步尾部照常放行");
  });
});
