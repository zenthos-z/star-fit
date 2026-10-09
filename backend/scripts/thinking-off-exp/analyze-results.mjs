/**
 * 关思考实验 A2b ——结果对照分析（零 LLM 成本，纯离线）。
 *
 * 输入：
 *   实验组：results/replay-{hit,half}.json + results/replay-events-{hit,half}-run{N}.jsonl
 *   对照组：../jev-nodes-research/results/replay-baseline.json（矩阵命中×1）
 *          ../jev-nodes-research/results/replay-baseline-free.json（半命中×2）
 *
 * 计量口径（与 replay-baseline.ts 一致 + 实验新增）：
 *   - thinking 事件二分（实验组特有，需事件文件；基线事件只有 head 无 len 分层，
 *     用同样规则可复算）：
 *       reasoning 类 = len < 300 的流式 delta（逐词 reasoning_content）
 *       echo/块类   = len >= 300 的快照整块（工具复述剥离/叙述转 thinking，
 *                     与思考开关无关的内容重分类）
 *   - TTFT 双口径：firstThinkingAt（思考面板首帧）/ firstCardAt（首卡）
 *   - 质量门：cards / 模板指纹 / validationRetries（打回）/ leakSuspects
 *     （疑似卡 JSON 残片）/ 吞卡（done 且无卡）/ error
 *
 * 用法（任意目录）：node scripts/thinking-off-exp/analyze-results.mjs [exp-results-dir]
 * 输出：markdown 对照表（stdout）。
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const expDir = process.argv[2] ?? join(here, "results");
const baseDir = join(here, "..", "jev-nodes-research", "results");

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

/** 事件流读取：优先裸 .jsonl，其次基线同规格的 .jsonl.gz（zlib 内建解压）。 */
function readEventLines(p) {
  const raw = existsSync(p)
    ? readFileSync(p, "utf8")
    : existsSync(`${p}.gz`)
      ? gunzipSync(readFileSync(`${p}.gz`)).toString("utf8")
      : null;
  return raw === null ? null : raw.split("\n");
}

// ---------- 基线组 ----------
function loadBaseline() {
  const out = { hit: [], half: [] };
  const hit = join(baseDir, "replay-baseline.json");
  const free = join(baseDir, "replay-baseline-free.json");
  if (existsSync(hit)) {
    for (const r of readJson(hit).runs) {
      for (const t of r.turns) {
        out.hit.push({ ...t, src: "baseline", group: "hit" });
      }
    }
  }
  if (existsSync(free)) {
    for (const r of readJson(free).runs) {
      for (const t of r.turns) {
        out.half.push({ ...t, src: "baseline", group: "half" });
      }
    }
  }
  return out;
}

// ---------- 实验组（含事件文件二分）----------
function splitThinkingEvents(eventsFile) {
  let reasoningEvents = 0;
  let reasoningChars = 0;
  let echoBlocks = 0;
  let echoChars = 0;
  const lines = readEventLines(eventsFile);
  if (lines === null) throw new Error(`events file missing: ${eventsFile}[.gz]`);
  for (const line of lines) {
    if (!line.trim()) continue;
    const ev = JSON.parse(line);
    if (ev.type !== "thinking") continue;
    if (ev.len >= 300) {
      echoBlocks += 1;
      echoChars += ev.len;
    } else {
      reasoningEvents += 1;
      reasoningChars += ev.len;
    }
  }
  return { reasoningEvents, reasoningChars, echoBlocks, echoChars };
}

function loadExperiment() {
  const out = { hit: [], half: [] };
  for (const group of ["hit", "half"]) {
    const summaryFile = join(expDir, `replay-${group}.json`);
    if (!existsSync(summaryFile)) continue;
    const summary = readJson(summaryFile);
    for (const r of summary.runs) {
      for (const t of r.turns) {
        const evFile = join(expDir, `replay-events-${group}-run${r.run}.jsonl`);
        // 事件文件按 turn 顺序复用（run 内 turn1/turn2 先后写入，无法逐 turn
        // 切分——二分以 run 为粒度归并，报告按 run 呈现并在表内注明）
        const hasEvents = existsSync(evFile) || existsSync(`${evFile}.gz`);
        out[group].push({
          ...t,
          src: "exp",
          group,
          run: r.run,
          events: hasEvents ? splitThinkingEvents(evFile) : null,
          toolRounds: r.toolRounds?.find?.((x) => x.turn === t.turn) ?? null,
        });
      }
    }
  }
  return out;
}

// ---------- 呈现 ----------
function fmtTurn(t) {
  const tl = t.timeline ?? {};
  const cards = (t.cards ?? []).join("+") || "无";
  const extra = [];
  if (t.src === "exp") {
    extra.push(`打回=${t.validationRetries ?? 0}`, `疑似泄漏=${t.leakSuspects ?? 0}`);
    if (t.events) {
      extra.push(
        `reasoning(${t.events.reasoningEvents}块/${t.events.reasoningChars}字符)`,
        `echo(${t.events.echoBlocks}块/${t.events.echoChars}字符)`,
      );
    }
  }
  const tr = t.toolRounds
    ? `轮次=${t.toolRounds.modelRounds} 工具=[${t.toolRounds.toolCalls.join("→")}]`
    : "";
  return [
    `| ${t.src} | run${t.run ?? "?"} | ${t.label} | ${t.thinkingEvents} | ${t.thinkingChars} | ` +
      `${((tl.firstThinkingAt ?? 0) / 1000).toFixed(1)}s | ${((tl.firstCardAt ?? 0) / 1000).toFixed(1)}s | ` +
      `${((t.ms ?? 0) / 1000).toFixed(0)}s | ${cards} | ${t.templateFingerprint ?? "-"} | ` +
      `${extra.join(" ")} ${tr} |`,
  ];
}

const baseline = loadBaseline();
const exp = loadExperiment();

console.log("# thinking-off 实验对照原始表\n");
for (const group of ["hit", "half"]) {
  console.log(`## 场景：${group === "hit" ? "矩阵命中（新手×居家×3练→t1）" : "半命中（中级×居家×4练）"}\n`);
  console.log("| 组 | run | turn | thinking块 | thinking字符 | 首thinking | 首卡 | 墙钟 | 卡 | 模板指纹 | 质量门 |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const t of [...baseline[group], ...exp[group]]) {
    console.log(fmtTurn(t)[0]);
  }
  console.log();
}

// 计划轮聚合（实验 vs 基线，速度倍率）
function planAgg(turns) {
  const plans = turns.filter((t) => t.label === "plan_round");
  if (plans.length === 0) return null;
  const chars = plans.map((t) => t.thinkingChars);
  const ms = plans.map((t) => t.ms);
  const card = plans.map((t) => (tl => tl && tl.firstCardAt)(t.timeline) ?? null);
  return {
    n: plans.length,
    charsMin: Math.min(...chars),
    charsMax: Math.max(...chars),
    msMin: Math.min(...ms),
    msMax: Math.max(...ms),
    cardMin: card.filter((x) => x !== null).length ? Math.min(...card.filter((x) => x !== null)) : null,
  };
}

console.log("## 计划轮聚合（基线 vs 关思考）\n");
for (const group of ["hit", "half"]) {
  const b = planAgg(baseline[group]);
  const e = planAgg(exp[group]);
  if (!b || !e) continue;
  console.log(
    `- ${group}: thinking字符 ${b.charsMin}-${b.charsMax} → ${e.charsMin}-${e.charsMax}` +
      `（×${(e.charsMax / b.charsMin).toFixed(2)}-${(e.charsMin / b.charsMax).toFixed(2)}）；` +
      `墙钟 ${(b.msMin / 1000).toFixed(0)}-${(b.msMax / 1000).toFixed(0)}s → ${(e.msMin / 1000).toFixed(0)}-${(e.msMax / 1000).toFixed(0)}s` +
      `（提速 ×${(b.msMax / e.msMin).toFixed(1)}-${(b.msMin / e.msMax).toFixed(1)}）` +
      (b.cardMin && e.cardMin
        ? `；首卡 ${(b.cardMin / 1000).toFixed(0)}s → ${(e.cardMin / 1000).toFixed(0)}s`
        : ""),
  );
}
