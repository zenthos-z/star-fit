/**
 * L003 feasibility-gate probe for M3 (AC6).
 *
 * Purpose: de-risk the deepagents.js integration BEFORE full test coverage, by
 * exercising the REAL framework path end-to-end with no mocks.
 *
 * What it proves (all must be REAL — A018/L100):
 *  1. `createDeepAgent` from the `deepagents` npm package actually loads,
 *     constructs, and accepts the M-RT checkpointer + the M8 V4 model. (No fake
 *     agent — that would mask framework-compatibility failure, the exact thing
 *     L003 guards against.)
 *  2. `agent.stream` yields >= 1 real token (or a done event) from the live V4
 *     model over the network. (No mock model — a mock would green-light a
 *     broken provider/baseURL/key path.)
 *  3. The checkpointer is the REAL M-RT PostgresSaver (agent_runtime schema),
 *     not an in-memory stub. (No mock checkpointer — that would hide the
 *     schema-isolation / setup contract from M-RT.)
 *  4. The `DeepAgentService.chat` seam turns that stream into `AgentEvent`s
 *     (`token` / `done` / `error`) per the frozen P010 contract.
 *
 * Run (needs the docker `starfit-postgres` up + a reachable model endpoint):
 *   DATABASE_URL=postgresql://starfit:starfit@localhost:5432/starfit \
 *     npx tsx src/services/agent/__probes__/deepagent-probe.ts
 *
 * Exit code 0 = probe PASSED (>= 1 token/done event observed). Non-zero = the
 * real path failed — the failure is the L003 finding, do not mask it.
 */

/* eslint-disable no-console -- this is a CLI probe; stdout IS the result. */

import 'dotenv/config';

import { createDeepAgent } from 'deepagents';

import { loadModel } from '../../llm.js';
import {
  ensureAgentRuntimeSchema,
  getAgentRuntimeCheckpointer,
} from '../agentRuntime.js';
import { DeepAgentService } from '../DeepAgentService.js';
import type { AIMessageChunk } from '@langchain/core/messages';

type Step = { name: string; ok: boolean; detail: string };
const steps: Step[] = [];

function record(name: string, ok: boolean, detail: string) {
  steps.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

function extractText(chunk: unknown): string {
  if (!Array.isArray(chunk)) {return '';}
  const message = chunk[0] as AIMessageChunk | undefined;
  const content = message?.content;
  if (typeof content === 'string') {return content;}
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

async function main() {
  console.log('=== M3 L003 probe (real createDeepAgent + agent.stream, NO mocks) ===\n');

  // --- Step 1: real V4 model from M8 loadModel (no mock model — A018) -------
  let model;
  try {
    model = await loadModel('chat');
    // A real model instance, not a fake. Assert it is a BaseChatModel-shaped obj.
    const looksReal = !!model && typeof (model as { invoke?: unknown }).invoke === 'function';
    record('loadModel(chat) real V4 model', looksReal, `${model.constructor?.name ?? typeof model}`);
  } catch (e) {
    record('loadModel(chat) real V4 model', false, (e as Error).message);
    throw e; // cannot continue without a real model
  }

  // --- Step 2: real M-RT checkpointer (no mock checkpointer — A018) ---------
  try {
    await ensureAgentRuntimeSchema(); // idempotent: CREATE SCHEMA IF NOT EXISTS
  } catch (e) {
    record('ensureAgentRuntimeSchema() real PG', false, (e as Error).message);
    throw e;
  }
  let checkpointer;
  try {
    checkpointer = getAgentRuntimeCheckpointer();
    const real = !!checkpointer && /PostgresSaver/i.test(checkpointer.constructor?.name ?? '');
    record('getAgentRuntimeCheckpointer() real PostgresSaver', real, checkpointer.constructor?.name ?? typeof checkpointer);
  } catch (e) {
    record('getAgentRuntimeCheckpointer() real PostgresSaver', false, (e as Error).message);
    throw e;
  }

  // --- Step 3: REAL createDeepAgent + agent.stream (the L003 target) --------
  let rawTokens = 0;
  let rawDone = false;
  let rawError: string | undefined;
  try {
    const agent = createDeepAgent({
      model, // real V4 model
      systemPrompt: 'You are a probe. Reply with the single word: OK',
      checkpointer, // real M-RT PostgresSaver (agent_runtime schema)
      name: 'm3-l003-probe',
    });
    const stream = await agent.stream(
      { messages: [{ role: 'user', content: 'Reply with the single word: OK' }] },
      { configurable: { thread_id: 'm3-l003-probe-1' }, streamMode: 'messages' },
    );
    for await (const chunk of stream) {
      const t = extractText(chunk);
      if (t) {rawTokens += 1;} // count non-empty token chunks
    }
    rawDone = true; // stream completed without throwing
  } catch (e) {
    rawError = (e as Error).message;
  }
  // AC6: yield >= 1 token OR a done event. Real path; no mock.
  const ac6Raw = rawTokens >= 1 || rawDone;
  record(
    'createDeepAgent + agent.stream (real)',
    ac6Raw,
    rawError ? `error: ${rawError}` : `tokens=${rawTokens}, done=${rawDone}`,
  );

  // --- Step 4: DeepAgentService.chat seam -> AgentEvent stream --------------
  let seamTokens = 0;
  let seamDone = false;
  let seamErrorEvent = false;
  const firstEvents: string[] = [];
  let processed = 0;
  try {
    const service = new DeepAgentService();
    // Iterate the async AgentEvent stream directly (no drain-then-iterate).
    for await (const ev of service.chat({
      userId: '00000000-0000-0000-0000-0000000000aa',
      message: 'Reply with the single word: OK',
      scenario: 'chat',
      threadId: 'm3-l003-seam-1',
    })) {
      processed += 1;
      if (firstEvents.length < 5) {
        firstEvents.push(ev.type);
      }
      if (ev.type === 'token') {
        seamTokens += 1;
      } else if (ev.type === 'done') {
        seamDone = true;
      } else if (ev.type === 'error') {
        seamErrorEvent = true;
      }
      if (processed > 2000) {
        break; // safety cap against a runaway stream
      }
    }
  } catch (e) {
    seamErrorEvent = true;
    console.log('  (seam threw:', (e as Error).message, ')');
  }
  // The seam must emit token(s) or done (a structured error event is also a
  // valid AgentEvent outcome, but for AC6 we want a positive token/done).
  const ac6Seam = seamTokens >= 1 || seamDone;
  record(
    'DeepAgentService.chat -> AgentEvent stream',
    ac6Seam,
    `events=[${firstEvents.join(',')}] tokens=${seamTokens} done=${seamDone} error=${seamErrorEvent}`,
  );

  // --- Summary --------------------------------------------------------------
  console.log('\n=== Summary ===');
  for (const s of steps) {console.log(`${s.ok ? 'PASS' : 'FAIL'}  ${s.name}`);}
  const ac6 = ac6Raw && ac6Seam;
  console.log(`\nAC6 (L003 probe, >=1 token/done, no mocks): ${ac6 ? 'PASS' : 'FAIL'}`);
  process.exit(ac6 ? 0 : 1);
}

main().catch((e: unknown) => {
  console.log('\nFATAL (real path failed — this is the L003 finding, not a mock):');
  const err = e as { stack?: string; message?: string };
  console.log(err?.stack || err?.message || e);
  process.exit(1);
});
