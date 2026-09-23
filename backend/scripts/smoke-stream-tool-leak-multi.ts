/**
 * 真实 LLM 冒烟 v3（2026-09-23 tool-leak 返工验证）——≥3 轮循环，走完整 HTTP SSE。
 *
 * 每轮独立 threadId（冷上下文，真实触发 list_exercises / read_file 工具调用），
 * 统计该轮 token 事件总字符数，断言 < 1500（修复前泄漏 7-11k）。
 *
 * 用法：
 *   set -a && . ./.env.local && set +a
 *   DATABASE_URL=... STARFIT_PORT=0 \
 *   npx tsx scripts/smoke-stream-tool-leak-multi.ts
 */
import Fastify from "fastify";
import type { AgentEvent } from "shared/contracts";
import { postChat } from "../src/controllers/chatController.js";

const userId = "a015dd22-9fd2-47ae-bbcb-aaa90bd2aebb";
const ROUNDS = Number(process.env.SMOKE_ROUNDS ?? 3);
const MESSAGES = [
  "制定明天的训练计划",
  "帮我制定一份明天的训练计划",
  "明天想练一次，帮我安排计划",
];

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
  let fail = 0;
  for (let r = 0; r < ROUNDS; r++) {
    const startedAt = Date.now();
    const res = await runRound(base, r);
    const ms = Date.now() - startedAt;
    const ok = !res.error && res.done && res.tokenChars < 1500;
    console.log(
      `round ${r + 1}: token_chars=${res.tokenChars} cards=[${res.cards.join(",")}] done=${res.done} error=${res.error} ms=${ms} ${ok ? "OK" : "FAIL"}`,
    );
    if (!ok) fail++;
  }
  await app.close();
  console.log(
    fail === 0 ? "SMOKE_MULTI_PASS" : `SMOKE_MULTI_FAIL (${fail}/${ROUNDS})`,
  );
  return fail === 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("SMOKE_CRASH:", err?.message ?? err);
    process.exit(1);
  });
