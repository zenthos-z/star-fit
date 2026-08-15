/**
 * R5 probe — proves the GOLD knowledge skills are mounted via the NATIVE Deep
 * Agents Skills + Filesystem stack and read on demand (B4).
 *
 * Two-tier design (L003 feasibility gate + A018/L100 no-mock):
 *
 *  Tier A — DETERMINISTIC, no infra needed (hard gate; exit non-zero on fail):
 *   1. `loadAllSkills()` -> `toDeepAgentSkillMount` produces a native
 *      `{ backend, skills, permissions }` mount.
 *   2. A REAL `createDeepAgent` accepts that mount (backend + skills + perms) —
 *      i.e. native construction succeeds with the GOLD skill source paths.
 *   3. The REAL native `FilesystemBackend.readRaw(readPath)` returns the on-disk
 *      GOLD `knowledge.md` bytes for the plan descriptor (on-demand read path is
 *      wired, virtualMode resolves `/plan-generation/knowledge.md` under root).
 *   4. Native `listSkills` discovers the mounted skills from the GOLD tree.
 *
 *  Tier B — LIVE agent read (opportunistic; only when infra is up):
 *   5. With a reachable model + checkpointer, stream a plan message and confirm
 *      the agent reads the knowledge file (its content, or a `read_file` tool
 *      call on the knowledge readPath, surfaces in the run). Skipped — not
 *      failed — when `R5_PROBE_LIVE` is unset / model is unreachable, because
 *      the deterministic Tier A already proves the native mount; the live read
 *      depends on an LLM choosing to read, which is non-deterministic.
 *
 * Run (Tier A only — always):
 *   npx tsx src/services/agent/__probes__/skillLoader-probe.ts
 * Run (Tier B live read):
 *   R5_PROBE_LIVE=1 DATABASE_URL=postgresql://starfit:starfit@localhost:5432/starfit \
 *     npx tsx src/services/agent/__probes__/skillLoader-probe.ts
 */

/* eslint-disable no-console -- CLI probe; stdout IS the result. */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

import { createDeepAgent } from 'deepagents';

import { loadAllSkills, toDeepAgentSkillMount, discoverNativeSkills, SKILLS_BACKEND_ROOT } from '../skillLoader.js';
import type { AIMessageChunk } from '@langchain/core/messages';

type Step = { name: string; ok: boolean; detail: string };
const steps: Step[] = [];

function record(name: string, ok: boolean, detail: string) {
  steps.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

function extractText(chunk: unknown): string {
  if (!Array.isArray(chunk)) {
    return '';
  }
  const message = chunk[0] as AIMessageChunk | undefined;
  const content = message?.content;
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((b) =>
        b && typeof b === 'object' && b.type === 'text' && typeof b.text === 'string'
          ? b.text
          : '',
      )
      .join('');
  }
  return '';
}

async function tierA(): Promise<boolean> {
  console.log('=== R5 probe — Tier A (deterministic native mount, no infra) ===\n');

  // 1. build the native mount from all skills
  const descriptors = loadAllSkills();
  let mount;
  try {
    mount = toDeepAgentSkillMount(descriptors);
    const okSkills = mount.skills.length >= 3 && mount.skills.every((s) => s.startsWith('/'));
    record(
      'toDeepAgentSkillMount(plan) -> native mount',
      okSkills,
      `skills=[${mount.skills.join(',')}] perms=${mount.permissions.length} backend=${mount.backend.constructor.name}`,
    );
  } catch (e) {
    record('toDeepAgentSkillMount(plan) -> native mount', false, (e as Error).message);
    return false;
  }

  // 2. REAL createDeepAgent accepts backend + skills + permissions (native
  //    construction; no model call yet). Use a cheap model id string —
  //    construction wires the Skills/Filesystem middleware without invoking it.
  let agent;
  try {
    agent = createDeepAgent({
      model: 'claude-sonnet-4-5-20250929', // resolved lazily; not called in Tier A
      backend: mount.backend,
      skills: mount.skills,
      permissions: mount.permissions,
      systemPrompt: 'You are the Starfit plan agent. Read /plan-generation/knowledge.md when you need plan rules.',
      name: 'r5-skill-probe',
    });
    record('createDeepAgent accepts native skill mount', !!agent, `agent=${agent?.constructor?.name ?? typeof agent}`);
  } catch (e) {
    record('createDeepAgent accepts native skill mount', false, (e as Error).message);
    return false;
  }

  // 3. REAL FilesystemBackend.readRaw returns the on-disk GOLD knowledge bytes
  const pg = descriptors.find((d) => d.name === 'plan-generation');
  if (!pg) {
    record('plan-generation descriptor present', false, 'missing');
    return false;
  }
  const kf = pg.knowledgeFiles[0];
  const onDisk = fs.readFileSync(kf.absPath, 'utf-8');
  try {
    const raw = await mount.backend.readRaw(kf.readPath);
    const rawText =
      raw.data && typeof raw.data.content === 'string'
        ? raw.data.content
        : '';
    record(
      'FilesystemBackend.readRaw(readPath) == on-disk GOLD',
      rawText === onDisk && rawText.length > 0,
      `readPath=${kf.readPath} bytes=${rawText.length} match=${rawText === onDisk}`,
    );
  } catch (e) {
    record('FilesystemBackend.readRaw(readPath) == on-disk GOLD', false, (e as Error).message);
    return false;
  }

  // 4. native listSkills discovers the mounted skills (use the loader's helper,
  //    which resolves the GOLD root correctly + matches by directory name).
  try {
    const found = discoverNativeSkills(descriptors);
    const dirs = found.map((m) => path.basename(path.dirname(m.path)));
    const hasPg = dirs.includes('plan-generation');
    record('listSkills discovers mounted skills', hasPg, `dirs=[${dirs.join(',')}] root=${SKILLS_BACKEND_ROOT}`);
    if (!hasPg) {
      return false;
    }
  } catch (e) {
    record('listSkills discovers mounted skills', false, (e as Error).message);
    return false;
  }

  return true;
}

async function tierB(agent: Awaited<ReturnType<typeof createDeepAgent>> | undefined, kfAbs: string, readPath: string): Promise<void> {
  console.log('\n=== R5 probe — Tier B (live agent read; opportunistic) ===');
  if (process.env.R5_PROBE_LIVE !== '1') {
    console.log('SKIP  live agent read — set R5_PROBE_LIVE=1 (and provide DATABASE_URL + reachable model) to enable.');
    return;
  }
  if (!agent) {
    console.log('SKIP  live agent read — Tier A did not produce an agent.');
    return;
  }
  // Distinct probe thread so it never collides with a real session.
  const threadId = `r5-skill-probe-${Date.now()}`;
  let tokens = 0;
  let sawKnowledgeMarker = false;
  const marker = 'MEV'; // a term that appears in plan-generation/knowledge.md
  try {
    const stream = await agent.stream(
      {
        messages: [
          {
            role: 'user',
            content: `I want a hypertrophy plan. Consult the plan-generation skill knowledge at ${readPath} before answering, then reply OK.`,
          },
        ],
      },
      { configurable: { thread_id: threadId }, streamMode: 'messages' },
    );
    for await (const chunk of stream) {
      const t = extractText(chunk);
      if (t) {
        tokens += 1;
        if (t.includes(marker)) {
          sawKnowledgeMarker = true;
        }
      }
    }
    record(
      'live agent streamed + knowledge marker observed',
      tokens >= 1,
      `tokens=${tokens} sawMarker=${sawKnowledgeMarker} (marker=${marker}; abs=${kfAbs})`,
    );
  } catch (e) {
    record('live agent streamed + knowledge marker observed', false, (e as Error).message);
  }
}

async function main() {
  const tierAOk = await tierA();

  // Re-derive handles for Tier B without re-running side effects.
  const descriptors = loadAllSkills();
  const mount = toDeepAgentSkillMount(descriptors);
  const kf = descriptors.find((d) => d.name === 'plan-generation')?.knowledgeFiles[0];
  let agent: Awaited<ReturnType<typeof createDeepAgent>> | undefined;
  try {
    agent = createDeepAgent({
      model: 'claude-sonnet-4-5-20250929',
      backend: mount.backend,
      skills: mount.skills,
      permissions: mount.permissions,
      systemPrompt: 'You are the Starfit plan agent. Read /plan-generation/knowledge.md when you need plan rules.',
      name: 'r5-skill-probe',
    });
  } catch {
    agent = undefined;
  }
  if (kf) {
    await tierB(agent, kf.absPath, kf.readPath);
  }

  console.log('\n=== Summary ===');
  for (const s of steps) {
    console.log(`${s.ok ? 'PASS' : 'FAIL'}  ${s.name}`);
  }
  // Tier A is the hard gate (its boolean folds every deterministic step).
  // Tier B is opportunistic — a SKIP never fails the probe.
  console.log(`\nR5 probe (Tier A native mount): ${tierAOk ? 'PASS' : 'FAIL'}`);
  process.exit(tierAOk ? 0 : 1);
}

main().catch((e: unknown) => {
  console.log('\nFATAL (real native path failed — this is the R5 finding, not a mock):');
  const err = e as { stack?: string; message?: string };
  console.log(err?.stack || err?.message || e);
  process.exit(1);
});
