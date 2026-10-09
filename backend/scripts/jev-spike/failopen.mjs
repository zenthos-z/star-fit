/**
 * 测试 4：fail-open 验证 —— 路由层异常形态是否可捕获、可回落。
 *
 * 四类异常逐一实测（#160 fail-open 前提：判定失败/低置信 → 回落 chat 全量提示词，轮次绝不失败）：
 *   1. 超时：本地 mock server 挂起不响应 → AbortController 触发（另附真实运行中的 30s 挂死实录）
 *   2. 5xx：本地 mock server 返回 500 + JSON body（另附 dmx 真实 503 形态）
 *   3. 空响应：本地 mock server 返回 200 + 空 body；真实 API questions:{} / state:"" 行为
 *   4. 低置信度：真实调用歧义样本，验证 confidence 可读且阈值判定可行
 *
 * 用法：DMXAPI_API_KEY=<key> node scripts/jev-spike/failopen.mjs
 */

import http from "node:http";
import { requireApiKey, callTypeSafe, saveResult } from "./lib.mjs";

const apiKey = requireApiKey();
const out = { generatedAt: new Date().toISOString(), cases: [] };

/** 模拟路由层决策（#160 设计）：可捕获异常或 conf < 阈值 → 回落 chat。 */
function routeDecision(callResult, threshold = 0.7) {
  if (!callResult.ok) return { routed: "chat", reason: `调用失败（${callResult.error?.name ?? `HTTP ${callResult.status}`}）→ fail-open` };
  const answers = callResult.body?.answers;
  if (!answers || typeof answers !== "object" || Object.keys(answers).length === 0) {
    return { routed: "chat", reason: "answers 缺失/为空 → fail-open" };
  }
  const intent = answers.intent;
  if (!intent?.choice) return { routed: "chat", reason: "intent.choice 缺失 → fail-open" };
  if ((intent.confidence ?? 0) < threshold) {
    return { routed: "chat", reason: `confidence ${intent.confidence} < ${threshold} → fail-open` };
  }
  return { routed: intent.choice, reason: `confidence ${intent.confidence} ≥ ${threshold} → 正常路由` };
}

// ---------- 本地 mock server：可控异常源 ----------
const mock = http.createServer((req, res) => {
  if (req.url === "/hang") {
    // 永不响应，模拟上游挂死
    return;
  }
  if (req.url === "/500") {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "upstream_error", message: "simulated 5xx", type: "dmx_api_error" } }));
    return;
  }
  if (req.url === "/empty200") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(""); // 空 body
    return;
  }
  res.writeHead(404);
  res.end();
});
await new Promise((r) => (mock.listen(0, "127.0.0.1", r)));
const mockBase = `http://127.0.0.1:${mock.address().port}`;
const QS = {
  intent: {
    type: "choice",
    instructions: "判断这条健身应用用户消息的意图类别。",
    criteria: { chat: "闲聊", plan: "计划请求", workout_complete: "训练回传", update_profile: "画像更新" },
  },
};

// ---------- 1. 超时 ----------
{
  const r = await callTypeSafe({ state: "test", questions: QS, apiKey, endpoint: `${mockBase}/hang`, timeoutMs: 800 });
  const decision = routeDecision(r);
  out.cases.push({ case: "timeout_hang", sim: "mock /hang 永不响应 + 800ms AbortController", result: { ok: r.ok, status: r.status, ms: Math.round(r.ms), error: r.error }, decision });
  console.log(`[1] 超时 → error=${r.error?.name}（${Math.round(r.ms)}ms 触发 abort）；决策：${decision.routed}（${decision.reason}）`);
}

// ---------- 2. 5xx ----------
{
  const r = await callTypeSafe({ state: "test", questions: QS, apiKey, endpoint: `${mockBase}/500` });
  const decision = routeDecision(r);
  out.cases.push({ case: "server_5xx", sim: "mock /500 返回 500 + dmx 风格 JSON", result: { ok: r.ok, status: r.status, ms: Math.round(r.ms), body: r.body }, decision });
  console.log(`[2] 5xx → HTTP ${r.status}，body 可解析=${typeof r.body === "object"}；决策：${decision.routed}（${decision.reason}）`);
}

// ---------- 3. 空响应（本地 + 真实 API 两路） ----------
/** 真实 API 调用：网络层失败（AbortError/TypeError）时重试一次（本机→dmx 有 ~3% 偶发断连，本身是 fail-open 论据）。 */
async function callRealWithRetry(opts) {
  let r = await callTypeSafe({ ...opts, apiKey });
  if (!r.ok && r.error && ["AbortError", "TypeError"].includes(r.error.name)) {
    r.retryOf = r.error.name;
    r = await callTypeSafe({ ...opts, apiKey });
  }
  return r;
}

{
  const r = await callTypeSafe({ state: "test", questions: QS, apiKey, endpoint: `${mockBase}/empty200` });
  const decision = routeDecision(r);
  out.cases.push({ case: "empty_body_200", sim: "mock /empty200 返回 200 + 空 body", result: { ok: r.ok, status: r.status, ms: Math.round(r.ms), bodyType: typeof r.body, bodyPreview: String(r.body).slice(0, 80) }, decision });
  console.log(`[3a] 空 body 200 → bodyType=${typeof r.body}；决策：${decision.routed}（${decision.reason}）`);
}
{
  // 真实 API：questions 传空对象
  const r = await callRealWithRetry({ state: "帮我做计划", questions: {} });
  const decision = routeDecision(r);
  out.cases.push({ case: "real_empty_questions", sim: "真实 API questions:{}", result: { ok: r.ok, status: r.status, ms: Math.round(r.ms), body: r.body, retriedFrom: r.retryOf }, decision });
  console.log(`[3b] 真实 questions:{} → HTTP ${r.status}，body=${JSON.stringify(r.body).slice(0, 120)}；决策：${decision.routed}（${decision.reason}）`);
}
{
  // 真实 API：空 state（合法文本）+ 正常问题
  const r = await callRealWithRetry({ state: "", questions: QS, timeoutMs: 45_000 });
  const decision = routeDecision(r);
  out.cases.push({ case: "real_empty_state", sim: "真实 API state:\"\"（空上下文）", result: { ok: r.ok, status: r.status, ms: Math.round(r.ms), answers: r.body?.answers ?? r.body, retriedFrom: r.retryOf }, decision });
  console.log(`[3c] 真实 state:"" → HTTP ${r.status}，intent=${JSON.stringify(r.body?.answers?.intent ?? null).slice(0, 120)}；决策：${decision.routed}（${decision.reason}）`);
}

// ---------- 4. 低置信度（真实歧义样本 ×3） ----------
const ambiguousTexts = [
  { id: "amb-hard", text: "我昨天练了背，感觉还挺不错的", note: "v1/v2 均低置信（0.36-0.71 波动）的复盘式样本" },
  { id: "amb-vague", text: "随便来点啥", note: "无任何意图信号" },
  { id: "amb-mixed", text: "练完了，顺便把我体重改成73公斤", note: "双意图混合" },
];
for (const t of ambiguousTexts) {
  const r = await callRealWithRetry({
    state: `【健身应用 AI 教练 · 用户本轮输入】\n${t.text}`,
    questions: { ...QS, intent: { ...QS.intent, criteria: { chat: "纯闲聊/知识咨询", plan: "生成/调整训练计划", workout_complete: "报告训练完成或数据回传", update_profile: "更新个人画像/身体数据/目标/偏好" } } },
    timeoutMs: 45_000,
  });
  const decision = routeDecision(r);
  const intent = r.body?.answers?.intent;
  out.cases.push({
    case: `low_confidence_${t.id}`, sim: `真实歧义样本：${t.text}（${t.note}）`,
    result: { ok: r.ok, status: r.status, ms: Math.round(r.ms), intent, retriedFrom: r.retryOf },
    decision,
  });
  console.log(`[4:${t.id}] "${t.text}" → intent=${intent?.choice} conf=${intent?.confidence ?? "n/a"}；决策：${decision.routed}（${decision.reason}）`);
}

mock.close();
const file = await saveResult("failopen-results.json", out);
console.log(`\nfail-open 验证完成，原始结果：${file}`);
