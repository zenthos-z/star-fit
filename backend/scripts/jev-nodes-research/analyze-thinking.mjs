#!/usr/bin/env node
/**
 * analyze-thinking.mjs — 对 replay-events-run{N}.jsonl 的 thinking 文本做
 * 主题占比分析（启发式关键词分桶，spec「推理占比估算」的数据面）。
 *
 * 每条 thinking 事件是一个小 delta（几字符~几十字符），按关键词命中分桶后
 * 汇总字符占比；未命中归「其他推理」。口径是近似（模型思考文本非线性），
 * spec 中以「启发式估算」标注。
 *
 * 用法：node scripts/jev-nodes-research/analyze-thinking.mjs [results-dir]
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2] ?? join(here, "results");

const BUCKETS = [
  {
    name: "知识复读（read_file 带行号复述）",
    test: (t) => /^\s*\d+\t/.test(t),
  },
  {
    name: "模板/选型推理（模板·分化·器械面·档）",
    test: (t) =>
      /模板|template|pick_|instantiate|分化|split|器械面|全[身课]|upper|lower|PPL|ppl/i.test(t),
  },
  {
    name: "参数/剂量推理（组次·RPE·重量·递进）",
    test: (t) =>
      /组数?|次数|RPE|rpe|重量|kg|公斤|剂量|sets?|reps?|weight|起步|递进|进阶|加重|progression|1RM|体重倍数/i.test(t),
  },
  {
    name: "问卷/门禁推理（必答·缺口·要不要问）",
    test: (t) =>
      /问卷|survey|必答|门禁|前提|prerequisite|缺(失|哪|什么)?|missing|问(用户|一下)?|收集|profile_intake|plan_gap/i.test(t),
  },
  {
    name: "卡片格式/校验推理（卡·字段·JSON）",
    test: (t) =>
      /卡|card|uiHint|submit|校验|json|JSON|围栏|字段|apply|entries|day_focus|rationale|sort_order/i.test(t),
  },
  {
    name: "工具调用编排（调用·读取·并行）",
    test: (t) =>
      /调用|call|load_history|find_exercises|list_exercises|read_file|get_current|工具|tool|并行|parallel|读取/i.test(t),
  },
];

const files = readdirSync(dir).filter((f) => /^replay-events-run\d+\.jsonl$/.test(f));
const aggregate = {};
for (const f of files) {
  const lines = readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean);
  const buckets = Object.fromEntries(BUCKETS.map((b) => [b.name, 0]));
  let other = 0;
  let total = 0;
  for (const line of lines) {
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev.type !== "thinking" || !ev.len) continue;
    total += ev.len;
    const text = ev.head ?? "";
    const hit = BUCKETS.find((b) => b.test(text));
    if (hit) buckets[hit.name] += ev.len;
    else other += ev.len;
  }
  aggregate[f] = {
    thinkingChars: total,
    shares: Object.fromEntries(
      [...Object.entries(buckets).map(([k, v]) => [k, `${((v / total) * 100).toFixed(1)}%`]), ["其他推理", `${((other / total) * 100).toFixed(1)}%`]],
    ),
  };
}
console.log(JSON.stringify(aggregate, null, 2));
