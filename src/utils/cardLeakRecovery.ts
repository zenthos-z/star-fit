/**
 * cardLeakRecovery — 流终态「卡片 JSON 泄漏进正文」的前端兜底（issue #56）。
 *
 * 定位结论（2026-09-30，T1 调试台 + 真实 SSE 采集帧序列佐证）：
 * 前端 SSE 解析链（parseSSEChunk → normalizeAgentEvent → synthesizeUiHint →
 * ExerciseRenderer 注册表）对 weekly_plan 卡全程无缺——健康轮（t10-sse-round1
 * 采集）里卡片以 uiHint 帧先于 token 送达且正确渲染。「周计划气泡显示原始
 * JSON 串」唯一可能的机制是后端流层提取器漏剥（卡片 JSON 未进围栏 / 围栏内
 * JSON 语法破损但括号平衡 / 缺 type 字段），此时卡片以 token 文本进正文。
 * 流层判定属 T9b 批次（#73）领地，前端按任务书在此加兜底：
 *
 *   Tier 1 复原：正文里的围栏/裸平衡 JSON 若能解析出已知卡型且过形态闸
 *     （weekly_plan 走 shared/contracts 的 Zod 契约全量校验），复原成卡片渲染；
 *   Tier 2 降级：卡型 JSON 解析失败或形态闸不过 → 从正文摘除并附**明确可读**
 *     提示行（红线：禁静默吞掉——用户必须能看出卡片没出来、该怎么补救）。
 *
 * 边界：只动「已知卡型」的 JSON 载荷；普通散文、非卡型 JSON（如用户要求
 * 展示的示例数据）一律原样保留——不引入把正文当嫌疑对象的过度容错。
 *
 * 解析器说明：这里刻意不用 shared/contracts 的 parseJSONSafe——那是契约数据
 * 入口的解析器，dev 下解析失败**抛错**（fail-fast 语义）；而本模块是扫描器，
 * 输入大概率是非 JSON 散文（候选探测失败 = 预期分支，交 Tier 2 降级），
 * dev 抛错会直接炸聊天定型。契约红线（JSON 解析走 parseJSONSafe）约束的是
 * 数据契约入口，不是容错扫描路径；复原卡的数据仍过 Zod 契约校验（真源不变）。
 */
import { WeeklyPlanCardDataSchema } from 'shared/contracts';
import type { UiHintCard } from 'shared/contracts';

/** 扫描用容错解析：失败返回 null（预期分支），任何环境不抛。 */
function scanParse(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * 可复原卡型全集（= ExerciseRenderer 注册表能渲染的 AI 卡型）。
 * 后端白名单（ALLOWED_UIHINT_TYPES）+ 前端 LEGACY 别名（synthesizeUiHint
 * 的 pass-through 形态），含 plan/summary/survey 等无后缀旧别名。
 */
const RECOVERABLE_CARD_TYPES = new Set([
  'plan_card', 'plan',
  'weekly_plan',
  'summary_card', 'summary',
  'survey_card', 'survey',
  'survey_success',
  'audit_complete',
  'profile_update_confirm',
]);

/** 别名归一：旧短名 → 注册表名（与 synthesizeUiHint 的映射同源）。 */
const TYPE_ALIASES: Record<string, string> = {
  plan: 'plan_card',
  summary: 'summary_card',
  survey: 'survey_card',
};

/** Tier 2 降级提示行（明确可读，附补救路径；禁含糊）。 */
export const CARD_DEGRADED_NOTE =
  '> ⚠️ 这条回复里的训练卡片数据损坏了，无法正常展示（原始数据已收起）。' +
  '回复「重发卡片」或重说一次需求，教练会重新生成。';

/** 单个候选载荷的判定结果。 */
type CandidateVerdict =
  | { kind: 'recover'; card: UiHintCard }
  | { kind: 'degrade' }
  | { kind: 'prose' }; // 非卡型 JSON——不是本次兜底的对象，原文保留

/**
 * 形态闸：复原卡必须过最小可渲染校验，防止把破损数据灌进卡片组件
 * （WeeklyPlanCard.weeklyCardRows 对缺字段数据会直接抛错）。
 * weekly_plan 用 shared/contracts 全量 Zod 契约（真源），其余按
 * uiHintFormat HC-1 教给模型的最小形态核验；通过时返回补全缺省后的数据。
 */
function shapeGate(type: string, data: unknown): { ok: boolean; data?: unknown } {
  if (type === 'weekly_plan') {
    const parsed = WeeklyPlanCardDataSchema.safeParse(data);
    return parsed.success ? { ok: true, data: parsed.data } : { ok: false };
  }
  if (type === 'plan_card') {
    if (!Array.isArray(data) || data.length === 0) return { ok: false };
    const sane = data.every(
      (ex) =>
        ex && typeof ex === 'object' &&
        typeof (ex as Record<string, unknown>).exerciseId === 'string' &&
        typeof (ex as Record<string, unknown>).name === 'string',
    );
    return sane ? { ok: true, data } : { ok: false };
  }
  if (type === 'survey_card') {
    return Array.isArray((data as Record<string, unknown>)?.questions)
      ? { ok: true, data }
      : { ok: false };
  }
  if (type === 'summary_card') {
    return typeof (data as Record<string, unknown>)?.summary === 'string' &&
      ((data as Record<string, unknown>).summary as string).length > 0
      ? { ok: true, data }
      : { ok: false };
  }
  if (type === 'profile_update_confirm') {
    return Array.isArray((data as Record<string, unknown>)?.proposals)
      ? { ok: true, data }
      : { ok: false };
  }
  // survey_success / audit_complete：对象形态即可（展示型，无强契约字段）
  return data && typeof data === 'object' && !Array.isArray(data)
    ? { ok: true, data }
    : { ok: false };
}

/** 对一段候选 JSON 文本做判定（解析 + 卡型识别 + 形态闸）。 */
function judgeCandidate(raw: string): CandidateVerdict {
  const parsed = scanParse(raw);
  if (!parsed) {
    // 解析失败 ≠ 一律散文：若破损文本仍自报已知卡型（"type":"weekly_plan"
    // 等字面量仍在），按破损卡降级摘除（ Tier 2）——这正是括号平衡但语法
    // 破损、流中断截断等后端提取器漏剥的真实形态。无卡型自报的坏 JSON
    // （如散文里的 {foo: 1}）按原文保留（禁过度容错）。
    const claimed = /"type"\s*:\s*"([A-Za-z_]+)"/.exec(raw);
    if (claimed) {
      const t = TYPE_ALIASES[claimed[1]!] ?? claimed[1]!;
      if (RECOVERABLE_CARD_TYPES.has(t)) return { kind: 'degrade' };
    }
    return { kind: 'prose' };
  }
  const rawType = parsed.type;
  if (typeof rawType !== 'string') return { kind: 'prose' };
  const type = TYPE_ALIASES[rawType] ?? rawType;
  if (!RECOVERABLE_CARD_TYPES.has(type)) return { kind: 'prose' };

  const gate = shapeGate(type, parsed.data);
  if (!gate.ok) return { kind: 'degrade' };
  const card: UiHintCard = {
    type: type as UiHintCard['type'],
    data: gate.data as Record<string, unknown>,
    priority: 0,
  };
  if (typeof parsed.title === 'string' && parsed.title.length > 0) card.title = parsed.title;
  return { kind: 'recover', card };
}

interface RawSpan {
  start: number; // 含围栏/花括号的 span 起点
  end: number;   // span 终点（不含）
  body: string;  // 待判定的 JSON 文本
}

/**
 * 扫出正文里的「卡型 JSON 候选 span」：
 *   1) ``` 围栏块（含流中断时的未闭合围栏——泄漏轮最常见的形态）；
 *   2) 围栏外的顶层平衡 {…}（后端提取器的无围栏兜底同样漏的场景）。
 * 花括号配平感知字符串与转义，避免把正文里的引号内容当结构。
 */
function scanCandidates(text: string): RawSpan[] {
  const spans: RawSpan[] = [];
  let i = 0;
  while (i < text.length) {
    const fence = text.indexOf('```', i);
    // 找到下一个围栏或平衡对象中更早出现者
    const brace = text.indexOf('{', i);
    if (fence !== -1 && (brace === -1 || fence <= brace)) {
      const langEnd = fence + 3;
      let j = langEnd;
      while (j < text.length && /[A-Za-z0-9+.\-]/.test(text[j]!)) j += 1;
      if (text[j] === '\r' && text[j + 1] === '\n') j += 2;
      else if (text[j] === '\n') j += 1;
      const close = text.indexOf('```', j);
      if (close === -1) {
        // 未闭合围栏（流中断）：body 到文末
        spans.push({ start: fence, end: text.length, body: text.slice(j) });
        break;
      }
      spans.push({ start: fence, end: close + 3, body: text.slice(j, close) });
      i = close + 3;
      continue;
    }
    if (brace === -1) break;
    // 顶层平衡对象扫描（字符串/转义感知）
    let depth = 0;
    let inStr = false;
    let escape = false;
    let end = -1;
    for (let k = brace; k < text.length; k += 1) {
      const ch = text[k]!;
      if (inStr) {
        if (escape) escape = false;
        else if (ch === '\\') escape = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) { end = k + 1; break; }
      }
    }
    if (end === -1) {
      // 未闭合对象（流中断）：到文末
      spans.push({ start: brace, end: text.length, body: text.slice(brace) });
      break;
    }
    spans.push({ start: brace, end, body: text.slice(brace, end) });
    i = end;
  }
  return spans;
}

/** 折叠正文里因摘除 span 产生的 3+ 连续换行（保留原排版节奏）。 */
function collapseBlankRuns(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n');
}

/** 复原结果：清洗后的正文 + 复原卡（SSE 已送达卡时为 undefined）+ 降级标志。 */
export interface LeakRecoveryResult {
  text: string;
  card?: UiHintCard;
  degraded: boolean;
}

/**
 * 对一轮已定型的回复正文做泄漏卡复原。
 *
 * @param turnText 本轮累积的正文（token 事件拼接结果）
 * @param existingCard SSE uiHint 事件已送达的卡（若有）——优先级高于复原卡；
 *        此时正文里再扫出的卡型 JSON 按冗余摘除（不打降级提示：卡片已可见）
 */
export function recoverLeakedCard(turnText: string, existingCard?: UiHintCard): LeakRecoveryResult {
  if (!turnText) return { text: turnText, degraded: false };

  const spans = scanCandidates(turnText);
  if (spans.length === 0) return { text: turnText, degraded: false };

  let recovered: UiHintCard | undefined;
  let degraded = false;
  // 倒序摘除 span（起点不受前面摘除影响），再按原顺序拼回
  const removals: Array<{ start: number; end: number }> = [];
  for (const span of [...spans].reverse()) {
    const verdict = judgeCandidate(span.body);
    if (verdict.kind === 'prose') continue; // 非卡型 JSON：原文保留
    removals.push({ start: span.start, end: span.end });
    if (verdict.kind === 'recover') {
      if (!existingCard && !recovered) {
        recovered = verdict.card;
      } else {
        // 已有卡（SSE 送达 / 先扫出的复原卡）→ 冗余卡载荷，摘除即可
        console.info('[cardLeakRecovery] duplicate leaked card payload stripped');
      }
    } else {
      degraded = true;
    }
  }
  if (removals.length === 0) return { text: turnText, degraded: false };

  let text = turnText;
  for (const r of removals) {
    text = text.slice(0, r.start) + text.slice(r.end);
  }
  text = collapseBlankRuns(text.trim());
  if (degraded && text) text = `${text}\n\n${CARD_DEGRADED_NOTE}`;
  else if (degraded) text = CARD_DEGRADED_NOTE;

  return { text, card: recovered, degraded };
}
