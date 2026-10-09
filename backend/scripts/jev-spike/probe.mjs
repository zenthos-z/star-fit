/**
 * 测试 1：协议探测 —— jev-1.13.0 在 dmx 的真实请求/响应形态。
 *
 * 产出（写入 results/probe-results.json 并打印摘要）：
 *   A. /v1/models 目录中 jev 的存在性与 metadata
 *   B. chat/completions 路径可用性（对照，验证 jev 只走 TypeSafe 端点）
 *   C. TypeSafe 端点最小请求 + choice/score/noul 三型逐一实测
 *   D. 协议边界错误形态（缺 state / 未知 type / choice 缺 criteria / 未知模型 / 错误密钥）
 *
 * 用法：DMXAPI_API_KEY=<key> node scripts/jev-spike/probe.mjs
 */

import { requireApiKey, callTypeSafe, saveResult, MODELS_ENDPOINT, DMX_BASE, JEV_MODEL } from "./lib.mjs";

const apiKey = requireApiKey();
const out = { generatedAt: new Date().toISOString(), sections: {} };

function summarize(x) {
  return JSON.stringify(x, null, 2);
}

// ---------- A. 模型目录 ----------
{
  const res = await fetch(MODELS_ENDPOINT, { headers: { Authorization: `Bearer ${apiKey}` } });
  const data = await res.json();
  const entry = (data.data ?? []).find((m) => m.id === JEV_MODEL);
  out.sections.modelsCatalog = {
    httpStatus: res.status,
    totalModels: Array.isArray(data.data) ? data.data.length : null,
    jevEntry: entry ?? null,
  };
  console.log(`[A] /v1/models → HTTP ${res.status}，共 ${out.sections.modelsCatalog.totalModels} 模型，jev 条目：${entry ? JSON.stringify(entry) : "不存在"}`);
}

// ---------- B. chat/completions 对照 ----------
{
  const attempts = [];
  for (let i = 1; i <= 2; i++) {
    const started = performance.now();
    try {
      const res = await fetch(`${DMX_BASE}/v1/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: JEV_MODEL, messages: [{ role: "user", content: "test" }] }),
      });
      const text = await res.text();
      attempts.push({ try: i, httpStatus: res.status, bodySafe: text.slice(0, 300), wallMs: Math.round(performance.now() - started) });
    } catch (err) {
      attempts.push({ try: i, httpStatus: null, error: `${err.name}: ${err.message}`, wallMs: Math.round(performance.now() - started) });
    }
    if (attempts.at(-1).httpStatus !== null) break;
  }
  out.sections.chatCompletionsControl = { attempts, note: "curl 直测同请求稳定返回 503 model_not_found（分组 default 无渠道），见 REPORT.md" };
  console.log(`[B] /v1/chat/completions 对照 → ${JSON.stringify(attempts.at(-1).httpStatus)}（预期：jev 不走该路径）`);
}

// ---------- C. TypeSafe 端点三型实测 ----------
const STATE = "【用户消息】帮我做一份增肌计划，我每周能练三天。";

const questionsAll = {
  intent: {
    type: "choice",
    instructions: "判断这条健身应用用户消息的意图类别。",
    criteria: {
      chat: "自由聊天、闲聊、咨询健身知识，不涉及生成计划/记录训练/更新个人资料",
      plan: "明确请求生成、调整或查看训练计划",
      workout_complete: "报告完成了训练、记录训练结果、回传训练数据",
      update_profile: "更新个人资料、身体数据、目标、偏好设置",
    },
  },
  certainty: {
    type: "score",
    instructions: "评估你对 intent 判断的确定程度。",
    criteria: ["很不确定", "较不确定", "一般", "较确定", "很确定"],
  },
  is_ambiguous: {
    type: "noul",
    instructions: "判断这条消息的意图是否 ambiguous（可能同时属于多个类别）。",
  },
};

{
  const r = await callTypeSafe({ state: STATE, questions: questionsAll, apiKey, timeoutMs: 30_000 });
  out.sections.typesafeFull = {
    ok: r.ok, status: r.status, ms: Math.round(r.ms),
    requestShape: { model: JEV_MODEL, state: STATE, questions: questionsAll },
    responseBody: r.body,
    error: r.error ?? undefined,
  };
  console.log(`[C] TypeSafe 全三型 → HTTP ${r.status} ${Math.round(r.ms)}ms`);
  if (r.ok) {
    for (const [qid, ans] of Object.entries(r.body.answers ?? {})) {
      console.log(`    ${qid}: ${JSON.stringify(ans)}`);
    }
    console.log(`    usage: ${JSON.stringify(r.body.usage)}`);
  } else {
    console.log(`    body: ${JSON.stringify(r.body).slice(0, 300)}`);
  }
}

// 单型最小请求（验证 questions 可只含一个问题）
{
  const r = await callTypeSafe({
    state: STATE,
    questions: { intent: questionsAll.intent },
    apiKey,
  });
  out.sections.typesafeSingleQuestion = { ok: r.ok, status: r.status, ms: Math.round(r.ms), responseBody: r.body };
  console.log(`[C2] 单问题最小请求 → HTTP ${r.status}，answers 键 = ${r.ok ? Object.keys(r.body.answers ?? {}) : "-"}`);
}

// ---------- D. 协议边界错误形态 ----------
const edgeProbes = [];

// D1: 缺 state
edgeProbes.push({
  name: "missing_state",
  result: await callTypeSafe({ state: undefined, questions: { intent: questionsAll.intent }, apiKey }),
});
// D2: 未知问题 type
edgeProbes.push({
  name: "unknown_question_type",
  result: await callTypeSafe({
    state: STATE,
    questions: { q: { type: "boolean", instructions: "yes or no" } },
    apiKey,
  }),
});
// D3: choice 缺 criteria
edgeProbes.push({
  name: "choice_missing_criteria",
  result: await callTypeSafe({
    state: STATE,
    questions: { q: { type: "choice", instructions: "pick one" } },
    apiKey,
  }),
});
// D4: 未知模型
edgeProbes.push({
  name: "unknown_model",
  result: await callTypeSafe({
    state: STATE,
    questions: { intent: questionsAll.intent },
    model: "jev-9.9.9-not-exist",
    apiKey,
  }),
});
// D5: 错误密钥
{
  const r = await callTypeSafe({
    state: STATE,
    questions: { intent: questionsAll.intent },
    apiKey: "sk-invalid-key-for-spike",
  });
  edgeProbes.push({ name: "invalid_api_key", result: r });
}

out.sections.edgeProbes = edgeProbes.map((p) => ({
  name: p.name,
  ok: p.result.ok,
  status: p.result.status,
  ms: Math.round(p.result.ms),
  body: p.result.body,
  error: p.result.error ?? undefined,
}));
for (const p of out.sections.edgeProbes) {
  console.log(`[D] ${p.name} → HTTP ${p.status} ${p.ms}ms :: ${JSON.stringify(p.body ?? p.error).slice(0, 160)}`);
}

const file = await saveResult("probe-results.json", out);
console.log(`\n协议探测完成，原始结果：${file}`);
console.log(summarifyInvariant(out));
/** 响应形态不变量摘要（choice/score/noul 各自字段）。 */
function summarifyInvariant(o) {
  const ans = o.sections.typesafeFull?.responseBody?.answers;
  if (!ans) return "（无成功响应，无法提取不变量）";
  const lines = ["响应形态不变量："];
  for (const [qid, a] of Object.entries(ans)) {
    lines.push(`  ${qid} (type=${a.type}): 字段 = ${Object.keys(a).join(", ")}`);
  }
  return lines.join("\n");
}
