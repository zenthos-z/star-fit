/**
 * splitLeakedReasoning — 把 Agent 最终回复里泄露的推理草稿与正文切开。
 *
 * 2026-09-22 从 DeepAgentService.ts 拆出：纯函数（零依赖），独立成模块后
 * 可在 jest（CJS）下直接测试——原模块顶层 import.meta（skillLoader）会把
 * 整条依赖链拖进 ESM 域，jest 无法承载。DeepAgentService 仅 re-export 兼容。
 */

/** CJK 占比：中文字符 / (中文 + 拉丁字母)。0 表示两者皆无。 */
export function cjkRatio(s: string): number {
  const cjk = (s.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) ?? []).length;
  const letters = (s.match(/[A-Za-z]/g) ?? []).length;
  return cjk + letters === 0 ? 0 : cjk / (cjk + letters);
}

/**
 * 中文自言自语检测（2026-09-15 实锤泄露：deepseek-v4-flash 也会写中文推理进正文，
 * 而旧启发式只切英文前缀）。特征：第一人称元认知动词（我需要/我应该/让我看看/我先查看/
 * 接下来我…）或对用户的第三人称转述（用户想/用户一直…）——这些是对着草稿纸自说自话，
 * 不是对用户说话（对用户说话用"你"，且以结论/建议句式开头）。
 */
export function looksLikeZhDeliberation(s: string): boolean {
  return /(我(需要|应该|想(先|看看|查看)|先|来|得|打算|准备)|让我(看看|查看|想|先)|接下来我|用户(想|要|一直|反复|这是)|他(上周|之前|的历史))/.test(
    s,
  );
}

/**
 * 流式判定：某一段落是否为「答案起点」——用户可见正文从这里开始。
 * 批量版 `splitLeakedReasoning` 与流式版（DeepAgentService 逐段放行）共用同一条
 * 判定规则，保证两种路径对同一文本的切分一致：
 *   - 含 ``` 的块（json 围栏卡片）永远是答案：JSON 语法拉丁字符占比高，且围栏必须
 *     到达 uiHint 提取器（它只扫 token/answer 事件）——移进 thinking 会静默丢卡；
 *   - CJK 主导且不像中文自言自语的块是答案起点；
 *   - 其余（拉丁主导 / 中文自说自话）视为推理草稿。
 */
export function isAnswerStartBlock(block: string): boolean {
  if (block.includes("```")) {
    return true;
  }
  if (cjkRatio(block) < 0.5) {
    return false; // Latin-dominant → deliberation
  }
  // CJK-dominant block: answer unless it reads like zh self-talk.
  return !looksLikeZhDeliberation(block);
}

/**
 * 流式兜底：把一段已确认的答案文本切成多个小 chunk，逐个以 token 事件转发
 * （「逐 token 转发」而非一次性 emit）。优先在自然断点（换行 / 中英文标点 / 空格）
 * 处切开，保证前端气泡按行逐字渲染；无断点则硬切 maxLen。
 */
export function chunkAnswerText(text: string, maxLen = 24): string[] {
  if (text.length === 0) return [];
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > maxLen) {
    const window = rest.slice(0, maxLen);
    let cut = -1;
    for (let i = window.length - 1; i >= 0; i -= 1) {
      const ch = window[i]!;
      if (
        /\n|[\u3002\uFF0C\uFF01\uFF1F\uFF1B\u3001.,!?;:，。！？；、]/.test(ch)
      ) {
        cut = i + 1;
        break;
      }
    }
    if (cut <= 0) cut = maxLen;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/**
 * 工具返回特征检测（2026-09-23 返工）：模型在「无 tool_calls 的终步消息」里
 * 复述工具返回内容（动作库 JSON / 技能文件全文），splitLeakedReasoning 会把这
 * 段复述误判为 answer 放行成 token（7-11k 字符泄漏实锤）。终步 flush 前用本
 * 函数拦截：命中 → 整段转 thinking，绝不放行。
 *
 * 命中规则（任一即拦）：
 *   A. 动作库 JSON 签名：`{"count":N,"exercises"`（容忍空白/换行）——list_exercises
 *      工具返回的特征形状，正文绝不可能长这样；
 *   B. JSON 主导：trim 后以 `{` / `[` 开头，且非空白字符中 >60% 是 ASCII 结构
 *      字符/引号（{}[]",:）——整段是裸 JSON（无 ``` 围栏，围栏卡片以 ``` 开头
 *      不会误伤）；
 *   C. 技能文件头：含 `# 计划生成知识指南`，或以 `1\t#` 开头的编号行（read_file
 *      复述 plan-generation/knowledge.md 的标题/目录形状）。
 */
export function looksLikeToolReturnEcho(text: string): boolean {
  if (!text || text.trim().length === 0) return false;
  const t = text.trim();

  // A. 动作库 JSON 签名（count + exercises 共现，容忍空白/换行）
  if (
    /\{\s*"count"\s*:\s*\d+\s*,\s*"exercises"/.test(t) ||
    (/\{\s*"count"\s*:/.test(t) && /"exercises"\s*:/.test(t))
  ) {
    return true;
  }

  // C. 技能文件头
  if (t.includes("# 计划生成知识指南") || /(^|\n)[ \t]*\d+[ \t]*\t#/.test(t)) {
    return true;
  }

  // B. JSON 主导：trim 后以 { / [ 开头（裸 JSON，无 ``` 围栏——围栏卡片以
  // ``` 开头不会误伤）。双重判定：
  //   B1. 任务原话：非空白中 >60% 是 ASCII 结构字符/引号（{}[]",:）；
  //   B2. 兜底：整段能被 JSON.parse 解析的对象/数组且长度足够大——正文绝不
  //       可能以「大段可解析裸 JSON」开头；短 JSON（如 {"ok":true}）用长度
  //       阈值排除误杀。真实动作库 JSON 含中文名/英文键，结构字符占比可能
  //       低于 60%（如 {"id":"ex_1","name":"深蹲"} 仅约 1/3），B2 兜住。
  if (t.startsWith("{") || t.startsWith("[")) {
    const nonWs = t.replace(/\s+/g, "");
    if (nonWs.length === 0) return false;
    const structural = (nonWs.match(/[\{\}\[\]"',:]/g) ?? []).length;
    if (structural / nonWs.length > 0.6) return true;
    if (t.length >= 100) {
      try {
        const parsed: unknown = JSON.parse(t);
        if (parsed !== null && typeof parsed === "object") return true;
      } catch {
        // 非纯 JSON（含叙述包裹）——B2 不判定，交给 A/C 签名兜底
      }
    }
  }

  return false;
}

export function splitLeakedReasoning(text: string): {
  reasoning: string;
  answer: string;
} {
  const blocks = text.split(/\n{2,}/).filter((b) => b.trim().length > 0);
  if (blocks.length < 2) {
    return { reasoning: "", answer: text };
  }

  // Find the first block where CJK clearly dominates — the answer's start.
  // A fenced code block (```json card) is ALWAYS answer regardless of its
  // letter ratios: JSON syntax is Latin-heavy and the fence must reach the
  // uiHint extractor, which only scans token (answer) events — a fence moved
  // into `thinking` would silently drop the card.
  let answerStart = -1;
  for (let i = 0; i < blocks.length; i++) {
    if (isAnswerStartBlock(blocks[i])) {
      answerStart = i;
      break;
    }
  }

  if (answerStart <= 0) {
    // No leading Latin-dominant deliberation (or none at all) — untouched.
    return { reasoning: "", answer: text };
  }

  const reasoning = blocks.slice(0, answerStart).join("\n\n");
  const answer = blocks.slice(answerStart).join("\n\n");
  return { reasoning, answer };
}
