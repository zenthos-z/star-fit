/**
 * 真实 LLM 回放（2026-09-30 吞卡修复验收，refs #73 T9b）——plan 场景 ≥3 轮，
 * 走完整生产管线（DeepAgentService → uiHintExtractor → 校验回路，SSE 编码层
 * 之前的 AgentEvent 流，进程内消费——SSE 不转发 thinking，观测不到吞卡），
 * 全新用户剧本式两轮出周计划（复用 #72 回放方法）。
 *
 * 背景（#72 T9 验收量化回放二实锤）：GLM「边调工具边出卡」——卡片正文写在
 * 携带 tool_calls 的消息里，classifyAgentStream 的 hasTools 分支把整段归
 * thinking，weekly_plan 卡（11,980 字符）被吞（92,277 thinking 字符中
 * 42,851 即此），用户端收不到卡。修复后该形态的卡必须经 token 流被
 * uiHintExtractor 提取成 uiHint 送达。
 *
 * 每轮双向断言（同时满足才 PASS）：
 *  - 下限：卡片真实送达（周计划卡 weekly_plan / plan_card 落地 uiHint）
 *    + 正文非空（token > 40，方差豁免记账）；
 *  - 上限（吞卡判别 v2）：单个 thinking 事件在剥除 read_file 编号行
 *    （`^\s*\d+\t`，文档复述形态）之后，不得含「完整围栏且 body 解析为
 *    白名单卡类型」的 JSON——被吞的卡以单个 thinking 事件含完整围栏出现，
 *    而文档复述（knowledge.md §9 示例卡）带编号行、合法 reasoning 增量是
 *    逐 token 小块，均不会命中；
 *  - 上限（泄漏治理）：散文 token < 1500 字符/轮——修复不得把中间步叙述
 *    放行成正文（卡经 uiHint 事件走，不计入 token 字符）。
 *
 * 失败分类（环境类不计入验收轮，如实报告）：
 *  - 硬失败（修复责任）：吞卡 / 泄漏——任一轮命中即 REPLAY_FAIL 终止；
 *  - 环境类（主线同样会发生，与吞卡修复无关）：空终步（done 且零 token 零
 *    卡——GLM 尾包空 content 怪癖）、流中断（error，如 undici `terminated`
    ——GLM 长思考流被服务端切断）、无卡-模型行为（完成但全剧本无卡）。
 *
 * 自动补轮：直到攒满 VERDICT_ROUNDS(默认 3) 个可判定轮（PASS / 硬失败）或
 * 跑满 MAX_ROUNDS(默认 6)。每轮事件时间线另存
 * /tmp/replay-t9b-events-r{N}.jsonl 供事后核查（uiHint 落点索引、围栏
 * thinking 原文等）。
 *
 * 离线 fixture 回放（--fixtures / FIXTURES=1，2026-09-30 双通道 429 期间按
 * 调度者裁决补充）：零网络零 DB——合成流帧直接喂 classifyAgentStream /
 * extractUiHintEvents（同一流层），确定性复现四条真实捕获形态：
 *   F1 #73 主形态（tool_calls 正文带 weekly_plan 围栏卡，#72 回放二实锤）；
 *   F2 修复 II 形态（终步编号行复述 + survey_card 单换行粘接，v3-R2T1 实锤）；
 *   F3 T56/#78 形态 A（终步无围栏 balanced-but-unparseable 卡 JSON，:170 路径）；
 *   F4 T56/#78 形态 B（LiveEchoGate thinking 事件中途切断卡缓冲，:174 路径）。
 * 断言与实况回放同一套（卡送达 / 吞卡判别 0 命中 / 泄漏上限 / 散文保真）。
 *
 * 用法：
 *   GLM_API_KEY=… DATABASE_URL=… npx tsx scripts/replay-stream-card.ts          # 实况
 *   npx tsx scripts/replay-stream-card.ts --fixtures                            # 离线
 *
 * #151 S2 卡片工具通道回放（2026-10-08）：
 *   npx tsx scripts/replay-stream-card.ts --tool-channel   # survey+weekly 走
 *     submit_xxx 工具通道（默认通道即 tool/tool/fence，无需 env）；同一剧本
 *     两轮：turn1 新用户缺画像 → submit_survey 出问卷卡；turn2 补齐信息 →
 *     submit_weekly_plan 出周计划卡。工具卡经卡汇排水以 uiHint 事件直达
 *     （不经 token 提取），验收判据（同一剧本双向）：
 *      - 下限：survey_card 与 weekly_plan 各 ≥1 轮经 uiHint 真实送达；
 *      - 合规（新增硬失败面）：正文 token 不得再出现卡围栏（```json + 白名单
 *        卡 body）——工具通道卡写成散文=失败交付，且与工具卡双发=重复渲染；
 *      - 上限：吞卡判别 0 命中 + 泄漏 <1500 字符（与围栏回放同标准）。
 *   npx tsx scripts/replay-stream-card.ts --fence          # 围栏回归：进程内
 *     强制 CARD_CHANNEL_*=fence（DB 无 card_channel_* 键时 env 生效），预期
 *     走原围栏管道出卡（卡从 token 提取），围栏路径不因双轨改造回归。
 */
import Fastify from "fastify";
import type { AgentEvent, ChatRequest } from "shared/contracts";
import { loginOrCreate } from "../src/controllers/adminController.js";
import { composeCardValidatingService } from "../src/controllers/chatController.js";
import {
  classifyAgentStream,
  deepAgentService,
} from "../src/services/agent/DeepAgentService.js";
import { extractUiHintEvents } from "../src/services/agent/uiHintExtractor.js";

const VERDICT_ROUNDS = Number(process.env.VERDICT_ROUNDS ?? 3);
const MAX_ROUNDS = Number(process.env.MAX_ROUNDS ?? 6);
const MAX_TOKEN_CHARS = 1500; // 泄漏上限（散文 token；卡经 uiHint 事件走，不计入）
const MIN_TOKEN_CHARS = 40; // 正文非空下限（方差豁免记账）
const EVENTS_DIR = process.env.EVENTS_DIR ?? "/tmp";
/** #151 S2 模式开关。 */
const TOOL_CHANNEL_MODE =
  process.argv.includes("--tool-channel") || process.env.TOOL_CHANNEL === "1";
const FENCE_MODE =
  process.argv.includes("--fence") || process.env.FENCE === "1";

const CARD_TYPES = [
  "weekly_plan",
  "plan_card",
  "summary_card",
  "survey_card",
  "deviation_card",
  "audit_complete",
  "profile_update_confirm",
];

/** 剧本：全新用户两轮出周计划（#72 剧本全链路同款形态）。 */
const SCRIPT_TURN1 = "帮我制定一份这周的训练计划";
const SCRIPT_TURN2 =
  "目标增肌；系统练了两年；家里有哑铃、可调哑铃凳和弹力带；一周能练4次；" +
  "体重75公斤；没有伤病。信息齐了，直接给我完整的周计划。";

interface TurnMetrics {
  turn: number;
  thinkingEvents: number;
  thinkingChars: number;
  tokenEvents: number;
  tokenChars: number;
  cards: string[];
  done: boolean;
  error: string | null;
  /** 吞卡判别 v2 命中（剥编号行后仍含白名单围栏卡） */
  swallowedFenceThinking: string[];
  /** 记账：送达卡签名串出现在 thinking（合法预构成会命中，不算失败） */
  cardSignatureInThinking: string[];
  /** uiHint 首次落地的事件索引与之后仍在流的 thinking 事件数（救援形态签名） */
  firstUiHintIndex: number;
  thinkingAfterUiHint: number;
  /** #151 S2：正文 token 里出现的卡围栏类型（工具通道合规判据；围栏模式=正常路径） */
  cardFenceInProse: string[];
  totalEvents: number;
  ms: number;
}

/**
 * #151 S2：扫正文 token 全文里的卡围栏（```json + 白名单卡 body）。
 * 工具通道下出现 = 模型把工具卡写成了散文（失败交付 + 与工具卡双发）。
 */
function scanCardFencesInProse(prose: string): string[] {
  const hits: string[] = [];
  const re = /```[A-Za-z]*\s*\{([\s\S]*?)```/g;
  for (const m of prose.matchAll(re)) {
    try {
      const parsed = JSON.parse(m[1].trim()) as unknown;
      const t = (parsed as { type?: unknown })?.type;
      if (typeof t === "string" && CARD_TYPES.includes(t)) hits.push(t);
    } catch {
      /* 非法 JSON 围栏：泄漏治理另有 tokenChars 上限兜底 */
    }
  }
  return hits;
}

/**
 * 吞卡判别 v2：先剥除 read_file 编号行（`  12\t…`）——文档复述里的示例卡
 * 围栏随编号行一起消失；剩余文本若含完整围栏且 body 解析为白名单卡类型，
 * 即为被吞的卡。未闭合围栏（流中断在卡中间）单独记账，不算硬失败。
 */
function detectSwallowedCard(text: string): {
  swallowed: boolean;
  unclosedFence: boolean;
} {
  const stripped = text
    .split("\n")
    .filter((l) => !/^\s*\d+\t/.test(l))
    .join("\n");
  const open = stripped.indexOf("```");
  if (open === -1) return { swallowed: false, unclosedFence: false };
  const bodyStart = stripped.indexOf("\n", open);
  const close = stripped.indexOf("```", bodyStart + 1);
  let body: string | null = null;
  if (close > bodyStart) {
    body = stripped.slice(bodyStart + 1, close);
  } else if (/```[A-Za-z]*\s*\{/.test(stripped.slice(open, open + 40))) {
    return { swallowed: false, unclosedFence: true }; // 流中断在卡中间：记账
  }
  if (body === null) return { swallowed: false, unclosedFence: false };
  try {
    const parsed = JSON.parse(body.trim()) as unknown;
    const swallowed =
      !!parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      typeof (parsed as { type?: unknown }).type === "string" &&
      CARD_TYPES.includes((parsed as { type: string }).type);
    return { swallowed, unclosedFence: false };
  } catch {
    return { swallowed: false, unclosedFence: false };
  }
}

async function createFreshUser(base: string): Promise<string> {
  const deviceId = `replay-t9b-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await fetch(`${base}/api/admin/login-or-create`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: deviceId }),
  });
  if (res.status !== 200) {
    throw new Error(
      `login-or-create failed: HTTP ${res.status} ${await res.text()}`,
    );
  }
  const body = (await res.json()) as { userId: string; isNew: boolean };
  if (!body.isNew) throw new Error("fresh user unexpectedly existed");
  return body.userId;
}

/** 送达卡的「签名串」：标题 / week_label——用于 thinking 记账。 */
function cardSignatures(card: Record<string, unknown>): string[] {
  const sigs: string[] = [];
  const title = card["title"];
  if (typeof title === "string" && title.length >= 4) sigs.push(title);
  const data = card["data"];
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const wl = (data as Record<string, unknown>)["week_label"];
    if (typeof wl === "string" && wl.length >= 3) sigs.push(wl);
  }
  return sigs;
}

/** 跑一轮（一个 turn），消费完整 AgentEvent 流并计量；事件时间线落 JSONL。 */
async function runTurn(
  userId: string,
  threadId: string,
  turn: number,
  message: string,
  eventsFile: string,
): Promise<TurnMetrics> {
  const req: ChatRequest = {
    userId,
    message,
    threadId,
    scenario: "plan",
    metadata: {},
  };
  const service = composeCardValidatingService(deepAgentService);
  return consumeEvents(service.chat(req), turn, eventsFile);
}

/** 消费一条 AgentEvent 流并计量（实况/离线 fixture 共用内核）。 */
async function consumeEvents(
  iter: AsyncIterable<AgentEvent>,
  turn: number,
  eventsFile: string,
): Promise<TurnMetrics> {
  const m: TurnMetrics = {
    turn,
    thinkingEvents: 0,
    thinkingChars: 0,
    tokenEvents: 0,
    tokenChars: 0,
    cards: [],
    done: false,
    error: null,
    swallowedFenceThinking: [],
    cardSignatureInThinking: [],
    firstUiHintIndex: -1,
    thinkingAfterUiHint: 0,
    cardFenceInProse: [],
    totalEvents: 0,
    ms: 0,
  };
  const sigs: string[] = [];
  let proseAll = ""; // #151 S2：正文全文（围栏合规扫描用）
  const startedAt = Date.now();
  const { appendFileSync } = await import("node:fs");
  const logEvent = (obj: Record<string, unknown>): void => {
    appendFileSync(eventsFile, JSON.stringify(obj) + "\n");
  };
  try {
    let index = 0;
    for await (const ev of iter) {
      const i = index++;
      m.totalEvents = i + 1;
      if (ev.type === "thinking" && ev.text) {
        m.thinkingEvents += 1;
        m.thinkingChars += ev.text.length;
        if (m.firstUiHintIndex >= 0) m.thinkingAfterUiHint += 1;
        const { swallowed, unclosedFence } = detectSwallowedCard(ev.text);
        if (swallowed) {
          m.swallowedFenceThinking.push(ev.text.slice(0, 160));
          logEvent({
            i,
            type: "thinking",
            len: ev.text.length,
            swallowGuard: true,
            head: ev.text.slice(0, 200),
          });
        } else if (unclosedFence) {
          logEvent({
            i,
            type: "thinking",
            len: ev.text.length,
            unclosedFence: true,
            head: ev.text.slice(0, 200),
          });
        }
        for (const sig of sigs) {
          if (
            ev.text.includes(sig) &&
            !m.cardSignatureInThinking.includes(sig)
          ) {
            m.cardSignatureInThinking.push(sig);
          }
        }
      } else if (ev.type === "token" && ev.text) {
        m.tokenEvents += 1;
        m.tokenChars += ev.text.length;
        proseAll += ev.text;
        logEvent({
          i,
          type: "token",
          len: ev.text.length,
          head: ev.text.slice(0, 80),
        });
      } else if (ev.type === "uiHint" && ev.card) {
        const cardType = String(
          (ev.card as Record<string, unknown>)["type"] ?? "?",
        );
        m.cards.push(cardType);
        if (m.firstUiHintIndex === -1) m.firstUiHintIndex = i;
        sigs.push(...cardSignatures(ev.card as Record<string, unknown>));
        logEvent({ i, type: "uiHint", cardType });
      } else if (ev.type === "done") {
        m.done = true;
      } else if (ev.type === "error") {
        m.error = ev.error?.message ?? "unknown error";
        logEvent({ i, type: "error", message: m.error });
      }
    }
  } catch (err) {
    m.error = err instanceof Error ? err.message : String(err);
    logEvent({ type: "crash", message: m.error });
  }
  m.cardFenceInProse = scanCardFencesInProse(proseAll);
  m.ms = Date.now() - startedAt;
  return m;
}

interface RoundResult {
  round: number;
  turns: TurnMetrics[];
  /** pass | hardfail | env */
  verdict: "pass" | "hardfail" | "env";
  reasons: string[];
  envNotes: string[];
  exemptBelowMin: number;
}

/** 一轮剧本：turn1 出计划请求；若未出周计划卡则 turn2 补齐信息再要。 */
async function runRound(base: string, round: number): Promise<RoundResult> {
  const userId = await createFreshUser(base);
  const threadId = `replay-t9b-r${round}-${Date.now()}`;
  const eventsFile = `${EVENTS_DIR}/replay-t9b-events-r${round}.jsonl`;
  console.log(`\n=== ROUND ${round} (user=${userId} thread=${threadId}) ===`);
  const reasons: string[] = [];
  const envNotes: string[] = [];
  let exemptBelowMin = 0;

  const t1 = await runTurn(userId, threadId, 1, SCRIPT_TURN1, eventsFile);
  const turns = [t1];
  const gotPlanCard = t1.cards.some(
    (c) => c === "weekly_plan" || c === "plan_card",
  );
  if (!gotPlanCard) {
    // 新用户缺前提 → turn1 多半是 survey_card / 空终步；turn2 补齐信息重要计划。
    const t2 = await runTurn(userId, threadId, 2, SCRIPT_TURN2, eventsFile);
    turns.push(t2);
  }

  for (const t of turns) {
    if (t.swallowedFenceThinking.length > 0) {
      reasons.push(
        `turn${t.turn} 吞卡(${t.swallowedFenceThinking.length} 个 thinking 事件含白名单围栏卡)`,
      );
    }
    if (t.tokenChars >= MAX_TOKEN_CHARS) {
      reasons.push(`turn${t.turn} 泄漏(${t.tokenChars} 字符)`);
    }
    if (t.tokenChars <= MIN_TOKEN_CHARS) exemptBelowMin++;
    if (t.error) {
      envNotes.push(`turn${t.turn} 流中断(${t.error.slice(0, 60)})`);
    } else if (t.done && t.tokenChars === 0 && t.cards.length === 0) {
      envNotes.push(`turn${t.turn} 空终步(GLM 尾包空 content)`);
    }
    const rescueShape =
      t.firstUiHintIndex >= 0 && t.thinkingAfterUiHint > 5
        ? "工具步救援形态(卡落地后思考仍在流)"
        : t.firstUiHintIndex >= 0
          ? "终步形态"
          : "无卡";
    console.log(
      `  turn ${t.turn}: cards=[${t.cards.join(",") || "无"}] ` +
        `thinking(块=${t.thinkingEvents}, 字符=${t.thinkingChars}) ` +
        `token(事件=${t.tokenEvents}, 字符=${t.tokenChars}) ` +
        `done=${t.done} err=${t.error ? t.error.slice(0, 40) : "N"} ` +
        `${t.ms}ms 卡形态=${rescueShape}` +
        (t.cardFenceInProse.length > 0
          ? ` 正文围栏=[${t.cardFenceInProse.join(",")}]`
          : "") +
        (t.swallowedFenceThinking.length > 0 ? " 【吞卡证据】" : ""),
    );
    for (const sw of t.swallowedFenceThinking) {
      console.log(`    [吞卡证据] ${JSON.stringify(sw)}…`);
    }
    if (t.cardSignatureInThinking.length > 0) {
      console.log(
        `    [记账] 卡签名串出现在 thinking: ${JSON.stringify(t.cardSignatureInThinking)}`,
      );
    }
  }

  const cards = turns.flatMap((t) => t.cards);
  const deliveredPlan = cards.some(
    (c) => c === "weekly_plan" || c === "plan_card",
  );
  let verdict: RoundResult["verdict"];
  if (reasons.length > 0) {
    verdict = "hardfail";
  } else if (deliveredPlan) {
    verdict = "pass";
  } else {
    // 无硬失败但也无周计划卡：环境/模型行为，不计入验收轮
    verdict = "env";
    envNotes.push(`全剧本无周计划卡(实际 ${cards.join(",") || "无"})`);
  }
  return { round, turns, verdict, reasons, envNotes, exemptBelowMin };
}

// ---------------------------------------------------------------------------
// #151 S2 工具通道回放（--tool-channel）与围栏回归（--fence）
// ---------------------------------------------------------------------------

/**
 * 工具通道一轮：同款两轮剧本（新用户 turn1 缺画像 → submit_survey；
 * turn2 补齐 → submit_weekly_plan）。工具卡经卡汇排水直达 uiHint，
 * 正文不应再出现卡围栏（合规硬失败面，见文件头注释）。
 */
async function runToolChannelRound(
  base: string,
  round: number,
): Promise<RoundResult> {
  const userId = await createFreshUser(base);
  const threadId = `replay-s2-r${round}-${Date.now()}`;
  const eventsFile = `${EVENTS_DIR}/replay-s2-tool-events-r${round}.jsonl`;
  console.log(
    `\n=== TOOL-CHANNEL ROUND ${round} (user=${userId} thread=${threadId}) ===`,
  );
  const reasons: string[] = [];
  const envNotes: string[] = [];
  let exemptBelowMin = 0;

  const t1 = await runTurn(userId, threadId, 1, SCRIPT_TURN1, eventsFile);
  const turns = [t1];
  // turn1 已直接出周计划（画像齐的意外路径）则无需 turn2；否则 turn2 补齐。
  if (!t1.cards.some((c) => c === "weekly_plan")) {
    const t2 = await runTurn(userId, threadId, 2, SCRIPT_TURN2, eventsFile);
    turns.push(t2);
  }

  for (const t of turns) {
    if (t.swallowedFenceThinking.length > 0) {
      reasons.push(
        `turn${t.turn} 吞卡(${t.swallowedFenceThinking.length} 个 thinking 事件含白名单围栏卡)`,
      );
    }
    if (t.tokenChars >= MAX_TOKEN_CHARS) {
      reasons.push(`turn${t.turn} 泄漏(${t.tokenChars} 字符)`);
    }
    if (t.cardFenceInProse.length > 0) {
      reasons.push(
        `turn${t.turn} 工具通道合规(正文出现卡围栏 [${t.cardFenceInProse.join(",")}]——工具卡写成散文=失败交付)`,
      );
    }
    if (t.tokenChars <= MIN_TOKEN_CHARS) exemptBelowMin++;
    if (t.error) {
      envNotes.push(`turn${t.turn} 流中断(${t.error.slice(0, 60)})`);
    } else if (t.done && t.tokenChars === 0 && t.cards.length === 0) {
      envNotes.push(`turn${t.turn} 空终步(GLM 尾包空 content)`);
    }
    console.log(
      `  turn ${t.turn}: cards=[${t.cards.join(",") || "无"}] ` +
        `thinking(块=${t.thinkingEvents}, 字符=${t.thinkingChars}) ` +
        `token(事件=${t.tokenEvents}, 字符=${t.tokenChars}) ` +
        `done=${t.done} err=${t.error ? t.error.slice(0, 40) : "N"} ` +
        `${t.ms}ms 正文围栏=[${t.cardFenceInProse.join(",") || "无"}]` +
        (t.swallowedFenceThinking.length > 0 ? " 【吞卡证据】" : ""),
    );
  }

  const cards = turns.flatMap((t) => t.cards);
  const deliveredSurvey = cards.includes("survey_card");
  const deliveredWeekly = cards.includes("weekly_plan");
  let verdict: RoundResult["verdict"];
  if (reasons.length > 0) {
    verdict = "hardfail";
  } else if (deliveredSurvey || deliveredWeekly) {
    // 每轮至少一张工具卡送达即 pass；跨轮聚合（survey 与 weekly 各 ≥1）
    // 在 toolChannelMain 汇总判定。
    verdict = "pass";
  } else {
    verdict = "env";
    envNotes.push(`全剧本无卡(实际 ${cards.join(",") || "无"})`);
  }
  console.log(
    `  轮内卡型: survey=${deliveredSurvey ? "✓" : "✗"} weekly=${deliveredWeekly ? "✓" : "✗"}`,
  );
  return { round, turns, verdict, reasons, envNotes, exemptBelowMin };
}

/** 工具通道模式主流程：survey 与 weekly_plan 各 ≥1 轮绿 + 零硬失败。 */
async function toolChannelMain(): Promise<number> {
  const app = Fastify({ logger: false });
  app.post("/api/admin/login-or-create", loginOrCreate);
  await app.listen({ port: 0, host: "127.0.0.1" });
  const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;

  const verdicts: Array<{
    round: number;
    verdict: string;
    survey: boolean;
    weekly: boolean;
    reasons?: string[];
    envNotes?: string[];
  }> = [];
  let hardFail = false;
  for (let r = 1; r <= MAX_ROUNDS && !hardFail; r++) {
    const res = await runToolChannelRound(base, r);
    const survey = res.turns.some((t) => t.cards.includes("survey_card"));
    const weekly = res.turns.some((t) => t.cards.includes("weekly_plan"));
    if (res.verdict === "hardfail") {
      hardFail = true;
      verdicts.push({
        round: r,
        verdict: "hardfail",
        survey,
        weekly,
        reasons: res.reasons,
      });
      console.log(`ROUND ${r}: HARD FAIL — ${res.reasons.join(" | ")}`);
      break;
    }
    verdicts.push({
      round: r,
      verdict: res.verdict,
      survey,
      weekly,
      envNotes: res.envNotes,
    });
    console.log(
      res.verdict === "pass"
        ? `ROUND ${r}: PASS (survey=${survey ? "✓" : "✗"} weekly=${weekly ? "✓" : "✗"})`
        : `ROUND ${r}: ENV(不计入) — ${res.envNotes.join(" | ")}`,
    );
    const surveyRounds = verdicts.filter(
      (v) => v.verdict === "pass" && v.survey,
    ).length;
    const weeklyRounds = verdicts.filter(
      (v) => v.verdict === "pass" && v.weekly,
    ).length;
    if (surveyRounds >= 1 && weeklyRounds >= 1) break;
  }
  await app.close();

  const passRounds = verdicts.filter((v) => v.verdict === "pass");
  const surveyRounds = passRounds.filter((v) => v.survey).length;
  const weeklyRounds = passRounds.filter((v) => v.weekly).length;
  const envCount = verdicts.filter((v) => v.verdict === "env").length;
  console.log(
    `\n=== S2 工具通道汇总: PASS 轮=${passRounds.length} ` +
      `(survey 卡=${surveyRounds} 轮 / weekly 卡=${weeklyRounds} 轮) ` +
      `环境类=${envCount} 硬失败=${hardFail ? 1 : 0} ===`,
  );
  const ok = !hardFail && surveyRounds >= 1 && weeklyRounds >= 1;
  console.log(ok ? "\nTOOL_REPLAY_PASS" : "\nTOOL_REPLAY_FAIL");
  return ok ? 0 : 1;
}

// ---------------------------------------------------------------------------
// 离线 fixture 回放（--fixtures / FIXTURES=1）
// ---------------------------------------------------------------------------

/** messages delta: [AIMessageChunk, metadata]。 */
function msgDelta(text: string): unknown {
  return ["messages", [{ content: text }, {}]];
}

/** updates 快照：model_request 节点的最后一条消息决定 step 分类。 */
function modelRequestUpdate(ai: unknown): unknown {
  return ["updates", { model_request: { messages: [ai] } }];
}

/** tools 节点快照：工具返回（复述判别锚来源）。 */
function toolUpdate(content: string): unknown {
  return [
    "updates",
    { tools: { messages: [{ _getType: () => "tool", content }] } },
  ];
}

function aiWithTools(toolNames: string[]): unknown {
  return {
    _getType: () => "ai",
    content: "",
    tool_calls: toolNames.map((name) => ({ name, args: "{}" })),
  };
}

function aiTerminal(content: string): unknown {
  return { _getType: () => "ai", content, tool_calls: [] };
}

/** T9 契约形态的 weekly_plan 卡（#72 回放二被吞卡的合成重构）。 */
const FIXTURE_WEEKLY_CARD = JSON.stringify(
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
const FIXTURE_WEEKLY_FENCE = "```json\n" + FIXTURE_WEEKLY_CARD + "\n```";

/** v3-R2T1 实锤：read_file 自检清单的编号行复述（截选）。 */
const FIXTURE_NUMBERED_ECHO = [
  "121\t自检清单（输出 plan 卡前逐项核对）：",
  "122\t",
  "123\t- id 来自 `find_exercises`/`list_exercises` 返回的真实条目（禁止编造）",
  "124\t- exercise_type 与动作库中该动作的类型一致",
  '125\t- sets/reps 为整数（reps 不能是 "8-12" 这类范围字符串）',
  "126\t- resistance 类 weight > 0（bodyweight/assisted 除外）",
  "127\t- 明日计划带 target 日期标记",
  "128\t",
].join("\n");
const FIXTURE_SURVEY_FENCE =
  '```json\n{"type":"survey_card","title":"训练档案 · 初始问卷","data":{"questions":[{"id":"goal","question":"目标？","options":[{"label":"增肌","value":"muscle_gain"}],"required":true}]}}\n```';

interface Fixture {
  name: string;
  desc: string;
  /** classifier = 原始 LangGraph 元组（→ classifyAgentStream → extract）；
   *  extractor = 已分类 AgentEvent（→ extract，单测提取器层）。 */
  level: "classifier" | "extractor";
  stream: unknown[];
  expectCards: string[];
  proseMustInclude: string[];
  proseMustExclude: string[];
}

const FIXTURES: Fixture[] = [
  {
    name: "F1",
    desc: "#73 主形态：tool_calls 正文带 weekly_plan 围栏卡（#72 回放二实锤）",
    level: "classifier",
    stream: [
      msgDelta(
        "这是为你定制的本周训练计划：\n\n" +
          FIXTURE_WEEKLY_FENCE +
          "\n\n我再确认一下动作库。",
      ),
      modelRequestUpdate(aiWithTools(["find_exercises"])),
      toolUpdate('{"count":1,"exercises":[{"id":"ex_1","name":"杠铃卧推"}]}'),
      msgDelta("计划已生成，确认后开始训练。"),
      modelRequestUpdate(aiTerminal("计划已生成，确认后开始训练。")),
    ],
    expectCards: ["weekly_plan"],
    proseMustInclude: ["计划已生成"],
    proseMustExclude: ["weekly_plan", "```json"],
  },
  {
    name: "F2",
    desc: "修复 II 形态：终步编号行复述 + survey_card 单换行粘接（v3-R2T1 实锤）",
    level: "classifier",
    stream: [
      msgDelta("我先读一下技能的自检清单。"),
      modelRequestUpdate(aiWithTools(["read_file"])),
      toolUpdate(FIXTURE_NUMBERED_ECHO),
      msgDelta(FIXTURE_NUMBERED_ECHO + "\n" + FIXTURE_SURVEY_FENCE),
      modelRequestUpdate(
        aiTerminal(FIXTURE_NUMBERED_ECHO + "\n" + FIXTURE_SURVEY_FENCE),
      ),
    ],
    expectCards: ["survey_card"],
    proseMustInclude: [],
    proseMustExclude: ["survey_card", "自检清单"],
  },
  {
    name: "F3",
    desc: "T56/#78 形态 A：无围栏 balanced-but-unparseable 卡 JSON（:170 路径）",
    level: "extractor",
    stream: [
      { type: "token", text: "这是你的计划：\n\n" },
      {
        type: "token",
        text: '{"type": "weekly_plan", "data": {"week_label": "第 1 周", "days": [1, 2,]}}',
      },
      { type: "token", text: "\n\n确认后开始训练。" },
      { type: "done" },
    ],
    expectCards: [],
    proseMustInclude: ["这是你的计划", "确认后开始训练"],
    proseMustExclude: ["weekly_plan", '"week_label"'],
  },
  {
    name: "F4",
    desc: "T56/#78 形态 B：thinking 事件中途切断卡缓冲（:174 路径 / LiveEchoGate）",
    level: "extractor",
    stream: [
      {
        type: "token",
        text: '好的，这是你的周计划：\n```json\n{"type": "week',
      },
      { type: "thinking", text: "1\t复述的工具返回块……" },
      {
        type: "token",
        text: 'ly_plan", "data": {"week_label": "第 1 周", "days": []}}',
      },
      { type: "token", text: "\n```\n以上是本周计划。" },
      { type: "done" },
    ],
    expectCards: ["weekly_plan"],
    proseMustInclude: ["好的，这是你的周计划", "以上是本周计划"],
    proseMustExclude: ["week_label"],
  },
];

async function* rawTupleStream(items: unknown[]): AsyncIterable<unknown> {
  for (const item of items) yield item;
}

async function* agentEventStream(events: unknown[]): AsyncIterable<AgentEvent> {
  for (const e of events) yield e as AgentEvent;
}

/** 构造 fixture 的 AgentEvent 流（每次调用全新生成器，可安全重放两次）。 */
function fixtureStream(fx: Fixture): AsyncIterable<AgentEvent> {
  return fx.level === "classifier"
    ? extractUiHintEvents(
        classifyAgentStream(
          rawTupleStream(fx.stream),
        ) as AsyncIterable<AgentEvent>,
      )
    : extractUiHintEvents(agentEventStream(fx.stream));
}

async function runFixture(
  fx: Fixture,
  eventsFile: string,
): Promise<{ m: TurnMetrics; failReasons: string[] }> {
  const m = await consumeEvents(fixtureStream(fx), 0, eventsFile);
  const failReasons: string[] = [];
  if (m.swallowedFenceThinking.length > 0) {
    failReasons.push(`吞卡判别命中(${m.swallowedFenceThinking.length})`);
  }
  if (m.error) failReasons.push(`流错误(${m.error.slice(0, 60)})`);
  if (!m.done) failReasons.push("无 done 终态");
  for (const c of fx.expectCards) {
    if (!m.cards.includes(c))
      failReasons.push(`卡未送达(${c}，实际 [${m.cards.join(",") || "无"}])`);
  }
  // 散文断言需要 token 全文：consumeEvents 只计量，这里重放一遍流拼接。
  let prose = "";
  for await (const ev of fixtureStream(fx)) {
    if (ev.type === "token" && ev.text) prose += ev.text;
  }
  for (const s of fx.proseMustInclude) {
    if (!prose.includes(s)) failReasons.push(`散文缺失(${s.slice(0, 20)})`);
  }
  for (const s of fx.proseMustExclude) {
    if (prose.includes(s)) failReasons.push(`正文泄漏(${s.slice(0, 20)})`);
  }
  if (m.tokenChars >= MAX_TOKEN_CHARS) {
    failReasons.push(`泄漏上限(${m.tokenChars} 字符)`);
  }
  return { m, failReasons };
}

async function fixtureMain(): Promise<number> {
  const eventsFile = `${EVENTS_DIR}/replay-t9b-fixtures.jsonl`;
  console.log(
    `=== 离线 fixture 回放（流层确定性回归，事件时间线 ${eventsFile}）===`,
  );
  let fails = 0;
  for (const fx of FIXTURES) {
    const { m, failReasons } = await runFixture(fx, eventsFile);
    const ok = failReasons.length === 0;
    if (!ok) fails += 1;
    console.log(
      `  ${fx.name} ${ok ? "PASS" : "FAIL"}: ${fx.desc}\n` +
        `    cards=[${m.cards.join(",") || "无"}] thinking(块=${m.thinkingEvents}, 字符=${m.thinkingChars}) ` +
        `token(事件=${m.tokenEvents}, 字符=${m.tokenChars})${failReasons.length ? "\n    失败: " + failReasons.join(" | ") : ""}`,
    );
  }
  console.log(
    `\n=== fixture 汇总: ${FIXTURES.length - fails}/${FIXTURES.length} PASS ===`,
  );
  console.log(fails === 0 ? "\nFIXTURE_PASS" : "\nFIXTURE_FAIL");
  return fails === 0 ? 0 : 1;
}

async function main(): Promise<number> {
  if (process.argv.includes("--fixtures") || process.env.FIXTURES === "1") {
    return fixtureMain();
  }
  if (TOOL_CHANNEL_MODE) {
    return toolChannelMain();
  }
  if (FENCE_MODE) {
    // 围栏回归：进程内强制全 fence（DB 无 card_channel_* 键时 env 生效，
    // 通道解析 DB > env > 默认）。出卡路径应回到原围栏管道（token 提取）。
    process.env.CARD_CHANNEL_SURVEY_CARD = "fence";
    process.env.CARD_CHANNEL_WEEKLY_PLAN = "fence";
    process.env.CARD_CHANNEL_PLAN_CARD = "fence";
    console.log(
      "=== #151 S2 围栏回归模式：CARD_CHANNEL_*=fence（预期卡从 token 围栏提取）===",
    );
  }
  const app = Fastify({ logger: false });
  app.post("/api/admin/login-or-create", loginOrCreate);
  await app.listen({ port: 0, host: "127.0.0.1" });
  const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;

  const verdicts: Array<{
    round: number;
    verdict: string;
    reasons?: string[];
    envNotes?: string[];
  }> = [];
  const totals = {
    thinkingEvents: 0,
    thinkingChars: 0,
    tokenEvents: 0,
    tokenChars: 0,
    cards: {} as Record<string, number>,
    exemptBelowMin: 0,
  };
  let hardFail = false;

  for (let r = 1; r <= MAX_ROUNDS; r++) {
    const res = await runRound(base, r);
    for (const t of res.turns) {
      totals.thinkingEvents += t.thinkingEvents;
      totals.thinkingChars += t.thinkingChars;
      totals.tokenEvents += t.tokenEvents;
      totals.tokenChars += t.tokenChars;
      for (const c of t.cards) totals.cards[c] = (totals.cards[c] ?? 0) + 1;
    }
    totals.exemptBelowMin += res.exemptBelowMin;
    if (res.verdict === "hardfail") {
      hardFail = true;
      verdicts.push({ round: r, verdict: "hardfail", reasons: res.reasons });
      console.log(`ROUND ${r}: HARD FAIL — ${res.reasons.join(" | ")}`);
      break; // 吞卡/泄漏命中：立即终止，无需继续
    } else if (res.verdict === "pass") {
      verdicts.push({ round: r, verdict: "pass" });
      console.log(`ROUND ${r}: PASS`);
    } else {
      verdicts.push({ round: r, verdict: "env", envNotes: res.envNotes });
      console.log(`ROUND ${r}: ENV(不计入) — ${res.envNotes.join(" | ")}`);
    }
    const passCount = verdicts.filter((v) => v.verdict === "pass").length;
    if (passCount >= VERDICT_ROUNDS) break;
  }
  await app.close();

  const passCount = verdicts.filter((v) => v.verdict === "pass").length;
  const envCount = verdicts.filter((v) => v.verdict === "env").length;
  console.log(
    `\n=== 汇总: 可判定 PASS=${passCount}/${VERDICT_ROUNDS} 环境类=${envCount} 硬失败=${hardFail ? 1 : 0}` +
      ` | thinking 块=${totals.thinkingEvents} 字符=${totals.thinkingChars}` +
      ` | token 事件=${totals.tokenEvents} 字符=${totals.tokenChars}` +
      ` | 卡片=${JSON.stringify(totals.cards)} | ≤40字符轮=${totals.exemptBelowMin} ===`,
  );
  console.log(
    `对照 #72 基线（单轮回放二）: thinking 块 13,871 / 字符 92,277（其中 42,851 为被吞卡）` +
      `—— 验收看「吞卡判别 0 命中 + 周计划卡真实送达」，绝对值仅参考。`,
  );
  const ok = !hardFail && passCount >= VERDICT_ROUNDS;
  console.log(ok ? "\nREPLAY_PASS" : "\nREPLAY_FAIL");
  return ok ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("REPLAY_CRASH:", err?.message ?? err);
    process.exit(1);
  });
