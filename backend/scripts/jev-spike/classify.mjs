/**
 * 测试 2 + 测试 3：意图分类准确率 + 延迟实测（同一批调用同时产出两项数据）。
 *
 * 逐条串行调用（避免并发影响延迟测量），每条记录：
 *   wallMs（客户端全链路：DNS+TLS+dmx 转发+模型判定）、choice、confidence、
 *   probabilities、noul 歧义分、input/output tokens。
 *
 * 产出：results/classify-results.json；打印混淆矩阵、错样本清单、延迟分位。
 *
 * 用法：DMXAPI_API_KEY=<key> node scripts/jev-spike/classify.mjs [--passes=1]
 */

import { requireApiKey, callTypeSafe, percentile, saveResult } from "./lib.mjs";
import { SAMPLES, sampleStats } from "./samples.mjs";

const apiKey = requireApiKey();
const args = process.argv.slice(2);
const passes = Number(args.find((a) => a.startsWith("--passes="))?.split("=")[1] ?? 1);

/** 与 #160 路由层设计一致的预定义问题（一次性问齐：类别 + 歧义 + 确定度）。 */
const QUESTIONS_V1 = {
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
  is_ambiguous: {
    type: "noul",
    instructions: "判断这条消息的意图是否 ambiguous（可能同时属于多个类别）。",
  },
  certainty: {
    type: "score",
    instructions: "评估你对 intent 判断的确定程度。",
    criteria: ["很不确定", "较不确定", "一般", "较确定", "很确定"],
  },
};

/**
 * v2：针对 v1 错样本（无触发词的画像陈述被判 chat/plan）强化 criteria 措辞——
 * update_profile 覆盖隐式身体数据/时间变化/伤病约束陈述，workout_complete 覆盖部分完成与过去式回传。
 */
const QUESTIONS_V2 = {
  intent: {
    type: "choice",
    instructions: "判断这条健身应用用户消息的主要意图类别。若消息包含个人信息陈述（数据变化/时间变化/伤病/饮食限制）优先考虑画像更新而非闲聊。",
    criteria: {
      chat: "纯社交闲聊、咨询健身知识、情绪表达，不需要程序化处理任何用户数据",
      plan: "请求生成、调整、替换或查看训练计划的排期与内容",
      workout_complete: "报告训练完成、部分完成或过去训练情况，回传组数/重量/时长/心率等训练数据",
      update_profile: "陈述或更新个人画像：目标、体重、身高、年龄、力量极限、静息心率等身体数据变化，可用训练时间变化，伤病约束，饮食限制与偏好",
    },
  },
  is_ambiguous: QUESTIONS_V1.is_ambiguous,
  certainty: QUESTIONS_V1.certainty,
};

const variant = args.find((a) => a.startsWith("--variant="))?.split("=")[1] ?? "v1";
const QUESTIONS = variant === "v2" ? QUESTIONS_V2 : QUESTIONS_V1;

function stateFor(text) {
  // state 头部模拟 #160 设计的输入（用户消息为主；正式实现还会带最近对话摘要+附件元数据）
  return `【健身应用 AI 教练 · 用户本轮输入】\n${text}`;
}

const stats = sampleStats();
console.log(`样本集：${stats.total} 条，分布 ${JSON.stringify(stats.byLabel)}，边界样本 ${stats.boundaryCount} 条，variant=${variant}，passes=${passes}\n`);

const allPasses = [];
for (let pass = 1; pass <= passes; pass++) {
  const rows = [];
  for (const s of SAMPLES) {
    const r = await callTypeSafe({ state: stateFor(s.text), questions: QUESTIONS, apiKey, timeoutMs: 30_000 });
    if (!r.ok) {
      rows.push({
        id: s.id, expected: s.expected, ok: false, status: r.status,
        error: r.error ?? JSON.stringify(r.body).slice(0, 200), ms: Math.round(r.ms),
      });
      console.log(`  ✗ ${s.id} 调用失败 HTTP ${r.status} ${r.ms | 0}ms`);
      continue;
    }
    const a = r.body.answers ?? {};
    const intent = a.intent ?? {};
    rows.push({
      id: s.id, text: s.text, expected: s.expected, boundary: Boolean(s.boundary),
      ok: true, status: r.status, ms: Math.round(r.ms * 10) / 10,
      predicted: intent.choice ?? null,
      correct: (intent.choice ?? null) === s.expected,
      confidence: intent.confidence ?? null,
      probabilities: intent.probabilities ?? null,
      ambiguityNoul: a.is_ambiguous?.noul ?? null,
      certaintyScore: a.certainty?.score ?? null,
      inputTokens: r.body.usage?.input_tokens ?? null,
      outputTokens: r.body.usage?.output_tokens ?? null,
    });
    const mark = rows.at(-1).correct ? "✓" : "✗";
    console.log(`  ${mark} ${s.id.padEnd(7)} expected=${s.expected.padEnd(16)} got=${String(rows.at(-1).predicted).padEnd(16)} conf=${intent.confidence} ${rows.at(-1).ms}ms`);
    await new Promise((res) => setTimeout(res, 150)); // 轻微间隔，降低限流风险
  }

  // ---- 汇总 ----
  const okRows = rows.filter((r) => r.ok);
  const correct = okRows.filter((r) => r.correct);
  const labels = ["chat", "plan", "workout_complete", "update_profile"];
  const confusion = {};
  for (const e of labels) {
    confusion[e] = {};
    for (const p of labels) confusion[e][p] = okRows.filter((r) => r.expected === e && r.predicted === p).length;
  }
  const latencies = okRows.map((r) => r.ms).sort((x, y) => x - y);
  const boundaryRows = okRows.filter((r) => r.boundary);
  const passResult = {
    pass,
    accuracy: { total: okRows.length, correct: correct.length, rate: correct.length / okRows.length },
    boundaryAccuracy: {
      total: boundaryRows.length,
      correct: boundaryRows.filter((r) => r.correct).length,
      rate: boundaryRows.filter((r) => r.correct).length / boundaryRows.length,
    },
    confusion,
    misclassified: okRows.filter((r) => !r.correct).map(({ id, text, expected, predicted, confidence, probabilities, boundary }) => ({ id, text, expected, predicted, confidence, probabilities, boundary })),
    latencyMs: {
      p50: Math.round(percentile(latencies, 0.5)),
      p90: Math.round(percentile(latencies, 0.9)),
      p95: Math.round(percentile(latencies, 0.95)),
      max: Math.round(latencies.at(-1)),
      min: Math.round(latencies[0]),
      mean: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
    },
    tokens: {
      inputTotal: okRows.reduce((a, r) => a + (r.inputTokens ?? 0), 0),
      outputTotal: okRows.reduce((a, r) => a + (r.outputTokens ?? 0), 0),
      inputMean: Math.round(okRows.reduce((a, r) => a + (r.inputTokens ?? 0), 0) / okRows.length),
    },
    lowConfidenceSamples: okRows.filter((r) => (r.confidence ?? 1) < 0.8).map(({ id, text, expected, predicted, confidence, probabilities }) => ({ id, text, expected, predicted, confidence, probabilities })),
    rows,
  };
  allPasses.push(passResult);

  console.log(`\n── pass ${pass} 汇总 ──`);
  console.log(`准确率：${passResult.accuracy.correct}/${passResult.accuracy.total} = ${(passResult.accuracy.rate * 100).toFixed(1)}%（边界样本 ${passResult.boundaryAccuracy.correct}/${passResult.boundaryAccuracy.total}）`);
  console.log(`延迟：P50=${passResult.latencyMs.p50}ms P95=${passResult.latencyMs.p95}ms max=${passResult.latencyMs.max}ms mean=${passResult.latencyMs.mean}ms（对照官方标称 70-500ms）`);
  console.log(`tokens：input 合计 ${passResult.tokens.inputTotal}（均值 ${passResult.tokens.inputMean}/条），output 合计 ${passResult.tokens.outputTotal}（免费）`);
  if (passResult.misclassified.length) {
    console.log(`错样本：${passResult.misclassified.map((m) => m.id).join(", ")}`);
  }
  if (passResult.lowConfidenceSamples.length) {
    console.log(`低置信(<0.8)：${passResult.lowConfidenceSamples.map((m) => `${m.id}(conf=${m.confidence})`).join(", ")}`);
  }
  console.log("混淆矩阵（行=expected 列=predicted）：");
  console.table(confusion);
}

const file = await saveResult(`classify-results-${variant}.json`, { generatedAt: new Date().toISOString(), variant, passes: allPasses });
console.log(`\n分类+延迟测试完成（variant=${variant}），原始结果：${file}`);
