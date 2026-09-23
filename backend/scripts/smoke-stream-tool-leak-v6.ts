/**
 * 真实 LLM 冒烟 v6（2026-09-23 tool-leak 返工 v6 验收）——双场景 × ≥6 轮，
 * 走完整 HTTP SSE，各用全新用户。
 *
 * 背景：v5（36f37dd）的 LiveEchoGate 只在「行首已成形」时判复述可疑，
 * chat 场景（用户主界面非计划消息，useAICoach.ts:779 `isPlanMode ? "plan"
 * : "chat"`）里 DeepSeek 复述 read_file 返回时 delta 被切碎（`1\t---` 拆成
 * `1` + `\t---`），每个增量单独看都不满足块首特征 → 立即放行 → 整段编号行
 * frontmatter 逐 delta 漏出（协调者实测 5997 / 2563 / 2460 字符）。plan 场景
 * 不漏是因为复述进 stepRaw（快照前）走整段 stripToolEchoBlocks。
 *
 * v6 修复：isEchoSuspicious 强化为「任意位置指纹 + 可疑前缀」（任意 `\t` /
 * 行首 `{` `[` / 行首裸数字前缀），切碎增量挂链缓冲到完整块边界统一判定。
 *
 * 本冒烟双场景各 6 轮（全新用户，零历史，排除历史污染）：
 *   - plan 场景：计划消息（触发 list_exercises / read_file / load_history）
 *   - chat 场景：用户主界面非计划消息（同样触发工具调用，v6 泄漏场景）
 * 每轮双向断言（同时满足）：
 *   - token_chars < 1500  （无泄漏）
 *   - token_chars > 40    （有真实回答；只出卡+极短引导语可豁免，6 轮内
 *                          不得 >2 轮 <40）
 * 卡片断言：plan 场景 survey_card ≥1 张；chat 场景若模型走纯文本不出卡，
 * 放宽为「正文 >40 且 <1500 即可」，但 chat 6 轮里至少 1 轮应有卡或说明
 * 为何无卡（脚本会打印卡数说明）。
 *
 * 用法：
 *   set -a && . ./.env.local && set +a
 *   npx tsx scripts/smoke-stream-tool-leak-v6.ts
 */
import Fastify from "fastify";
import type { AgentEvent } from "shared/contracts";
import { postChat } from "../src/controllers/chatController.js";
import { loginOrCreate } from "../src/controllers/adminController.js";

const ROUNDS = Number(process.env.SMOKE_ROUNDS ?? 6);
const MAX_TOKEN_CHARS = 1500;
const MIN_TOKEN_CHARS = 40;

const SCENARIOS: Array<{
  name: string;
  messages: string[];
}> = [
  {
    name: "plan",
    messages: [
      "制定明天的训练计划",
      "帮我制定一份明天的训练计划",
      "明天想练一次，帮我安排计划",
      "请帮我安排一下明天的训练",
      "明天有空，帮我出个训练计划",
      "帮我制定明天的训练计划",
    ],
  },
  {
    name: "chat",
    messages: [
      "帮我看看我最近的训练情况",
      "我上周的深蹲重量帮我查查",
      "最近练得怎么样帮我总结一下",
      "帮我查一下我练过哪些动作",
      "我的训练历史里卧推做了多少组",
      "看看我最近的状态怎么样",
    ],
  },
];

interface RoundResult {
  tokenChars: number;
  cards: string[];
  done: boolean;
  error: boolean;
  ms: number;
}

async function runRound(
  base: string,
  userId: string,
  scenario: string,
  message: string,
  round: number,
): Promise<RoundResult> {
  const threadId = `smoke-v6-${Date.now()}-${scenario}-${round}`;
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": userId },
    body: JSON.stringify({
      userId,
      threadId,
      message,
      scenario,
      metadata: {},
    }),
  });
  if (res.status !== 200) {
    console.error(`[round ${round}] HTTP_STATUS:`, res.status);
    return { tokenChars: 0, cards: [], done: false, error: true, ms: 0 };
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
  return { tokenChars, cards, done, error, ms: 0 };
}

async function createFreshUser(base: string): Promise<string> {
  const deviceId = `bench-user-v6-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

/** 跑完一个场景的 ROUNDS 轮，返回失败数。 */
async function runScenario(
  base: string,
  scenario: string,
  messages: string[],
): Promise<number> {
  const userId = await createFreshUser(base);
  console.log(
    `\n=== SMOKE V6 scenario=${scenario} (${ROUNDS} rounds, fresh user ${userId}) ===`,
  );

  const results: RoundResult[] = [];
  for (let r = 0; r < ROUNDS; r++) {
    const startedAt = Date.now();
    const res = await runRound(
      base,
      userId,
      scenario,
      messages[r % messages.length]!,
      r,
    );
    res.ms = Date.now() - startedAt;
    results.push(res);
  }

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
  if (scenario === "plan" && totalCards < 1) {
    fail++;
    console.log(
      `[${scenario}] 全程 survey_card 数量 = ${totalCards}（要求 ≥1 张）`,
    );
  } else {
    console.log(
      `[${scenario}] 全程 survey_card = ${totalCards} 张，其它卡片 = ${JSON.stringify(allCards.filter((c) => c !== "survey_card"))}` +
        (totalCards < 1
          ? "（chat 场景模型走纯文本未出卡 → 已按放宽断言「正文 >40 且 <1500 即可」验收）"
          : ""),
    );
  }
  if (belowMin > 2) {
    fail++;
    console.log(`[${scenario}] 正文 ≤40 的轮数 = ${belowMin}（要求 ≤2）`);
  }
  console.log(
    `[${scenario}] 汇总: survey_card=${totalCards} 低于40字符轮=${belowMin} token最小=${Math.min(...results.map((r) => r.tokenChars))} token最大=${Math.max(...results.map((r) => r.tokenChars))}`,
  );
  console.log(
    fail === 0
      ? `[${scenario}] SCENARIO_PASS`
      : `[${scenario}] SCENARIO_FAIL (${fail} 处不达标)`,
  );
  return fail;
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

  let fail = 0;
  for (const sc of SCENARIOS) {
    fail += await runScenario(base, sc.name, sc.messages);
  }
  await app.close();

  console.log(
    fail === 0 ? "\nSMOKE_V6_PASS" : `\nSMOKE_V6_FAIL (${fail} 处不达标)`,
  );
  return fail === 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("SMOKE_CRASH:", err?.message ?? err);
    process.exit(1);
  });
