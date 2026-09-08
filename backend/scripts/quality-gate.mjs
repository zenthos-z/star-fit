// quality-gate.mjs — E2E 脚本用的质量门桥接（从 TS 源码翻译核心判定逻辑，
// 保持与 backend/src/services/agent/workoutQualityGate.ts 同步的判定规则：
// 关键词窗口提取 + 容差 ≤1 或 ≤2% + km/m 换算 + 「N 组」后置量词）
const NUMBER_RE = /(\d[\d,]*(?:\.\d+)?)/g;

const METRIC_RULES = [
  { field: 'totalVolume', keywords: ['总容量', '总负荷', '容量', 'total volume', 'volume'], label: '总容量(kg)' },
  { field: 'setsCount', keywords: ['完成组', '总组数', '组数', '完成了'], label: '组数' },
  { field: 'totalCardioDurationSec', keywords: ['有氧时长'], label: '有氧时长(秒)' },
  { field: 'totalDistanceM', keywords: ['总距离', '距离', 'distance'], label: '距离(m)' },
  { field: 'avgHr', keywords: ['平均心率', '心率', 'bpm'], label: '平均心率(bpm)' },
];

const withinTolerance = (actual, claimed) => {
  const abs = Math.abs(actual - claimed);
  if (abs <= 1) return true;
  return abs / Math.max(Math.abs(actual), 1) <= 0.02;
};

function extractValues(text, rule) {
  const lower = text.toLowerCase();
  const values = [];
  for (const m of lower.matchAll(NUMBER_RE)) {
    const value = Number(m[1].replace(/,/g, ''));
    const before = lower.slice(Math.max(0, m.index - 12), m.index);
    const after = lower.slice(m.index + m[0].length, m.index + m[0].length + 6);
    if (rule.keywords.some((kw) => before.includes(kw) || after.includes(kw))) values.push(value);
  }
  return values;
}

export function checkWorkoutCardQuality(cardText, facts) {
  const issues = [];
  if (!facts?.stats) return { ok: true, issues };
  for (const rule of METRIC_RULES) {
    const actual = facts.stats[rule.field];
    if (typeof actual !== 'number' || actual <= 0) continue;
    for (const claimed of extractValues(cardText, rule)) {
      const candidates = rule.field === 'totalDistanceM' ? [claimed, claimed * 1000, claimed / 1000] : [claimed];
      if (!candidates.some((c) => withinTolerance(actual, c))) {
        issues.push({
          code: 'data_mismatch',
          message: `卡片中的${rule.label}「${claimed}」与真实训练数据不符（实际: ${actual}）`,
          path: ['data'],
        });
      }
    }
  }
  return { ok: issues.length === 0, issues };
}

export function extractSessionFacts(historySummary) {
  const sessions = historySummary?.sessions;
  if (!Array.isArray(sessions) || sessions.length === 0) return null;
  return sessions[sessions.length - 1] ?? null;
}
