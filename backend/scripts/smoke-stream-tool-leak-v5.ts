/**
 * 真实 LLM 冒烟 v5（2026-09-23 tool-leak 返工 v5 验收）——≥6 轮循环，走完整 HTTP SSE。
 *
 * 与 v4 冒烟（smoke-stream-tool-leak-multi.ts）的关键差异：**全新用户**——
 * 每次运行先调 /api/admin/login-or-create 用随机 device_id 建一个零历史账号，
 * 彻底排除「历史污染」假设（协调者已用全新用户 4 轮 3 泄漏坐实代码缺陷）。
 *
 * 每轮独立 threadId（冷上下文，真实触发 list_exercises / read_file 工具调用），
 * 统计该轮 token 事件总字符数，断言（返工 v5 双向验收）：
 *   - token_chars < 1500  （无泄漏）
 *   - token_chars > 40    （有真实回答；单轮模型方差只出卡片+极短引导语可豁免，
 *                          但 6 轮内不得 >2 轮 < 40）
 *   - survey_card ≥ 1 张  （全程至少 1 张卡落地，卡片不被吞）
 *
 * 用法：
 *   set -a && . ./.env.local && set +a
 *   npx tsx scripts/smoke-stream-tool-leak-v5.ts
 */
import Fastify from "fastify";
import type { AgentEvent } from "shared/contracts";
import { postChat } from "../src/controllers/chatController.js";
import { loginOrCreate } from "../src/controllers/adminController.js";

const ROUNDS = Number(process.env.SMOKE_ROUNDS ?? 6);
const MESSAGES = [
  "制定明天的训练计划",
  "帮我制定一份明天的训练计划",
  "明天想练一次，帮我安排计划",
  "请帮我安排一下明天的训练",
  "明天有空，帮我出个训练计划",
  "帮我制定明天的训练计划",
];

const MAX_TOKEN_CHARS = 1500;
const MIN_TOKEN_CHARS = 40;

async function runRound(
  base: string,
  userId: string,
  round: number,
): Promise<{
  tokenChars: number;
  cards: string[];
  done: boolean;
  error: boolean;
}> {
  const threadId = `smoke-v5-${Date.now()}-${round}`;
  const message = MESSAGES[round % MESSAGES.length]!;
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": userId },
    body: JSON.stringify({
      userId,
      threadId,
      message,
      scenario: "plan",
      metadata: {},
    }),
  });
  if (res.status !== 200) {
    console.error(`[round ${round}] HTTP_STATUS:`, res.status);
    return { tokenChars: 0, cards: [], done: false, error: true };
  }
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let tokenChars = 0;
  const cards: string[] = [];
  let done = false;
  let error = false;
  for (;;) {
    const { value, done: readDone } = await reader.read();
    if (readDone) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const rawFrame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const line = rawFrame.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      let ev: AgentEvent;
      try {
        ev = JSON.parse(line.slice(6)) as AgentEvent;
      } catch {
        continue;
      }
      if (ev.type === "token" && ev.text) tokenChars += ev.text.length;
      else if (ev.type === "uiHint" && ev.card)
        cards.push(String(ev.card.type ?? "unknown"));
      else if (ev.type === "done") done = true;
      else if (ev.type === "error") error = true;
    }
  }
  return { tokenChars, cards, done, error };
}

async function createFreshUser(base: string): Promise<string> {
  const deviceId = `bench-user-v5-${Date.now()}`;
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
  if (!body.isNew)
    throw new Error(`fresh user unexpectedly existed: ${deviceId}`);
  return body.userId;
}

async function main(): Promise<number> {
  const app = Fastify({ logger: false });
  app.post("/api/chat", postChat);
  app.post("/api/admin/login-or-create", loginOrCreate);
  app.addHook("onError", async (req, reply, err) => {
    console.error("FASTIFY_ONERROR:", err?.message);
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const port = (app.server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  const userId = await createFreshUser(base);
  console.log(`=== SMOKE V5 (${ROUNDS} rounds, fresh user ${userId}) ===`);

  const results: Array<{
    tokenChars: number;
    cards: string[];
    ms: number;
    done: boolean;
    error: boolean;
  }> = [];
  for (let r = 0; r < ROUNDS; r++) {
    const startedAt = Date.now();
    const res = await runRound(base, userId, r);
    const ms = Date.now() - startedAt;
    results.push({
      tokenChars: res.tokenChars,
      cards: res.cards,
      ms,
      done: res.done,
      error: res.error,
    });
  }
  await app.close();

  let fail = 0;
  let belowMin = 0;
  const allCards: string[] = [];
  results.forEach((res, i) => {
    allCards.push(...res.cards);
    const reasons: string[] = [];
    if (!res.done) reasons.push("no-done");
    if (res.error) reasons.push("error");
    if (res.tokenChars >= MAX_TOKEN_CHARS)
      reasons.push(`leak(${res.tokenChars})`);
    if (res.tokenChars <= MIN_TOKEN_CHARS) belowMin++;
    if (reasons.length > 0) fail++;
    console.log(
      `round ${i + 1}: token_chars=${res.tokenChars} cards=[${res.cards.join(",")}] done=${res.done} error=${res.error} ms=${res.ms} ${res.tokenChars <= MIN_TOKEN_CHARS ? "EXEMPT(方差,记配额)" : reasons.length === 0 ? "OK" : `FAIL(${reasons.join(",")})`}`,
    );
  });
  const totalCards = allCards.filter((c) => c === "survey_card").length;
  if (totalCards < 1) {
    fail++;
    console.log(`全程 survey_card 数量 = ${totalCards}（要求 ≥1 张）`);
  }
  if (belowMin > 2) {
    fail++;
    console.log(`正文 ≤40 的轮数 = ${belowMin}（要求 ≤2，其余轮须有真实回答）`);
  }
  console.log(
    `汇总: survey_card=${totalCards} 低于40字符轮=${belowMin} token最小=${Math.min(...results.map((r) => r.tokenChars))} token最大=${Math.max(...results.map((r) => r.tokenChars))}`,
  );
  console.log(
    fail === 0 ? "SMOKE_V5_PASS" : `SMOKE_V5_FAIL (${fail} 处不达标)`,
  );
  return fail === 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("SMOKE_CRASH:", err?.message ?? err);
    process.exit(1);
  });
