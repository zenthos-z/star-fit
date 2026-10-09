/**
 * skillLoader unit tests (R5).
 *
 * Runner: node:test via tsx — same convention as the other agent __tests__.
 *   npx tsx --test backend/src/services/agent/__tests__/skillLoader.test.ts
 *
 * Covers the deterministic, no-infra-required acceptance criteria:
 *  - B1 (native mount, no MAS runtime): source-level grep of skillLoader.ts
 *    must hit ZERO for SkillDiscovery/SkillsMiddleware/loadSkillTool, and must
 *    import the native deepagents Skill/filesystem API.
 *  - B2 (GOLD read-only, P008 golden-master): every GOLD knowledge file on disk
 *    matches a frozen SHA256 snapshot — locks byte-level consistency without
 *    eyeballing a diff.
 *  - B3 (generic mount): loadAllSkills mounts every skill dir under mas/skills
 *    (the GOLD three + fitness-data-tools), deterministically sorted.
 *  - B4 (Filesystem on-demand read, no mock — A018/L100): the REAL
 *    FilesystemBackend from the native mount returns the REAL knowledge.md
 *    content for a plan descriptor's readPath (the agent reads on demand, not
 *    from a stuffed prompt). The live-LLM half of B4 lives in the probe.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

import {
  loadAllSkills,
  mountAllSkills,
  toDeepAgentSkillMount,
  allKnowledgeFiles,
  discoverNativeSkills,
  SKILLS_BACKEND_ROOT,
  type SkillDescriptor,
} from "../skillLoader.js";

// ---------------------------------------------------------------------------
// B2 — frozen SHA256 golden-master of the GOLD knowledge files (P008).
// Keyed by POSIX path relative to the skills root (= readPath without leading /).
// If a GOLD file changes, this snapshot fails LOUD — R5 must not edit GOLD.
// Deliberate knowledge evolution (task-driven, NOT loader drift) must update
// the snapshot hash here in the same change set.  History:
//   2026-09-26  plan-generation/knowledge.md 3.1.0 → 4.0.0 (E3/issue #2:
//               weekly-plan generation mode; section 11 added)
//   2026-09-28  plan-generation knowledge 5.0 rewrite (#41, B5b) — snapshot
//               refreshed in 42c (42b had left it red); 2026-09-29 42c split:
//               knowledge.md slimmed + knowledge/{novice-starting,
//               volume-progression,injury-adjustment}.md added
//   2026-09-29  plan-generation knowledge 5.3.0 (T2/issue #54): §1.4 选动作
//               工具链 find_exercises（≤3 次收敛）+ id 真源表述同步——SHA 按
//               磁盘实值重算（42c 教训）
//   2026-09-30  plan-generation knowledge 5.4.0 (T9/issue #66): §9.3 结构化
//               四件套模板（day_focus/rationale/category/sets 逐组处方）+
//               §11.1 粒度判定表自 SKILL.md 迁入——SHA 按磁盘实值重算
//   2026-09-30  plan-generation knowledge 5.4.1 (T9 剧本回放返工): §9.3 增
//               「思考不预写出卡内容 / 出卡轮零工具」防膨胀要点（回放实测
//               卡片随工具轮消息被流层吞进思考）——SHA 按磁盘实值重算
//   2026-09-30  exercise-type-guide/knowledge-index.md 重生成（W2/#88 分册1
//               类型体系统一：单一真源 shared/contracts/card-types.ts，
//               scripts/gen-exercise-type-index.mjs 生成）——SHA 按磁盘实值重算
//   2026-10-03  plan-generation knowledge 5.5.0 (#114 B5c)：§11.1 前置门槛
//               收敛共享题库（purpose=profile_intake/plan_gap + 题库 id 映射
//               表）；novice-starting §3.2.0 门禁表加题库 id 列——SHA 按
//               磁盘实值重算
//   2026-10-08  plan-generation knowledge 6.0.0 (#151 S3 技能瘦身)：§9.3
//               周计划首选模板实例化路径（pick_template →
//               instantiate_weekly_plan → submit_weekly_plan）；§9.1/§9.3
//               示例卡 JSON 删除（#73 复述源 + #136 伪造 id 示例源治理，
//               字段契约单一真源 = data-schema 技能）——SHA 按磁盘实值重算
//   2026-10-09  plan-generation knowledge (#151 S4 围栏指令退役)：§9.3 删
//               「通道为 fence 回滚位」与「围栏通道下出卡消息不得携带
//               tool_calls」围栏残余；§11.1 问卷轮交付改 submit_survey 工具
//               调用（survey_card 围栏输出指令零残留 grep 门）——SHA 按
//               磁盘实值重算
// ---------------------------------------------------------------------------
const GOLD_SNAPSHOT: Record<string, string> = {
  "exercise-type-guide/knowledge-index.md":
    "8fca328c6186d9b9ab3598a70601edc51dafba281aa097c6c9df54087ccef4ad",
  "exercise-type-guide/knowledge/assisted.md":
    "78e5a44d2fd374b4d0781e8797af40e86827ce081ff20bbd75ea0b2813e8bbda",
  "exercise-type-guide/knowledge/bodyweight.md":
    "b0cb41dffc8ac171ea867d223a60d2683bad124063afbc476fa42280d907e9eb",
  "exercise-type-guide/knowledge/cardio.md":
    "6a50bc47b49789248c5f6f1ae43eba3c12a69b85e6c60aea24549ef92f6fb87a",
  "exercise-type-guide/knowledge/flexibility.md":
    "11f1dbbddff3f9751b089557d965049828499d01e8ef8c6b42b348a831c1a55c",
  "exercise-type-guide/knowledge/heavy_weight.md":
    "887181d5d035b56f9ed2da104fdb863be9354619932b7ea5d7b26e97de744f09",
  "exercise-type-guide/knowledge/isometric.md":
    "3b549d4ad76de52ab644f2bb64e177017d4fddbc91dbd8fa0d3bd7a99e63d2c7",
  "exercise-type-guide/knowledge/outdoor.md":
    "66030276c0aad404829fb83f8068b16cb31ba5309ce99fab9c1b497547549411",
  "exercise-type-guide/knowledge/rep_training.md":
    "64c15946b4ada481ff5cfcfbbcee94a6f69d6e44dbc4cb8015351cd05f315924",
  "exercise-type-guide/knowledge/resistance.md":
    "d0ff799068ca2747eb762495aae5f5ecd0494b3f20329d310188664d52b7403a",
  "exercise-type-guide/knowledge/unilateral.md":
    "de7d5b00f5f2146c3bae79c7063bfb01a17698174f0944cbb982394b7972a4a2",
  "plan-generation/knowledge.md":
    "99d8d56240a08cdb09f5d661d58507262a093580bd1d7486bce147f1d1cf55a6",
  "plan-generation/knowledge/injury-adjustment.md":
    "d556d96744b2cea9404dd88a085454729ec6ce4e3060712b662692f8ff269e0a",
  "plan-generation/knowledge/novice-starting.md":
    "847a375799c8375da695ff1ce24636c3519846c73d16358fc88f28129508b642",
  "plan-generation/knowledge/volume-progression.md":
    "10d70dc7b3a974860aab5ec02c2dbeed649a3c02662a2dcce4703d546cf0b5bb",
  "strength-training-designer/knowledge/non-big-three-guide.md":
    "2cfc4569bf8ee7adf99dd7f4a946e17f2be00c59e6c8989d6f2ed8b3b2320a82",
};

function sha256(absPath: string): string {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(absPath))
    .digest("hex");
}

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_LOADER_SRC = fs.readFileSync(
  path.resolve(TEST_DIR, "..", "skillLoader.ts"),
  "utf-8",
);

// ---------------------------------------------------------------------------
// B1 — native mount, MAS runtime dropped
// ---------------------------------------------------------------------------

describe("skillLoader — B1 native mount (no MAS runtime)", () => {
  it("does not import the MAS skill runtime (SkillDiscovery/SkillsMiddleware/loadSkillTool)", () => {
    // L010: a source-level grep that must hit 0. We check import lines.
    const importLines = SKILL_LOADER_SRC.split("\n").filter((l) =>
      /\bimport\b/.test(l),
    );
    const offenders = importLines.filter((l) =>
      /SkillDiscovery|SkillsMiddleware|loadSkillTool/.test(l),
    );
    assert.deepEqual(
      offenders,
      [],
      `skillLoader.ts must not import MAS runtime; offenders: ${offenders.join(", ")}`,
    );
  });

  it("imports the native Deep Agents Skill/filesystem API", () => {
    assert.match(SKILL_LOADER_SRC, /from ['"]deepagents['"]/);
    assert.match(SKILL_LOADER_SRC, /FilesystemBackend/);
    assert.match(SKILL_LOADER_SRC, /listSkills/);
  });
});

// ---------------------------------------------------------------------------
// B2 — GOLD read-only (P008 golden-master)
// ---------------------------------------------------------------------------

describe("skillLoader — B2 GOLD read-only (byte-level snapshot)", () => {
  it("every knowledge file on disk matches its frozen SHA256 (no GOLD drift)", () => {
    const files = allKnowledgeFiles();
    assert.ok(
      files.length >= 13,
      `expected >=13 GOLD knowledge files, got ${files.length}`,
    );

    for (const kf of files) {
      const rel = kf.readPath.replace(/^\//, "");
      const expected = GOLD_SNAPSHOT[rel];
      assert.ok(
        expected,
        `knowledge file ${rel} has no frozen snapshot — snapshot is incomplete`,
      );
      const actual = sha256(kf.absPath);
      assert.equal(
        actual,
        expected,
        `GOLD knowledge file ${rel} changed (P008 golden-master mismatch). R5 must not edit GOLD.`,
      );
    }
  });

  it("every descriptor knowledge file actually exists on disk (no dangling refs)", () => {
    for (const kf of allKnowledgeFiles()) {
      assert.ok(
        fs.existsSync(kf.absPath),
        `knowledge file missing on disk: ${kf.absPath}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// B3 — per-scenario subset
// ---------------------------------------------------------------------------

describe("skillLoader — B3 generic mount (loadAllSkills)", () => {
  const names = (ds: SkillDescriptor[]) => ds.map((d) => d.name);

  it("loadAllSkills mounts every skill directory under mas/skills", () => {
    const all = loadAllSkills();
    const n = names(all);
    // The three GOLD skills + the new operational skill.
    for (const expected of [
      "exercise-type-guide",
      "fitness-data-tools",
      "plan-generation",
      "strength-training-designer",
    ]) {
      assert.ok(
        n.includes(expected),
        `loadAllSkills must mount ${expected}, got [${n.join(", ")}]`,
      );
    }
  });

  it("loadAllSkills is sorted + deterministic (same call -> same output)", () => {
    const a = loadAllSkills();
    const b = loadAllSkills();
    assert.deepEqual(
      names(a),
      [...names(a)].sort(),
      "loadAllSkills must return descriptors sorted by name",
    );
    assert.equal(JSON.stringify(a), JSON.stringify(b));
  });

  it("mountAllSkills composes to a native mount covering all skills", () => {
    const mount = mountAllSkills();
    assert.ok(mount.backend, "mount must include a FilesystemBackend");
    assert.ok(
      mount.skills.length >= 4,
      `expected >=4 skills, got ${mount.skills.length}`,
    );
  });
});

// ---------------------------------------------------------------------------
// B4 — Filesystem on-demand read (no mock; A018/L100)
// ---------------------------------------------------------------------------

describe("skillLoader — B4 Filesystem on-demand read (real backend, no mock)", () => {
  it("toDeepAgentSkillMount produces a native mount with backend + skills + read-only perms", () => {
    const mount = toDeepAgentSkillMount(loadAllSkills());
    assert.ok(mount.backend, "mount must include a FilesystemBackend");
    assert.ok(
      mount.skills.length >= 3 &&
        mount.skills.every((s) => s.startsWith("/") && s.endsWith("/")),
      `skills must be POSIX source paths, got ${JSON.stringify(mount.skills)}`,
    );
    // GOLD read-only: every permission rule is read-only (no 'write').
    for (const perm of mount.permissions) {
      assert.deepEqual(perm.operations, ["read"]);
      assert.ok(perm.paths.length > 0);
    }
  });

  it("the REAL FilesystemBackend reads knowledge.md content on demand (agent read path)", async () => {
    // A018/L100: no mock filesystem. We use the native FilesystemBackend from the
    // mount and the REAL plan-generation/knowledge.md on disk, then assert the
    // backend returns that exact content for the descriptor's readPath.
    const all = loadAllSkills();
    const pg = all.find((d) => d.name === "plan-generation");
    assert.ok(pg, "plan-generation descriptor present");
    const kf = pg.knowledgeFiles.find((k) =>
      k.readPath.endsWith("/knowledge.md"),
    );
    assert.ok(kf, "plan-generation knowledge.md descriptor present");

    // What the agent would get by calling read_file(kf.readPath) on demand:
    const mount = toDeepAgentSkillMount(all);
    const readResult = await mount.backend.read(kf.readPath);

    // The on-disk truth (independent of the backend):
    const onDisk = fs.readFileSync(kf.absPath, "utf-8");

    // FilesystemBackend.read decorates with line numbers, so compare by
    // RECONSTRUCTING the raw content: every non-empty source line must appear.
    // (readResult.content is the line-numbered view; readRaw gives raw bytes.)
    assert.ok(
      typeof readResult.content === "string" && readResult.content.length > 0,
      "backend.read must return non-empty content for the knowledge readPath",
    );

    // Stronger: readRaw returns { data?: FileData }; for a text file the
    // FilesystemBackend returns V2 form with `content: string`. Assert its bytes
    // equal disk — proves the on-demand readPath resolves to the GOLD file.
    const raw = await mount.backend.readRaw(kf.readPath);
    assert.ok(!raw.error, `readRaw must not error: ${raw.error ?? ""}`);
    assert.ok(
      raw.data,
      "readRaw must return FileData for the knowledge readPath",
    );
    const rawContent = raw.data.content;
    const rawText =
      typeof rawContent === "string"
        ? rawContent
        : Array.isArray(rawContent)
          ? rawContent.join("\n")
          : "";
    assert.equal(
      rawText,
      onDisk,
      "native FilesystemBackend.readRaw(readPath) must equal on-disk GOLD content (on-demand read wired, virtualMode resolves readPath under root)",
    );
  });

  it("discoverNativeSkills finds the mounted skills via native listSkills", () => {
    const all = loadAllSkills();
    const found = discoverNativeSkills(all);
    // Native discovery should surface the skills whose directories we mounted.
    // (frontmatter `name` uses underscores; we match by directory name.)
    const foundDirs = found.map((m) => path.basename(path.dirname(m.path)));
    assert.ok(
      foundDirs.includes("plan-generation"),
      `native listSkills must discover plan-generation, found dirs: [${foundDirs.join(", ")}]`,
    );
  });
});

// ---------------------------------------------------------------------------
// Sanity: backend root + descriptor shape
// ---------------------------------------------------------------------------

describe("skillLoader — descriptor shape", () => {
  it("SKILLS_BACKEND_ROOT exists and holds the three skill dirs", () => {
    assert.ok(fs.existsSync(SKILLS_BACKEND_ROOT));
    for (const dir of [
      "plan-generation",
      "exercise-type-guide",
      "strength-training-designer",
    ]) {
      assert.ok(
        fs.existsSync(path.join(SKILLS_BACKEND_ROOT, dir, "SKILL.md")),
        `${dir}/SKILL.md must exist under the backend root`,
      );
    }
  });

  it("every descriptor carries non-empty name/description + >=1 knowledge file + filesystem ref", () => {
    for (const d of loadAllSkills()) {
      assert.ok(d.name && d.description, `${d.name} needs name+description`);
      assert.ok(
        d.knowledgeFiles.length >= 1,
        `${d.name} needs >=1 knowledge file`,
      );
      assert.ok(
        d.sourcePath.startsWith("/"),
        `${d.name} sourcePath must be POSIX-absolute`,
      );
      for (const kf of d.knowledgeFiles) {
        assert.ok(
          kf.readPath.startsWith("/"),
          "readPath must be POSIX-absolute (fs reference)",
        );
        assert.ok(
          kf.absPath && path.isAbsolute(kf.absPath),
          "absPath must be absolute",
        );
      }
    }
  });
});
