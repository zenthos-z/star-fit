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
    // B0. 卡片豁免（2026-09-23 返工 v3）：顶层带非空 string `type` 的可解析
    //     对象是 uiHint 卡片载荷（模型偶尔不包围栏直接 inline），必须到达
    //     token 流供 uiHintExtractor 提取——绝不拦截。
    try {
      const parsed: unknown = JSON.parse(t);
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        typeof (parsed as { type?: unknown }).type === "string" &&
        (parsed as { type: string }).type.length > 0
      ) {
        return false;
      }
    } catch {
      // 非纯 JSON（含叙述包裹 / 多个粘接对象）——B0 不判定，继续 B1/B2
    }
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

/**
 * 终步工具复述前缀剥离（2026-09-23 返工 v3）。
 *
 * v2（efabc98）在终步 flush 前对「整个 stepRaw」跑 looksLikeToolReturnEcho，
 * 命中就把复述+正常回答+围栏卡片整体吞进 thinking——真实 LLM 回放 3 轮全部
 * 正文 0 字符 + 卡片 0 张（被吞 thinking 18969 字符 = 动作库 JSON 复述 + 围栏
 * survey_card + 中文回答）。模型在无 tool_calls 的终步消息里先 echo 工具返回
 * 再写真实回复（DeepSeek 常见），一刀切把正常回答陪葬，围栏卡片也进不了
 * token 流 → uiHintExtractor 提不出卡。
 *
 * 本函数只精确摘除「开头的裸工具返回复述段」，其余（正常回答 + 围栏卡片）
 * 原样返回继续走 splitLeakedReasoning。识别顺序（逐案独立，命中即返）：
 *
 *   A. 前导 JSON 串（粘接形态）：list_exercises 返回 `{...}` 后紧跟
 *      load_history 返回 `{...}`（实测 `]}{"userId"` 无分隔符粘接），或
 *      换行分隔。逐段提取平衡 JSON 对象，遇到带顶层 `type` 的卡片对象即停；
 *      整串命中 count+exercises / history_summary+profile_static 签名或
 *      ≥300 字符（无 type 的裸 JSON）才判为复述，否则不动；
 *   B. 前导编号行（read_file 复述）：read_file 返回带行号前缀 `N\t`，
 *      模型复述即「每行都以数字+Tab 开头」的块（实测技能索引 `1\t---`、
 *      knowledge.md `1\t# 计划生成知识指南...`），≥70% 行命中即整块剥离；
 *   C. 前导签名块（技能文件头等）：首个非空块命中 looksLikeToolReturnEcho
 *      （# 计划生成知识指南 / JSON 主导等）→ 连同后续「文档结构块」
 *      （isSkillDocContinuation）一起剥离，遇围栏（```）或叙述块即停。
 *
 * 关键约束：围栏卡片以 ``` 开头，任何一条路径都不会命中；正常中文回答
 * 只要不是前导复述的一部分就完整保留。
 */
export function stripToolEchoPrefix(text: string): {
  echo: string;
  rest: string;
} {
  if (!text || text.trim().length === 0) return { echo: "", rest: text };
  const body = text.trimStart();

  // A. 前导 JSON 串（含粘接对象）
  if (body.startsWith("{")) {
    const { echoLen, isEcho } = leadingEchoJsonLen(body);
    if (isEcho && echoLen > 0) {
      return { echo: body.slice(0, echoLen).trim(), rest: body.slice(echoLen) };
    }
  }

  // B. 前导编号行（read_file 复述：每行 `N\t`）
  const firstBlock = body.split(/\n{2,}/)[0] ?? "";
  if (isNumberedToolEcho(firstBlock)) {
    return {
      echo: firstBlock.trim(),
      rest: body.slice(firstBlock.length),
    };
  }

  // C. 前导签名块（技能文件头 / JSON 主导等）
  const blocks = body.split(/\n{2,}/);
  let i = 0;
  while (i < blocks.length && blocks[i]!.trim().length === 0) i += 1;
  if (i < blocks.length && looksLikeToolReturnEcho(blocks[i]!)) {
    let j = i + 1;
    while (j < blocks.length && isSkillDocContinuation(blocks[j]!)) j += 1;
    return {
      echo: blocks.slice(i, j).join("\n\n").trim(),
      rest: blocks.slice(j).join("\n\n"),
    };
  }

  return { echo: "", rest: text };
}

/**
 * 提取前导的「粘接 JSON 对象串」：从文本开头连续提取平衡 JSON 对象
 * （对象间容忍空白/无分隔符），遇到无法解析或带顶层非空 string `type`
 * （uiHint 卡片）的对象即停。返回应剥离的字符长度与是否判为复述。
 */
function leadingEchoJsonLen(text: string): {
  echoLen: number;
  isEcho: boolean;
} {
  let collected = "";
  let pos = 0;
  while (pos < text.length) {
    while (pos < text.length && /\s/.test(text[pos]!)) pos += 1;
    const ch = text[pos];
    if (ch !== "{" && ch !== "[") break;
    const end = scanBalancedJsonAt(text, pos);
    if (end === null) break;
    const obj = text.slice(pos, end);
    let parsed: unknown;
    try {
      parsed = JSON.parse(obj);
    } catch {
      break;
    }
    const topType = (parsed as { type?: unknown } | null)?.type;
    if (typeof topType === "string" && topType.length > 0) break; // 卡片→保留
    collected += obj;
    pos = end;
  }
  if (collected.length === 0) return { echoLen: 0, isEcho: false };
  const sigA =
    /"count"\s*:\s*\d+/.test(collected) && /"exercises"\s*:/.test(collected);
  const sigH =
    /"history_summary"\s*:/.test(collected) &&
    /"profile_static"\s*:/.test(collected);
  const isEcho = sigA || sigH || collected.length >= 300;
  return { echoLen: isEcho ? pos : 0, isEcho };
}

/**
 * 扫描从 start 开始的平衡 JSON 对象/数组（字符串/转义感知），
 * 成功解析则返回结束位置（含闭合符），否则返回 null。
 */
function scanBalancedJsonAt(text: string, start: number): number | null {
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inStr) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inStr = false;
      }
      continue;
    }
    if (ch === '"') {
      inStr = true;
    } else if (ch === "{" || ch === "[") {
      depth += 1;
    } else if (ch === "}" || ch === "]") {
      depth -= 1;
      if (depth === 0) {
        const candidate = text.slice(start, i + 1);
        try {
          JSON.parse(candidate);
          return i + 1;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * read_file 工具返回的复述形态：每行以 `N\t`（行号+Tab）开头。
 * 要求 ≥2 行且 ≥70% 非空行命中（容忍个别包裹行），整体 ≥30 字符。
 * 正常回答绝不会以「数字+Tab」行开头（Markdown 编号用 `.`/`)`）。
 */
function isNumberedToolEcho(block: string): boolean {
  if (block.trim().length < 30) return false;
  const lines = block.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2) return false;
  const numbered = lines.filter((l) => /^\s*\d+\t/.test(l)).length;
  return numbered / lines.length >= 0.7;
}

/**
 * 技能文档复述的延续块判定：技能文件头（`# 计划生成知识指南`）命中后，
 * 后续「文档结构块」（标题/引用/列表/表格/编号行，≥60% 行命中）属于同一份
 * 复述，继续剥离；围栏卡片（含 ```）或叙述块立即停止。
 */
function isSkillDocContinuation(block: string): boolean {
  if (block.includes("```")) return false; // 围栏卡片——绝不剥离
  if (looksLikeToolReturnEcho(block)) return true;
  const lines = block.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return false;
  const structured = lines.filter((l) =>
    /^(#|>|-|\*|\||\d+[.)\t]|_)/.test(l.trim()),
  ).length;
  return structured / lines.length >= 0.6;
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
