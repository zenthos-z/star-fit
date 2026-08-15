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

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

import {
  loadAllSkills,
  mountAllSkills,
  toDeepAgentSkillMount,
  allKnowledgeFiles,
  discoverNativeSkills,
  SKILLS_BACKEND_ROOT,
  type SkillDescriptor,
} from '../skillLoader.js';

// ---------------------------------------------------------------------------
// B2 — frozen SHA256 golden-master of the GOLD knowledge files (P008).
// Keyed by POSIX path relative to the skills root (= readPath without leading /).
// If a GOLD file changes, this snapshot fails LOUD — R5 must not edit GOLD.
// ---------------------------------------------------------------------------
const GOLD_SNAPSHOT: Record<string, string> = {
  'exercise-type-guide/knowledge-index.md':
    '7865b3d7f9647c0094fecae4a2a8c3640e00ed79a8621f249db97b427bcfef8d',
  'exercise-type-guide/knowledge/assisted.md':
    'ede9c0baae40853587c02e90f4c7a702883528df7f557edbd96c0116c6996156',
  'exercise-type-guide/knowledge/bodyweight.md':
    'b0cb41dffc8ac171ea867d223a60d2683bad124063afbc476fa42280d907e9eb',
  'exercise-type-guide/knowledge/cardio.md':
    '6a50bc47b49789248c5f6f1ae43eba3c12a69b85e6c60aea24549ef92f6fb87a',
  'exercise-type-guide/knowledge/flexibility.md':
    '11f1dbbddff3f9751b089557d965049828499d01e8ef8c6b42b348a831c1a55c',
  'exercise-type-guide/knowledge/heavy_weight.md':
    '887181d5d035b56f9ed2da104fdb863be9354619932b7ea5d7b26e97de744f09',
  'exercise-type-guide/knowledge/isometric.md':
    '3b549d4ad76de52ab644f2bb64e177017d4fddbc91dbd8fa0d3bd7a99e63d2c7',
  'exercise-type-guide/knowledge/outdoor.md':
    '66030276c0aad404829fb83f8068b16cb31ba5309ce99fab9c1b497547549411',
  'exercise-type-guide/knowledge/rep_training.md':
    '64c15946b4ada481ff5cfcfbbcee94a6f69d6e44dbc4cb8015351cd05f315924',
  'exercise-type-guide/knowledge/resistance.md':
    'd0ff799068ca2747eb762495aae5f5ecd0494b3f20329d310188664d52b7403a',
  'exercise-type-guide/knowledge/unilateral.md':
    'de7d5b00f5f2146c3bae79c7063bfb01a17698174f0944cbb982394b7972a4a2',
  'plan-generation/knowledge.md':
    '342e5b9d2e6c0ea9dc32a51e18b13bd8d90329d14126ac42f35be54e0b42e1d6',
  'strength-training-designer/knowledge/non-big-three-guide.md':
    '2cfc4569bf8ee7adf99dd7f4a946e17f2be00c59e6c8989d6f2ed8b3b2320a82',
};

function sha256(absPath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
}

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_LOADER_SRC = fs.readFileSync(
  path.resolve(TEST_DIR, '..', 'skillLoader.ts'),
  'utf-8',
);

// ---------------------------------------------------------------------------
// B1 — native mount, MAS runtime dropped
// ---------------------------------------------------------------------------

describe('skillLoader — B1 native mount (no MAS runtime)', () => {
  it('does not import the MAS skill runtime (SkillDiscovery/SkillsMiddleware/loadSkillTool)', () => {
    // L010: a source-level grep that must hit 0. We check import lines.
    const importLines = SKILL_LOADER_SRC.split('\n').filter((l) =>
      /\bimport\b/.test(l),
    );
    const offenders = importLines.filter((l) =>
      /SkillDiscovery|SkillsMiddleware|loadSkillTool/.test(l),
    );
    assert.deepEqual(
      offenders,
      [],
      `skillLoader.ts must not import MAS runtime; offenders: ${offenders.join(', ')}`,
    );
  });

  it('imports the native Deep Agents Skill/filesystem API', () => {
    assert.match(SKILL_LOADER_SRC, /from ['"]deepagents['"]/);
    assert.match(SKILL_LOADER_SRC, /FilesystemBackend/);
    assert.match(SKILL_LOADER_SRC, /listSkills/);
  });
});

// ---------------------------------------------------------------------------
// B2 — GOLD read-only (P008 golden-master)
// ---------------------------------------------------------------------------

describe('skillLoader — B2 GOLD read-only (byte-level snapshot)', () => {
  it('every knowledge file on disk matches its frozen SHA256 (no GOLD drift)', () => {
    const files = allKnowledgeFiles();
    assert.ok(files.length >= 13, `expected >=13 GOLD knowledge files, got ${files.length}`);

    for (const kf of files) {
      const rel = kf.readPath.replace(/^\//, '');
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

  it('every descriptor knowledge file actually exists on disk (no dangling refs)', () => {
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

describe('skillLoader — B3 generic mount (loadAllSkills)', () => {
  const names = (ds: SkillDescriptor[]) => ds.map((d) => d.name);

  it('loadAllSkills mounts every skill directory under mas/skills', () => {
    const all = loadAllSkills();
    const n = names(all);
    // The three GOLD skills + the new operational skill.
    for (const expected of [
      'exercise-type-guide',
      'fitness-data-tools',
      'plan-generation',
      'strength-training-designer',
    ]) {
      assert.ok(
        n.includes(expected),
        `loadAllSkills must mount ${expected}, got [${n.join(', ')}]`,
      );
    }
  });

  it('loadAllSkills is sorted + deterministic (same call -> same output)', () => {
    const a = loadAllSkills();
    const b = loadAllSkills();
    assert.deepEqual(
      names(a),
      [...names(a)].sort(),
      'loadAllSkills must return descriptors sorted by name',
    );
    assert.equal(JSON.stringify(a), JSON.stringify(b));
  });

  it('mountAllSkills composes to a native mount covering all skills', () => {
    const mount = mountAllSkills();
    assert.ok(mount.backend, 'mount must include a FilesystemBackend');
    assert.ok(mount.skills.length >= 4, `expected >=4 skills, got ${mount.skills.length}`);
  });
});

// ---------------------------------------------------------------------------
// B4 — Filesystem on-demand read (no mock; A018/L100)
// ---------------------------------------------------------------------------

describe('skillLoader — B4 Filesystem on-demand read (real backend, no mock)', () => {
  it('toDeepAgentSkillMount produces a native mount with backend + skills + read-only perms', () => {
    const mount = toDeepAgentSkillMount(loadAllSkills());
    assert.ok(mount.backend, 'mount must include a FilesystemBackend');
    assert.ok(
      mount.skills.length >= 3 && mount.skills.every((s) => s.startsWith('/') && s.endsWith('/')),
      `skills must be POSIX source paths, got ${JSON.stringify(mount.skills)}`,
    );
    // GOLD read-only: every permission rule is read-only (no 'write').
    for (const perm of mount.permissions) {
      assert.deepEqual(perm.operations, ['read']);
      assert.ok(perm.paths.length > 0);
    }
  });

  it('the REAL FilesystemBackend reads knowledge.md content on demand (agent read path)', async () => {
    // A018/L100: no mock filesystem. We use the native FilesystemBackend from the
    // mount and the REAL plan-generation/knowledge.md on disk, then assert the
    // backend returns that exact content for the descriptor's readPath.
    const all = loadAllSkills();
    const pg = all.find((d) => d.name === 'plan-generation');
    assert.ok(pg, 'plan-generation descriptor present');
    const kf = pg.knowledgeFiles.find((k) => k.readPath.endsWith('/knowledge.md'));
    assert.ok(kf, 'plan-generation knowledge.md descriptor present');

    // What the agent would get by calling read_file(kf.readPath) on demand:
    const mount = toDeepAgentSkillMount(all);
    const readResult = await mount.backend.read(kf.readPath);

    // The on-disk truth (independent of the backend):
    const onDisk = fs.readFileSync(kf.absPath, 'utf-8');

    // FilesystemBackend.read decorates with line numbers, so compare by
    // RECONSTRUCTING the raw content: every non-empty source line must appear.
    // (readResult.content is the line-numbered view; readRaw gives raw bytes.)
    assert.ok(
      typeof readResult.content === 'string' && readResult.content.length > 0,
      'backend.read must return non-empty content for the knowledge readPath',
    );

    // Stronger: readRaw returns { data?: FileData }; for a text file the
    // FilesystemBackend returns V2 form with `content: string`. Assert its bytes
    // equal disk — proves the on-demand readPath resolves to the GOLD file.
    const raw = await mount.backend.readRaw(kf.readPath);
    assert.ok(!raw.error, `readRaw must not error: ${raw.error ?? ''}`);
    assert.ok(raw.data, 'readRaw must return FileData for the knowledge readPath');
    const rawContent = raw.data.content;
    const rawText =
      typeof rawContent === 'string'
        ? rawContent
        : Array.isArray(rawContent)
          ? rawContent.join('\n')
          : '';
    assert.equal(
      rawText,
      onDisk,
      'native FilesystemBackend.readRaw(readPath) must equal on-disk GOLD content (on-demand read wired, virtualMode resolves readPath under root)',
    );
  });

  it('discoverNativeSkills finds the mounted skills via native listSkills', () => {
    const all = loadAllSkills();
    const found = discoverNativeSkills(all);
    // Native discovery should surface the skills whose directories we mounted.
    // (frontmatter `name` uses underscores; we match by directory name.)
    const foundDirs = found.map((m) => path.basename(path.dirname(m.path)));
    assert.ok(
      foundDirs.includes('plan-generation'),
      `native listSkills must discover plan-generation, found dirs: [${foundDirs.join(', ')}]`,
    );
  });
});

// ---------------------------------------------------------------------------
// Sanity: backend root + descriptor shape
// ---------------------------------------------------------------------------

describe('skillLoader — descriptor shape', () => {
  it('SKILLS_BACKEND_ROOT exists and holds the three skill dirs', () => {
    assert.ok(fs.existsSync(SKILLS_BACKEND_ROOT));
    for (const dir of ['plan-generation', 'exercise-type-guide', 'strength-training-designer']) {
      assert.ok(
        fs.existsSync(path.join(SKILLS_BACKEND_ROOT, dir, 'SKILL.md')),
        `${dir}/SKILL.md must exist under the backend root`,
      );
    }
  });

  it('every descriptor carries non-empty name/description + >=1 knowledge file + filesystem ref', () => {
    for (const d of loadAllSkills()) {
      assert.ok(d.name && d.description, `${d.name} needs name+description`);
      assert.ok(d.knowledgeFiles.length >= 1, `${d.name} needs >=1 knowledge file`);
      assert.ok(d.sourcePath.startsWith('/'), `${d.name} sourcePath must be POSIX-absolute`);
      for (const kf of d.knowledgeFiles) {
        assert.ok(kf.readPath.startsWith('/'), 'readPath must be POSIX-absolute (fs reference)');
        assert.ok(kf.absPath && path.isAbsolute(kf.absPath), 'absPath must be absolute');
      }
    }
  });
});
