/**
 * splitLeakedReasoning — 把 Agent 最终回复里泄露的推理草稿与正文切开。
 *
 * 2026-09-22 从 DeepAgentService.ts 拆出：纯函数（零依赖），独立成模块后
 * 可在 jest（CJS）下直接测试——原模块顶层 import.meta（skillLoader）会把
 * 整条依赖链拖进 ESM 域，jest 无法承载。DeepAgentService 仅 re-export 兼容。
 */

export function splitLeakedReasoning(text: string): {
  reasoning: string;
  answer: string;
} {
  const blocks = text.split(/\n{2,}/).filter((b) => b.trim().length > 0);
  if (blocks.length < 2) {
    return { reasoning: "", answer: text };
  }

  const cjkRatio = (s: string): number => {
    const cjk = (s.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) ?? []).length;
    const letters = (s.match(/[A-Za-z]/g) ?? []).length;
    return cjk + letters === 0 ? 0 : cjk / (cjk + letters);
  };

  // 中文自言自语检测（2026-09-15 实锤泄露：deepseek-v4-flash 也会写中文推理进正文，
  // 而旧启发式只切英文前缀）。特征：第一人称元认知动词（我需要/我应该/让我看看/我先查看/
  // 接下来我…）或对用户的第三人称转述（用户想/用户一直…）——这些是对着草稿纸自说自话，
  // 不是对用户说话（对用户说话用"你"，且以结论/建议句式开头）。
  const looksLikeZhDeliberation = (s: string): boolean =>
    /(我(需要|应该|想(先|看看|查看)|先|来|得|打算|准备)|让我(看看|查看|想|先)|接下来我|用户(想|要|一直|反复|这是)|他(上周|之前|的历史))/.test(
      s,
    );

  // Find the first block where CJK clearly dominates — the answer's start.
  // A fenced code block (```json card) is ALWAYS answer regardless of its
  // letter ratios: JSON syntax is Latin-heavy and the fence must reach the
  // uiHint extractor, which only scans token (answer) events — a fence moved
  // into `thinking` would silently drop the card.
  let answerStart = -1;
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].includes("```")) {
      answerStart = i;
      break;
    }
    if (cjkRatio(blocks[i]) < 0.5) continue; // Latin-dominant → deliberation
    // CJK-dominant block: answer unless it reads like zh self-talk.
    if (looksLikeZhDeliberation(blocks[i])) continue;
    answerStart = i;
    break;
  }

  if (answerStart <= 0) {
    // No leading Latin-dominant deliberation (or none at all) — untouched.
    return { reasoning: "", answer: text };
  }

  const reasoning = blocks.slice(0, answerStart).join("\n\n");
  const answer = blocks.slice(answerStart).join("\n\n");
  return { reasoning, answer };
}
