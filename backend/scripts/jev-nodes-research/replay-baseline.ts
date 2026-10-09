/**
 * 线G' Jev 决策节点研究（#160 二次定调 + #155）——现状基线回放（纯调研）。
 *
 * 目的：量化「新用户引导（问卷轮）」与「计划生成轮」的 thinking 压力基线
 * （thinking 块数/字符/时长/工具轮次/出卡形态），为节点拆解 spec 提供实测锚点。
 *
 * 方法（复用 #72/#151 replay-stream-card.ts 的进程内回放法，零 HTTP 依赖后端）：
 *  - 每轮：新用户 + 新 thread，两轮剧本——
 *      turn1（问卷轮场景）：「帮我制定一份这周的训练计划」→ 预期 survey_card；
 *      turn2（计划生成轮场景）：补齐六项必答信息 → 预期模板路径 weekly_plan 卡。
 *  - scenario 恒为 "chat"（#160 实锤：isPlanMode 死路，真实用户路径恒 chat）。
 *  - 每轮计量：thinking 块/字符、token 块/字符、卡型+模板指纹、墙钟、
 *    逐事件相对时间戳（首个 thinking/token/卡/完成）；turn 结束后从
 *    checkpointer 反序列化 thread 消息，统计每 turn 的模型轮次与工具调用序列。
 *  - 事件时间线全文落 results/replay-events-run{N}.jsonl（含 thinking 文本
 *    头部，供离线推理占比分析；不含任何密钥）。
 *
 * 配额纪律（任务书红线）：真 LLM 回放总尝试 ≤ MAX_TURNS（默认 6 = 3 轮×2 turn，
 * 每场景 ≤3 轮；含失败尝试的总上限 8 由 HARD_TURN_CAP 封顶）。
 *
 * 用法（backend/ 下）：
 *   GLM_API_KEY=… DATABASE_URL=… npx tsx scripts/jev-nodes-research/replay-baseline.ts
 *   env：RUNS（默认 3）｜KEEP=1 跳过清理｜EVENTS_DIR（默认脚本目录 results/）
 * 清理：默认删除本脚本创建的测试用户（device_id 前缀 jev-nodes-replay-）与其
 * thread checkpoints（research 卫生，t2 验收同款惯例）。
 */
import Fastify from "fastify";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { AgentEvent, ChatRequest } from "shared/contracts";
import { loginOrCreate } from "../../src/controllers/adminController.js";
import { composeCardValidatingService } from "../../src/controllers/chatController.js";
import { deepAgentService } from "../../src/services/agent/DeepAgentService.js";
import { loadWeeklyPlanTemplates } from "../../src/services/agent/planTemplates.js";
import { getPostgresClient } from "../../src/db/postgresql/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const EVENTS_DIR = process.env.EVENTS_DIR ?? join(here, "results");
const RUNS = Number(process.env.RUNS ?? 3);
/** 配额硬顶：两 turn 剧本 ×3 轮 = 6，含环境类重试的总尝试上限 8。 */
const HARD_TURN_CAP = Number(process.env.HARD_TURN_CAP ?? 8);
const DEVICE_PREFIX = "jev-nodes-replay-";

/** 剧本：与 #151 S3 验收同源（replay-stream-card.ts SCRIPT_TURN1/2）。
 * TURN1_MSG/TURN2_MSG 可用 env 覆盖（对照测量：模板命中 vs 自由生成路径）：
 * 默认 turn2 是「中级×居家×4练」=模板矩阵空洞 → 自由路径；
 * TEMPLATE 覆盖示例见 README（新手×居家哑铃×3练 → t1 命中）。 */
const TURN1_MSG =
  process.env.TURN1_MSG ?? "帮我制定一份这周的训练计划";
const TURN2_MSG =
  process.env.TURN2_MSG ??
  "目标增肌；系统练了两年；家里有哑铃、可调哑铃凳和弹力带；一周能练4次；" +
    "体重75公斤；没有伤病。信息齐了，直接给我完整的周计划。";

interface TimelineMarks {
  firstEventAt: number | null;
  firstThinkingAt: number | null;
  lastThinkingAt: number | null;
  firstTokenAt: number | null;
  firstCardAt: number | null;
  doneAt: number | null;
}

interface TurnMetrics {
  turn: number;
  label: "survey_round" | "plan_round";
  message: string;
  thinkingEvents: number;
  thinkingChars: number;
  tokenEvents: number;
  tokenChars: number;
  cards: string[];
  cardMeta: Array<Record<string, unknown>>;
  templateFingerprint: string | null;
  done: boolean;
  error: string | null;
  ms: number;
  timeline: TimelineMarks;
  /** thinking 流占比近似：thinking 活跃时长（首→末 thinking 事件）ms。 */
  thinkingSpanMs: number | null;
}

interface ToolRoundInfo {
  turn: number;
  modelRounds: number;
  toolCalls: string[];
}

function templateFingerprintHit(card: Record<string, unknown>): string | null {
  const data = card["data"];
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  const phase = typeof d.phase_label === "string" ? d.phase_label : "";
  const summary = typeof d.split_summary === "string" ? d.split_summary : "";
  const names = loadWeeklyPlanTemplates().map((t) => t.name_zh);
  // phase 为空时 n.includes("") 恒真——只对非空 phase/symbol 匹配（survey 卡
  // 无 phase_label，误报会让问卷轮也挂上模板指纹）
  const byPhase = phase
    ? names.find((n) => phase.includes(n) || n.includes(phase))
    : undefined;
  if (byPhase) return byPhase;
  const m = /^(.+?) · 每周 \d 练 · (新手档|进阶档)$/.exec(summary);
  if (m) {
    const bySummary = names.find(
      (n) => summary.includes(n) || m[1].includes(n) || n.includes(m[1]),
    );
    if (bySummary) return bySummary;
  }
  return null;
}

/** 消费一条 AgentEvent 流并计量；时间线落 JSONL（含 thinking 头 240 字符）。 */
async function consumeEvents(
  iter: AsyncIterable<AgentEvent>,
  label: TurnMetrics["label"],
  eventsFile: string,
): Promise<TurnMetrics> {
  const m: TurnMetrics = {
    turn: 0,
    label,
    message: "",
    thinkingEvents: 0,
    thinkingChars: 0,
    tokenEvents: 0,
    tokenChars: 0,
    cards: [],
    cardMeta: [],
    templateFingerprint: null,
    done: false,
    error: null,
    ms: 0,
    timeline: {
      firstEventAt: null,
      firstThinkingAt: null,
      lastThinkingAt: null,
      firstTokenAt: null,
      firstCardAt: null,
      doneAt: null,
    },
    thinkingSpanMs: null,
  };
  const t0 = Date.now();
  try {
    for await (const ev of iter) {
      const at = Date.now() - t0;
      if (m.timeline.firstEventAt === null) m.timeline.firstEventAt = at;
      if (ev.type === "thinking" && ev.text) {
        m.thinkingEvents += 1;
        m.thinkingChars += ev.text.length;
        if (m.timeline.firstThinkingAt === null)
          m.timeline.firstThinkingAt = at;
        m.timeline.lastThinkingAt = at;
        appendFileSync(
          eventsFile,
          JSON.stringify({
            at,
            type: "thinking",
            len: ev.text.length,
            head: ev.text.slice(0, 240),
          }) + "\n",
        );
      } else if (ev.type === "token" && ev.text) {
        m.tokenEvents += 1;
        m.tokenChars += ev.text.length;
        if (m.timeline.firstTokenAt === null) m.timeline.firstTokenAt = at;
        appendFileSync(
          eventsFile,
          JSON.stringify({ at, type: "token", len: ev.text.length }) + "\n",
        );
      } else if (ev.type === "uiHint" && ev.card) {
        const card = ev.card as Record<string, unknown>;
        const cardType = String(card["type"] ?? "?");
        m.cards.push(cardType);
        const data =
          card["data"] && typeof card["data"] === "object"
            ? (card["data"] as Record<string, unknown>)
            : {};
        m.cardMeta.push({
          type: cardType,
          phase_label: data.phase_label,
          split_summary: data.split_summary,
        });
        const fp = templateFingerprintHit(card);
        if (fp) m.templateFingerprint = fp;
        if (m.timeline.firstCardAt === null) m.timeline.firstCardAt = at;
        appendFileSync(
          eventsFile,
          JSON.stringify({ at, type: "uiHint", cardType, fp }) + "\n",
        );
      } else if (ev.type === "done") {
        m.done = true;
        m.timeline.doneAt = at;
      } else if (ev.type === "error") {
        m.error = ev.error?.message ?? "unknown error";
        appendFileSync(
          eventsFile,
          JSON.stringify({ at, type: "error", message: m.error }) + "\n",
        );
      }
    }
  } catch (err) {
    m.error = err instanceof Error ? err.message : String(err);
  }
  m.ms = Date.now() - t0;
  if (
    m.timeline.firstThinkingAt !== null &&
    m.timeline.lastThinkingAt !== null
  ) {
    m.thinkingSpanMs = m.timeline.lastThinkingAt - m.timeline.firstThinkingAt;
  }
  return m;
}

/**
 * 从 checkpointer 读 thread 消息，按 human 消息切 turn，统计每 turn 的
 * 模型轮次（AI 消息数）与工具调用序列（AI 消息 tool_calls 串联）。
 */
async function collectToolRounds(
  threadId: string,
  expectedHumans: number,
): Promise<ToolRoundInfo[]> {
  const { getAgentRuntimeCheckpointer } = await import(
    "../../src/services/agent/agentRuntime.js"
  );
  const cp = getAgentRuntimeCheckpointer() as unknown as {
    getTuple(cfg: {
      configurable: { thread_id: string };
    }): Promise<{
      checkpoint?: { channel_values?: { messages?: unknown[] } };
    } | undefined>;
  };
  // checkpoint 落库有轻微异步：轮询至 human 消息数达标或 10s 超时
  let msgs: Array<Record<string, unknown>> = [];
  for (let i = 0; i < 20; i++) {
    const tuple = await cp.getTuple({
      configurable: { thread_id: threadId },
    });
    msgs = (tuple?.checkpoint?.channel_values?.messages ?? []) as Array<
      Record<string, unknown>
    >;
    const humans = msgs.filter((x) => String(x.type) === "human").length;
    if (humans >= expectedHumans) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const perTurn: ToolRoundInfo[] = [];
  let current: ToolRoundInfo | null = null;
  for (const msg of msgs) {
    const type = String(msg.type ?? msg._getType?.() ?? "?");
    if (type === "human") {
      if (current) perTurn.push(current);
      current = { turn: perTurn.length + 1, modelRounds: 0, toolCalls: [] };
    } else if (type === "ai" && current) {
      current.modelRounds += 1;
      const calls = (msg.tool_calls ?? []) as Array<{
        name?: string;
      }>;
      for (const c of calls) current.toolCalls.push(String(c.name ?? "?"));
    }
  }
  if (current) perTurn.push(current);
  return perTurn;
}

async function createFreshUser(base: string): Promise<string> {
  const deviceId = `${DEVICE_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await fetch(`${base}/api/admin/login-or-create`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: deviceId }),
  });
  if (res.status !== 200) {
    throw new Error(`login-or-create failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as { userId: string; isNew: boolean };
  if (!body.isNew) throw new Error("fresh user unexpectedly existed");
  return body.userId;
}

async function main(): Promise<void> {
  mkdirSync(EVENTS_DIR, { recursive: true });
  const app = Fastify({ logger: false });
  app.post("/api/admin/login-or-create", loginOrCreate);
  await app.listen({ port: 0, host: "127.0.0.1" });
  const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;

  const service = composeCardValidatingService(deepAgentService);
  const runs: Array<{
    run: number;
    userId: string;
    threadId: string;
    turns: TurnMetrics[];
    toolRounds: ToolRoundInfo[];
  }> = [];
  let turnsAttempted = 0;

  for (let run = 1; run <= RUNS; run++) {
    if (turnsAttempted >= HARD_TURN_CAP) {
      console.log(`[quota] HARD_TURN_CAP=${HARD_TURN_CAP} 已到，停止。`);
      break;
    }
    const userId = await createFreshUser(base);
    const threadId = `jev-nodes-r${run}-${Date.now().toString(36)}`;
    const eventsFile = join(EVENTS_DIR, `replay-events-run${run}.jsonl`);
    writeFileSync(eventsFile, "");
    console.log(
      `\n=== RUN ${run} (user=${userId.slice(0, 8)}… thread=${threadId}) ===`,
    );
    const turns: TurnMetrics[] = [];

    for (const [idx, label, msg] of [
      [1, "survey_round", TURN1_MSG],
      [2, "plan_round", TURN2_MSG],
    ] as const) {
      if (turnsAttempted >= HARD_TURN_CAP) break;
      turnsAttempted += 1;
      const req: ChatRequest = {
        userId,
        message: msg,
        threadId,
        scenario: "chat",
        metadata: {},
      };
      console.log(`  turn ${idx} [${label}] 发送：${msg.slice(0, 24)}…`);
      const t = await consumeEvents(service.chat(req), label, eventsFile);
      t.turn = idx;
      t.message = msg;
      turns.push(t);
      console.log(
        `  turn ${idx} [${label}]: cards=[${t.cards.join(",") || "无"}] ` +
          `thinking(块=${t.thinkingEvents}, 字符=${t.thinkingChars}) ` +
          `token(事件=${t.tokenEvents}, 字符=${t.tokenChars}) ` +
          `${t.ms}ms 模板指纹=${t.templateFingerprint ?? "-"} ` +
          `err=${t.error ? t.error.slice(0, 50) : "N"}`,
      );
      // 429/配额类失败立即停（避免空烧配额）
      if (t.error && /429|quota|上限/i.test(t.error)) {
        console.log(`[quota] 疑似配额耗尽，终止后续 turn。`);
        break;
      }
    }

    const toolRounds = await collectToolRounds(threadId, turns.length);
    for (const tr of toolRounds) {
      console.log(
        `  turn ${tr.turn} 模型轮次=${tr.modelRounds} 工具=[${tr.toolCalls.join(" → ")}]`,
      );
    }
    runs.push({ run, userId, threadId, turns, toolRounds });
  }

  // 汇总
  const summary = {
    schema: "jev-nodes-replay-baseline/1",
    ranAt: new Date().toISOString(),
    scenario: "chat（#160 实锤的真实路径：isPlanMode 死路）",
    turnsAttempted,
    runs: runs.map((r) => ({
      run: r.run,
      userId: r.userId,
      threadId: r.threadId,
      turns: r.turns.map((t) => ({
        ...t,
        message: undefined,
      })),
      toolRounds: r.toolRounds,
    })),
  };
  const out = join(EVENTS_DIR, "replay-baseline.json");
  writeFileSync(out, JSON.stringify(summary, null, 2));
  console.log(`\nsaved -> ${out}`);

  // 分场景聚合（终端速览）
  for (const label of ["survey_round", "plan_round"] as const) {
    const ts = runs.flatMap((r) => r.turns).filter((t) => t.label === label);
    if (ts.length === 0) continue;
    const chars = ts.map((t) => t.thinkingChars);
    const ms = ts.map((t) => t.ms);
    console.log(
      `\n[${label}] n=${ts.length} thinking块中位=${median(ts.map((t) => t.thinkingEvents))} ` +
        `thinking字符中位=${median(chars)} 总字符=${chars.reduce((a, b) => a + b, 0)} ` +
        `墙钟中位=${median(ms)}ms 卡=${ts.map((t) => t.cards.join("+")).join(" | ")}`,
    );
  }

  await app.close();

  // 清理（默认）：删测试用户 + 其 thread checkpoints
  if (process.env.KEEP !== "1") {
    try {
      const client = getPostgresClient();
      const del = await client.query(
        `DELETE FROM users WHERE device_id LIKE $prefix RETURNING id`,
        { prefix: `${DEVICE_PREFIX}%` },
      );
      const delCp = await client.query(
        `DELETE FROM checkpoints WHERE thread_id = ANY($ids) RETURNING thread_id`,
        { ids: runs.map((r) => r.threadId) },
      );
      console.log(
        `[cleanup] users deleted=${del.rowCount} checkpoints deleted=${delCp.rowCount}`,
      );
    } catch (err) {
      console.error("[cleanup] failed:", err);
    }
  }
  // PG pool/定时器 teardown 泄漏是既有已知面——显式退出（starfit-test-infra 记录）
  process.exit(0);
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

void main();
