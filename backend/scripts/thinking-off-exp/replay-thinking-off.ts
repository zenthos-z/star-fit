/**
 * 关思考实验 A2b（#155 #160）——关思考回放（复用 jev-nodes-research 剧本与计量）。
 *
 * 与 replay-baseline.ts 的差异（其余计量逐字保持一致，确保与基线可比）：
 *   1. 运行前由 self-check.ts 证实：本实验经 env THINKING_DISABLED_CHAT=true
 *      关闭 chat 场景思考（计划生成轮的真实场景名是 chat，#160 实锤 isPlanMode
 *      死路；parseDisabledFlag 只认 true/false——任务书候选键
 *      THINKING_DISABLED_PLAN=1 双陷阱已实证并记录）。
 *   2. 新增质量门计量：
 *      - validationRetries：uiHintValidationLoop 打回轮数（RETRY_STATUS_TOKEN
 *        "\n\n正在修订卡片…" 在 token 事件中的出现次数，含卡无效与泄漏两条
 *        重试通道——两者对用户表现为同一 token）；
 *      - leakSuspects：thinking 事件中疑似卡片 JSON 残片（同时含 '{' 与
 *        '"type"'）计数，供离线泄漏核查；
 *      - token 事件头 120 字符落盘（基线版只记长度）。
 *   3. collectToolRounds 修复：消息类型检测改用 _getType()（BaseMessage 契约，
 *      基线版进程内识别失败的根因），checkpointer thread_id 使用
 *      `${userId}:${threadId}` 复合键（DeepAgentService L597 拼接）——工具
 *      轮次不再需要离线补取。
 *   4. 清理：device_id 前缀 thinking-off-replay-；checkpoints 按复合键删。
 *
 * 配额纪律（任务书）：真 LLM 回放 ≤8 turn 总额由本实验两批（hit ×2 run +
 * half ×2 run，每 run 2 turn）合计构成；单次调用 RUNS=2 / HARD_TURN_CAP=4。
 *
 * 用法（backend/ 下）：
 *   THINKING_DISABLED_CHAT=true GLM_API_KEY=… DATABASE_URL=… \
 *   GROUP=hit RUNS=2 TURN2_MSG="新手×居家×3练全要素消息" \
 *   npx tsx scripts/thinking-off-exp/replay-thinking-off.ts
 * env：GROUP（hit|half，仅影响产物文件名）| RUNS(默认2) | HARD_TURN_CAP(默认4)
 *      | KEEP=1 跳过清理 | EVENTS_DIR（默认脚本目录 results/）| TURN1_MSG/TURN2_MSG
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
const GROUP = process.env.GROUP ?? "exp";
const RUNS = Number(process.env.RUNS ?? 2);
/** 配额硬顶：本实验单批 2 run × 2 turn = 4（两批合计 8 = 任务书总额）。 */
const HARD_TURN_CAP = Number(process.env.HARD_TURN_CAP ?? 4);
const DEVICE_PREFIX = "thinking-off-replay-";
/** uiHintValidationLoop 打回轮的状态 token（两条重试通道共用）。 */
const RETRY_STATUS_TOKEN_MARK = "正在修订卡片";

/** 剧本与 jev-nodes-research/replay-baseline.ts 逐字一致（对照可比前提）。 */
const TURN1_MSG =
  process.env.TURN1_MSG ?? "帮我制定一份这周的训练计划";
/** 默认 turn2 = 中级×居家×4练（半命中）；hit 批用 TURN2_MSG 覆盖为新手×居家×3练。 */
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
  /** 质量门新增：校验回路打回轮数（RETRY_STATUS_TOKEN 出现次数）。 */
  validationRetries: number;
  /** 质量门新增：thinking 流中疑似卡片残片计数（含 '{' 且含 '"type"'）。 */
  leakSuspects: number;
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

/** 消费一条 AgentEvent 流并计量；时间线落 JSONL（thinking 头 240 字符 +
 * token 头 120 字符——后者为质量门新增，基线版只记长度）。 */
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
    validationRetries: 0,
    leakSuspects: 0,
  };
  const t0 = Date.now();
  try {
    for await (const ev of iter) {
      const at = Date.now() - t0;
      if (m.timeline.firstEventAt === null) m.timeline.firstEventAt = at;
      if (ev.type === "thinking" && ev.text) {
        m.thinkingEvents += 1;
        m.thinkingChars += ev.text.length;
        if (ev.text.includes("{") && ev.text.includes('"type"')) {
          m.leakSuspects += 1;
        }
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
        if (ev.text.includes(RETRY_STATUS_TOKEN_MARK)) {
          m.validationRetries += 1;
        }
        if (m.timeline.firstTokenAt === null) m.timeline.firstTokenAt = at;
        appendFileSync(
          eventsFile,
          JSON.stringify({
            at,
            type: "token",
            len: ev.text.length,
            head: ev.text.slice(0, 120),
          }) + "\n",
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
 * 模型轮次（AI 消息数）与工具调用序列。
 * （修复基线版两处缺陷：①类型检测改 _getType()（BaseMessage 契约）；
 *  ②checkpointer 实际键 = `${userId}:${threadId}` 复合（L597）。）
 */
async function collectToolRounds(
  cpThreadId: string,
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
      configurable: { thread_id: cpThreadId },
    });
    msgs = (tuple?.checkpoint?.channel_values?.messages ?? []) as Array<
      Record<string, unknown>
    >;
    const humans = msgs.filter(
      (x) =>
        typeof x._getType === "function" && x._getType() === "human",
    ).length;
    if (humans >= expectedHumans) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const perTurn: ToolRoundInfo[] = [];
  let current: ToolRoundInfo | null = null;
  for (const msg of msgs) {
    const t =
      typeof msg._getType === "function" ? msg._getType() : String(msg.type ?? "?");
    if (t === "human") {
      if (current) perTurn.push(current);
      current = { turn: perTurn.length + 1, modelRounds: 0, toolCalls: [] };
    } else if (t === "ai" && current) {
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
  // 开关断言：本脚本必须在 THINKING_DISABLED_CHAT=true 下运行（跑错配置
  // 烧掉的是不可比数据，白付配额）
  if (process.env.THINKING_DISABLED_CHAT !== "true") {
    console.error(
      "[guard] THINKING_DISABLED_CHAT!=true——本脚本只做关思考实验组，" +
        "基线请用 jev-nodes-research/replay-baseline.ts。中止。",
    );
    process.exit(2);
  }
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
    /** checkpointer 复合键（清理与工具轮取数共用）。 */
    cpThreadId: string;
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
    const threadId = `think-off-${GROUP}-r${run}-${Date.now().toString(36)}`;
    const cpThreadId = `${userId}:${threadId}`;
    const eventsFile = join(
      EVENTS_DIR,
      `replay-events-${GROUP}-run${run}.jsonl`,
    );
    writeFileSync(eventsFile, "");
    console.log(
      `\n=== RUN ${run} [${GROUP}] (user=${userId.slice(0, 8)}… thread=${threadId}) ===`,
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
          `打回=${t.validationRetries} 疑似泄漏=${t.leakSuspects} ` +
          `${t.ms}ms 模板指纹=${t.templateFingerprint ?? "-"} ` +
          `err=${t.error ? t.error.slice(0, 50) : "N"}`,
      );
      // 429/配额类失败立即停（避免空烧配额）
      if (t.error && /429|quota|上限/i.test(t.error)) {
        console.log(`[quota] 疑似配额耗尽，终止后续 turn。`);
        break;
      }
    }

    const toolRounds = await collectToolRounds(cpThreadId, turns.length);
    for (const tr of toolRounds) {
      console.log(
        `  turn ${tr.turn} 模型轮次=${tr.modelRounds} 工具=[${tr.toolCalls.join(" → ")}]`,
      );
    }
    runs.push({ run, userId, threadId, cpThreadId, turns, toolRounds });
  }

  // 汇总
  const summary = {
    schema: "thinking-off-replay/1",
    ranAt: new Date().toISOString(),
    group: GROUP,
    thinkingSwitch: "THINKING_DISABLED_CHAT=true (env, source verified by self-check)",
    scenario: "chat（#160 实锤的真实路径：isPlanMode 死路）",
    turnsAttempted,
    runs: runs.map((r) => ({
      run: r.run,
      userId: r.userId,
      threadId: r.threadId,
      cpThreadId: r.cpThreadId,
      turns: r.turns.map((t) => ({
        ...t,
        message: undefined,
      })),
      toolRounds: r.toolRounds,
    })),
  };
  const out = join(EVENTS_DIR, `replay-${GROUP}.json`);
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
        `墙钟中位=${median(ms)}ms 打回合计=${ts.reduce((a, t) => a + t.validationRetries, 0)} ` +
        `疑似泄漏合计=${ts.reduce((a, t) => a + t.leakSuspects, 0)} ` +
        `卡=${ts.map((t) => t.cards.join("+")).join(" | ")}`,
    );
  }

  await app.close();

  // 清理（默认）：删测试用户 + 其 thread checkpoints（复合键）
  if (process.env.KEEP !== "1") {
    try {
      const client = getPostgresClient();
      const del = await client.query(
        `DELETE FROM users WHERE device_id LIKE $prefix RETURNING id`,
        { prefix: `${DEVICE_PREFIX}%` },
      );
      // checkpointer 真表在 agent_runtime schema（public.checkpoints 是空壳
      // 同名表——基线脚本清错表的原因）；三表按 thread_id 连删（94+162+286
      // 行实测形态：checkpoints/checkpoint_writes/checkpoint_blobs）
      let cpDeleted = 0;
      for (const tbl of [
        "checkpoints",
        "checkpoint_writes",
        "checkpoint_blobs",
      ]) {
        const del = await client.query(
          `DELETE FROM agent_runtime.${tbl} WHERE thread_id = ANY($ids)`,
          { ids: runs.map((r) => r.cpThreadId) },
        );
        cpDeleted += del.rowCount ?? 0;
      }
      console.log(
        `[cleanup] users deleted=${del.rowCount} checkpoint rows deleted=${cpDeleted}`,
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
