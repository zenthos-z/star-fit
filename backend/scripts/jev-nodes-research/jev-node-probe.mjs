/**
 * 线G' Jev 决策节点研究（#160 二次定调 + #155）——关键判定节点 dmx jev 实测。
 *
 * 与 jev-spike（#172，意图路由）不同：本探针测的是**决策节点拆解**里两个
 * 场景的关键判定，验证「Jev 替代大模型自由推理」在这些节点上的判定质量：
 *
 *  N1 问卷完整性判定（新用户引导场景）：state = 用户消息 + profile 摘要，
 *     6 个 choice 问题（必答六项各一：goal/experience/weight_kg/equipment/
 *     weekly_frequency/injuries，选项 missing|known）→ 输出「缺哪几项」。
 *     预期标签按 novice-starting.md §3.2.0 门禁表人工标注。
 *  N2 引导路径选择（新用户引导场景）：同 state，1 个 choice 问题
 *     （full_intake | gap_fill | direct_plan | clarify）。
 *  N3 画像档位判定（计划生成场景）：state = 画像事实（经验/训练龄/目标/
 *     场地/周频率），2 个问题：tier choice（novice|intermediate，规则锚 =
 *     instantiate 工具「<6 个月训练龄 → novice」+ 模板 audience），+
 *     readiness score（5 档，观察 score 型可用性）。
 *
 * 计量：每调用 latency / usage tokens / 逐问题对错 / 决定性答案置信度。
 * 成本护栏：≤30 次调用（实测均值 ~600 input tok/次 ≈ $0.0008 << $0.02 红线）。
 *
 * 用法：DMXAPI_API_KEY=<key> node scripts/jev-nodes-research/jev-node-probe.mjs
 * 输出：results/jev-node-probe.json + 终端摘要。密钥只从 env 读，不入任何文件。
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(here, "results");
const ENDPOINT =
  process.env.JEV_ENDPOINT ?? "https://www.dmxapi.cn/typesafe/v1/systemone";
const MODEL = process.env.JEV_MODEL ?? "jev-1.13.0";
const TIMEOUT_MS = Number(process.env.JEV_TIMEOUT_MS ?? 10_000);

const apiKey = process.env.DMXAPI_API_KEY;
if (!apiKey || apiKey.trim() === "") {
  console.error(
    "[jev-nodes] 缺少环境变量 DMXAPI_API_KEY —— 运行前设置（dmxapi.cn 账户密钥）。脚本不内置任何密钥。",
  );
  process.exit(2);
}

// ---------------------------------------------------------------------------
// dmx TypeSafe 调用（jev-spike lib.mjs 同款协议，独立内联防目录外依赖）
// ---------------------------------------------------------------------------

async function callTypeSafe({ state, questions, timeoutMs = TIMEOUT_MS }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: MODEL, state, questions }),
      signal: ctrl.signal,
    });
    const ms = Date.now() - t0;
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    if (!res.ok) {
      return { ok: false, status: res.status, body, ms, error: { name: "HTTP", message: `HTTP ${res.status}` } };
    }
    return { ok: true, status: res.status, body, ms };
  } catch (err) {
    return {
      ok: false,
      status: null,
      body: null,
      ms: Date.now() - t0,
      error: { name: err.name, message: String(err?.message ?? err) },
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// 样本与预期（人工标注；口径 = novice-starting §3.2.0 门禁 + 模板 audience）
// ---------------------------------------------------------------------------

/** 6 个必答域的 choice 问题模板（choice 型自带 confidence——spike §1.3 教训）。 */
const FIELD_QUESTIONS = {
  goal: {
    type: "choice",
    instructions:
      "健身计划六项必答信息之一：训练目标。判断它对「制定训练计划」而言是缺失(missing)还是已知(known)。",
    criteria: {
      missing: "用户消息与档案摘要中都没有可用的训练目标。",
      known: "档案摘要已给出目标，或用户消息里明确说了目标（增肌/减脂/力量/健康/体态）。",
    },
  },
  experience: {
    type: "choice",
    instructions:
      "六项必答之二：训练经验。判断缺失(missing)还是已知(known)。",
    criteria: {
      missing: "消息与档案都没有训练经验/训练年限信息。",
      known: "档案已给出经验档，或用户明说了练了多久/什么水平（含「纯新手」也算已知）。",
    },
  },
  weight_kg: {
    type: "choice",
    instructions:
      "六项必答之三：体重(kg)。判断缺失(missing)还是已知(known)。",
    criteria: {
      missing: "消息与档案都没有体重。",
      known: "档案已给出体重，或用户消息报了体重（如「我75公斤」「60kg」）。",
    },
  },
  equipment: {
    type: "choice",
    instructions:
      "六项必答之四：可用器械/场地。判断缺失(missing)还是已知(known)。",
    criteria: {
      missing: "消息与档案都没有器械/场地信息。",
      known: "档案已给出器械偏好，或用户说了场地/器械（健身房/家里/只有哑铃/自重）。",
    },
  },
  weekly_frequency: {
    type: "choice",
    instructions:
      "六项必答之五：每周可训练频率。判断缺失(missing)还是已知(known)。",
    criteria: {
      missing: "消息与档案都没有每周练几次。",
      known: "档案已给出周频率，或用户明说了每周几天（含「一周能练4次」）。",
    },
  },
  injuries: {
    type: "choice",
    instructions:
      "六项必答之六：伤病/疼痛部位。判断缺失(missing)还是已知(known)。",
    criteria: {
      missing: "消息与档案都没有伤病信息（没提 ≠ 没伤病，未确认即缺失）。",
      known: "档案登记了活动伤病，或用户明说无伤病/某部位有伤。",
    },
  },
};

const PATH_QUESTION = {
  type: "choice",
  instructions:
    "新用户引导路径决策：结合消息与档案摘要，下一轮应该走哪条引导路径？",
  criteria: {
    full_intake:
      "档案基本为空且缺多项必答——发全量首用问卷（profile_intake，一次问完）。",
    gap_fill: "只缺 1-2 项——发缺口补全问卷（plan_gap，只问缺的）。",
    direct_plan: "六项必答全部齐备——直接进入计划生成，不再发问卷。",
    clarify: "用户意图不明（没说要计划/不知道想干嘛）——先反问澄清，不出问卷不出计划。",
  },
};

/**
 * N1/N3 共享样本：profile 摘要 + 用户消息 → 六域缺失预期 + 路径预期。
 * 摘要形态对齐 load_history 的画像面（goal/experience/weight/equipment/
 * frequency/injuries 六键，null=档案未填）。
 */
const INTAKE_SAMPLES = [
  {
    id: "v01-全空-要计划",
    profile: "档案：goal=null, experience=null, weight_kg=null, equipment=null, weekly_frequency=null, injuries=null（全新用户，档案全空）",
    message: "帮我制定一份这周的训练计划",
    expectMissing: ["goal", "experience", "weight_kg", "equipment", "weekly_frequency", "injuries"],
    expectPath: "full_intake",
  },
  {
    id: "v02-全空-意图不明",
    profile: "档案：goal=null, experience=null, weight_kg=null, equipment=null, weekly_frequency=null, injuries=null（全新用户）",
    message: "嗨，你是谁呀，能干嘛",
    expectMissing: ["goal", "experience", "weight_kg", "equipment", "weekly_frequency", "injuries"],
    expectPath: "clarify",
  },
  {
    id: "v03-消息自带体重",
    profile: "档案：goal=null, experience=null, weight_kg=null, equipment=null, weekly_frequency=null, injuries=null",
    message: "我75公斤，想增肌，帮我排这周的训练",
    expectMissing: ["experience", "equipment", "weekly_frequency", "injuries"],
    expectPath: "gap_fill",
  },
  {
    id: "v04-档案半满",
    profile: "档案：goal=muscle_gain, experience=intermediate, weight_kg=72, equipment=null, weekly_frequency=null, injuries=null",
    message: "给我排个计划吧",
    expectMissing: ["equipment", "weekly_frequency", "injuries"],
    expectPath: "gap_fill",
  },
  {
    id: "v05-档案半满-消息补频率",
    profile: "档案：goal=muscle_gain, experience=null, weight_kg=72, equipment=[dumbbell,bench], weekly_frequency=null, injuries=null",
    message: "一周能练4次，帮我出计划",
    expectMissing: ["experience", "injuries"],
    expectPath: "gap_fill",
  },
  {
    id: "v06-只缺伤病",
    profile: "档案：goal=fat_loss, experience=beginner, weight_kg=65, equipment=[machine,cable], weekly_frequency=3, injuries=null",
    message: "直接给我这周的计划",
    expectMissing: ["injuries"],
    expectPath: "gap_fill",
  },
  {
    id: "v07-全齐-直接出",
    profile: "档案：goal=muscle_gain, experience=beginner(3个月), weight_kg=75, equipment=[dumbbell,bench,band], weekly_frequency=4, injuries=[]（无伤病已确认）",
    message: "直接给我完整的周计划",
    expectMissing: [],
    expectPath: "direct_plan",
  },
  {
    id: "v08-全齐但消息要改目标",
    profile: "档案：goal=fat_loss, experience=intermediate, weight_kg=70, equipment=[barbell,rack], weekly_frequency=4, injuries=[]",
    message: "目标改成增肌，重新给我排一版",
    expectMissing: [],
    expectPath: "direct_plan",
  },
  {
    id: "v09-消息提伤病",
    profile: "档案：goal=strength, experience=intermediate, weight_kg=80, equipment=[barbell,rack], weekly_frequency=4, injuries=null",
    message: "最近膝盖有点不舒服，帮我排这周的计划",
    expectMissing: ["injuries"],
    expectPath: "gap_fill",
  },
  {
    id: "v10-口语化经验",
    profile: "档案：goal=null, experience=null, weight_kg=null, equipment=null, weekly_frequency=null, injuries=null",
    message: "练了两年多了，家里就一副哑铃，一周大概练三回，帮我定个计划，我没伤",
    expectMissing: ["goal", "weight_kg"],
    expectPath: "gap_fill",
  },
  {
    id: "v11-自由聊天不打扰",
    profile: "档案：goal=muscle_gain, experience=beginner, weight_kg=null, equipment=null, weekly_frequency=null, injuries=null",
    message: "今天好累啊，随便聊两句",
    expectMissing: ["weight_kg", "equipment", "weekly_frequency", "injuries"],
    expectPath: "clarify",
  },
  {
    id: "v12-半满且要单日",
    profile: "档案：goal=general_fitness, experience=beginner_zero, weight_kg=68, equipment=[bodyweight], weekly_frequency=3, injuries=null",
    message: "明天练什么",
    expectMissing: ["injuries"],
    expectPath: "gap_fill",
  },
];

/** N2 档位判定样本：画像事实 → tier 预期（锚：训练龄<6月或新手自述 → novice）。 */
const TIER_QUESTION = {
  type: "choice",
  instructions:
    "训练容量档位判定：依据训练经验/训练龄/恢复与目标，该用户周计划应使用哪档起步剂量？",
  criteria: {
    novice:
      "训练龄 <6 个月、或自述纯新手/没系统练过、或停训很久刚回来——低起始重量、保守容量。",
    intermediate:
      "训练龄 ≥6 个月且系统训练中——标准起步剂量与常规容量递进。",
  },
};

const READINESS_QUESTION = {
  type: "score",
  instructions:
    "对该用户当前执行系统性训练计划的准备充分程度打分（0=很不充分 … 4=很充分）。考虑经验、恢复、频率可行性与信息完整度。",
  criteria: ["很不充分", "较不充分", "一般", "较充分", "很充分"],
};

const TIER_SAMPLES = [
  { id: "t01-纯新手", state: "用户档案：经验=纯新手没系统练过；训练龄=0；目标=增肌；场地=家里哑铃；周频率=3。消息：帮我安排开始练。", expectTier: "novice" },
  { id: "t02-3个月", state: "用户档案：经验=3个月以内；训练龄=3；目标=增肌；场地=健身房；周频率=3。", expectTier: "novice" },
  { id: "t03-5个月边界", state: "用户档案：经验=练了5个月；训练龄=5；目标=力量；场地=健身房；周频率=4。", expectTier: "novice" },
  { id: "t04-7个月边界", state: "用户档案：经验=练了7个月；训练龄=7；目标=增肌；场地=健身房；周频率=4。", expectTier: "intermediate" },
  { id: "t05-两年", state: "用户档案：经验=半年到两年；训练龄=20；目标=增肌；场地=家里哑铃；周频率=4。", expectTier: "intermediate" },
  { id: "t06-两年以上", state: "用户档案：经验=两年以上；训练龄=48；目标=力量；场地=健身房；周频率=5。", expectTier: "intermediate" },
  { id: "t07-停训回归", state: "用户档案：经验=以前练过3年但停了2年刚回来；训练龄=36（但中断24）；目标=增肌；场地=健身房；周频率=3。消息：好久没练了重新开始。", expectTier: "novice" },
  { id: "t08-口语新手", state: "用户消息：没怎么练过，就想减减肥，一周去2次健身房。档案：经验=null。", expectTier: "novice" },
  { id: "t09-口语老手", state: "用户消息：练了好几年了，最近想冲一把力量，一周5练。档案：经验=null。", expectTier: "intermediate" },
  { id: "t10-六月整", state: "用户档案：经验=系统训练整6个月；训练龄=6；目标=体态改善；场地=健身房；周频率=4。", expectTier: "intermediate" },
];

// ---------------------------------------------------------------------------
// 执行
// ---------------------------------------------------------------------------

const results = [];
let inputTokens = 0;
let outputTokens = 0;
let failCount = 0;

function fmtAnswer(a) {
  if (!a) return "null";
  if (a.type === "choice") return `${a.choice}(conf=${a.confidence ?? "?"})`;
  if (a.type === "score") return `${a.score}(conf=${a.confidence ?? "?"})`;
  if (a.type === "noul") return `noul=${a.noul}`;
  return JSON.stringify(a).slice(0, 60);
}

// N1 + N2（引导路径）：每样本一次调用，7 问并行
console.log("=== N1 问卷完整性 + N2 引导路径（每样本一次调用，7 问并行）===");
for (const s of INTAKE_SAMPLES) {
  const state = `【用户消息】${s.message}\n【档案摘要】${s.profile}`;
  const questions = {
    ...Object.fromEntries(
      Object.entries(FIELD_QUESTIONS).map(([k, q]) => [`miss_${k}`, q]),
    ),
    path: PATH_QUESTION,
  };
  const r = await callTypeSafe({ state, questions });
  if (!r.ok) {
    failCount += 1;
    console.log(`  ${s.id}: 调用失败 ${r.error.name} ${r.error.message} (${r.ms}ms)`);
    results.push({ node: "N1+N2", sample: s.id, ok: false, error: r.error, ms: r.ms });
    continue;
  }
  inputTokens += r.body.usage?.input_tokens ?? 0;
  outputTokens += r.body.usage?.output_tokens ?? 0;
  const ans = r.body.answers ?? {};
  const missingGot = Object.entries(FIELD_QUESTIONS)
    .filter(([k]) => ans[`miss_${k}`]?.choice === "missing")
    .map(([k]) => k);
  const missingHit =
    missingGot.length === s.expectMissing.length &&
    missingGot.every((k) => s.expectMissing.includes(k));
  const pathGot = ans.path?.choice ?? "?";
  const pathHit = pathGot === s.expectPath;
  console.log(
    `  ${s.id}: 缺项=${missingGot.join("/") || "无"} ${missingHit ? "✓" : `✗(期望 ${s.expectMissing.join("/") || "无"})`} ` +
      `路径=${pathGot} ${pathHit ? "✓" : `✗(期望 ${s.expectPath})`} conf=${ans.path?.confidence ?? "?"} ${r.ms}ms`,
  );
  results.push({
    node: "N1+N2",
    sample: s.id,
    ok: true,
    ms: r.ms,
    missingGot,
    missingExpected: s.expectMissing,
    missingHit,
    pathGot,
    pathExpected: s.expectPath,
    pathHit,
    pathConfidence: ans.path?.confidence ?? null,
    confidences: Object.fromEntries(
      Object.keys({ ...FIELD_QUESTIONS }).map((k) => [
        k,
        ans[`miss_${k}`]?.confidence ?? null,
      ]),
    ),
    usage: r.body.usage,
  });
}

// N3 档位判定：每样本一次调用，tier choice + readiness score
console.log("\n=== N3 画像档位判定（每样本一次调用，tier + readiness）===");
for (const s of TIER_SAMPLES) {
  const questions = { tier: TIER_QUESTION, readiness: READINESS_QUESTION };
  const r = await callTypeSafe({ state: s.state, questions });
  if (!r.ok) {
    failCount += 1;
    console.log(`  ${s.id}: 调用失败 ${r.error.name} ${r.error.message} (${r.ms}ms)`);
    results.push({ node: "N3", sample: s.id, ok: false, error: r.error, ms: r.ms });
    continue;
  }
  inputTokens += r.body.usage?.input_tokens ?? 0;
  outputTokens += r.body.usage?.output_tokens ?? 0;
  const ans = r.body.answers ?? {};
  const tierGot = ans.tier?.choice ?? "?";
  const tierHit = tierGot === s.expectTier;
  console.log(
    `  ${s.id}: tier=${tierGot} ${tierHit ? "✓" : `✗(期望 ${s.expectTier})`} conf=${ans.tier?.confidence ?? "?"} ` +
      `readiness=${fmtAnswer(ans.readiness)} ${r.ms}ms`,
  );
  results.push({
    node: "N3",
    sample: s.id,
    ok: true,
    ms: r.ms,
    tierGot,
    tierExpected: s.expectTier,
    tierHit,
    tierConfidence: ans.tier?.confidence ?? null,
    readiness: ans.readiness?.score ?? null,
    usage: r.body.usage,
  });
}

// 汇总
const n1n2 = results.filter((x) => x.node === "N1+N2" && x.ok);
const n3 = results.filter((x) => x.node === "N3" && x.ok);
const latency = results.filter((x) => x.ok).map((x) => x.ms).sort((a, b) => a - b);
const p50 = latency[Math.floor(latency.length / 2)] ?? 0;
const costUsd = (inputTokens / 1e6) * 0.042;
const summary = {
  schema: "jev-nodes-probe/1",
  ranAt: new Date().toISOString(),
  endpoint: ENDPOINT,
  model: MODEL,
  calls: results.length,
  failures: failCount,
  n1_missingSet: {
    hit: n1n2.filter((x) => x.missingHit).length,
    total: n1n2.length,
  },
  n2_path: {
    hit: n1n2.filter((x) => x.pathHit).length,
    total: n1n2.length,
  },
  n3_tier: { hit: n3.filter((x) => x.tierHit).length, total: n3.length },
  latency: { p50, min: latency[0], max: latency[latency.length - 1] },
  usage: { inputTokens, outputTokens, costUsd: Number(costUsd.toFixed(6)) },
};
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "jev-node-probe.json"), JSON.stringify({ summary, results }, null, 2));
console.log(
  `\n汇总：N1 缺项判定 ${summary.n1_missingSet.hit}/${summary.n1_missingSet.total} | ` +
    `N2 路径 ${summary.n2_path.hit}/${summary.n2_path.total} | N3 档位 ${summary.n3_tier.hit}/${summary.n3_tier.total} | ` +
    `latency P50=${p50}ms | input ${inputTokens} tok ≈ $${costUsd.toFixed(5)} | 失败 ${failCount}`,
);
console.log(`saved -> ${join(OUT_DIR, "jev-node-probe.json")}`);
