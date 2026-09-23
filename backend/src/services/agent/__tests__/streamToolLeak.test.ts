/**
 * 真流式 tool-leak 回归单测（2026-09-23）。
 *
 * 背景：主线合入真流式（2da9261）后，真实 LLM 回放发现工具返回内容泄漏进
 * 正文——卡片轮用户看到的正文混入 7-11k 字符（plan-generation/knowledge.md
 * 技能全文、list_exercises 动作库 JSON）。根因：旧版在 messages 流里用
 * `isAnswerStartBlock` 提前翻转 answerStarted，工具调用轮里模型复述的工具
 * 返回（CJK 主导 / 含围栏）被误判为「答案起点段」实时放行成 token。
 *
 * 修复：messages 流只缓冲，`updates.model_request` 快照的 tool_calls 标志
 * 是唯一判定锚——带 tool_calls → 缓冲全量转 thinking（零 token）；无
 * tool_calls → 终步，flush 缓冲 + 后续 delta 直通。
 *
 * 额外提供修复前后对照：把泄漏版旧逻辑（answerStarted 提前翻转）原样复刻
 * 成旧版分类器，同一合成流新旧同跑，证明旧版泄漏 token / 新版零 token。
 *
 * Runner: node:test via tsx（与 __tests__ 其余文件一致）。
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { classifyAgentStream } from "../DeepAgentService.js";
import {
  isAnswerStartBlock,
  stripToolEchoPrefix,
  stripToolEchoBlocks,
} from "../splitLeakedReasoning.js";
import { extractUiHintEvents } from "../uiHintExtractor.js";
import type { AgentEvent } from "shared/contracts";

// ---------------------------------------------------------------------------
// 合成流构造
// ---------------------------------------------------------------------------

/** messages delta: [AIMessageChunk, metadata]，chunk 仅需 .content。 */
function msgDelta(text: string): unknown {
  return ["messages", [{ content: text }, {}]];
}

/** updates 快照：model_request 节点的最后一条消息决定 step 分类。 */
function modelRequestUpdate(ai: unknown): unknown {
  return ["updates", { model_request: { messages: [ai] } }];
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

/** 把合成流喂进旧版分类器（复刻 2026-09-23 前泄漏逻辑），收集 token 文本。 */
async function classifyOld(
  raws: unknown[],
): Promise<{ tokens: string; answerStartedCount: number }> {
  // 旧版逻辑（git HEAD:DeepAgentService.ts isMessages 分支原样复刻）：
  // isAnswerStartBlock 提前翻转 answerStarted，已放行段落即刻 yield token。
  const BLOCK_SEP = "\n\n";
  const BLOCK_SEP_RE = /\n{2,}/;
  let tokens = "";
  let answerStarted = false;
  let preAnswer = "";
  let partial = "";

  async function* gen() {
    for (const r of raws) yield r;
  }
  for await (const raw of gen()) {
    let mode: string | undefined;
    let data: unknown = raw;
    if (
      Array.isArray(raw) &&
      typeof raw[0] === "string" &&
      (raw[0] === "messages" || raw[0] === "updates")
    ) {
      mode = raw[0];
      data = raw[1];
    }
    if (mode === "messages" || (mode === undefined && Array.isArray(data))) {
      const chunk = Array.isArray(data) ? (data as unknown[])[0] : undefined;
      const content = (chunk as { content?: string } | undefined)?.content;
      if (typeof content === "string" && content.length > 0) {
        partial += content;
        if (!answerStarted) {
          for (;;) {
            const m = BLOCK_SEP_RE.exec(partial);
            if (!m || m.index === undefined) break;
            const block = partial.slice(0, m.index);
            partial = partial.slice(m.index + m[0].length);
            if (isAnswerStartBlock(block)) {
              answerStarted = true;
              tokens += block + BLOCK_SEP;
              break;
            }
            // 旧版：未放行段攒进 preAnswer 等快照分类（此处仅复刻行为，
            // 无需读取——它在旧版里也只被 hasTools 分支消费，与 token 泄漏无关）。
            void preAnswer;
            preAnswer += block + BLOCK_SEP;
          }
        }
        if (answerStarted && partial) {
          tokens += partial;
          partial = "";
        }
      }
    }
  }
  return { tokens, answerStartedCount: answerStarted ? 1 : 0 };
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
// 回归测试：工具调用轮叙述绝不放行为 token
// ---------------------------------------------------------------------------

describe("tool-leak 回归：工具调用轮的中间叙述绝不产出 token 事件", () => {
  it("CJK 主导叙述（旧版会被 isAnswerStartBlock 误判为答案起点）→ 零 token", async () => {
    // 模型调 list_exercises 前先写一段中文叙述——CJK 主导、非自言自语，
    // 旧判定规则会把它当成答案起点实时放行。
    const narration =
      "好的，我先查看动作库中可用的动作列表，确认用户目前掌握的动作，再为他安排明天的训练计划。";
    const raws = [
      msgDelta(narration),
      modelRequestUpdate(aiWithTools(["list_exercises"])),
      // 终步答案随后落地，验证中间步内容与答案严格隔离。
      msgDelta("这是明天的计划："),
      msgDelta("深蹲 3 组 × 8 次。"),
      modelRequestUpdate(aiTerminal("这是明天的计划：深蹲 3 组 × 8 次。")),
    ];

    const events = await classify(
      (async function* () {
        for (const r of raws) yield r;
      })(),
    );
    const tokens = texts(events, "token");
    assert.equal(
      tokens.includes(narration),
      false,
      `中间叙述不得进入 token，实际 token 文本: ${tokens}`,
    );
    // 但叙述可进入 thinking（或丢弃），且终步答案正常放行。
    assert.ok(tokens.includes("这是明天的计划"), "终步答案必须正常放行");
    assert.ok(tokens.includes("深蹲"), "终步答案必须正常放行");
  });

  it("read_file 技能全文复述（含 ``` 围栏，旧判定必然误判）→ 零 token", async () => {
    // 工具调用轮把 read_file 返回的技能文件原文复述进 content，含 json 围栏。
    const skillLeak = [
      "我已经阅读了计划生成技能文档，关键要点如下：",
      "```markdown",
      "# Plan generation skill",
      "五要素：目标 / 经验 / 器械 / 频率 / 恢复。",
      "新手空杆 20kg 起步，最小配重 2.5-5kg。",
      "每次调整只改一个变量，宁轻勿伤。",
      "```",
    ].join("\n\n");
    const raws = [
      msgDelta(skillLeak),
      modelRequestUpdate(aiWithTools(["read_file", "list_exercises"])),
      msgDelta("好的，明天计划已生成。"),
      modelRequestUpdate(aiTerminal("好的，明天计划已生成。")),
    ];

    const events = await classify(
      (async function* () {
        for (const r of raws) yield r;
      })(),
    );
    const tokens = texts(events, "token");
    assert.equal(
      tokens.includes(skillLeak),
      false,
      "技能全文不得泄漏进 token（旧版围栏块必被误判放行）",
    );
    assert.ok(tokens.includes("明天计划已生成"), "终步答案正常放行");
  });

  it("list_exercises 动作库 JSON 复述 → 零 token", async () => {
    // 工具调用轮把动作库 JSON 原样写进 content。
    const jsonLeak = JSON.stringify(
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
      msgDelta(jsonLeak),
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
    assert.equal(
      tokens.includes("ex-1"),
      false,
      "动作库 JSON 不得泄漏进 token",
    );
    assert.ok(tokens.includes("这是最终计划"), "终步答案正常放行");
  });

  it("纯文本轮（无工具调用）：缓冲 flush 成逐段 token，不丢答案", async () => {
    // 单步纯文本轮：全部 delta 缓冲 → 终步快照 flush 为 token chunks。
    const answer = "好的，先热身再训练。";
    const raws = [
      msgDelta("好的，先"),
      msgDelta("热身再训"),
      msgDelta("练。"),
      modelRequestUpdate(aiTerminal(answer)),
    ];

    const events = await classify(
      (async function* () {
        for (const r of raws) yield r;
      })(),
    );
    const tokens = texts(events, "token");
    assert.equal(
      tokens.replace(/\s/g, ""),
      answer.replace(/\s/g, ""),
      "纯文本轮答案完整",
    );
    assert.ok(
      events.some((e) => e.type === "done"),
      "done 事件必达",
    );
  });

  it("终步快照后的 delta 直通（answerLive），首字延迟收益保留", async () => {
    // 终步快照落地后，剩余 delta 逐条实时放行而非重新缓冲。
    const answer = "明天练腿。";
    const raws = [
      msgDelta("明天练"),
      msgDelta("腿。"),
      modelRequestUpdate(aiTerminal(answer)),
      msgDelta("补充："),
      msgDelta("先热身。"),
    ];

    const events = await classify(
      (async function* () {
        for (const r of raws) yield r;
      })(),
    );
    const tokens = texts(events, "token");
    assert.ok(tokens.includes("明天练腿"), "快照前的缓冲 flush 放行");
    assert.ok(tokens.includes("补充："), "快照后的 delta 直通放行");
    assert.ok(tokens.includes("先热身。"), "快照后的 delta 直通放行");
  });

  it("多工具轮（连续中间步）叙述全部隔离，只有终步进 token", async () => {
    const round1 = "先看看用户当前状态，确认动作库。";
    const round2 = "动作库确认完毕，我再读取计划生成技能。";
    const finalAnswer = "明天计划：深蹲 3×8。";
    const raws = [
      msgDelta(round1),
      modelRequestUpdate(aiWithTools(["list_exercises"])),
      msgDelta(round2),
      modelRequestUpdate(aiWithTools(["read_file"])),
      msgDelta(finalAnswer),
      modelRequestUpdate(aiTerminal(finalAnswer)),
    ];

    const events = await classify(
      (async function* () {
        for (const r of raws) yield r;
      })(),
    );
    const tokens = texts(events, "token");
    assert.equal(tokens.includes(round1), false, "第 1 轮叙述不进 token");
    assert.equal(tokens.includes(round2), false, "第 2 轮叙述不进 token");
    assert.ok(tokens.includes("深蹲"), "终步答案进 token");
  });

  it("流在快照前结束：未分类缓冲按叙述转 thinking，绝不猜成 token", async () => {
    // 模拟断流：delta 到达但 updates 快照从未落地（工具调用中/超时）。
    const dangling = "我先查看一下动作库……";
    const raws = [msgDelta(dangling)];

    const events = await classify(
      (async function* () {
        for (const r of raws) yield r;
      })(),
    );
    const tokens = texts(events, "token");
    assert.equal(tokens, "", "无快照 = 无 token（绝不猜）");
    const thinking = texts(events, "thinking");
    assert.ok(thinking.includes(dangling), "悬空缓冲进 thinking 不丢失");
    assert.ok(
      events.some((e) => e.type === "done"),
      "done 事件必达",
    );
  });
});

// ---------------------------------------------------------------------------
// 修复前后对照：同一合成流，旧版泄漏 token / 新版零 token
// ---------------------------------------------------------------------------

describe("tool-leak 修复前后对照（同一合成流）", () => {
  const bigLeak = Array.from(
    { length: 120 },
    (_, i) =>
      `动作 ${i}：哑铃卧推（胸）——每组 8-12 次，注意肘部角度，宁轻勿伤。`,
  ).join("\n");

  it("工具轮复述 CJK 长文本：旧版全量泄漏进 token，新版零 token", async () => {
    const raws = [
      msgDelta("我已经查到动作库，内容如下：\n\n"),
      msgDelta(bigLeak),
      msgDelta("\n\n接下来我会据此制定计划。"),
      modelRequestUpdate(aiWithTools(["list_exercises"])),
      msgDelta("明天计划：深蹲 3×8。"),
      modelRequestUpdate(aiTerminal("明天计划：深蹲 3×8。")),
    ];

    const oldRes = await classifyOld(raws);
    assert.ok(
      oldRes.tokens.includes("动作 0：哑铃卧推"),
      `旧版应泄漏复述文本进 token（实际 ${oldRes.tokens.length} 字符）`,
    );

    const events = await classify(
      (async function* () {
        for (const r of raws) yield r;
      })(),
    );
    const tokens = texts(events, "token");
    assert.equal(
      tokens.includes("动作 0：哑铃卧推"),
      false,
      "新版中间轮复述零泄漏",
    );
    assert.ok(tokens.includes("明天计划"), "新版终步答案正常放行");
    // 量化对比：新版 token 长度远小于泄漏文本长度。
    assert.ok(
      tokens.length < bigLeak.length / 2,
      `新版 token 总长 ${tokens.length} 应远小于泄漏文本 ${bigLeak.length}`,
    );
  });

  it("工具轮复述围栏 JSON：旧版围栏块被 isAnswerStartBlock 必判为答案 → 泄漏；新版零 token", async () => {
    const fenced =
      '```json\n{\n  "plan": { "goal": "增肌", "days": 4 }\n}\n```';
    const raws = [
      msgDelta("计划技能文件内容：\n\n"),
      msgDelta(fenced),
      modelRequestUpdate(aiWithTools(["read_file"])),
      msgDelta("好的，明天计划已生成。"),
      modelRequestUpdate(aiTerminal("好的，明天计划已生成。")),
    ];

    const oldRes = await classifyOld(raws);
    assert.ok(
      oldRes.tokens.includes("```json"),
      `旧版围栏块必被误判为答案起点泄漏（实际 token: ${oldRes.tokens.slice(0, 40)}）`,
    );

    const events = await classify(
      (async function* () {
        for (const r of raws) yield r;
      })(),
    );
    const tokens = texts(events, "token");
    assert.equal(tokens.includes("```json"), false, "新版围栏复述零泄漏");
    assert.ok(tokens.includes("明天计划已生成"), "新版终步答案正常放行");
  });
});

// ---------------------------------------------------------------------------
// 返工 v2（2026-09-23）：终步消息复述工具返回 → 拦截成 thinking，零 token
// ---------------------------------------------------------------------------
// 第一版修复（updates 快照锚）封住了「中间步叙述」泄漏，但真实 LLM 回放暴露：
// 模型在「无 tool_calls 的终步消息」里复述工具返回（动作库 JSON / 技能文件
// 全文），splitLeakedReasoning 把复述判成 answer 放行成 token（首正文时间=
// 完成时间，flush 一次性吐出 7-11k 字符）。本节验证：终步复述命中工具返回
// 特征 → 整段转 thinking，绝不放行成 token。
describe("tool-leak 返工：终步消息复述工具返回 → 拦截零 token", () => {
  // 与 mcpTools.list_exercises 真实返回同构的动作库 JSON（count + exercises）
  const actionLibJson = JSON.stringify({
    count: 31,
    exercises: Array.from({ length: 31 }, (_, i) => ({
      id: `ex-${i + 1}`,
      name: `动作${i + 1}`,
      type: i % 3 === 0 ? "compound" : "isolation",
      equipment: "barbell",
      description:
        "这是动作库中的第 " + (i + 1) + " 个动作，用于训练计划编排参考。",
    })),
  });

  it("终步复述动作库 JSON（count+exercises 签名）→ 零 token", async () => {
    // 模型在无 tool_calls 的终步消息里原样复述 list_exercises 返回——
    // 快照锚把它判为「无工具终步」，旧逻辑 splitLeakedReasoning 因 JSON 含
    // 中文描述（CJK 主导）放行成 answer → 泄漏。
    const raws = [
      msgDelta(actionLibJson),
      modelRequestUpdate(aiTerminal(actionLibJson)),
    ];

    const events = await classify(
      (async function* () {
        for (const r of raws) yield r;
      })(),
    );
    const tokens = texts(events, "token");
    assert.equal(
      tokens.length,
      0,
      `终步复述动作库 JSON 必须零 token（实际 ${tokens.length} 字符）`,
    );
    const thinking = texts(events, "thinking");
    assert.ok(
      thinking.includes('"count"'),
      "复述应整体进入 thinking 面板（不丢失）",
    );
    assert.ok(
      events.some((e) => e.type === "done"),
      "done 事件必达",
    );
  });

  it("终步复述技能文件头（# 计划生成知识指南）→ 零 token", async () => {
    // 模型终步复述 plan-generation/knowledge.md 全文——以标题行开头，
    // CJK 主导且无自说自话特征，旧 splitLeakedReasoning 必判为 answer。
    const skillLeak = [
      "# 计划生成知识指南 (Plan Generation Knowledge Guide)",
      "",
      "> 本指南由 Starfit MAS 系统维护，基于当前运动科学研究和最佳实践设计。",
      "",
      "## 一、动作选择原则",
      "",
      "### 1.1 复合动作优先原则",
      "",
      "- **复合动作占比**：60-70% 的训练量应来自复合动作",
      "- **优先级排序**：",
      "  1. 大肌群复合动作（深蹲、卧推、硬拉、引体向上、划船）",
      "  2. 多关节孤立动作（侧平举、弯举、三头下压）",
    ].join("\n");
    const raws = [
      msgDelta(skillLeak),
      modelRequestUpdate(aiTerminal(skillLeak)),
    ];

    const events = await classify(
      (async function* () {
        for (const r of raws) yield r;
      })(),
    );
    const tokens = texts(events, "token");
    assert.equal(
      tokens.length,
      0,
      `终步复述技能文件头必须零 token（实际 ${tokens.length} 字符）`,
    );
    const thinking = texts(events, "thinking");
    assert.ok(
      thinking.includes("# 计划生成知识指南"),
      "技能文件复述应整体进入 thinking 面板",
    );
    assert.ok(
      events.some((e) => e.type === "done"),
      "done 事件必达",
    );
  });

  it("终步复述纯 JSON 结构（{ 开头 + 结构字符 >60%）→ 零 token", async () => {
    // 无 count/exercises 签名的裸 JSON 大块（如 load_history 等工具返回的
    // 其他 JSON 形状）——靠 B 规则：以 { 开头且非空白中结构字符占比 >60%。
    const bareJson = JSON.stringify({
      items: Array.from({ length: 20 }, (_, i) => ({
        k: `key_${i}`,
        v: `val_${i}`,
        t: i,
      })),
    });
    assert.ok(bareJson.length > 400, "样本需足够大才符合「大段 JSON」");
    const raws = [msgDelta(bareJson), modelRequestUpdate(aiTerminal(bareJson))];

    const events = await classify(
      (async function* () {
        for (const r of raws) yield r;
      })(),
    );
    const tokens = texts(events, "token");
    assert.equal(
      tokens.length,
      0,
      `终步复述裸 JSON 必须零 token（实际 ${tokens.length} 字符）`,
    );
    assert.ok(
      events.some((e) => e.type === "done"),
      "done 事件必达",
    );
  });

  it("终步纯文本答案不受拦截影响（无工具返回特征）→ 正常放行", async () => {
    // 回归保护：合法终步答案（中文叙述 + 短 JSON 卡片围栏）不得误拦截。
    const answer = [
      "明天的训练计划如下：",
      "```json",
      '{"type":"plan_card","title":"明日训练","items":[{"name":"深蹲","sets":3}]}',
      "```",
      "请按以上计划执行。",
    ].join("\n");
    const raws = [msgDelta(answer), modelRequestUpdate(aiTerminal(answer))];

    const events = await classify(
      (async function* () {
        for (const r of raws) yield r;
      })(),
    );
    const tokens = texts(events, "token");
    assert.ok(
      tokens.includes("明天的训练计划如下"),
      "合法答案必须放行（实际 token 缺失）",
    );
    assert.ok(
      tokens.includes("```json"),
      "围栏卡片必须到达 token 流（uiHint 提取器只扫 token）",
    );
    assert.ok(tokens.includes("请按以上计划执行"), "答案尾部正常放行");
  });

  it("终步复述动作库 JSON 后跟真答案 delta：复述进 thinking，后续 delta 按 token 直通", async () => {
    // v3 语义（返工）：剥离复述段后，快照之后到达的正常回答 delta 必须放行
    // 为 token——v2 的保守「拦截后不翻 answerLive」会把它们吞进 thinking，
    // 正是被返工的「整段吞卡吞答」行为在快照边界的翻版。
    const raws = [
      msgDelta(actionLibJson),
      modelRequestUpdate(aiTerminal(actionLibJson)),
      msgDelta("以上是动作库，明天计划如下："),
      msgDelta("深蹲 3×8。"),
    ];

    const events = await classify(
      (async function* () {
        for (const r of raws) yield r;
      })(),
    );
    const tokens = texts(events, "token");
    const thinking = texts(events, "thinking");
    assert.ok(thinking.includes('"count"'), "复述段进 thinking 面板");
    assert.equal(tokens.includes('"exercises"'), false, "复述内容不得进 token");
    assert.ok(tokens.includes("深蹲 3×8"), "后续正常回答 delta 放行为 token");
  });
});

// ---------------------------------------------------------------------------
// 返工 v3（2026-09-23）：只剥离工具复述段，保留正常回答与围栏卡片
// ---------------------------------------------------------------------------
// v2（efabc98）对「整个 stepRaw」跑 looksLikeToolReturnEcho，命中即整段转
// thinking——真实 LLM 回放 3 轮全部正文 0 字符 + 卡片 0 张（被吞 thinking
// 18969 字符 = 动作库 JSON 复述 + 围栏 survey_card + 中文回答）。真实终步消息
// 是「复述段 + 围栏卡片 + 正常回答」混合体：模型先 echo 工具返回再写真实回复。
// v3 用 stripToolEchoPrefix 只摘开头裸复述段进 thinking，其余继续走
// splitLeakedReasoning（answer 进 token、围栏卡片经 uiHint 提取正常落地）。

describe("tool-leak 返工 v3：终步剥离复述段，保留正常回答与围栏卡片", () => {
  const actionLibJson = JSON.stringify({
    count: 31,
    exercises: Array.from({ length: 31 }, (_, i) => ({
      id: `ex-${i + 1}`,
      name: `动作${i + 1}`,
      type: i % 3 === 0 ? "compound" : "isolation",
      equipment: "barbell",
      description: "动作库第 " + (i + 1) + " 个动作，用于计划编排参考。",
    })),
  });
  const loadHistoryJson = JSON.stringify({
    userId: "a015dd22-9fd2-47ae-bbcb-aaa90bd2aebb",
    history_summary: { sessions: [] },
    profile_static: {},
    profile_dynamic: {},
  });
  const surveyCard = [
    "```json",
    JSON.stringify(
      {
        type: "survey_card",
        title: "先确认三件事",
        data: {
          questions: [
            {
              id: "goal",
              question: "你训练的主要目标是什么？",
              options: [
                { label: "增肌", value: "muscle_gain" },
                { label: "减脂", value: "fat_loss" },
              ],
              required: true,
            },
          ],
        },
        priority: 1,
      },
      null,
      2,
    ),
    "```",
  ].join("\n");

  it("1. 终步 = 动作库 JSON 复述 + 围栏 survey_card + 中文回答 → 复述进 thinking、回答进 token、卡片被 uiHint 提取", async () => {
    // 必测场景 1：真实 LLM 终步消息的混合形态（v2 整段吞掉的全部三件套）。
    const mixed =
      actionLibJson +
      "\n\n" +
      surveyCard +
      "\n\n答完这三个问题，我马上给你出明天的完整计划";
    const raws = [msgDelta(mixed), modelRequestUpdate(aiTerminal(mixed))];

    const events = await classify(
      (async function* () {
        for (const r of raws) yield r;
      })(),
    );
    const tokens = texts(events, "token");
    const thinking = texts(events, "thinking");
    // 复述段 → thinking（精确摘除，不含正常回答）
    assert.ok(thinking.includes('"count"'), "动作库 JSON 复述进 thinking");
    assert.ok(thinking.includes('"exercises"'), "动作库 JSON 复述进 thinking");
    assert.equal(
      thinking.includes("答完这三个问题"),
      false,
      "正常中文回答不得被误吞进 thinking",
    );
    // 中文回答 → token
    assert.ok(tokens.includes("答完这三个问题"), "中文回答进 token");
    assert.ok(tokens.includes("完整计划"), "中文回答尾部进 token");
    // 围栏卡片 → token 流（uiHintExtractor 只扫 token），并可被提取成 uiHint
    assert.ok(tokens.includes("```json"), "围栏卡片完整保留在 token 流");
    assert.ok(tokens.includes("survey_card"), "围栏卡片 JSON 进 token 流");
    assert.ok(tokens.includes("先确认三件事"), "卡片载荷未被剥离/截断");
    assert.equal(
      tokens.includes('"exercises"'),
      false,
      "复述 JSON 不得泄漏进 token",
    );
    const hints = await collectHints(events);
    assert.ok(
      hints.includes("survey_card"),
      `围栏卡片必须被 uiHintExtractor 提取成 uiHint 事件（实际 ${hints.join(",")}）`,
    );
  });

  it("2. 终步 = 技能文件头复述 + 中文回答 → 复述进 thinking、回答进 token", async () => {
    // 必测场景 2：技能头（# 计划生成知识指南）复述 + 正常回答。
    const skillHead = [
      "# 计划生成知识指南 (Plan Generation Knowledge Guide)",
      "> 本指南由 Starfit MAS 系统维护，基于当前运动科学研究和最佳实践设计。",
      "好的，这是为你准备的明天训练计划：",
      "深蹲 3 组 × 8 次。",
    ].join("\n\n");
    const raws = [
      msgDelta(skillHead),
      modelRequestUpdate(aiTerminal(skillHead)),
    ];

    const events = await classify(
      (async function* () {
        for (const r of raws) yield r;
      })(),
    );
    const tokens = texts(events, "token");
    const thinking = texts(events, "thinking");
    assert.ok(
      thinking.includes("# 计划生成知识指南"),
      "技能文件头复述进 thinking",
    );
    assert.ok(
      thinking.includes("本指南由 Starfit MAS"),
      "技能头延续块一起进 thinking",
    );
    assert.ok(
      tokens.includes("好的，这是为你准备的明天训练计划"),
      "中文回答进 token",
    );
    assert.ok(tokens.includes("深蹲 3 组"), "回答内容进 token");
    assert.equal(
      thinking.includes("好的，这是为你准备的"),
      false,
      "正常回答不得进 thinking",
    );
  });

  it("3. 纯正常回答（无复述）→ 全进 token（v1 isAnswerStartBlock 路径防回归）", async () => {
    // 必测场景 3：英文草稿 + 中文回答 —— splitLeakedReasoning 原路径必须
    // 完好：草稿进 thinking、回答进 token，且 stripToolEchoPrefix 不得误伤。
    const answer = [
      "Let me check the user's profile first.",
      "好的，明天的计划已经为你准备好了：",
      "深蹲 3 组 × 8 次。",
    ].join("\n\n");
    const raws = [msgDelta(answer), modelRequestUpdate(aiTerminal(answer))];

    const events = await classify(
      (async function* () {
        for (const r of raws) yield r;
      })(),
    );
    const tokens = texts(events, "token");
    const thinking = texts(events, "thinking");
    assert.ok(
      tokens.includes("好的，明天的计划已经为你准备好了"),
      "中文回答全进 token",
    );
    assert.ok(tokens.includes("深蹲 3 组 × 8 次"), "回答尾部进 token");
    assert.ok(thinking.includes("Let me check"), "英文草稿仍走 thinking");
    assert.equal(tokens.includes("Let me check"), false, "草稿不进 token");
    const hints = await collectHints(events);
    assert.equal(hints.length, 0, "无卡片时不产生 uiHint");
  });

  it("真实形态：动作库 JSON + load_history JSON 无分隔符粘接 + 中文回答 + 围栏卡片", async () => {
    // 实测（fix2 回放）：`]}{"userId"` 两个工具返回直接粘接，随后同一行紧跟
    // 中文回答，再换行出围栏 survey_card，结尾还有一句补充提问。
    const real =
      actionLibJson +
      loadHistoryJson +
      "新账号第一次出计划，先确认三件事，我就把明天的训练安排定下来：\n\n" +
      surveyCard +
      "\n\n另外顺带告诉我：每周能练几次、体重多少、有没有旧伤，我一起写进计划。";
    const raws = [msgDelta(real), modelRequestUpdate(aiTerminal(real))];

    const events = await classify(
      (async function* () {
        for (const r of raws) yield r;
      })(),
    );
    const tokens = texts(events, "token");
    const thinking = texts(events, "thinking");
    assert.ok(thinking.includes('"count"'), "动作库 JSON 复述进 thinking");
    assert.ok(
      thinking.includes('"history_summary"'),
      "粘接的 load_history JSON 一起进 thinking",
    );
    assert.ok(
      thinking.includes('"profile_static"'),
      "粘接的 load_history JSON 一起进 thinking",
    );
    assert.equal(
      thinking.includes("新账号第一次出计划"),
      false,
      "粘接 JSON 之后的同行中文回答不得进 thinking",
    );
    assert.ok(tokens.includes("新账号第一次出计划"), "中文回答进 token");
    assert.ok(tokens.includes("另外顺带告诉我"), "结尾回答进 token");
    assert.ok(tokens.includes("```json"), "围栏卡片进 token 流");
    assert.equal(
      tokens.includes('"count"'),
      false,
      "复述 JSON 不得泄漏进 token",
    );
    const hints = await collectHints(events);
    assert.ok(hints.includes("survey_card"), "survey_card 被 uiHint 提取");
  });

  it("真实形态：read_file 编号行复述（技能索引 1\\t---） + 围栏卡片 + 回答", async () => {
    // 实测（fix2 回放）：模型在终步复述 read_file 返回的技能索引——每行
    // 「行号+Tab」，随后换行出围栏 survey_card。
    const skillIndex = [
      "1\t---",
      '2\tname: "plan-generation"',
      '3\tdescription: "计划生成能力包 - 训练容量计算、历史数据加载"',
      '4\tskills: ["knowledge.md", "prompt.md"]',
      '5\tversion: "3.1.0"',
    ].join("\n");
    const msg =
      skillIndex +
      "\n\n" +
      surveyCard +
      "\n\n以上是技能索引，我来按它制定计划。";
    const raws = [msgDelta(msg), modelRequestUpdate(aiTerminal(msg))];

    const events = await classify(
      (async function* () {
        for (const r of raws) yield r;
      })(),
    );
    const tokens = texts(events, "token");
    const thinking = texts(events, "thinking");
    assert.ok(thinking.includes("1\t---"), "read_file 编号行复述进 thinking");
    assert.ok(thinking.includes("plan-generation"), "编号复述内容进 thinking");
    assert.ok(tokens.includes("以上是技能索引"), "中文回答进 token");
    assert.ok(tokens.includes("```json"), "围栏卡片进 token 流");
    const hints = await collectHints(events);
    assert.ok(hints.includes("survey_card"), "survey_card 被 uiHint 提取");
  });

  it("纯复述（无回答）→ 复述全进 thinking、零 token（v2 行为保持）", async () => {
    const raws = [
      msgDelta(actionLibJson),
      modelRequestUpdate(aiTerminal(actionLibJson)),
    ];
    const events = await classify(
      (async function* () {
        for (const r of raws) yield r;
      })(),
    );
    const tokens = texts(events, "token");
    const thinking = texts(events, "thinking");
    assert.equal(tokens.length, 0, "纯复述轮零 token");
    assert.ok(thinking.includes('"exercises"'), "复述全进 thinking 不丢失");
  });
});

describe("stripToolEchoPrefix 直接单测（剥离边界契约）", () => {
  it("动作库 JSON + 围栏卡片 + 中文 → 只剥 JSON", () => {
    const json = '{"count":1,"exercises":[{"id":"ex_1","name":"深蹲"}]}';
    const card = '```json\n{"type":"survey_card","title":"t"}\n```';
    const answer = "答完这三个问题，我马上给你出计划。";
    const { echo, rest } = stripToolEchoPrefix(
      json + "\n\n" + card + "\n\n" + answer,
    );
    assert.equal(echo, json, "只剥 JSON 复述段");
    assert.ok(rest.includes("```json"), "围栏卡片留在 rest");
    assert.ok(rest.includes(answer), "中文回答留在 rest");
  });

  it("中文回答开头（无复述）→ 完全不剥", () => {
    const answer = "好的，这是你的明天训练计划：\n\n深蹲 3 组 × 8 次。";
    const { echo, rest } = stripToolEchoPrefix(answer);
    assert.equal(echo, "");
    assert.equal(rest, answer);
  });

  it("围栏卡片开头 → 完全不剥（卡片绝不能被当成复述）", () => {
    const card = '```json\n{"type":"survey_card","title":"先确认"}\n```';
    const { echo, rest } = stripToolEchoPrefix(card + "\n\n请回答。");
    assert.equal(echo, "");
    assert.ok(rest.includes("survey_card"));
  });

  it("带顶层 type 的裸 inline JSON（未包围栏的卡片）→ 不剥", () => {
    const inlineCard = '{"type":"plan_card","title":"明日计划","items":[]}';
    const { echo, rest } = stripToolEchoPrefix(
      inlineCard + "\n\n请按计划执行。",
    );
    assert.equal(echo, "");
    assert.ok(rest.includes("plan_card"));
  });

  it("短 JSON（无签名、<300 字符）→ 不剥", () => {
    const short = '{"ok":true,"msg":"已保存"}';
    const { echo, rest } = stripToolEchoPrefix(short + "\n\n好的。");
    assert.equal(echo, "");
    assert.ok(rest.includes(short));
  });

  it("技能文件头 + 文档结构延续 + 中文回答 → 头与延续剥、回答留", () => {
    const head =
      "# 计划生成知识指南 (Plan Generation Knowledge Guide)\n\n" +
      "> 本指南由 Starfit MAS 系统维护。\n\n" +
      "## 一、动作选择原则\n\n" +
      "- **复合动作占比**：60-70%\n\n" +
      "好的，这是为你准备的明天计划：";
    const { echo, rest } = stripToolEchoPrefix(head);
    assert.ok(echo.includes("# 计划生成知识指南"));
    assert.ok(echo.includes("## 一、动作选择原则"));
    assert.ok(echo.includes("复合动作占比"));
    assert.ok(rest.includes("好的，这是为你准备的"));
  });
});

// ---------------------------------------------------------------------------
// 返工 v4（2026-09-23）：任意位置复述块剥离（全段扫描）
// ---------------------------------------------------------------------------
// v3（stripToolEchoPrefix）只剥「前缀」复述；真实 DeepSeek 行为是「先写引导语
// → 再整段 echo read_file 返回（编号行 frontmatter）→ 再写真实回答」——复述在
// 中间/后置位置时 v3 前导判定全部失效，splitLeakedReasoning 把复述误判成
// answer 放行成 token（协调者实测 6115 / 2480 字符泄漏）。v4 在 answer 部分
// 逐块（\n{2,} 分隔）全段扫描：命中复述特征 → 摘进 thinking；未命中 → 保留。
describe("tool-leak 返工 v4：任意位置复述块剥离（全段扫描）", () => {
  // 与协调者泄漏 dump 同构的 read_file 编号行 frontmatter（CJK 主导，会被
  // splitLeakedReasoning 误判为 answer 起点——正是 v3 漏网的形态）
  const numberedEcho = [
    "1\t---",
    '2\tname: "plan-generation"',
    '3\tdescription: "计划生成能力包 - 训练容量计算、历史数据加载与个性化训练计划编排"',
    '4\tskills: ["knowledge.md", "prompt.md"]',
    '5\tversion: "3.1.0"',
    "6\t# 计划生成知识指南",
    "7\t## 一、动作选择原则",
    "8\t- 复合动作占比 60-70%，动作顺序先大肌群后小肌群",
  ].join("\n");

  it("1. 中间复述形态：引导语 + 编号行 frontmatter 复述 + 围栏卡片 + 正常回答 → 复述进 thinking、引导语/回答/卡片进 token", async () => {
    // 协调者实测形态：模型先写引导语，再整段复述 read_file 返回，再写真实回答。
    // v3 的 firstBlock=引导语块 → isNumberedToolEcho 判定失败 → 整段放行泄漏。
    const leadIn = "好的，明天的训练计划安排如下。";
    const answer = "深蹲 3 组 × 8 次，卧推 3 组 × 10 次。";
    const surveyCard = [
      "```json",
      JSON.stringify(
        {
          type: "survey_card",
          title: "先确认",
          data: { questions: [{ id: "goal", question: "目标？" }] },
        },
        null,
        2,
      ),
      "```",
    ].join("\n");
    const msg =
      leadIn + "\n\n" + numberedEcho + "\n\n" + surveyCard + "\n\n" + answer;
    const raws = [msgDelta(msg), modelRequestUpdate(aiTerminal(msg))];

    const events = await classify(
      (async function* () {
        for (const r of raws) yield r;
      })(),
    );
    const tokens = texts(events, "token");
    const thinking = texts(events, "thinking");
    // 复述块（中间位置）→ thinking
    assert.ok(
      thinking.includes('name: "plan-generation"'),
      "中间位置编号行复述必须进 thinking",
    );
    assert.ok(thinking.includes("# 计划生成知识指南"), "复述块整体进 thinking");
    assert.equal(
      thinking.includes("深蹲 3 组 × 8 次"),
      false,
      "正常回答不得进 thinking",
    );
    assert.equal(
      thinking.includes("好的，明天的训练计划安排如下"),
      false,
      "引导语不得进 thinking",
    );
    // 引导语 + 回答 + 围栏卡片 → token
    assert.ok(
      tokens.includes("好的，明天的训练计划安排如下"),
      "引导语进 token",
    );
    assert.ok(tokens.includes("深蹲 3 组 × 8 次"), "正常回答进 token");
    assert.ok(tokens.includes("```json"), "围栏卡片保留在 token 流");
    assert.ok(tokens.includes("survey_card"), "卡片载荷未被剥离");
    assert.equal(
      tokens.includes('name: "plan-generation"'),
      false,
      "复述块绝不泄漏进 token",
    );
    const hints = await collectHints(events);
    assert.ok(hints.includes("survey_card"), "survey_card 被 uiHint 提取");
  });

  it("2. 后置复述形态：正常回答 + 复述块（无后续）→ 复述摘除、回答保留", async () => {
    // 复述在末尾（模型先答完再 echo 工具返回，或 echo 后无真实回答）。
    const answer = "好的，明天的计划是深蹲 3 组 × 8 次。";
    const msg = answer + "\n\n" + numberedEcho;
    const raws = [msgDelta(msg), modelRequestUpdate(aiTerminal(msg))];

    const events = await classify(
      (async function* () {
        for (const r of raws) yield r;
      })(),
    );
    const tokens = texts(events, "token");
    const thinking = texts(events, "thinking");
    assert.ok(
      thinking.includes('name: "plan-generation"'),
      "后置复述块进 thinking",
    );
    assert.ok(
      tokens.includes("好的，明天的计划是深蹲"),
      "正常回答保留进 token",
    );
    assert.equal(
      tokens.includes('name: "plan-generation"'),
      false,
      "后置复述不得泄漏进 token",
    );
  });

  it("3. 围栏卡片块紧邻复述块 → 卡片块绝不摘（token 载体）", async () => {
    // 复述块与围栏卡片之间无任何叙述缓冲，直接相邻。
    const surveyCard = [
      "```json",
      JSON.stringify({
        type: "survey_card",
        title: "紧邻测试",
        data: { questions: [{ id: "q", question: "？", options: [] }] },
      }),
      "```",
    ].join("\n");
    const msg =
      numberedEcho + "\n\n" + surveyCard + "\n\n" + "请回答以上问题。";
    const raws = [msgDelta(msg), modelRequestUpdate(aiTerminal(msg))];

    const events = await classify(
      (async function* () {
        for (const r of raws) yield r;
      })(),
    );
    const tokens = texts(events, "token");
    const thinking = texts(events, "thinking");
    assert.ok(thinking.includes('name: "plan-generation"'), "复述进 thinking");
    assert.ok(tokens.includes("```json"), "围栏卡片必须完整保留在 token 流");
    assert.ok(tokens.includes("survey_card"), "卡片 JSON 内容不得被剥离");
    assert.ok(tokens.includes("紧邻测试"), "卡片载荷完整");
    assert.equal(
      tokens.includes('name: "plan-generation"'),
      false,
      "复述不得泄漏",
    );
    const hints = await collectHints(events);
    assert.ok(hints.includes("survey_card"), "紧邻复述的卡片仍被提取");
  });

  it("4. 纯正常回答（含围栏卡片）→ 全进 token（回归防破坏）", async () => {
    // 无任何复述的合法回答：中文叙述 + 围栏卡片，stripToolEchoBlocks 不得误摘。
    const card = [
      "```json",
      JSON.stringify({ type: "plan_card", title: "明日训练", items: [] }),
      "```",
    ].join("\n");
    const msg = "好的，明天计划如下：\n\n" + card + "\n\n" + "请按计划执行。";
    const raws = [msgDelta(msg), modelRequestUpdate(aiTerminal(msg))];

    const events = await classify(
      (async function* () {
        for (const r of raws) yield r;
      })(),
    );
    const tokens = texts(events, "token");
    assert.ok(tokens.includes("好的，明天计划如下"), "叙述进 token");
    assert.ok(tokens.includes("```json"), "围栏卡片进 token");
    assert.ok(tokens.includes("请按计划执行"), "回答尾部进 token");
    const hints = await collectHints(events);
    assert.ok(hints.includes("plan_card"), "plan_card 被 uiHint 提取");
  });

  it("5. 中间复述形态（技能头延续被空行切开）→ 链式延续块一并摘除", async () => {
    // read_file 输出内部含空行，编号行 frontmatter 被 \n{2,} 切成多块；
    // 首块命中后，后续文档结构块（isSkillDocContinuation）链式跟剥。
    const echoPart1 = ["1\t---", '2\tname: "plan-generation"'].join("\n");
    const echoPart2 = [
      '3\tdescription: "计划生成能力包 - 训练容量计算、历史数据加载"',
      '4\tversion: "3.1.0"',
      "5\t# 计划生成知识指南",
      "6\t## 一、动作选择原则",
      "7\t- 复合动作占比 60-70%，动作顺序先大肌群后小肌群",
    ].join("\n");
    const leadIn = "好的，我来看一下计划生成相关的技能说明。";
    const answer = "明天练深蹲 3 组 × 8 次。";
    const msg =
      leadIn + "\n\n" + echoPart1 + "\n\n" + echoPart2 + "\n\n" + answer;
    const raws = [msgDelta(msg), modelRequestUpdate(aiTerminal(msg))];

    const events = await classify(
      (async function* () {
        for (const r of raws) yield r;
      })(),
    );
    const tokens = texts(events, "token");
    const thinking = texts(events, "thinking");
    assert.ok(
      thinking.includes('name: "plan-generation"'),
      "复述首块进 thinking",
    );
    assert.ok(
      thinking.includes("## 一、动作选择原则"),
      "链式延续块（被空行切开的后续文档结构）一并进 thinking",
    );
    assert.ok(tokens.includes("明天练深蹲"), "正常回答进 token");
    assert.equal(
      tokens.includes("## 一、动作选择原则"),
      false,
      "延续块不得泄漏进 token",
    );
  });
});

describe("stripToolEchoBlocks 直接单测（任意位置剥离边界契约）", () => {
  const numberedEcho = [
    "1\t---",
    '2\tname: "plan-generation"',
    '3\tdescription: "计划生成能力包 - 训练容量计算、历史数据加载"',
    '4\tskills: ["knowledge.md", "prompt.md"]',
    '5\tversion: "3.1.0"',
  ].join("\n");

  it("中间复述：引导语 + 编号行复述 + 回答 → 只摘复述块", () => {
    const leadIn = "好的，我来为你安排明天的训练。";
    const answer = "深蹲 3 组 × 8 次。";
    const { echo, rest } = stripToolEchoBlocks(
      leadIn + "\n\n" + numberedEcho + "\n\n" + answer,
    );
    assert.ok(echo.includes('name: "plan-generation"'), "中间复述块摘出");
    assert.ok(rest.includes(leadIn), "引导语保留");
    assert.ok(rest.includes(answer), "回答保留");
    assert.equal(rest.includes("1\t---"), false, "复述不留 rest");
  });

  it("后置复述：回答 + 编号行复述（无后续）→ 摘复述、留回答", () => {
    const answer = "好的，明天计划是深蹲 3 组 × 8 次。";
    const { echo, rest } = stripToolEchoBlocks(answer + "\n\n" + numberedEcho);
    assert.ok(echo.includes('name: "plan-generation"'), "后置复述摘出");
    assert.ok(rest.includes(answer), "回答保留");
  });

  it("围栏卡片紧邻复述 → 卡片绝不摘", () => {
    const card = '```json\n{"type":"survey_card","title":"t"}\n```';
    const { echo, rest } = stripToolEchoBlocks(
      numberedEcho + "\n\n" + card + "\n\n请回答。",
    );
    assert.ok(echo.includes('name: "plan-generation"'));
    assert.ok(rest.includes("```json"), "卡片块保留");
    assert.ok(rest.includes("survey_card"));
    assert.ok(rest.includes("请回答。"));
  });

  it("纯正常回答 → 完全不摘", () => {
    const answer =
      "好的，明天计划如下：\n\n- 深蹲 3 组 × 8 次\n- 卧推 3 组 × 10 次\n\n请按计划执行。";
    const { echo, rest } = stripToolEchoBlocks(answer);
    assert.equal(echo, "");
    assert.equal(rest, answer);
  });

  it("短块（<30 字符）不判定 → 保留", () => {
    const short = "好的，明天练腿。";
    const { echo, rest } = stripToolEchoBlocks(short + "\n\n" + numberedEcho);
    assert.ok(echo.includes('name: "plan-generation"'));
    assert.ok(rest.includes(short), "短块保留（未误摘）");
  });
});

// ---------------------------------------------------------------------------
// 返工 v4（2026-09-23）：looksLikeZhDeliberation 收紧「来」——正常回答开首保护
// ---------------------------------------------------------------------------
// 真实 LLM 冒烟（8 轮）发现 3 轮正文 0 字符：模型正常回答以「我来定/我来给」
// （对用户承诺句式）开首，裸 `|来|` 判定为中文自言自语 → 整段摘进 thinking。
// 收紧为「来 + 元认知动词」才算自言自语，「我来定/我来为你/我来给」必须保留正文。
describe("tool-leak 返工 v4：looksLikeZhDeliberation 收紧「来」（正常回答开首保护）", () => {
  it("「我来定」式承诺句式 → 不是自言自语，不摘", async () => {
    const answer =
      "明天的计划我来定，先确认几个关键信息（顺便的话也告诉我：一周练几次、体重多少、有没有旧伤，我好把强度调准）：";
    const raws = [msgDelta(answer), modelRequestUpdate(aiTerminal(answer))];
    const events = await classify(
      (async function* () {
        for (const r of raws) yield r;
      })(),
    );
    const tokens = texts(events, "token");
    const thinking = texts(events, "thinking");
    assert.ok(
      tokens.includes("明天的计划我来定"),
      "「我来定」承诺句式必须保留进 token（实际 token: " +
        JSON.stringify(tokens) +
        "）",
    );
    assert.equal(
      thinking.includes("明天的计划我来定"),
      false,
      "「我来定」不得被摘进 thinking",
    );
  });

  it("「我来看看」式元认知动词 → 仍是自言自语，照旧摘", async () => {
    // 收敛保护：真正的自言自语形态必须仍被识别（不能因为收紧而漏放）。
    // 用双块形态：前块自言自语 + 后块真实回答，走 splitLeakedReasoning 判定。
    const deliberation = "好的，我来看看计划生成指南，熟悉一下动作库的用法。";
    const answer = "深蹲 3 组 × 8 次，卧推 3 组 × 10 次。";
    const msg = deliberation + "\n\n" + answer;
    const raws = [msgDelta(msg), modelRequestUpdate(aiTerminal(msg))];
    const events = await classify(
      (async function* () {
        for (const r of raws) yield r;
      })(),
    );
    const tokens = texts(events, "token");
    const thinking = texts(events, "thinking");
    assert.equal(
      tokens.includes("我来看看计划生成指南"),
      false,
      "「我来看看」自言自语不得进 token",
    );
    assert.ok(
      thinking.includes("我来看看计划生成指南"),
      "「我来看看」仍进 thinking",
    );
    assert.ok(tokens.includes("深蹲 3 组"), "真实回答照常进 token");
  });

  it("「我来为你」承诺句式 → 不摘（另一真实变体）", async () => {
    const answer = "好的，我来为你安排明天的训练，深蹲 3 组 × 8 次。";
    const raws = [msgDelta(answer), modelRequestUpdate(aiTerminal(answer))];
    const events = await classify(
      (async function* () {
        for (const r of raws) yield r;
      })(),
    );
    const tokens = texts(events, "token");
    assert.ok(
      tokens.includes("我来为你安排"),
      "「我来为你」承诺句式必须进 token",
    );
  });
});
