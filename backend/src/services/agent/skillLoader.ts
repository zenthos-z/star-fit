/**
 * skillLoader (R5) — exposes the legacy MAS skills' pure-knowledge `.md`
 * (plan-generation / exercise-type-guide / strength-training-designer, ~13 GOLD
 * assets) plus the new operational skills (e.g. fitness-data-tools) through
 * **Deep Agents native Skills + Filesystem**, mounted in full for the generic
 * agent and read on demand.
 *
 * ## What this replaces
 * The old MAS runtime — `SkillDiscovery` / `SkillsMiddleware` /
 * `loadSkillTool` (`backend/src/services/mas/skills/`) — discovered skills,
 * stuffed knowledge into prompts, and routed tool calls at runtime. R5 drops
 * that runtime: this module imports NONE of those MAS classes (B1, source-level
 * grep must hit 0). Instead it wires the **deepagents native** stack:
 *   - `FilesystemBackend` + the auto-added filesystem tools (`read_file` /
 *     `ls` / `glob` / `grep`) so the agent reads knowledge **on demand**, not
 *     stuffed into the systemPrompt (B4);
 *   - the native `skills` source paths so `SkillsMiddleware` exposes the skill
 *     index (name + description) and the agent pulls detail files itself.
 *
 * ## GOLD read-only (HC-2 / L002 / B2)
 * The knowledge `.md` files are frozen GOLD assets. This module only READS them
 * (to surface descriptions + verify byte-identical content); it never writes,
 * edits, or relocates them. `git diff` on the GOLD knowledge markdown must be
 * empty. `toDeepAgentSkillMount` enforces read-only at the native permission
 * layer as defense in depth. New operational skills (not GOLD) live alongside
 * under the same root and are equally read-only to the agent.
 *
 * ## Generic mounting (v3 amendment ①)
 * The generic Deep Agent mounts ALL skills — every directory under the GOLD
 * `mas/skills` root that has a `SKILL.md`. The single agent loop picks which
 * skill to activate based on intent; `scenario` is no longer used to select a
 * subset. `loadAllSkills()` enumerates skill directories dynamically, so adding
 * a new skill directory under `mas/skills/` is all it takes to mount it.
 *
 * @module skillLoader
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Native Deep Agents API (B1: native Skill/filesystem, NOT the MAS runtime).
import { FilesystemBackend, listSkills } from 'deepagents';
import type { FilesystemPermission } from 'deepagents';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * One knowledge file the agent reads on demand via the native filesystem tool.
 */
export interface KnowledgeFile {
  /**
   * Absolute filesystem path — the GOLD asset location. Used for build-time
   * verification (byte-identical read) and direct inspection. Never mutated.
   */
  readonly absPath: string;
  /**
   * POSIX path the agent uses with `read_file`, relative to the shared backend
   * root (the `mas/skills` directory). Example: `/plan-generation/knowledge.md`.
   * This is the on-demand-read address surfaced to the LLM (B4).
   */
  readonly readPath: string;
  /** Short human label of what this knowledge covers. */
  readonly label: string;
}

/**
 * A knowledge skill exposed via native Deep Agents Skills + Filesystem.
 *
 * A `SkillDescriptor` is pure data describing WHERE the skill lives and WHAT the
 * agent may read; it carries no runtime behaviour. `toDeepAgentSkillMount`
 * turns a set of descriptors into the native `createDeepAgent` params.
 */
export interface SkillDescriptor {
  /**
   * deepagents-native skill name (Agent Skills spec: lowercase alphanumeric +
   * hyphens). Uses the skill's DIRECTORY name (hyphen-form), which is what the
   * native SkillsMiddleware keys on; the GOLD `SKILL.md` frontmatter `name`
   * uses underscores, which deepagents accepts with only a benign warning.
   */
  readonly name: string;
  /** Human description, read verbatim from the GOLD `SKILL.md` frontmatter. */
  readonly description: string;
  /** Absolute path to the skill directory (the GOLD asset root). */
  readonly skillDirPath: string;
  /** Absolute path to the `SKILL.md` entry (native skill entrypoint). */
  readonly skillMdPath: string;
  /**
   * Knowledge files the agent reads ON DEMAND (B4). NOT preloaded into the
   * prompt — the agent decides when to `read_file` them.
   */
  readonly knowledgeFiles: ReadonlyArray<KnowledgeFile>;
  /**
   * POSIX source path for the native SkillsMiddleware, relative to the backend
   * root. Example: `/plan-generation/`. Passed straight to `createDeepAgent`
   * `skills` (or `createSkillsMiddleware({ sources })`).
   */
  readonly sourcePath: string;
}

/**
 * Native `createDeepAgent` skill/filesystem params derived from a descriptor
 * set. Pass `backend`, `skills`, and `permissions` straight to
 * `createDeepAgent({ ..., ...mount })`.
 */
export interface DeepAgentSkillMount {
  /** FilesystemBackend rooted at the shared `mas/skills` directory (read-only). */
  readonly backend: FilesystemBackend;
  /** Native skill source paths (one per descriptor). */
  readonly skills: string[];
  /** Read-only permission rules — GOLD write/edit is forbidden (defense in depth). */
  readonly permissions: FilesystemPermission[];
}

// ---------------------------------------------------------------------------
// GOLD asset registry
// ---------------------------------------------------------------------------

/**
 * Absolute path to the legacy MAS skills root (the GOLD asset tree). Resolved
 * from this module's location: `backend/src/services/agent/` -> `../mas/skills`.
 * Computed once at module load; all descriptors reference files under here.
 */
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_ROOT = path.resolve(MODULE_DIR, '..', 'mas', 'skills');

/**
 * The directory every backend path is relative to. All `readPath` / `sourcePath`
 * values are POSIX paths under this root, so a single `FilesystemBackend` rooted
 * here resolves every knowledge file the agent is allowed to read.
 */
export const SKILLS_BACKEND_ROOT = SKILLS_ROOT;

/** Convert an absolute path under SKILLS_ROOT to its POSIX `readPath`. */
function toReadPath(absPath: string): string {
  const rel = path.relative(SKILLS_ROOT, absPath);
  const posix = rel.split(path.sep).join('/');
  return posix.startsWith('/') ? posix : `/${posix}`;
}

/**
 * Read the `description` (and `name`) from a GOLD `SKILL.md` YAML frontmatter.
 *
 * Pure local parse: the GOLD frontmatter is frozen YAML, so a minimal fence +
 * key extraction is robust without pulling a YAML dependency. Kept readonly —
 * this never writes the file (L002).
 *
 * Returns `null` if the file or frontmatter is missing (the caller decides
 * whether that is fatal).
 */
function readSkillFrontmatter(
  skillMdPath: string,
): { name: string; description: string } | null {
  let raw: string;
  try {
    raw = fs.readFileSync(skillMdPath, 'utf-8');
  } catch {
    return null;
  }
  const fenceMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fenceMatch) {
    return null;
  }
  const body = fenceMatch[1];
  const get = (key: string): string | null => {
    const m = body.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm'));
    if (!m) {
      return null;
    }
    // Strip surrounding quotes (single/double) if present.
    let v = m[1].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    return v;
  };
  const name = get('name');
  const description = get('description');
  if (!name || !description) {
    return null;
  }
  return { name, description };
}

/**
 * Recursively list every `.md` file under `dir` except `SKILL.md` itself.
 * Used to populate `knowledgeFiles` for a dynamically-discovered skill.
 */
function walkMarkdown(dir: string): Array<{ absPath: string; rel: string }> {
  const out: Array<{ absPath: string; rel: string }> = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkMarkdown(abs));
    } else if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'SKILL.md') {
      out.push({ absPath: abs, rel: path.relative(dir, abs) });
    }
  }
  return out;
}

/**
 * Build a `SkillDescriptor` for one GOLD skill directory (explicit knowledge
 * files — used by the GOLD_REGISTRY below for byte-identical golden-master).
 */
function buildDescriptor(
  dirName: string,
  knowledgeRel: ReadonlyArray<{ rel: string; label: string }>,
): SkillDescriptor {
  const skillDirPath = path.join(SKILLS_ROOT, dirName);
  const skillMdPath = path.join(skillDirPath, 'SKILL.md');
  const fm = readSkillFrontmatter(skillMdPath);
  if (!fm) {
    // GOLD invariant: every mounted skill must have parseable frontmatter.
    throw new Error(
      `skillLoader: GOLD SKILL.md missing frontmatter at ${skillMdPath}`,
    );
  }
  const knowledgeFiles: KnowledgeFile[] = [];
  for (const { rel, label } of knowledgeRel) {
    const absPath = path.join(skillDirPath, rel.split('/').join(path.sep));
    const readPath = toReadPath(absPath);
    knowledgeFiles.push({ absPath, readPath, label });
  }
  return {
    name: dirName, // native name = directory (hyphen-form)
    description: fm.description,
    skillDirPath,
    skillMdPath,
    knowledgeFiles,
    sourcePath: toReadPath(skillDirPath) + '/',
  };
}

/**
 * Build a `SkillDescriptor` from a directory by auto-discovering its knowledge
 * `.md` files. Used by `loadAllSkills` so new skill directories are picked up
 * without touching a registry.
 */
function buildDescriptorFromDir(dirName: string): SkillDescriptor {
  const skillDirPath = path.join(SKILLS_ROOT, dirName);
  const skillMdPath = path.join(skillDirPath, 'SKILL.md');
  const fm = readSkillFrontmatter(skillMdPath);
  if (!fm) {
    throw new Error(
      `skillLoader: SKILL.md missing frontmatter at ${skillMdPath}`,
    );
  }
  const knowledgeFiles: KnowledgeFile[] = walkMarkdown(skillDirPath).map(
    ({ absPath, rel }) => ({
      absPath,
      readPath: toReadPath(absPath),
      label: rel.split(path.sep).join('/'),
    }),
  );
  return {
    name: dirName,
    description: fm.description,
    skillDirPath,
    skillMdPath,
    knowledgeFiles,
    sourcePath: toReadPath(skillDirPath) + '/',
  };
}

/**
 * The GOLD registry: the three legacy skill directories and the explicit
 * knowledge files each exposes for on-demand read. Used for byte-identical
 * golden-master verification (`allKnowledgeFiles`). GOLD content is referenced,
 * never copied. (Mounting itself is directory-driven via `loadAllSkills`, so
 * this registry no longer gates which skills mount.)
 *
 * Asset count: 1 (plan-generation) + 11 (exercise-type-guide: index + 10 types)
 * + 1 (strength-training-designer) = 13 knowledge files — the ~15 GOLD assets
 * named in the card (SKILL.md entries round it up).
 */
const GOLD_REGISTRY: Record<string, () => SkillDescriptor> = {
  'plan-generation': () =>
    buildDescriptor('plan-generation', [
      { rel: 'knowledge.md', label: 'plan-generation main knowledge' },
    ]),
  'exercise-type-guide': () =>
    buildDescriptor('exercise-type-guide', [
      { rel: 'knowledge-index.md', label: 'exercise-type index' },
      { rel: 'knowledge/resistance.md', label: 'resistance type' },
      { rel: 'knowledge/bodyweight.md', label: 'bodyweight type' },
      { rel: 'knowledge/isometric.md', label: 'isometric type' },
      { rel: 'knowledge/cardio.md', label: 'cardio type' },
      { rel: 'knowledge/outdoor.md', label: 'outdoor type' },
      { rel: 'knowledge/unilateral.md', label: 'unilateral type' },
      { rel: 'knowledge/assisted.md', label: 'assisted type' },
      { rel: 'knowledge/flexibility.md', label: 'flexibility type' },
      { rel: 'knowledge/heavy_weight.md', label: 'heavy_weight type' },
      { rel: 'knowledge/rep_training.md', label: 'rep_training type' },
    ]),
  'strength-training-designer': () =>
    buildDescriptor('strength-training-designer', [
      {
        rel: 'knowledge/non-big-three-guide.md',
        label: 'non-big-three guide',
      },
    ]),
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Enumerate EVERY mountable skill directory under the GOLD `mas/skills` root
 * (each must contain a `SKILL.md`) and return native-mountable
 * `SkillDescriptor`s. Sorted by directory name for deterministic order.
 *
 * This is the generic-agent mount path: the single agent loop picks which skill
 * to activate by intent, so all skills are mounted together. Dropping a new
 * skill directory under `mas/skills/` (with a `SKILL.md`) is enough to mount it.
 *
 * Pure producer (only reads files to surface descriptions). Deterministic.
 */
export function loadAllSkills(): SkillDescriptor[] {
  const entries = fs.readdirSync(SKILLS_ROOT, { withFileTypes: true });
  const out: SkillDescriptor[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const skillMd = path.join(SKILLS_ROOT, entry.name, 'SKILL.md');
    if (fs.existsSync(skillMd)) {
      out.push(buildDescriptorFromDir(entry.name));
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * Convenience: convert ALL skills straight to native `createDeepAgent` params.
 * Pass the result through:
 * ```ts
 * const agent = createDeepAgent({ model, ...mountAllSkills(), tools, systemPrompt, checkpointer });
 * ```
 */
export function mountAllSkills(): DeepAgentSkillMount {
  return toDeepAgentSkillMount(loadAllSkills());
}

/**
 * All GOLD knowledge files across every GOLD skill, flattened. Useful for
 * build-time golden-master verification (B2: assert each file on disk is
 * byte-identical to its checked-in content) and for sweeping probes. Covers the
 * three GOLD skills only (new operational skills are not GOLD).
 */
export function allKnowledgeFiles(): KnowledgeFile[] {
  return Object.values(GOLD_REGISTRY)
    .map((factory) => factory().knowledgeFiles)
    .flat();
}

/**
 * Convert a descriptor set into native `createDeepAgent` skill/filesystem params.
 *
 * The agent built with this mount:
 *  - has the native filesystem tools (`read_file` / `ls` / `glob` / `grep`)
 *    backed by a `FilesystemBackend` rooted at the GOLD `mas/skills` directory;
 *  - sees the mounted skills via native `SkillsMiddleware` (name + description
 *    index), then reads each skill's knowledge files ON DEMAND — never preloaded
 *    into the prompt (B4);
 *  - is forbidden from writing/editing under the skill tree (read-only GOLD).
 *
 * Pass the result straight through:
 * ```ts
 * const mount = toDeepAgentSkillMount(loadAllSkills());
 * const agent = createDeepAgent({ model, ...mount, systemPrompt, checkpointer });
 * ```
 */
export function toDeepAgentSkillMount(
  descriptors: ReadonlyArray<SkillDescriptor>,
): DeepAgentSkillMount {
  const skills = descriptors.map((d) => d.sourcePath);

  // Read-only permission rules: one allow-read glob per mounted skill tree.
  // Paths are absolute POSIX globs under the backend root (no `..`/`~`).
  // Write/edit operations are intentionally absent => GOLD is read-only.
  const permissions: FilesystemPermission[] = descriptors.map((d) => ({
    paths: [`${d.sourcePath}**`],
    operations: ['read'],
  }));

  // virtualMode=true so agent readPaths (POSIX-absolute like
  // `/plan-generation/knowledge.md`) resolve UNDER the root, not from the
  // filesystem `/`. Without it the legacy mode treats absolute paths as-is and
  // `read_file('/plan-generation/knowledge.md')` would miss. This also enforces
  // path-traversal protection (no `..`/`~`, must stay within root) — GOLD safety.
  const backend = new FilesystemBackend({ rootDir: SKILLS_ROOT, virtualMode: true });

  return { backend, skills, permissions };
}

/**
 * Verify (at build/probe time) that the native SkillsMiddleware can discover the
 * mounted skills from the GOLD directories. Wraps deepagents' own `listSkills`
 * so callers do not import the native API directly.
 *
 * @param descriptors the set returned by `loadAllSkills`
 * @returns the native `SkillMetadata` list deepagents finds under the skills root
 */
export function discoverNativeSkills(
  descriptors: ReadonlyArray<SkillDescriptor>,
) {
  if (descriptors.length === 0) {
    return [];
  }
  // listSkills takes filesystem dirs; project-level is the shared root.
  const found = listSkills({ projectSkillsDir: SKILLS_ROOT });
  const wanted = new Set(descriptors.map((d) => d.name));
  // Native metadata uses the SKILL.md frontmatter `name` (underscore-form);
  // match by the directory the skill lives in, which is the descriptor name.
  return found.filter((m) => {
    const dir = path.basename(path.dirname(m.path));
    return wanted.has(dir);
  });
}
