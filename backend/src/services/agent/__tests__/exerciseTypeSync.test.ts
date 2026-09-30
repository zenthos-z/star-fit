/**
 * exerciseTypeSync — 技能知识文档 ↔ card-types 单一真源 漂移守门
 * （W2 / issue #88 分册1：类型体系统一）
 *
 * 真源：shared/contracts/card-types.ts（5 大类 + 10 细类 + cardType 两级
 * 体系）。技能层 exercise-type-guide 的 knowledge-index.md（整文件）与
 * SKILL.md 类型表由 scripts/gen-exercise-type-index.mjs 生成；本测试用
 * 同一渲染实现（import 脚本的纯渲染函数 + 源码真源）比对磁盘文件，
 * 改真源后忘记重新生成会红：
 *
 *   cd shared && npm run build && cd .. && node scripts/gen-exercise-type-index.mjs
 *
 * 与 skillLoader.test.ts 的 GOLD_SNAPSHOT 互补：那边冻结字节哈希防意外
 * 编辑，这边对齐真源防「改一处没同步」。
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  EXERCISE_TYPE_VALUES,
  EXERCISE_TYPE_DEFS,
  CARD_MAJOR_TYPES,
  CARD_MAJOR_LABELS_ZH,
  MAJOR_CARD_TYPES,
  cardTypeForExerciseType,
} from "shared/contracts";

import {
  renderKnowledgeIndex,
  renderSkillTableBlock,
  applySkillTable,
} from "../../../../../scripts/gen-exercise-type-index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(
  __dirname,
  "../../mas/skills/exercise-type-guide",
);

const source = {
  EXERCISE_TYPE_VALUES,
  EXERCISE_TYPE_DEFS,
  CARD_MAJOR_TYPES,
  CARD_MAJOR_LABELS_ZH,
  MAJOR_CARD_TYPES,
  cardTypeForExerciseType,
};

describe("exercise-type-guide 同源生成守门（#88 分册1）", () => {
  it("knowledge-index.md 与 card-types 真源一致（漂移→重新生成）", () => {
    const onDisk = fs.readFileSync(
      path.join(SKILL_DIR, "knowledge-index.md"),
      "utf8",
    );
    assert.equal(
      onDisk,
      renderKnowledgeIndex(source),
      "knowledge-index.md 与真源漂移：运行 node scripts/gen-exercise-type-index.mjs 重新生成",
    );
  });

  it("SKILL.md 类型表与 card-types 真源一致（漂移→重新生成）", () => {
    const onDisk = fs.readFileSync(path.join(SKILL_DIR, "SKILL.md"), "utf8");
    const expected = applySkillTable(onDisk, renderSkillTableBlock(source));
    assert.equal(
      onDisk,
      expected,
      "SKILL.md 类型表与真源漂移：运行 node scripts/gen-exercise-type-index.mjs 重新生成",
    );
  });

  it("每个细类的 knowledge/{fine}.md 知识文件存在（细类全集 ↔ 文件名同源）", () => {
    for (const fine of EXERCISE_TYPE_VALUES) {
      const p = path.join(SKILL_DIR, "knowledge", `${fine}.md`);
      assert.ok(fs.existsSync(p), `缺知识文件：knowledge/${fine}.md`);
    }
    // 反向：知识目录无多余细类文件（多出来的文件不会被真源枚举到）
    const files = fs
      .readdirSync(path.join(SKILL_DIR, "knowledge"))
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""))
      .sort();
    assert.deepEqual(
      files,
      [...EXERCISE_TYPE_VALUES].sort(),
      "knowledge/ 目录存在细类全集之外的文件——新增类型请先入 card-types 真源",
    );
  });
});
