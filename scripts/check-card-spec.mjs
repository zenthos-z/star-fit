#!/usr/bin/env node
/**
 * check-card-spec.mjs — 卡片规范手册守门脚本（issue #88 手册批：分册2+4+5）
 *
 * 两类机器核验（v2 spec 验收锚点）：
 *   1. 字段清单对拍：docs/card-spec/ 各页 spec:fields 块 vs shared/contracts
 *      （及 backend 校验 schema）真源；细类占位页 spec:fine 表 vs
 *      card-types.ts EXERCISE_TYPE_DEFS。不一致退出码 1。
 *   2. 示例 JSON 校验：抽取各页 spec:example 块，经 tsx 调用真实校验器
 *      （uiHintValidator / contracts Zod）实际解析。校验失败退出码 1。
 *
 * 页内标记约定（markdown 注释，渲染不可见）：
 *   <!-- spec:fields id="唯一" expect="真源名" --> …字段表… <!-- /spec:fields -->
 *   <!-- spec:example id="唯一" validator="uiHint|exerciseAction|workoutSession|hrSample|hrBatch|none" -->
 *     ```json …``` （未标记的 json 块视为违规——示例必须声明校验器）
 *   <!-- /spec:example -->
 *   <!-- spec:fine type="细类" --> …派发表… <!-- /spec:fine -->
 *
 * 用法：node scripts/check-card-spec.mjs   （仓库根目录）
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SPEC_DIR = path.join(REPO_ROOT, 'docs/card-spec');

const FINE_TYPES = [
  'resistance', 'unilateral', 'bodyweight', 'assisted', 'isometric',
  'cardio', 'flexibility', 'heavy_weight', 'rep_training', 'outdoor',
];

const REQUIRED_FILES = [
  'README.md',
  'agent-consumption.md',
  'data-collection.md',
  'templates/card-spec-template.md',
  'resistance_standard.md',
  'cardio_running.md',
  ...FINE_TYPES.map((t) => `fine/${t}.md`),
];

// 实现校验器的真源模块（tsx 加载，见 buildHelperSource）
const KNOWN_EXPECTS = new Set([
  'ExercisePlanSchema',   // backend uiHintSchemas：plan_card data 行字段
  'UIHintPlanCard',       // backend uiHintSchemas：plan_card 卡级外层键
  'ExerciseActionSets',   // shared/contracts：ExerciseAction.sets 组字段
  'HeartRateSample',      // shared/contracts：心率样本字段
  'SessionExerciseEntry', // 格式化训练条目（双端文本对拍：workoutSummary ↔ sessionController）
]);
const KNOWN_VALIDATORS = new Set([
  'uiHint', 'exerciseAction', 'workoutSession', 'hrSample', 'hrBatch', 'none',
]);

// ---------------------------------------------------------------------------
// markdown 解析（纯函数）
// ---------------------------------------------------------------------------

/** 递归收集 docs/card-spec 下全部 md 文件（相对 SPEC_DIR 路径） */
function collectPages() {
  const out = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.isFile() && ent.name.endsWith('.md')) out.push(p);
    }
  };
  walk(SPEC_DIR);
  return out.map((p) => path.relative(SPEC_DIR, p));
}

/** 成对标记块提取：返回 {id, attrs, body, start, end}[] */
function extractBlocks(text, tag) {
  const openRe = new RegExp(`<!--\\s*${tag}\\s+([^>]*)-->`, 'g');
  const blocks = [];
  let m;
  while ((m = openRe.exec(text)) !== null) {
    const closeIdx = text.indexOf(`<!-- /${tag} -->`, m.index);
    if (closeIdx === -1) {
      blocks.push({ attrs: m[1], body: '', start: m.index, end: text.length, unclosed: true });
      break;
    }
    const body = text.slice(openRe.lastIndex, closeIdx);
    blocks.push({
      attrs: m[1],
      body,
      start: m.index,
      end: closeIdx + `<!-- /${tag} -->`.length,
      unclosed: false,
    });
    openRe.lastIndex = closeIdx;
  }
  for (const b of blocks) {
    b.id = attr(b.attrs, 'id') ?? attr(b.attrs, 'type') ?? '';
    b.expect = attr(b.attrs, 'expect') ?? '';
    b.validator = attr(b.attrs, 'validator') ?? '';
    b.type = attr(b.attrs, 'type') ?? '';
  }
  return blocks;
}

function attr(str, name) {
  const m = new RegExp(`${name}="([^"]*)"`).exec(str);
  return m ? m[1] : null;
}

/** 从标记块 body 提取字段名：表格首列反引号 token + 列表行首反引号 token */
function extractFieldTokens(body) {
  const tokens = [];
  const seen = new Set();
  const push = (t) => {
    if (t && !seen.has(t)) { seen.add(t); tokens.push(t); }
  };
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('|')) {
      const cells = line.split('|').slice(1, -1);
      if (cells.length === 0) continue;
      const first = cells[0].trim();
      if (/^[-: ]+$/.test(first)) continue; // 分隔行
      if (first.length === 0) continue;
      for (const t of first.match(/`([^`]+)`/g) ?? []) push(t.slice(1, -1));
    } else if (line.startsWith('- `')) {
      for (const t of line.match(/`([^`]+)`/g) ?? []) push(t.slice(1, -1));
    }
  }
  return tokens;
}

/** spec:fine 表：提取数据行 5 列反引号值 */
function extractFineRow(body) {
  const lines = body.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|'));
  const data = lines.filter((l) => !/\|[-: ]+\|/.test(l)); // 去分隔行
  // 数据行 = 非表头（首列不是「细类」）
  const row = data.find((l) => {
    const first = l.split('|')[1] ?? '';
    return !first.includes('细类');
  });
  if (!row) return null;
  const cells = row.split('|').slice(1, -1).map((c) => {
    const m = /`([^`]+)`/.exec(c.trim());
    return m ? m[1] : c.trim();
  });
  return { fine: cells[0], major: cells[1], cardType: cells[2], required: cells[3], optional: cells[4] };
}

/** 提取 ```json 围栏及其全文位置（供未标记块检查） */
function extractJsonFences(text) {
  const fences = [];
  const re = /```json\r?\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    fences.push({ body: m[1], start: m.index, end: m.index + m[0].length });
  }
  return fences;
}

// ---------------------------------------------------------------------------
// 静态检查（不需真源）
// ---------------------------------------------------------------------------

const problems = [];
const note = (msg) => problems.push(msg);

function staticChecks(pages) {
  // 1. 文件齐全
  const pageSet = new Set(pages);
  for (const f of REQUIRED_FILES) {
    if (!pageSet.has(f)) note(`[完整性] 缺文件 docs/card-spec/${f}`);
  }

  // 2. 每页标记解析 + 未标记 json 围栏
  const manifest = { fields: [], fine: [], examples: [] };
  for (const page of pages) {
    const text = fs.readFileSync(path.join(SPEC_DIR, page), 'utf8');
    const fields = extractBlocks(text, 'spec:fields');
    const examples = extractBlocks(text, 'spec:example');
    const fine = extractBlocks(text, 'spec:fine');

    for (const b of fields) {
      if (b.unclosed) note(`[${page}] spec:fields id="${b.id}" 缺闭合标记`);
      if (!b.id) note(`[${page}] spec:fields 缺 id 属性`);
      if (!KNOWN_EXPECTS.has(b.expect)) {
        note(`[${page}] spec:fields id="${b.id}" expect="${b.expect}" 不是已实现真源`);
      }
      manifest.fields.push({
        page, id: b.id, expect: b.expect, tokens: extractFieldTokens(b.body),
      });
    }

    for (const b of examples) {
      if (b.unclosed) note(`[${page}] spec:example id="${b.id}" 缺闭合标记`);
      if (!b.id) note(`[${page}] spec:example 缺 id 属性`);
      if (!KNOWN_VALIDATORS.has(b.validator)) {
        note(`[${page}] spec:example id="${b.id}" validator="${b.validator}" 不是已实现校验器`);
      }
      const fences = extractJsonFences(b.body);
      if (fences.length !== 1) {
        note(`[${page}] spec:example id="${b.id}" 应恰含 1 个 json 围栏（实际 ${fences.length}）`);
        continue;
      }
      manifest.examples.push({
        page, id: b.id, validator: b.validator, json: fences[0].body,
      });
    }

    for (const b of fine) {
      if (b.unclosed) note(`[${page}] spec:fine type="${b.type}" 缺闭合标记`);
      const row = extractFineRow(b.body);
      if (!row) { note(`[${page}] spec:fine 解析不到数据行`); continue; }
      if (row.fine !== b.type) note(`[${page}] spec:fine type="${b.type}" 表行细类 "${row.fine}" 不一致`);
      manifest.fine.push({ page, ...row });
    }

    // 未标记 json 围栏 = 违规（示例必须声明校验器）
    const covered = [...fields, ...examples, ...fine];
    for (const f of extractJsonFences(text)) {
      const inside = covered.some((b) => f.start >= b.start && f.end <= b.end);
      if (!inside) note(`[${page}] 存在未标记的 json 围栏（示例块必须加 spec:example + validator）`);
    }
  }

  // 3. 规范卡硬性内容
  const specCardPages = ['templates/card-spec-template.md', 'resistance_standard.md', 'cardio_running.md'];
  for (const p of specCardPages) {
    const fp = path.join(SPEC_DIR, p);
    if (!fs.existsSync(fp)) continue;
    const text = fs.readFileSync(fp, 'utf8');
    if (!text.includes('不设降级路径')) note(`[${p}] 缺「无兜底」显式声明（不设降级路径）`);
    if (!manifest.examples.some((e) => e.page === p && e.validator === 'uiHint')) {
      note(`[${p}] 缺 validator="uiHint" 的示例（每页规范卡示例 JSON 必须实际过 uiHintValidator）`);
    }
  }
  const readme = fs.existsSync(path.join(SPEC_DIR, 'README.md'))
    ? fs.readFileSync(path.join(SPEC_DIR, 'README.md'), 'utf8') : '';
  for (const redline of ['数据窄、前端宽', '不兜底', '无缺漏无错误']) {
    if (!readme.includes(redline)) note(`[README.md] 三红线缺失：「${redline}」`);
  }

  // 4. 细类占位页齐全性 + 唯一性
  const finePages = manifest.fine.filter((f) => f.page.startsWith('fine/'));
  const byFine = new Map();
  for (const f of finePages) {
    if (byFine.has(f.fine)) note(`[fine/] 细类 ${f.fine} 有多张占位页`);
    byFine.set(f.fine, f);
  }
  for (const t of FINE_TYPES) {
    if (!byFine.has(t)) note(`[完整性] 细类 ${t} 缺占位页`);
  }

  return manifest;
}

// ---------------------------------------------------------------------------
// tsx 真源核验（加载 shared/contracts 与 backend 校验器）
// ---------------------------------------------------------------------------

function buildHelperSource(rootUrl) {
  return `
import fs from "node:fs";
import { validateUiHint } from "${rootUrl}/backend/src/services/agent/uiHintValidator.ts";
import { ExercisePlanSchema, UIHintSchema } from "${rootUrl}/backend/src/services/agent/schemas/uiHintSchemas.ts";
import {
  ExerciseActionSchema,
  HeartRateSampleSchema,
  HeartRateSamplesBatchSchema,
  WorkoutSessionSchema,
} from "${rootUrl}/shared/contracts/index.ts";
import {
  EXERCISE_TYPE_DEFS,
  EXERCISE_TYPE_VALUES,
  cardTypeForExerciseType,
} from "${rootUrl}/shared/contracts/card-types.ts";

const shapeKeys = (schema) => Object.keys(schema.shape ?? {});
const setElement = (schema) => {
  const sets = schema.shape.sets;
  const el = sets._def.element ?? sets._def.type;
  return Object.keys(el.shape ?? {});
};
const planCardOption = () => {
  for (const opt of UIHintSchema.options ?? []) {
    const lit = opt.shape?.type?._def;
    const val = lit?.value ?? (Array.isArray(lit?.values) ? lit.values[0] : undefined);
    if (val === "plan_card") return Object.keys(opt.shape);
  }
  return null;
};

// SessionExerciseEntry：双端文本对拍（前端接口 ↔ 后端 z.object）
const textKeys = (file, anchor, endAnchor) => {
  const src = fs.readFileSync(file, "utf8");
  const start = src.indexOf(anchor);
  if (start === -1) return null;
  const end = src.indexOf(endAnchor, start);
  const body = src.slice(start, end === -1 ? undefined : end);
  const keys = [];
  for (const line of body.split("\\n")) {
    const m = /^\\s{2,}(\\w+)\\??\\s*:/.exec(line);
    if (m && !keys.includes(m[1])) keys.push(m[1]);
  }
  return keys;
};

const ROOT = ${JSON.stringify(pathToFileURL(REPO_ROOT).pathname)};
const feKeys = textKeys(
  ROOT + "/src/utils/workoutSummary.ts",
  "export interface FormattedExerciseEntry",
  "}",
);
const beKeys = textKeys(
  ROOT + "/backend/src/controllers/sessionController.ts",
  "const ExerciseEntrySchema = z.object({",
  "});",
);
if (!feKeys || !beKeys) {
  console.log(JSON.stringify({ fatal: "SessionExerciseEntry 双端锚点解析失败（源文件结构变更？）" }));
  process.exit(0);
}
// 双端对齐纪律：前端产出接口必须是后端 API schema 的子集（metadata 透传字段除外）
const beSet = new Set(beKeys);
const feExtra = feKeys.filter((k) => !beSet.has(k));
if (feExtra.length > 0) {
  console.log(JSON.stringify({ fatal: \`workoutSummary.ts 条目字段 [\${feExtra}] 不在 sessionController ExerciseEntrySchema 中——双端漂移\` }));
  process.exit(0);
}

const resolvers = {
  ExercisePlanSchema: () => shapeKeys(ExercisePlanSchema),
  UIHintPlanCard: () => planCardOption(),
  ExerciseActionSets: () => setElement(ExerciseActionSchema),
  HeartRateSample: () => shapeKeys(HeartRateSampleSchema),
  SessionExerciseEntry: () => beKeys,
};

const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const out = { fields: [], fine: [], examples: [], fatal: null };

for (const f of manifest.fields) {
  const expected = resolvers[f.expect]?.();
  if (!expected) {
    out.fields.push({ ...f, ok: false, problem: \`expect="\${f.expect}" 无解析器\` });
    continue;
  }
  const exp = [...expected].sort();
  const got = [...f.tokens].sort();
  const ok = exp.length === got.length && exp.every((v, i) => v === got[i]);
  out.fields.push({
    page: f.page, id: f.id, ok,
    missing: exp.filter((v) => !got.includes(v)),
    extra: got.filter((v) => !exp.includes(v)),
  });
}

const defsByFine = Object.fromEntries(
  EXERCISE_TYPE_VALUES.map((t) => [t, {
    major: EXERCISE_TYPE_DEFS[t].major,
    cardType: cardTypeForExerciseType(t),
    required: EXERCISE_TYPE_DEFS[t].plan_required,
    optional: EXERCISE_TYPE_DEFS[t].plan_optional,
  }]),
);
for (const f of manifest.fine) {
  const truth = defsByFine[f.fine];
  if (!truth) {
    out.fine.push({ page: f.page, fine: f.fine, ok: false, problem: "细类不在 EXERCISE_TYPE_VALUES" });
    continue;
  }
  const diffs = [];
  if (f.major !== truth.major) diffs.push(\`major: 文档=\${f.major} 真源=\${truth.major}\`);
  if (f.cardType !== truth.cardType) diffs.push(\`cardType: 文档=\${f.cardType} 真源=\${truth.cardType}\`);
  if (f.required !== truth.required) diffs.push(\`必需字段: 文档=\${f.required} 真源=\${truth.required}\`);
  if (f.optional !== truth.optional) diffs.push(\`可选字段: 文档=\${f.optional} 真源=\${truth.optional}\`);
  out.fine.push({ page: f.page, fine: f.fine, ok: diffs.length === 0, problem: diffs.join("; ") || null });
}

const validators = {
  uiHint: (v) => {
    const r = validateUiHint(v);
    return r.ok ? null : r.errors.map((e) => \`\${e.path.join(".")}: \${e.message}\`).join(" | ");
  },
  exerciseAction: (v) => {
    const r = ExerciseActionSchema.safeParse(v);
    return r.success ? null : JSON.stringify(r.error.issues.map((i) => \`\${i.path.join(".")}: \${i.message}\`));
  },
  workoutSession: (v) => {
    const r = WorkoutSessionSchema.safeParse(v);
    return r.success ? null : JSON.stringify(r.error.issues.map((i) => \`\${i.path.join(".")}: \${i.message}\`));
  },
  hrSample: (v) => {
    const r = HeartRateSampleSchema.safeParse(v);
    return r.success ? null : JSON.stringify(r.error.issues.map((i) => \`\${i.path.join(".")}: \${i.message}\`));
  },
  hrBatch: (v) => {
    const r = HeartRateSamplesBatchSchema.safeParse(v);
    return r.success ? null : JSON.stringify(r.error.issues.map((i) => \`\${i.path.join(".")}: \${i.message}\`));
  },
  none: () => null,
};

for (const e of manifest.examples) {
  let v;
  try {
    v = JSON.parse(e.json);
  } catch (err) {
    out.examples.push({ page: e.page, id: e.id, validator: e.validator, ok: false, problem: \`JSON 解析失败: \${err.message}\` });
    continue;
  }
  const problem = validators[e.validator]?.(v);
  out.examples.push({ page: e.page, id: e.id, validator: e.validator, ok: problem == null, problem: problem ?? null });
}

console.log(JSON.stringify(out));
`;
}

function runTruthChecks(manifest) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'card-spec-'));
  const manifestPath = path.join(tmp, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const helperPath = path.join(tmp, 'helper.ts');
  fs.writeFileSync(helperPath, buildHelperSource(pathToFileURL(REPO_ROOT).href.replace(/\/$/, '')));

  const tsxBin = path.join(REPO_ROOT, 'node_modules/.bin/tsx');
  const tsconfig = path.join(REPO_ROOT, 'backend/tsconfig.json');
  const proc = spawnSync(tsxBin, ['--tsconfig', tsconfig, helperPath, manifestPath], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (proc.error) {
    note(`[真源核验] tsx 启动失败：${proc.error.message}`);
    return null;
  }
  if (proc.status !== 0) {
    note(`[真源核验] tsx 退出码 ${proc.status}\n${proc.stderr}`);
    return null;
  }
  const line = proc.stdout.trim().split('\n').pop();
  try {
    return JSON.parse(line);
  } catch {
    note(`[真源核验] 结果解析失败：${line?.slice(0, 400)}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

const pages = collectPages();
const manifest = staticChecks(pages);
const truth = runTruthChecks(manifest);

let fieldsOk = 0; let fieldsTotal = 0;
let fineOk = 0; let fineTotal = 0;
let examplesOk = 0; let examplesTotal = 0;

if (truth) {
  if (truth.fatal) note(`[真源核验] ${truth.fatal}`);
  for (const f of truth.fields ?? []) {
    fieldsTotal++;
    if (f.ok) { fieldsOk++; continue; }
    const miss = f.missing?.length ? ` 缺[${f.missing.join(',')}]` : '';
    const ext = f.extra?.length ? ` 多[${f.extra.join(',')}]` : '';
    note(`[对拍] ${f.page} spec:fields id="${f.id}" 与真源不一致${miss}${ext}${f.problem ? `（${f.problem}）` : ''}`);
  }
  for (const f of truth.fine ?? []) {
    fineTotal++;
    if (f.ok) { fineOk++; continue; }
    note(`[对拍] ${f.page} 细类 ${f.fine} 派发表与 EXERCISE_TYPE_DEFS 不一致：${f.problem ?? ''}`);
  }
  for (const e of truth.examples ?? []) {
    examplesTotal++;
    if (e.ok) { examplesOk++; continue; }
    note(`[示例] ${e.page} spec:example id="${e.id}"（${e.validator}）校验失败：${e.problem ?? ''}`);
  }
}

console.log(`docs/card-spec 页面：${pages.length}`);
console.log(`字段清单对拍：${fieldsOk}/${fieldsTotal} 过`);
console.log(`细类派发对拍：${fineOk}/${fineTotal} 过`);
console.log(`示例 JSON 校验：${examplesOk}/${examplesTotal} 过`);

if (problems.length > 0) {
  console.error(`\n失败 ${problems.length} 项：`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log('\nPASS：手册与 shared/contracts 真源一致，示例 JSON 全部通过校验');
process.exit(0);
