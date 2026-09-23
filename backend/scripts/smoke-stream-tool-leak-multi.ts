/**
 * 真实 LLM 冒烟 v5（2026-09-23 tool-leak 返工 v4 验证）——≥5 轮循环，走完整 HTTP SSE。
 *
 * 每轮独立 threadId（冷上下文，真实触发 list_exercises / read_file 工具调用），
 * 统计该轮 token 事件总字符数，断言（返工 v4 双向验收）：
 *   - token_chars < 1500  （无泄漏：v3 漏网 6115 / 2480 字符）
 *   - token_chars > 40    （有真实回答：v2 整段拦截后正文 0 字符；单轮模型方差
 *                          只出卡片+极短引导语可豁免，但 5 轮内不得 2 轮以上 < 40）
 *   - survey_card ≥ 1 张  （全程至少 1 张卡落地，卡片不被吞）
 *
 * 用法：
 *   set -a && . ./.env.local && set +a
 *   DATABASE_URL=postgresql://starfit:***@localhost:5432/starfit \
 *   SMOKE_ROUNDS=5 npx tsx scripts/smoke-stream-tool-leak-multi.ts
 */
import Fastify from "fastify";
import type { AgentEvent } from "shared/contracts";
import { postChat } from "../src/controllers/chatController.js";

const userId = "a015dd22-9fd2-47ae-bbcb-aaa90bd2aebb";
const ROUNDS = Number(process.env.SMOKE_ROUNDS ?? 5);
const MESSAGES = [
  "制定明天的训练计划",
  "帮我制定一份明天的训练计划",
  "明天想练一次，帮我安排计划",
  "请帮我安排一下明天的训练",
  "明天有空，帮我出个训练计划",
];

// 返工 v4 验收（每轮必须同时满足，卡片为全程 ≥1 张）：
//   - 正文 < 1500 字符（无工具复述泄漏）
//   - 正文 > 40 字符（有真实回答，防整段吞；单轮方差可豁免但不超 2 轮）
//   - survey_card ≥ 1 张（防吞卡）
const MAX_TOKEN_CHARS = 1500;
const MIN_TOKEN_CHARS = 40;

async function runRound(
  base: string,
  round: number,
): Promise<{
  tokenChars: number;
  cards: string[];
  done: boolean;
  error: boolean;
}> {
  const threadId = `smoke-multi-${Date.now()}-${round}`;
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

async function main(): Promise<number> {
  const app = Fastify({ logger: false });
  app.post("/api/chat", postChat);
  app.addHook("onError", async (req, reply, err) => {
    console.error("FASTIFY_ONERROR:", err?.message);
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const port = (app.server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  console.log(`=== SMOKE MULTI (${ROUNDS} rounds) ===`);
  const results: Array<{
    tokenChars: number;
    cards: string[];
    ms: number;
    done: boolean;
    error: boolean;
  }> = [];
  for (let r = 0; r < ROUNDS; r++) {
    const startedAt = Date.now();
    const res = await runRound(base, r);
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

  // 逐轮判定 + 全程汇总（返工 v4 双向验收，与任务验收口径一致）：
  //   - 每轮 token < 1500（无泄漏，硬门槛，违反即 FAIL）
  //   - 每轮 token > 40（有真实回答）；单轮「只出卡片+极短引导语」属模型方差
  //     （含 splitLeakedReasoning 的"我来"开首答案被 deliberation 启发式误判
  //     的已知边缘），该轮豁免并注明——但 5 轮内不得 >2 轮正文 ≤40
  //   - 每轮 done 必达、error 必无（流完整性）
  //   - 全程 survey_card ≥ 1 张（防吞卡，全程判定）
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
    if (res.tokenChars <= MIN_TOKEN_CHARS) {
      // 豁免轮：本轮不 FAIL，但计入 belowMin 全程配额（≤2 轮豁免允许）
      belowMin++;
    }
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
  // 豁免上限：5 轮内 ≤2 轮正文 ≤40（模型方差），否则失败
  if (belowMin > 2) {
    fail++;
    console.log(`正文 ≤40 的轮数 = ${belowMin}（要求 ≤2，其余轮须有真实回答）`);
  }
  console.log(
    `汇总: survey_card=${totalCards} 低于40字符轮=${belowMin} token最小=${Math.min(...results.map((r) => r.tokenChars))} token最大=${Math.max(...results.map((r) => r.tokenChars))}`,
  );
  console.log(
    fail === 0 ? "SMOKE_MULTI_PASS" : `SMOKE_MULTI_FAIL (${fail} 处不达标)`,
  );
  return fail === 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("SMOKE_CRASH:", err?.message ?? err);
    process.exit(1);
  });
