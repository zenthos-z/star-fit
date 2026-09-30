#!/usr/bin/env node
/**
 * gen-exercise-type-index.mjs — 技能知识索引同源生成（issue #88 分册1）
 *
 * 单一真源：shared/contracts/card-types.ts（5 大类 + 10 细类 + cardType
 * 两级体系）。本脚本把真源渲染成技能层按需读取的文档，改一处自动同步：
 *
 *   1. backend/src/services/mas/skills/exercise-type-guide/knowledge-index.md
 *      （整文件生成）
 *   2. 同目录 SKILL.md 的「动作类型规范」表格（BEGIN/END GENERATED 标记
 *      之间生成，标记外手写内容不动）
 *
 * 用法：
 *   cd shared && npm run build && cd .. && node scripts/gen-exercise-type-index.mjs
 *   node scripts/gen-exercise-type-index.mjs --check   # 只比对不写，漂移退出码 1
 *
 * 漂移守门：backend/src/services/agent/__tests__/exerciseTypeSync.test.ts
 * 以 --check 语义（import 本脚本的纯渲染函数 + 源码真源）断言磁盘文件
 * 与真源一致——改 card-types.ts 后忘记重新生成会红。
 *
 * 渲染函数设计为纯函数（defs 作参数注入）：CLI 模式从 shared/dist 加载
 * 真源，测试模式经 tsx 从 shared/contracts 源码加载，共享同一渲染实现，
 * 不产生第二套逻辑。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SKILL_DIR = path.join(
  REPO_ROOT,
  'backend/src/services/mas/skills/exercise-type-guide',
);
const INDEX_PATH = path.join(SKILL_DIR, 'knowledge-index.md');
const SKILL_PATH = path.join(SKILL_DIR, 'SKILL.md');

const TABLE_BEGIN = '<!-- BEGIN GENERATED: exercise-type-table (scripts/gen-exercise-type-index.mjs) -->';
const TABLE_END = '<!-- END GENERATED: exercise-type-table -->';

// ---------------------------------------------------------------------------
// 纯渲染函数（defs 注入，无 IO）
// ---------------------------------------------------------------------------

/**
 * @param {object} source card-types 单一真源子集：
 *   { EXERCISE_TYPE_VALUES, EXERCISE_TYPE_DEFS, CARD_MAJOR_TYPES,
 *     CARD_MAJOR_LABELS_ZH, cardTypeForExerciseType }
 */
export function renderKnowledgeIndex(source) {
  const { EXERCISE_TYPE_VALUES, EXERCISE_TYPE_DEFS, CARD_MAJOR_TYPES, CARD_MAJOR_LABELS_ZH, MAJOR_CARD_TYPES, cardTypeForExerciseType } = source;

  const header = `# 动作类型知识索引

> 本文件由 scripts/gen-exercise-type-index.mjs 从 shared/contracts/card-types.ts
> 生成（#88 分册1 类型单一真源），禁手改——改类型定义请改 card-types.ts
> 后重新生成。

## 快速参考表

| 细类 | 大类 | 名称 | cardType | 必需字段 | 典型场景 | 详细知识 |
|------|------|------|----------|----------|----------|----------|
`;

  const rows = renderIndexRows(EXERCISE_TYPE_VALUES, EXERCISE_TYPE_DEFS, cardTypeForExerciseType);

  const guide = `

## 使用指南

### 何时查询详细知识？

**建议查询**：
- 生成的计划中包含该类型动作
- 不确定该类型的参数设置
- 用户明确指定了训练目标

**无需查询**：
- 只是浏览动作列表
- 用户需求很明确且常见

### 按需读取示例（原生 read_file）

\`\`\`javascript
// 单个类型详细知识（~1000-2000 tokens）
read_file("/exercise-type-guide/knowledge/cardio.md")

// 轻量级索引（本文件，所有类型概要，~500 tokens）
read_file("/exercise-type-guide/knowledge-index.md")
\`\`\`

## 按大类分类（5 大类两级体系）

cardType = \`{major}_{variant}\`（如 resistance_standard、cardio_running），
为卡片分发键；细类为动作库/计划维度检索轴。
`;

  const groups = CARD_MAJOR_TYPES.map((major) => {
    const fines = EXERCISE_TYPE_VALUES.filter(
      (t) => EXERCISE_TYPE_DEFS[t].major === major,
    );
    const lines = fines.length
      ? fines.map(
          (t) =>
            `- **${t}** - ${EXERCISE_TYPE_DEFS[t].label_zh}：${EXERCISE_TYPE_DEFS[t].plan_required}`,
        )
      : [`- 无细类（仅动作/cardType 层有效，cardType = ${MAJOR_CARD_TYPES[major]}）`];
    return `### ${CARD_MAJOR_LABELS_ZH[major]}（${major}）\n${lines.join('\n')}\n`;
  }).join('\n');

  return header + rows + guide + '\n' + groups;
}

function renderIndexRows(EXERCISE_TYPE_VALUES, EXERCISE_TYPE_DEFS, cardTypeForExerciseType) {
  return EXERCISE_TYPE_VALUES.map((t) => {
    const def = EXERCISE_TYPE_DEFS[t];
    return `| ${t} | ${def.major} | ${def.label_zh} | ${cardTypeForExerciseType(t)} | ${def.plan_required} | ${def.scenario_zh} | read_file("/exercise-type-guide/knowledge/${t}.md") |`;
  }).join('\n');
}

/** SKILL.md 生成表格块（含 BEGIN/END 标记） */
export function renderSkillTableBlock(source) {
  const { EXERCISE_TYPE_VALUES, EXERCISE_TYPE_DEFS, cardTypeForExerciseType } = source;
  const header =
    '| 类型 | 大类 | 名称 | cardType | 必需字段 | 可选字段 | 典型示例 |\n' +
    '| -------------- | ------ | -------- | ---------- | ---------- | -------- | --------------------- |';
  const rows = EXERCISE_TYPE_VALUES.map((t) => {
    const def = EXERCISE_TYPE_DEFS[t];
    return `| \`${t}\` | ${def.major} | ${def.label_zh} | \`${cardTypeForExerciseType(t)}\` | ${def.plan_required} | ${def.plan_optional} | ${def.example} |`;
  }).join('\n');
  return `${TABLE_BEGIN}\n${header}\n${rows}\n${TABLE_END}`;
}

/** 用生成的表格块替换 SKILL.md 标记区间（标记外内容原样保留） */
export function applySkillTable(skillMd, block) {
  const begin = skillMd.indexOf(TABLE_BEGIN);
  const end = skillMd.indexOf(TABLE_END);
  if (begin === -1 || end === -1) {
    throw new Error(`SKILL.md 缺少生成标记（${TABLE_BEGIN.slice(5, 60)}…）`);
  }
  return (
    skillMd.slice(0, begin) + block + skillMd.slice(end + TABLE_END.length)
  );
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function loadSource() {
  const dist = path.join(REPO_ROOT, 'shared/dist/contracts/card-types.js');
  if (!fs.existsSync(dist)) {
    console.error(
      `[gen-exercise-type-index] 缺少 ${dist}——先执行：cd shared && npm run build`,
    );
    process.exit(2);
  }
  const mod = await import(pathToFileURL(path.resolve(dist)).href);
  return mod;
}

async function main() {
  const check = process.argv.includes('--check');
  const source = await loadSource();

  const indexMd = renderKnowledgeIndex(source);
  const skillMd = fs.readFileSync(SKILL_PATH, 'utf8');
  const skillOut = applySkillTable(skillMd, renderSkillTableBlock(source));

  let drift = false;
  const currentIndex = fs.readFileSync(INDEX_PATH, 'utf8');
  if (currentIndex !== indexMd) {
    drift = true;
    console.error('[gen-exercise-type-index] knowledge-index.md 与真源漂移');
    if (!check) fs.writeFileSync(INDEX_PATH, indexMd);
  }
  if (skillMd !== skillOut) {
    drift = true;
    console.error('[gen-exercise-type-index] SKILL.md 类型表与真源漂移');
    if (!check) fs.writeFileSync(SKILL_PATH, skillOut);
  }

  if (check) {
    if (drift) {
      console.error(
        '[gen-exercise-type-index] --check 失败：请运行 node scripts/gen-exercise-type-index.mjs 重新生成',
      );
      process.exit(1);
    }
    console.log('[gen-exercise-type-index] --check 通过：技能知识文档与真源一致');
  } else {
    console.log(
      drift
        ? '[gen-exercise-type-index] 已重新生成（knowledge-index.md / SKILL.md 表格）'
        : '[gen-exercise-type-index] 无漂移，文件未改动',
    );
  }
}

// 被 import 时不执行 CLI（测试走纯渲染函数）
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
