/**
 * tutorialContent — 教学内容选取纯函数（A4 教程数据源切换，issue #12）。
 *
 * 内容优先级（库数据优先，AI 兜底）：
 *   ① content_html        admin 官方版（最高，既有口径）
 *   ② tutorial_md         动作库结构化数据五段组装（source=library，
 *                          backend tutorialAssembler 模板渲染，REST 详情端点附带）
 *   ③ tutorials.ai.content_md  服务器已生成的 AI 版
 *   （localStorage 离线备份与 AI 即时生成由调用方按既有链路处理）
 *
 * source 语义：'library' = 动作库内容（官方/结构化），'ai' = AI 生成。
 */

/** 教程数据源（前端徽标口径：「数据源：动作库」/「AI 生成」） */
export type TutorialSourceKind = 'library' | 'ai';

export interface PickedTutorial {
  content: string;
  source: TutorialSourceKind;
}

/** REST 详情响应（exercises 行 + 视图字段 + A4 tutorial_md/tutorial_source） */
export interface ExerciseDetailData {
  content_html?: string | null;
  tutorial_md?: string | null;
  tutorials?: unknown;
  [key: string]: unknown;
}

/** 按优先级选取教学内容；三槽皆空返回 null（调用方走离线备份/AI 生成）
 *
 * A6 中文优先调整（issue #19 PR 返工）：tutorial_md（库结构化五段中文教学）
 * 提为最高——content_html 存量为库源英文一句话 stub（314 条，60-139 字符），
 * 会压住中文教学；content_html 降为 tutorial_md 缺席时的回退。 */
export function pickTutorialContent(
  data: ExerciseDetailData | null | undefined,
): PickedTutorial | null {
  if (!data) return null;

  if (typeof data.tutorial_md === 'string' && data.tutorial_md.trim() !== '') {
    return { content: data.tutorial_md, source: 'library' };
  }

  if (typeof data.content_html === 'string' && data.content_html.trim() !== '') {
    return { content: data.content_html, source: 'library' };
  }

  const ai = parseTutorialsAi(data.tutorials);
  if (ai && ai.trim().length > 50) {
    return { content: ai, source: 'ai' };
  }

  return null;
}

/** tutorials JSONB（对象或字符串两形态）里的 ai.content_md */
export function parseTutorialsAi(
  tutorials: unknown,
): string | undefined {
  let raw = tutorials;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  if (!raw || typeof raw !== 'object') return undefined;
  const ai = (raw as Record<string, unknown>).ai;
  if (!ai || typeof ai !== 'object') return undefined;
  const md = (ai as Record<string, unknown>).content_md;
  return typeof md === 'string' ? md : undefined;
}

/**
 * 历史遗留：旧版 AI 提示词以 🎯💪⚠️❌ 等 emoji 作段落图标（issue #8 判定失误）。
 * 渲染前清洗标题行与引用行首的 emoji，保证「段落标识=纯文字标题」口径。
 */
const EMOJI_SCHEME_RE =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu;

export function stripDecorativeEmoji(markdown: string): string {
  return markdown
    .split('\n')
    .map((line) => {
      const headingOrQuote = /^\s{0,3}(#{1,6}\s|>\s?)/.test(line);
      if (!headingOrQuote) return line;
      return line.replace(EMOJI_SCHEME_RE, '').replace(/^(#{1,6}\s|>\s?)\s+/, '$1');
    })
    .join('\n');
}
