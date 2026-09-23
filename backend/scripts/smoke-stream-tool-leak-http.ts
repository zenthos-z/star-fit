/**
 * 真实 LLM 冒烟 v2（2026-09-23 tool-leak 修复验证）——走完整 HTTP SSE 链路。
 *
 * 起真实 Fastify 的 /api/chat 路由（chatController compose 层，含
 * extractUiHintEvents + uiHintValidationLoop 质量门），真实
 * deepseek-v4-flash-ga-260731 + 真实 PG（agent_runtime checkpointer）。
 *
 * 断言：
 *   1. SSE 流里 token 事件总字符数 < 1500（修复前泄漏 7-11k）；
 *   2. survey_card / plan_card uiHint 卡片正常落地（经 M5 校验回路）；
 *   3. done 事件必达、无 error。
 *
 * 用法：
 *   DATABASE_URL=... AI_PROVIDER=deepseek DEEPSEEK_BASE_URL=... \
 *   DEEPSEEK_MODEL_FLASH=... DEEPSEEK_API_KEY=... \
 *   npx tsx scripts/smoke-stream-tool-leak-http.ts
 */
import Fastify from "fastify";
import type { AgentEvent } from "shared/contracts";
import { postChat } from "../src/controllers/chatController.js";

const userId = "a015dd22-9fd2-47ae-bbcb-aaa90bd2aebb";
const threadId = `smoke-http-${Date.now()}`;

async function main(): Promise<number> {
  const app = Fastify({ logger: false });
  app.post("/api/chat", postChat);
  app.addHook("onError", async (req, reply, err) => {
    console.error("FASTIFY_ONERROR:", err?.message);
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const port = (app.server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;

  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-id": userId,
    },
    body: JSON.stringify({
      userId,
      threadId,
      message: "制定明天的训练计划",
      scenario: "plan",
      metadata: {},
    }),
  });
  if (res.status !== 200) {
    console.error("HTTP_STATUS:", res.status, "BODY:", (await res.text()).slice(0, 400));
  }
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: AgentEvent[] = [];

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const rawFrame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const line = rawFrame.split("\n").find((l) => l.startsWith("data: "));
      if (line) events.push(JSON.parse(line.slice(6)) as AgentEvent);
    }
  }
  await app.close();

  let tokenChars = 0;
  let tokens = 0;
  let thinking = 0;
  const cards: string[] = [];
  for (const ev of events) {
    if (ev.type === "token" && ev.text) {
      tokens++;
      tokenChars += ev.text.length;
    } else if (ev.type === "thinking" && ev.text) {
      thinking++;
    } else if (ev.type === "uiHint" && ev.card) {
      cards.push(String(ev.card.type ?? "unknown"));
    }
  }
  const tokenText = events
    .filter((e) => e.type === "token" && e.text)
    .map((e) => e.text as string)
    .join("");

  console.log("=== HTTP SMOKE RESULT ===");
  console.log(`http_status=${res.status}`);
  console.log(`token_events=${tokens}`);
  console.log(`token_total_chars=${tokenChars}`);
  console.log(`thinking_events=${thinking}`);
  console.log(`uiHint_cards=[${cards.join(",")}]`);
  console.log(`done=${events.some((e) => e.type === "done")}`);
  console.log(`error=${events.some((e) => e.type === "error")}`);
  console.log(`token_sample=${tokenText.slice(0, 160).replace(/\n/g, "\\n")}`);

  let fail = 0;
  if (events.some((e) => e.type === "error")) {
    console.error("SMOKE_FAIL: error event in stream");
    fail = 2;
  } else if (tokenChars >= 1500) {
    console.error(`SMOKE_FAIL: token chars ${tokenChars} >= 1500 (工具返回泄漏)`);
    fail = 3;
  } else if (cards.length === 0) {
    console.error("SMOKE_FAIL: no uiHint card landed");
    fail = 4;
  } else if (!events.some((e) => e.type === "done")) {
    console.error("SMOKE_FAIL: no done event");
    fail = 5;
  }
  if (fail === 0) console.log("SMOKE_PASS");
  return fail;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("SMOKE_CRASH:", err?.message ?? err);
    process.exit(1);
  });
