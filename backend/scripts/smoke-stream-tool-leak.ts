/**
 * 真实 LLM 冒烟（2026-09-23 tool-leak 修复验证）。
 *
 * 直调 DeepAgentService.chat()（不经 HTTP/SSE 层，聚焦 agent 内核流分类），
 * 场景 = plan（「制定明天计划」）——真实 deepseek-v4-flash-ga-260731 走
 * list_exercises + read_file 工具轮 + 终步答案轮。
 *
 * 断言：
 *   1. token 事件总字符数 < 1500（修复前泄漏 7-11k）；
 *   2. survey_card / plan_card 卡片事件正常落地（走 token 正文 + uiHint 提取）。
 *
 * 用法：
 *   DATABASE_URL=... AI_PROVIDER=deepseek DEEPSEEK_BASE_URL=... \
 *   DEEPSEEK_MODEL_FLASH=... DEEPSEEK_API_KEY=... \
 *   npx tsx scripts/smoke-stream-tool-leak.ts
 */
import { deepAgentService } from "../src/services/agent/DeepAgentService.js";
import type { AgentEvent } from "shared/contracts";

const userId = "a015dd22-9fd2-47ae-bbcb-aaa90bd2aebb";
const threadId = `smoke-${Date.now()}`;

const events: AgentEvent[] = [];
let tokens = 0;
let thinking = 0;
let tokenChars = 0;
let cards: Array<{ type: string; title?: string }> = [];

for await (const ev of deepAgentService.chat({
  userId,
  threadId,
  message: "制定明天的训练计划",
  scenario: "plan",
  metadata: {},
})) {
  events.push(ev);
  if (ev.type === "token" && ev.text) {
    tokens++;
    tokenChars += ev.text.length;
  } else if (ev.type === "thinking" && ev.text) {
    thinking++;
  } else if (ev.type === "uiHint" && ev.card) {
    cards.push({
      type: ev.card.type ?? "unknown",
      title: (ev.card as any).title ?? (ev.card as any).cardType,
    });
  }
}

const joined = events
  .filter((e) => e.type === "token" && e.text)
  .map((e) => e.text as string)
  .join("");

console.log("=== SMOKE RESULT ===");
console.log(`token_events=${tokens}`);
console.log(`token_total_chars=${tokenChars}`);
console.log(`thinking_events=${thinking}`);
console.log(`uiHint_cards=${JSON.stringify(cards)}`);
console.log(`token_text_sample=${joined.slice(0, 200).replace(/\n/g, "\\n")}`);
console.log(`done=${events.some((e) => e.type === "done")} error=${events.some((e) => e.type === "error")}`);

if (events.some((e) => e.type === "error")) {
  const err = events.find((e) => e.type === "error");
  console.error("SMOKE_ERROR:", JSON.stringify(err));
  process.exit(2);
}
if (tokenChars >= 1500) {
  console.error(`SMOKE_FAIL: token chars ${tokenChars} >= 1500 (工具返回泄漏)`);
  process.exit(3);
}
if (cards.length === 0) {
  console.error("SMOKE_FAIL: no uiHint card landed");
  process.exit(4);
}
console.log("SMOKE_PASS");
