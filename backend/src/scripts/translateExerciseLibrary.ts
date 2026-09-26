/**
 * A6 动作库批量中文翻译脚本（issue #19）——可重复执行（幂等）。
 *
 * 管线：术语表先行（loadGlossary，Zod 校验）→ 读库 354 条（Repository
 * searchItems，禁止裸 SQL）→ 名称定名（全名定名层精确命中优先，未命中走
 * LLM 批量兜底）→ 教学内容四段深化翻译（LLM，glm-5.3-flash，Anthropic
 * Messages 兼容网关；parseJSONSafe + Zod + 步数对齐复核）→ buildInstructionsZh
 * 结构化编码 → ExerciseDetailUpdateSchema 校验 → repo.updateDetail 回写
 * （白名单仅 name_zh / instructions_zh，源英文字段不动）。
 *
 * 幂等：name_zh 与 instructions_zh（有教学字段时）均已非空的行跳过；
 * --force 强制重翻。逐行回写，中断后重跑续传。
 *
 * 用法：
 *   DATABASE_URL=postgresql://starfit:starfit@localhost:15432/starfit \
 *   ANTHROPIC_AUTH_TOKEN=... \
 *     npx tsx src/scripts/translateExerciseLibrary.ts [--dry] [--force]
 *       [--limit N] [--only substr] [--names-only] [--review [N]]
 *
 *   --dry         只出计划，不调 LLM 不写库（无需通道 key）
 *   --force       已翻译的也重翻
 *   --limit N     只处理前 N 条待翻行（冒烟）
 *   --only substr 只处理名称含 substr 的行
 *   --names-only  只翻名称（跳过教学内容；名称回填单独成行）
 *   --review [N]  翻译后抽检 N 条（默认 20）落 a6-translation-review.md；
 *                 单独使用（无可翻行）时仅重建抽检报告
 *
 * LLM 通道（环境实测 2026-09-26，无 OPENAI_API_KEY）：智谱 Anthropic 兼容
 * 网关（ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN），模型 glm-5.3-flash；
 * 可用 TRANSLATE_BASE_URL / TRANSLATE_API_KEY / TRANSLATE_MODEL 覆盖。
 *
 * @version 1.0.0
 * @created 2026-09-26
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ExerciseDetailUpdateSchema,
  buildInstructionsZh,
  parseInstructionsZh,
} from "../../../shared/dist/contracts/index.js";
import type { ExerciseLibraryItem } from "../../../shared/dist/contracts/index.js";
import {
  buildContentSystemPrompt,
  buildNamesSystemPrompt,
  checkNameOverrideHit,
  checkTermConsistency,
  loadGlossary,
  nameOverride,
  renderGlossaryForPrompt,
  resolveLlmChannelFromEnv,
  translateExerciseContent,
  translateExercisesBatch,
  translateNamesBatch,
  type LlmChannel,
  type TerminologyGlossary,
  type TranslatedExercise,
  type TranslationInput,
} from "../services/exerciseTranslate/index.js";

/** 术语表落点（与脚本同目录，仓库内真源） */
const GLOSSARY_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "terminology-glossary.json",
);

/** 抽检报告落点 */
const REVIEW_DOC_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../docs/design/a6-translation-review.md",
);

/** 内容翻译并发与批大小（bigmodel RPM 限流实测：单条并发 8 持续 429、并发 3 吞吐
 *  ~1.7 条/分；批处理把请求数降为 1/批大小后 3 并发稳定，429 由退避兜底） */
const CONTENT_CONCURRENCY = 3;
const CONTENT_BATCH_SIZE = 5;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry");
const force = args.includes("--force");
const namesOnly = args.includes("--names-only");
const limitArg = flagValue("--limit");
const onlyArg = flagValue("--only");
const reviewArg = flagValue("--review");

function flagValue(flag: string): string | null {
  const idx = args.indexOf(flag);
  if (idx === -1) {
    return null;
  }
  const next = args[idx + 1];
  return next && !next.startsWith("--") ? next : "";
}

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

/** exercises 行 → 翻译输入（教学列子集；英文原值只读） */
function toInput(item: ExerciseLibraryItem) {
  return {
    id: item.id,
    name: item.name,
    instructions: item.instructions,
    form_cues: item.form_cues,
    common_mistakes: item.common_mistakes,
    breathing: item.breathing,
  };
}

const hasTeaching = (item: ExerciseLibraryItem): boolean =>
  (item.instructions?.length ?? 0) > 0 ||
  (item.form_cues?.length ?? 0) > 0 ||
  (item.common_mistakes?.length ?? 0) > 0 ||
  (item.breathing?.trim() ?? "") !== "";

const isTranslated = (item: ExerciseLibraryItem): boolean =>
  (item.name_zh?.trim() ?? "") !== "" &&
  (!hasTeaching(item) || (item.instructions_zh?.length ?? 0) > 0);

async function main(): Promise<void> {
  console.log(`A6 动作库批量中文翻译${dryRun ? "（DRY RUN）" : ""}`);
  const runIso = new Date().toISOString();

  // ---- 1. 术语表先行 ----
  const glossary = loadGlossary(GLOSSARY_PATH);
  console.log(
    `✓ 术语表：${glossary.entries.length} 条（全名定名 ${glossary.overrides.length}｜词表 ${glossary.vocabulary.length}｜` +
      `通行 ${glossary.entries.filter((e) => e.source === "通行").length}／直译 ${glossary.entries.filter((e) => e.source === "直译").length}／存疑 ${glossary.entries.filter((e) => e.source === "存疑").length}）`,
  );

  // ---- 2. 读库（Repository，禁止裸 SQL）----
  if (!process.env.DATABASE_URL) {
    fail("缺少 DATABASE_URL");
  }
  const { getPostgresClient, closePostgresClient } =
    await import("../db/postgresql/client/postgres-client.js");
  const { createExerciseRepository } =
    await import("../db/postgresql/repository/exercise.repository.js");
  const client = getPostgresClient();
  const repo = createExerciseRepository(client);

  let items: ExerciseLibraryItem[];
  try {
    items = await repo.searchItems({});
    if (items.length === 0) {
      fail("公共动作库为空（先跑 A3 导入）");
    }
    const pendingAll = items.filter((i) => !isTranslated(i) || force);
    let pending =
      onlyArg !== null
        ? pendingAll.filter((i) =>
            i.name.toLowerCase().includes(onlyArg.toLowerCase()),
          )
        : pendingAll;
    if (limitArg !== null) {
      pending = pending.slice(0, Number(limitArg));
    }
    console.log(
      `✓ 读库：公共库 ${items.length} 行，待翻 ${pending.length} 行` +
        `（名称缺 ${pending.filter((i) => !i.name_zh?.trim()).length}｜教学内容缺 ${pending.filter((i) => hasTeaching(i) && (force || !i.instructions_zh?.length)).length}）`,
    );

    if (dryRun) {
      for (const i of pending.slice(0, 10)) {
        console.log(
          `  - ${i.name}（name_zh ${i.name_zh ? "已有" : "缺"}｜教学 ${hasTeaching(i) ? "有" : "无"}｜instructions_zh ${i.instructions_zh?.length ? "已有" : "缺"}）`,
        );
      }
      console.log("（dry run：不调 LLM 不写库）");
      return;
    }

    // ---- 3. LLM 通道 ----
    let channel: LlmChannel;
    try {
      channel = resolveLlmChannelFromEnv();
    } catch (error) {
      fail((error as Error).message);
    }
    console.log(
      `✓ LLM 通道：${channel.baseUrl}（模型 ${channel.model}，Anthropic Messages 兼容）`,
    );

    // ---- 4. 名称翻译：定名层精确命中优先，未命中 LLM 批量兜底 ----
    const nameZh = new Map<string, string>(); // item.id → name_zh
    const overrideHits: string[] = [];
    const fallbackNames: string[] = [];
    for (const item of pending) {
      if (item.name_zh?.trim() && !force) {
        continue;
      } // 名称已有且非强制 → 跳过名称
      const override = nameOverride(glossary, item.name);
      if (override) {
        nameZh.set(item.id, override.zh);
        overrideHits.push(item.name);
      } else {
        fallbackNames.push(item.name);
      }
    }
    if (fallbackNames.length > 0) {
      console.log(
        `⋯ 名称兜底：${fallbackNames.length} 条未命中定名层，走 LLM 批量翻译`,
      );
      const namesPrompt = buildNamesSystemPrompt(
        renderGlossaryForPrompt(glossary),
      );
      const BATCH = 30;
      for (let s = 0; s < fallbackNames.length; s += BATCH) {
        const batch = fallbackNames.slice(s, s + BATCH);
        const map = await translateNamesBatch(channel, namesPrompt, batch);
        for (const item of pending) {
          const zh = map.get(item.name);
          if (zh) {
            nameZh.set(item.id, zh);
          }
        }
        console.log(
          `  ✓ 名称批次 ${s / BATCH + 1}/${Math.ceil(fallbackNames.length / BATCH)}（${batch.length} 条）`,
        );
      }
    }
    console.log(
      `✓ 名称翻译：定名命中 ${overrideHits.length}｜LLM 兜底 ${fallbackNames.length}`,
    );

    // ---- 5. 教学内容四段深化翻译（批量主通道 + 单条兜底，逐行回写幂等续传）----
    const contentPending = namesOnly
      ? []
      : pending.filter(
          (i) => hasTeaching(i) && (force || !i.instructions_zh?.length),
        );
    const contentPrompt = buildContentSystemPrompt(
      renderGlossaryForPrompt(glossary),
    );
    console.log(
      `⋯ 教学内容翻译：${contentPending.length} 条（批 ${CONTENT_BATCH_SIZE} × 并发 ${CONTENT_CONCURRENCY}）`,
    );

    const failures: Array<{ name: string; error: string }> = [];
    let done = 0;
    let retriesUsed = 0;
    let singleFallbacks = 0;
    const usageTotal = { in: 0, out: 0 };
    let nameOnlyWritten = 0;
    let contentWritten = 0;

    // 名称锚定表（en → 定名中文；批量/单条通道共用）
    const anchorByName = new Map<string, string>();
    for (const item of contentPending) {
      const zh = nameZh.get(item.id) ?? item.name_zh;
      if (zh) {
        anchorByName.set(item.name, zh);
      }
    }

    // 翻译产物 → 结构化编码 → 契约校验 → Repository 回写
    async function writeTranslated(result: TranslatedExercise): Promise<void> {
      const instructionsZh = buildInstructionsZh({
        steps: result.steps,
        cues: result.cues,
        mistakes: result.mistakes,
        breathing: result.breathing,
      });
      const patch = ExerciseDetailUpdateSchema.parse({
        name_zh: anchorByName.get(result.name) ?? result.name_zh,
        instructions_zh: instructionsZh,
      });
      await repo.updateDetail(result.id, patch, "system");
      contentWritten++;
    }

    // 名称回填先行（不在内容翻译队列的行立即仅回填名称）
    const contentIds = new Set(contentPending.map((i) => i.id));
    for (const item of pending) {
      const zh = nameZh.get(item.id);
      if (!zh || contentIds.has(item.id)) {
        continue;
      }
      const patch = ExerciseDetailUpdateSchema.parse({ name_zh: zh });
      await repo.updateDetail(item.id, patch, "system");
      nameOnlyWritten++;
    }

    // 单条兜底（批量两轮未过项）
    async function fallbackSingle(input: TranslationInput): Promise<void> {
      singleFallbacks++;
      try {
        const { result, attempts, usage } = await translateExerciseContent(
          channel,
          contentPrompt,
          input,
          anchorByName.get(input.name) || undefined,
        );
        retriesUsed += attempts - 1;
        usageTotal.in += usage.in;
        usageTotal.out += usage.out;
        await writeTranslated(result);
      } catch (error) {
        failures.push({ name: input.name, error: (error as Error).message });
      }
    }

    const chunks: TranslationInput[][] = [];
    for (let s2 = 0; s2 < contentPending.length; s2 += CONTENT_BATCH_SIZE) {
      chunks.push(
        contentPending.slice(s2, s2 + CONTENT_BATCH_SIZE).map(toInput),
      );
    }
    const chunkQueue = [...chunks];
    async function worker(): Promise<void> {
      for (;;) {
        const chunk = chunkQueue.shift();
        if (!chunk) {
          return;
        }
        const batch = await translateExercisesBatch(
          channel,
          contentPrompt,
          chunk,
          anchorByName,
        );
        usageTotal.in += batch.usage.in;
        usageTotal.out += batch.usage.out;
        for (const result of batch.ok) {
          try {
            await writeTranslated(result);
          } catch (error) {
            failures.push({
              name: result.name,
              error: (error as Error).message,
            });
          }
          done++;
        }
        for (const input of batch.failed) {
          await fallbackSingle(input);
          done++;
        }
        if (done % 20 === 0 || done >= contentPending.length) {
          console.log(
            `  进度 ${done}/${contentPending.length}（失败 ${failures.length}｜兜底 ${singleFallbacks}）`,
          );
        }
      }
    }
    await Promise.all(
      Array.from({ length: CONTENT_CONCURRENCY }, () => worker()),
    );

    console.log(
      `✓ 回写：名称 ${nameOnlyWritten + contentWritten} 行（仅名称 ${nameOnlyWritten}｜含教学 ${contentWritten}）` +
        `｜单条兜底 ${singleFallbacks}｜对齐重试 ${retriesUsed} 次｜tokens ${usageTotal.in}/${usageTotal.out}`,
    );
    if (failures.length > 0) {
      console.error(
        `✗ 失败 ${failures.length} 条（重跑续传，已成功行不重翻）：`,
      );
      for (const f of failures.slice(0, 10)) {
        console.error(`  - ${f.name}: ${f.error.slice(0, 160)}`);
      }
    }

    // ---- 6. 抽检报告 ----
    if (reviewArg !== null || failures.length > 0) {
      const sampleSize =
        reviewArg === null || reviewArg === "" ? 20 : Number(reviewArg);
      const fresh = await repo.searchItems({});
      const translated = fresh.filter((i) => i.name_zh?.trim());
      if (translated.length > 0) {
        const report = renderReviewDoc(glossary, fresh, runIso, sampleSize);
        mkdirSync(dirname(REVIEW_DOC_PATH), { recursive: true });
        writeFileSync(REVIEW_DOC_PATH, report, "utf8");
        console.log(
          `✓ 抽检报告：${REVIEW_DOC_PATH}（样本 ${Math.min(sampleSize, translated.length)}）`,
        );
      }
    }
    console.log("\n=== 完成 ===");
    if (failures.length > 0) {
      process.exitCode = 2;
    }
  } finally {
    await closePostgresClient();
  }
}

// ============================================================================
// 抽检报告渲染（原文/译文/术语命中对比）
// ============================================================================

function pickSample(
  items: ExerciseLibraryItem[],
  size: number,
): ExerciseLibraryItem[] {
  const translated = items
    .filter((i) => i.name_zh?.trim())
    .sort((a, b) => a.name.localeCompare(b.name));
  if (translated.length <= size) {
    return translated;
  }
  const picked: ExerciseLibraryItem[] = [];
  const step = translated.length / size;
  for (let i = 0; i < size; i++) {
    picked.push(translated[Math.floor(i * step)]);
  }
  return picked;
}

function renderReviewDoc(
  glossary: TerminologyGlossary,
  items: ExerciseLibraryItem[],
  runIso: string,
  sampleSize: number,
): string {
  const translated = items.filter((i) => i.name_zh?.trim());
  const contentDone = translated.filter((i) => i.instructions_zh?.length);
  const withTeaching = items.filter(hasTeaching);

  const exactNames = translated.filter(
    (i) => checkNameOverrideHit(i.name, i.name_zh ?? "", glossary).exact,
  ).length;
  const overrideCovered = translated.filter(
    (i) => checkNameOverrideHit(i.name, i.name_zh ?? "", glossary).override,
  ).length;

  let hitTotal = 0;
  let missTotal = 0;
  const missByTerm = new Map<string, number>();
  for (const item of contentDone) {
    const source = [
      item.name,
      ...(item.instructions ?? []),
      ...(item.form_cues ?? []),
      ...(item.common_mistakes ?? []),
      item.breathing ?? "",
    ].join("\n");
    const target = [item.name_zh ?? "", ...(item.instructions_zh ?? [])].join(
      "\n",
    );
    const check = checkTermConsistency(source, target, glossary);
    hitTotal += check.hitCount;
    missTotal += check.missCount;
    for (const t of check.terms) {
      if (!t.hit) {
        missByTerm.set(t.en, (missByTerm.get(t.en) ?? 0) + 1);
      }
    }
  }

  const lines: string[] = [];
  lines.push("# A6 动作库翻译抽检报告（issue #19）");
  lines.push("");
  lines.push(`> 生成时间：${runIso}`);
  lines.push(
    `> 术语表：${glossary.entries.length} 条（通行／直译／存疑 = ` +
      `${glossary.entries.filter((e) => e.source === "通行").length}／` +
      `${glossary.entries.filter((e) => e.source === "直译").length}／` +
      `${glossary.entries.filter((e) => e.source === "存疑").length}）`,
  );
  lines.push("");
  lines.push("## 一、总体指标");
  lines.push("");
  lines.push(
    `- 公共库 ${items.length} 行；名称已译 **${translated.length}**；教学内容已译 **${contentDone.length}**／有教学字段 ${withTeaching.length}`,
  );
  if (overrideCovered > 0) {
    lines.push(
      `- 名称定名命中率：**${((exactNames / overrideCovered) * 100).toFixed(1)}%**（${exactNames}/${overrideCovered}，定名层覆盖内的名称逐字一致）`,
    );
  }
  lines.push(
    `- 正文术语命中率：**${hitTotal + missTotal > 0 ? ((hitTotal / (hitTotal + missTotal)) * 100).toFixed(1) : "—"}%**（${hitTotal}/${hitTotal + missTotal}；miss 为措辞重组警示，非硬错误）`,
  );
  lines.push("");

  // 存疑清单
  const doubtful = glossary.entries.filter((e) => e.source === "存疑");
  lines.push(
    `## 二、存疑译名清单（${doubtful.length} 条，不强行定名，待人工复核）`,
  );
  lines.push("");
  lines.push("| 英文 | 译名（暂用） | 备注 |");
  lines.push("| --- | --- | --- |");
  for (const e of doubtful) {
    lines.push(`| ${e.en} | ${e.zh} | ${e.note ?? "—"} |`);
  }
  lines.push("");

  // miss 集中术语
  if (missByTerm.size > 0) {
    const top = [...missByTerm.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15);
    lines.push("## 三、术语 miss 集中区（重写措辞漂移提示，人工复核优先看）");
    lines.push("");
    lines.push("| 术语 | 统一译名 | miss 次数 |");
    lines.push("| --- | --- | --- |");
    for (const [en, count] of top) {
      const entry = glossary.vocabulary.find((e) => e.en === en);
      lines.push(`| ${en} | ${entry?.zh ?? "—"} | ${count} |`);
    }
    lines.push("");
  }

  // 抽检样本
  const sample = pickSample(items, sampleSize);
  lines.push(`## 四、逐条抽检（${sample.length} 条，名称序均匀抽样）`);
  lines.push("");
  for (const item of sample) {
    lines.push(`### ${item.name} → ${item.name_zh}`);
    const nameCheck = checkNameOverrideHit(
      item.name,
      item.name_zh ?? "",
      glossary,
    );
    if (nameCheck.override) {
      lines.push(
        `- 定名：${nameCheck.exact ? "✅ 逐字一致" : `⚠️ 偏离定名「${nameCheck.override.zh}」`}`,
      );
    } else {
      lines.push(`- 定名：术语表未精确命中（LLM 兜底译名）`);
    }
    const zhSections = parseInstructionsZh(item.instructions_zh);
    if (item.instructions?.length && zhSections) {
      const pairCount = Math.min(3, item.instructions.length);
      for (let i = 0; i < pairCount; i++) {
        lines.push(`- 步骤${i + 1}原文：${item.instructions[i]}`);
        lines.push(`- 步骤${i + 1}译文：${zhSections.steps[i] ?? "（缺）"}`);
      }
      if (item.instructions.length > pairCount) {
        lines.push(
          `- ……（共 ${item.instructions.length} 步，步数对齐 ${zhSections.steps.length === item.instructions.length ? "✅" : `⚠️ ${zhSections.steps.length} 步`}）`,
        );
      }
      if (zhSections.cues.length > 0) {
        lines.push(`- 要领示例：${zhSections.cues[0]}`);
      }
      if (zhSections.mistakes.length > 0) {
        lines.push(`- 纠错示例：${zhSections.mistakes[0]}`);
      }
      if (zhSections.breathing) {
        lines.push(`- 呼吸：${zhSections.breathing}`);
      }
      const source = [
        item.name,
        ...(item.instructions ?? []),
        ...(item.form_cues ?? []),
        ...(item.common_mistakes ?? []),
        item.breathing ?? "",
      ].join("\n");
      const target = [item.name_zh ?? "", ...(item.instructions_zh ?? [])].join(
        "\n",
      );
      const check = checkTermConsistency(source, target, glossary);
      const missed = check.terms.filter((t) => !t.hit).map((t) => t.en);
      lines.push(
        `- 术语命中：${check.hitCount}/${check.hitCount + check.missCount}${missed.length > 0 ? `（miss：${missed.slice(0, 6).join("、")}）` : ""}`,
      );
    } else if (hasTeaching(item)) {
      lines.push(`- ⚠️ 有教学字段但 instructions_zh 未回填`);
    } else {
      lines.push(`- 无教学字段（库1 补充行，仅译名称）`);
    }
    lines.push("");
  }

  lines.push("## 五、复核口径说明");
  lines.push("");
  lines.push(
    "- 步骤译文为教学口径扩写（40-90 字/步），非逐字直译；对比时看语义覆盖与发力细节增量，不要求字面对应。",
  );
  lines.push(
    "- common_mistakes 采用「错误+纠正」纠错表述；breathing 为完整句。",
  );
  lines.push(
    "- miss 术语人工复核原则：若译文以更自然措辞表达了同一概念（如 press→推、raise→举），判定可接受；若概念缺失或错译，回改该条。",
  );
  lines.push(
    "- 存疑清单内译名为暂用口径，人工定名后更新 terminology-glossary.json 重跑对应行（--force --only）。",
  );
  lines.push("");
  return lines.join("\n");
}

main().catch((error) => {
  console.error("✗ 翻译失败：", error);
  process.exit(1);
});
