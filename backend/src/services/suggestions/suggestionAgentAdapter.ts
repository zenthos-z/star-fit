/**
 * Suggestion Agent Adapter - DeepAgent 到建议管线的有界适配层
 *
 * 职责（严格受限）：
 * - 把 Service 压缩好的画像摘要 + 公式基准交给 DeepAgent（单 Agent + skill 路由），
 *   让它按画像输出 **有界调整意图 + 理由文案**，而不是数值（AI 不做算术红线）
 * - 显式 threadId = 'suggestions:'+userId —— 绝不写用户主聊天 checkpoint
 * - DeepSeek 无结构化输出 → ```json 围栏 + parseJSONSafe + Zod 校验回路
 *   （uiHintValidationLoop 同款哲学；坏卡带错误反馈重试，至多 2 次纠正）
 * - 12s 超时（env SUGGESTION_AGENT_TIMEOUT_MS）→ 返回 null 降级；
 *   chat 内部 invoke 不可中断，超时只是放弃等待
 *
 * 任何失败都返回 null（由 SuggestionService 降级 formula + degraded_reason），
 * 本适配器绝不 throw 到路由层。
 */

import {
  SuggestionAdjustmentCardSchema,
  parseJSONSafe,
  type AdjustmentIntent,
  type AgentEvent,
  type ChatRequest,
} from 'shared/contracts';

import type { AgentService } from '../agent/AgentService.js';

import type { AgentAdjustmentInput, SuggestionAgentPort } from './suggestionService.js';

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

/** 校验回路：首次 + 最多 2 次纠正（与 uiHintValidationLoop DEFAULT_MAX_RETRIES 一致） */
export const SUGGESTION_MAX_RETRIES = 2;

export function resolveSuggestionTimeoutMs(): number {
  const raw = Number(process.env.SUGGESTION_AGENT_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 12000;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class SuggestionAgentAdapter implements SuggestionAgentPort {
  /** AgentService 由组合根（controller）注入，便于单测 fake 与按环境装配 */
  constructor(private readonly agent: AgentService) {}

  async adjust(input: AgentAdjustmentInput): Promise<AdjustmentIntent[] | null> {
    try {
      return await this.withTimeout(this.runValidationLoop(input));
    } catch {
      // 调用方（SuggestionService）依赖 null 降级语义；这里吞掉意外异常
      return null;
    }
  }

  /** 超时只是放弃等待（invoke 无法中断）；后台仍会自然结束。定时器两种结局都清理 */
  private async withTimeout(promise: Promise<AdjustmentIntent[] | null>): Promise<AdjustmentIntent[] | null> {
    const ms = resolveSuggestionTimeoutMs();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), ms);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async runValidationLoop(input: AgentAdjustmentInput): Promise<AdjustmentIntent[] | null> {
    let message = buildPrompt(input, []);
    for (let attempt = 0; attempt <= SUGGESTION_MAX_RETRIES; attempt += 1) {
      const events = await this.collectEvents({
        userId: input.userId,
        message,
        // 独立线程：与用户主聊天 checkpoint 完全隔离（防止建议轮询污染对话状态）
        threadId: `suggestions:${input.userId}`,
      });
      if (events.error) return null;

      const card = extractAdjustmentCard(events.text);
      if (!card) {
        message = buildPrompt(input, ['输出中没有可解析的 ```json 围栏卡片']);
        continue;
      }
      const parsed = SuggestionAdjustmentCardSchema.safeParse(card);
      if (parsed.success) {
        return filterToRequested(parsed.data.adjustments, input);
      }
      // 结构化错误反馈给下一轮（uiHintValidationLoop 同款回路）
      const details = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ');
      message = buildPrompt(input, [`上一轮卡片校验失败：${details}`]);
    }
    return null;
  }

  /** 跑完一轮 chat，汇拢 token 文本与错误事件（终态文本才含卡片） */
  private async collectEvents(req: ChatRequest): Promise<{ text: string; error: boolean }> {
    let text = '';
    for await (const event of this.agent.chat(req) as AsyncIterable<AgentEvent>) {
      if (event.type === 'error') return { text, error: true };
      if (event.type === 'token' && event.text) text += event.text;
    }
    return { text, error: false };
  }
}

// ---------------------------------------------------------------------------
// Prompt（输入 = Service 压缩摘要；指令 = 只出有界意图，禁算术）
// ---------------------------------------------------------------------------

function buildPrompt(input: AgentAdjustmentInput, feedback: string[]): string {
  const items = input.items.map((item) => ({
    动作: item.name,
    类型: item.type,
    公式基准值: item.baseline,
    锚点依据: item.anchorSummary,
    用户当前配置: item.current ?? '未设置',
    伤病限制: item.injuryLimited ? '是（只许下调或不变）' : '否',
  }));

  const lines = [
    '你是动作建议调整顾问。系统已经用科学公式（est_1RM × RPE 强度表 + 安全钳制）算好每个动作的基准值，你的任务是结合用户画像给出【有界调整意图】和【推荐理由】。',
    '',
    '用户画像摘要：',
    JSON.stringify(input.profileSummary, null, 0),
    '',
    '动作清单（baseline 为公式基准，仅供参考，禁止复述或重算）：',
    JSON.stringify(items, null, 0),
    '',
    '输出要求（严格遵守）：',
    '1. 只输出一个 ```json 围栏块，无其他文字。形状：{"type":"suggestion_adjustment","adjustments":[...]}',
    '2. 每条 adjustment：{"exercise_name":"...","actions":[{"field":"weight|reps|duration_sec|distance_m|set_count|target_rpe","mode":"multiply|delta","value":数字}],"reason":"不超过80字的理由","safety_note":"可选"}',
    '3. 边界（越界会被系统丢弃）：multiply 只能 0.7~1.15；delta 只能 -3~3；set_count 只许 delta -2~1；target_rpe 只许 delta -1~1。',
    '4. 禁止计算或输出绝对重量/次数 —— 只给调整意图，数值由系统合成。',
    '5. 伤病限制为「是」的动作只许下调（multiply<1 或 delta<0）。',
    '6. 宁轻勿重：没把握就不调整（省略该动作即可）；reason 要引用画像中的具体事实，不得编造数据。',
  ];
  if (feedback.length > 0) {
    lines.push('', '上一轮问题（必须修正）：', ...feedback.map((f) => `- ${f}`));
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 围栏解析
// ---------------------------------------------------------------------------

/** 从终态文本剥 ```json 围栏；无围栏时退回首个平衡对象（宽松容错） */
export function extractAdjustmentCard(text: string): unknown {
  const fence = /```(?:json|JSON)?\s*\n?([\s\S]*?)```/.exec(text);
  const candidate = fence ? fence[1] : firstBalancedObject(text);
  if (candidate === null) return null;
  const parsed = parseJSONSafe(candidate);
  return parsed && typeof parsed === 'object' ? parsed : null;
}

function firstBalancedObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** 只保留本次请求里真实存在的动作（Agent 幻觉出的动作名直接丢弃） */
function filterToRequested(
  intents: AdjustmentIntent[],
  input: AgentAdjustmentInput,
): AdjustmentIntent[] {
  const norm = (s: string) => s.toLowerCase().replace(/[\s\-_（）()]/g, '');
  const known = new Set(input.items.map((item) => norm(item.name)));
  return intents.filter((intent) => known.has(norm(intent.exercise_name)));
}
