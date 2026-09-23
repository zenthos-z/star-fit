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
import { isAnswerStartBlock } from "../splitLeakedReasoning.js";
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

  it("终步复述动作库 JSON 后跟真答案 delta：复述拦截，后续 delta 也零 token", async () => {
    // 最保守场景：模型先复述 JSON，随后同一终步继续输出真答案 delta——
    // 拦截后不翻 answerLive，后续 delta 进缓冲，流尾按 thinking 处理，
    // 绝不实时放行为 token（宁可保守不漏）。
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
    assert.equal(
      tokens.length,
      0,
      `复述被拦截后，后续 delta 也不得实时放行（实际 ${tokens.length} 字符）`,
    );
  });
});
