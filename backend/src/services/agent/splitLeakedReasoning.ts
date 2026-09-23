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
 *
 * 2026-09-23 返工 v4 收紧元认知动词：真实 LLM 冒烟（8 轮 3 轮正文 0 字符）发现
 * 裸 `来` / `先` / `得` 会把正常回答开首误判为自言自语（"明天的计划我来定"、
 * "我得先知道几个关键信息"——对用户的承诺/征询句式，不是草稿纸自白）。只有
 * 紧跟「读/查/看」类元认知动词（来(看看|查看|确认|查|读|想)、先(查看|看看|查|读)、
 * 得(看看|查看|查|读|先看看)）才算自言自语；承诺/征询句式必须保留在正文。
 */
export function looksLikeZhDeliberation(s: string): boolean {
  return /(我(需要|应该|想(先|看看|查看)|先(查看|看看|查|读)|来(看看|查看|确认|查|读|想)|得(看看|查看|查|读|先看看)|打算|准备)|让我(看看|查看|想|先)|接下来我|用户(想|要|一直|反复|这是)|他(上周|之前|的历史))/.test(
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
 * 终步工具复述「全段扫描剥离」（2026-09-23 返工 v4）。
 *
 * v3（stripToolEchoPrefix）只剥离「开头」的复述段；真实 DeepSeek 行为是
 * 在任意位置复述工具返回——先写引导语（如"好的我来看看计划生成指南"）→
 * 再整段 echo read_file 返回（编号行 frontmatter：`1\t---`、`2\tname: ...`）
 * → 再写真实回答。复述落在中间/后置时，v3 的 B 分支 firstBlock = 引导语块，
 * isNumberedToolEcho 判定失败，整段被 splitLeakedReasoning 误判成 answer
 * 放行成 token（协调者实测 6115 / 2480 字符泄漏）。
 *
 * 本函数对 answer 部分逐块（\n{2,} 分隔）扫描，把「前缀剥离」扩展为
 * 「任意位置剥离」：
 *   - 命中复述特征（looksLikeToolReturnEcho / isNumberedToolEcho）→ 摘进
 *     thinking（leakedThinking），绝不进 token；
 *   - 命中后紧跟的文档延续块（编号行 frontmatter 被空行切开的后续块、技能
 *     文档结构块）→ 链式一并摘除，遇围栏/普通叙述块即断链；
 *   - 其余块原样保留为 token。
 * 防误伤铁律：
 *   - 含 ``` 的围栏卡片块绝不摘——它是卡片的 token 载体（uiHintExtractor
 *     只扫 token/answer 事件），必须完整保留；
 *   - 正常中文回答块无复述特征（非编号行、非 JSON 主导、非技能头），不受
 *     影响；短块（<30 字符）不判定（isNumberedToolEcho 阈值）。
 *   - 链式延续只认「强文档结构」块（标题/引用/表格/编号行，见
 *     isSkillDocContinuationStrong）——纯 bullet 列表的回答块（- / * 主导）
 *     不是 read_file 复述的延续，绝不跟剥。
 */
export function stripToolEchoBlocks(text: string): {
  echo: string;
  rest: string;
} {
  if (!text || text.trim().length === 0) return { echo: "", rest: text };
  const blocks = text.split(/\n{2,}/);
  const keep: string[] = [];
  const echoes: string[] = [];
  let inEchoChain = false; // 前一块已确认是复述 → 允许文档延续块跟剥
  for (const raw of blocks) {
    const block = raw.trim();
    if (block.length === 0) continue;
    if (block.includes("```")) {
      // 围栏卡片——token 载体，绝不摘；链同步断开（卡片不属于复述文档）。
      inEchoChain = false;
      keep.push(block);
      continue;
    }
    const hit = looksLikeToolReturnEcho(block) || isNumberedToolEcho(block);
    if (hit) {
      echoes.push(block);
      inEchoChain = true;
      continue;
    }
    if (inEchoChain && isSkillDocContinuationStrong(block)) {
      echoes.push(block);
      continue;
    }
    inEchoChain = false;
    keep.push(block);
  }
  return { echo: echoes.join("\n\n"), rest: keep.join("\n\n") };
}

/**
 * 直通段「复述可疑」判定（返工 v5）：
 * 未完成块是否可能构成工具返回复述的起点——命中则缓冲等待完整块判定
 * （绝不提前放行），未命中立即放行（保留流式首字收益）。
 *
 * 可疑形态（都是「正常正文绝不可能」的形状）：
 *   - `\d+\t` 编号行（read_file 返回复述的特征行首，Markdown 编号用 . / )）；
 *   - `{` / `[` 起始行（工具返回裸 JSON / 粘接 JSON 的特征）；
 *   - 技能文件头签名（# 计划生成知识指南）。
 */
export function isEchoSuspicious(text: string): boolean {
  if (!text) return false;
  return (
    /(^|\n)[ \t]*(\d+\t|\{|\[)/.test(text) ||
    text.includes("# 计划生成知识指南")
  );
}

export interface LiveGateDrain {
  /** 已判定安全的块 → 放行成 token 事件 */
  tokens: string;
  /** 已判定为工具返回复述的块 → 转 thinking（绝不 yield token） */
  echoes: string;
}

/**
 * 直通段复述闸门（返工 v5 核心，2026-09-23）。
 *
 * v4（231fed9）的剥离链（stripToolEchoPrefix + stripToolEchoBlocks）只在终步
 * 快照到达那一刻对「已缓冲的 stepRaw」执行一次；快照确认终步后 answerLive=
 * true，后续 messages delta 走 `if (answerLive)` 直通分支直接 yield 成 token，
 * 完全绕过剥离检查——DeepSeek「先出快照再补输出」时，模型在直通段复述
 * read_file 返回（编号行 frontmatter `1\t---`、`2\tname: ...`）全部裸奔进正文
 * （协调者实测：污染用户 5 轮 3 泄漏 + 全新用户 4 轮 3 泄漏，历史污染假设排除，
 * 代码缺陷坐实）。
 *
 * 本闸门挂在 answerLive 直通分支：delta 先入缓冲，按块判定后再放行——
 *   - 完整块（\n{2,} 边界）出现 → 跑 stripToolEchoBlocks 同款判定链
 *     （looksLikeToolReturnEcho / isNumberedToolEcho /
 *     isSkillDocContinuationStrong），命中 → 转 thinking；未命中 → 放行 token；
 *   - 无 \n{2,} 的巨型单块（编号行复述全文等）→ 累积到阈值（默认 400 字符）
 *     后按行对齐切割判定，缓冲延迟钳在阈值量级；
 *   - 非「复述可疑」的未完成块 → 立即放行（eager-yield），保留 v4 的流式首字
 *     收益；只有复述可疑形态或复述链（echoChain）内才缓冲等待判定。
 *
 * 防误伤铁律（与批量链一致）：含 ``` 的围栏卡片块绝不摘（uiHint 提取器只扫
 * token 流）；正常中文/英文回答块不受影响；短块（<30 字符）不判为复述
 * （isNumberedToolEcho 阈值）。复述链跨 feed 保持：被阈值切开的编号行复述
 * 后续块、以及紧跟复述的文档结构延续块，不会被当成新块漏判。
 */
export class LiveEchoGate {
  private pending = "";
  private chain = false;

  constructor(private readonly threshold = 400) {}

  /** 追加一个 messages delta，返回可放行的 token 与待转 thinking 的复述。 */
  feed(delta: string): LiveGateDrain {
    this.pending += delta;
    return this.drain();
  }

  /** 流结束：判定残余未完成块（复述 → thinking，正常 → token）。 */
  flush(): LiveGateDrain {
    const r = this.judge(this.pending);
    this.pending = "";
    this.chain = false;
    return r;
  }

  /** 重置（新 step 开始；answerLive 翻转前调用）。 */
  reset(): void {
    this.pending = "";
    this.chain = false;
  }

  private drain(): LiveGateDrain {
    const tokens: string[] = [];
    const echoes: string[] = [];
    for (;;) {
      // 1. 完整块边界：最后一个 \n{2,} 之前的文本全是完整块，整体判定
      const sep = this.pending.lastIndexOf("\n\n");
      if (sep > 0) {
        const complete = this.pending.slice(0, sep);
        this.pending = this.pending.slice(sep);
        const r = this.judge(complete);
        if (r.tokens) tokens.push(r.tokens);
        if (r.echoes) echoes.push(r.echoes);
        continue;
      }
      // 2. 阈值：无 \n{2,} 的巨型单块按行对齐切割判定（最后一行若未完成
      //    则留在缓冲等后续增量），避免无限缓冲拖死流式
      if (this.pending.length >= this.threshold) {
        const lastNl = this.pending.lastIndexOf("\n");
        let complete: string;
        if (lastNl > 0 && lastNl < this.pending.length - 1) {
          complete = this.pending.slice(0, lastNl + 1);
          this.pending = this.pending.slice(lastNl + 1);
        } else {
          complete = this.pending;
          this.pending = "";
        }
        const r = this.judge(complete);
        if (r.tokens) tokens.push(r.tokens);
        if (r.echoes) echoes.push(r.echoes);
        continue;
      }
      // 3. 非复述可疑的未完成块 → 立即放行（流式首字收益；复述链内不放行，
      //    等待下一次完整块判定以完成文档延续剥离）
      if (
        this.pending.trim().length > 0 &&
        !this.chain &&
        !isEchoSuspicious(this.pending)
      ) {
        tokens.push(this.pending);
        this.pending = "";
        continue;
      }
      break;
    }
    return { tokens: tokens.join(""), echoes: echoes.join("\n\n") };
  }

  private judge(text: string): LiveGateDrain {
    const blocks = text.split(/\n{2,}/);
    const keep: string[] = [];
    const echoes: string[] = [];
    for (const raw of blocks) {
      const block = raw.trim();
      if (block.length === 0) continue;
      if (block.includes("```")) {
        // 围栏卡片——token 载体，绝不摘；复述链同步断开
        this.chain = false;
        keep.push(block);
        continue;
      }
      const hit = looksLikeToolReturnEcho(block) || isNumberedToolEcho(block);
      if (hit) {
        echoes.push(block);
        this.chain = true;
        continue;
      }
      if (this.chain && isSkillDocContinuationStrong(block)) {
        echoes.push(block);
        continue;
      }
      this.chain = false;
      keep.push(block);
    }
    return { tokens: keep.join("\n\n"), echoes: echoes.join("\n\n") };
  }
}

/**
 * 复述文档延续块的「强结构」判定：read_file 复述（编号行 frontmatter / 技能
 * 文档结构）被空行切开的后续块，行首应为标题（#）、引用（>）、表格（|）或
 * 编号行（\d+[.)\t]）等强文档标记，且结构化行占比 ≥60%。
 *
 * 与 isSkillDocContinuation 的区别：不含纯 bullet 列表（- / * 主导）——模型
 * 正常回答常以「- 深蹲 3 组」式列表呈现，紧跟复述块时绝不能当延续摘走。
 */
function isSkillDocContinuationStrong(block: string): boolean {
  if (block.includes("```")) return false; // 围栏卡片——绝不剥离
  if (looksLikeToolReturnEcho(block)) return true;
  const lines = block.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return false;
  const structured = lines.filter((l) =>
    /^(#|>|\||\d+[.)\t]|_)/.test(l.trim()),
  ).length;
  return structured / lines.length >= 0.6;
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
