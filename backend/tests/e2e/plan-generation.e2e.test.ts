/**
 * INT — end-to-end plan-generation integration tests.
 *
 * Proves the G2-integration convergence: the five Wave-1 revisions (M3 kernel,
 * M-RT checkpointer, R3/R5 skill+tools surface, M5 validation, SSE transport,
 * M8FE frontend) compose into ONE working `/api/chat scenario=plan` chain.
 *
 * Two tiers (L100 real-data-over-mock / L009 flaky-dep-excision):
 *
 *  ALWAYS-ON (stable, no LLM): a scripted RAW agent stands in for the single
 *  unstable dependency (the LLM — L009), while the REAL integration wiring is
 *  exercised end-to-end — INT card extraction (`uiHintExtractor`) + M5
 *  validation loop (`chatWithValidationLoop`) + REAL Fastify HTTP + REAL SSE
 *  transport (hijack / sseEncode / raw.end — A018: never fake the transport).
 *  Covers B1 (full SSE chain), B4 (validation retry), B6 (MAS residual).
 *
 *  REAL-DEP (gated on DATABASE_URL + AI_PROVIDER_PLAN=deepseek + DEEPSEEK_*):
 *  the TRUE deep `deepseek-v4-flash` model + TRUE M-RT PostgresSaver run the
 *  whole chain, proving B1-real (live card stream), B2 (agent_runtime real
 *  checkpoint, isolated from public), B3 (real V4 model id). Skipped when the
 *  real deps are absent so typecheck/CI on a bare machine is not broken.
 *
 * Framework: node:test + tsx (same convention as `chat-sse.e2e.test.ts`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";

import type { AgentEvent, AgentService, ChatRequest } from "shared/contracts";
import {
  composeCardValidatingService,
  postChat,
  setAgentServiceResolver,
} from "../../src/controllers/chatController.js";
import { extractUiHintEvents } from "../../src/services/agent/uiHintExtractor.js";

const VALID_USER = "00000000-0000-0000-0000-0000000000aa";

const VALID_PLAN_CARD =
  '{"type":"plan_card","data":[{"exerciseId":"bench","name":"Bench Press","sets":4,"reps":8,"weight":60}]}';
// Same shape minus the required `exerciseId` -> rejected by the M5 validator.
const INVALID_PLAN_CARD =
  '{"type":"plan_card","data":[{"name":"Bench Press","sets":4,"reps":8}]}';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A scripted RAW agent (the unstable LLM stand-in — L009). Emits token chunks
 *  then `done`; optional per-call card bodies let a retry produce a different
 *  card (B4). */
function scriptedRawAgent(cards: string[], prose = "Here is your plan.\n"): AgentService {
  let call = 0;
  return {
    async *chat(): AsyncIterable<AgentEvent> {
      call += 1;
      const card = cards[Math.min(call - 1, cards.length - 1)];
      yield { type: "token", text: prose };
      yield { type: "token", text: "```json\n" + card + "\n```\n" };
      yield { type: "token", text: "Let me know how it goes!" };
      yield { type: "done" };
    },
  };
}

async function startApp(): Promise<{ app: FastifyInstance; baseUrl: string }> {
  const app = Fastify({ logger: false });
  app.post("/api/chat", postChat);
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return { app, baseUrl: `http://127.0.0.1:${port}` };
}

async function readSseFrames(res: Response): Promise<AgentEvent[]> {
  assert.ok(res.body, "response body stream must exist");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: AgentEvent[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const rawFrame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const line = rawFrame.split("\n").find((l) => l.startsWith("data: "));
      if (line) {
        events.push(JSON.parse(line.slice("data: ".length)) as AgentEvent);
      }
    }
  }
  return events;
}

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": VALID_USER },
    body: JSON.stringify(body),
  });
}

// Restore the real resolver between tests so a scripted agent never leaks.
test.afterEach(() => {
  setAgentServiceResolver(null);
});

// ===========================================================================
// ALWAYS-ON: B1 — full SSE chain (real extraction + validation + transport),
// only the LLM is scripted (L009).
// ===========================================================================

test("B1: /api/chat scenario=plan streams >=1 token + 1 uiHint(plan_card) + 1 done", async () => {
  setAgentServiceResolver(async () =>
    composeCardValidatingService(scriptedRawAgent([VALID_PLAN_CARD])),
  );
  const { app, baseUrl } = await startApp();
  try {
    const res = await postJson(`${baseUrl}/api/chat`, {
      scenario: "plan",
      message: "帮我做增肌计划",
    });
    const events = await readSseFrames(res);

    const tokens = events.filter((e) => e.type === "token");
    const hints = events.filter((e) => e.type === "uiHint");
    const dones = events.filter((e) => e.type === "done");

    assert.ok(tokens.length >= 1, "stream contains >=1 token frame");
    assert.equal(hints.length, 1, "exactly one uiHint frame");
    assert.equal((hints[0]!.card as { type?: string }).type, "plan_card");
    assert.equal(dones.length, 1, "exactly one done frame");
    // Ordering: a token precedes the uiHint; done is last.
    const hintIdx = events.indexOf(hints[0]!);
    const doneIdx = events.indexOf(dones[0]!);
    assert.ok(events.slice(0, hintIdx).some((e) => e.type === "token"));
    assert.equal(doneIdx, events.length - 1);
  } finally {
    await app.close();
  }
});

// ===========================================================================
// ALWAYS-ON: B4 — M5 validation loop (sole retry home — L004) through the
// composed service. Proves the loop genuinely re-invokes chat on an invalid
// card and yields the corrected card (or VALIDATION_ERROR past maxRetries).
// ===========================================================================

test("B4: invalid-first card -> retry yields valid plan_card", async () => {
  const svc = composeCardValidatingService(scriptedRawAgent([INVALID_PLAN_CARD, VALID_PLAN_CARD]));
  const events: AgentEvent[] = [];
  for await (const e of svc.chat({ userId: VALID_USER, message: "plan", scenario: "plan" } as ChatRequest)) {
    events.push(e);
  }
  const hint = events.find((e) => e.type === "uiHint");
  assert.ok(hint, "retry produced a valid card");
  assert.equal((hint!.card as { type?: string }).type, "plan_card");
  assert.ok(events.some((e) => e.type === "done"), "stream ends with done");
});

test("B4: always-invalid card -> VALIDATION_ERROR (no uiHint leaked)", async () => {
  const svc = composeCardValidatingService(scriptedRawAgent([INVALID_PLAN_CARD]));
  const events: AgentEvent[] = [];
  for await (const e of svc.chat({ userId: VALID_USER, message: "plan", scenario: "plan" } as ChatRequest)) {
    events.push(e);
  }
  assert.equal(events.some((e) => e.type === "uiHint"), false, "invalid card never forwarded");
  const err = events.find(
    (e) => e.type === "error" && (e as { error?: { code?: string } }).error?.code === "VALIDATION_ERROR",
  );
  assert.ok(err, "terminal VALIDATION_ERROR after retries exhausted");
});

test("B4 (unit): extraction surfaces an invalid card so the loop can reject it", async () => {
  // Direct proof that extraction is LIBERAL: an invalid card is still extracted
  // (not pre-filtered), which is what makes the retry loop observable.
  async function* raw(): AsyncIterable<AgentEvent> {
    yield { type: "token", text: "```json\n" + INVALID_PLAN_CARD + "\n```\n" };
    yield { type: "done" };
  }
  const out: AgentEvent[] = [];
  for await (const e of extractUiHintEvents(raw())) {
    out.push(e);
  }
  const hint = out.find((e) => e.type === "uiHint");
  assert.ok(hint, "invalid card extracted (liberal — B4)");
  assert.equal((hint!.card as { type?: string }).type, "plan_card");
});

// ===========================================================================
// ALWAYS-ON: B6 — MAS runtime residual cleared (AF3). The old MAS graph
// runtime is gone; the agent chain imports nothing from services/mas.
// (Skill *content* markdown under services/mas/skills is retained knowledge,
// not the MAS runtime — and services/mas/graph no longer exists.)
// ===========================================================================

test("B6: no old MAS runtime in the agent chain (services/mas/graph gone, no MAS imports)", () => {
  const backendSrc = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "src",
  );

  // 1. The MAS graph runtime directory was deleted (R9).
  const masGraph = path.join(backendSrc, "services", "mas", "graph");
  assert.equal(
    fs.existsSync(masGraph),
    false,
    "services/mas/graph runtime directory must not exist",
  );

  // 2. No agent-chain source imports from the MAS runtime. (The chain is
  //    MAS-free by construction post-refactor.)
  const chainFiles = [
    "services/agent/DeepAgentService.js",
    "services/agent/uiHintExtractor.js",
    "services/agent/uiHintValidationLoop.js",
    "controllers/chatController.js",
    "sse/agentSse.js",
  ];
  for (const rel of chainFiles) {
    const full = path.join(backendSrc, rel);
    if (!fs.existsSync(full)) {
      continue;
    }
    const src = fs.readFileSync(full, "utf8");
    assert.equal(
      /from\s+['"][^'"]*services\/mas/.test(src),
      false,
      `${rel} must not import from services/mas`,
    );
    assert.equal(src.includes("CheckpointManager"), false, `${rel} must not reference CheckpointManager`);
  }

  // 3. No executable reference to the MAS symbols anywhere in src: grep the
  //    three AC patterns and assert every hit is inside a comment or the
  //    dedicated guard test (i.e. documentation of the removal, not a call).
  const masPattern = /CheckpointManager|services\/mas\/graph|SkillDiscovery/;
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...walk(full));
      } else if (entry.name.endsWith(".ts")) {
        out.push(full);
      }
    }
    return out;
  };
  const offenders: string[] = [];
  for (const file of walk(backendSrc)) {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, idx) => {
      if (!masPattern.test(line)) {
        return;
      }
      const trimmed = line.trim();
      // Tolerated: comment lines and the guard test that enforces the absence.
      const isComment = trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
      const isGuardTest = /__tests__\/skillLoader\.test\.[tj]s$/.test(file);
      if (!isComment && !isGuardTest) {
        offenders.push(`${path.relative(backendSrc, file)}:${idx + 1}: ${trimmed}`);
      }
    });
  }
  assert.deepEqual(offenders, [], `no executable MAS runtime references (only comments/guard allowed):\n${offenders.join("\n")}`);
});

// ===========================================================================
// REAL-DEP (gated): B1-real / B2 / B3 — true deepseek-v4-flash + true M-RT
// PostgresSaver run the whole chain. Skipped when the real deps are absent.
// ===========================================================================

const REAL_DB = process.env.DATABASE_URL;
const REAL_DEEPSEEK =
  process.env.AI_PROVIDER_PLAN === "deepseek" && !!process.env.DEEPSEEK_API_KEY;
const RUN_REAL = !!REAL_DB && REAL_DEEPSEEK;
const realTest = RUN_REAL ? test : test.skip;

// Shared thread id between B1-real (writes the checkpoint via the live chain)
// and B2 (asserts it landed in agent_runtime, isolated from public).
const REAL_THREAD = `int-real-${process.pid}-${Date.now()}`;

/** Best-effort pool teardown so the node:test process can exit cleanly. */
async function closeAgentPools() {
  try {
    const { closeAgentRuntime } = await import("../../src/services/agent/agentRuntime.js");
    await closeAgentRuntime();
  } catch {
    /* ignore — best effort */
  }
}

realTest("B1-real + B3: real deepseek-v4-flash streams token + uiHint(plan_card) + done", async () => {
  // B3: the resolved model id IS deepseek-v4-flash (no deepseek-chat/reasoner).
  const { loadModel } = await import("../../src/services/llm.js");
  const model = (await loadModel("plan")) as { model?: string };
  assert.ok(
    typeof model.model === "string" && model.model.includes("deepseek-v4-flash"),
    `model id must contain deepseek-v4-flash (got ${model.model})`,
  );
  assert.equal(
    /deepseek-chat|reasoner/.test(model.model ?? ""),
    false,
    "no legacy deepseek-chat/reasoner",
  );

  // B1-real: the REAL composed service runs the live chain. The LLM is the one
  // unstable dep (L009); a transient model error is retried up to 3 attempts so
  // a one-off flake does not flunk the integration proof. A clean run yields
  // token(s) + uiHint(plan_card) + done (verified empirically: the live agent
  // emits a fenced, validation-passing plan_card on a normal call).
  const { deepAgentService } = await import("../../src/services/agent/DeepAgentService.js");
  deepAgentService.resetAgentCache?.("plan");
  const svc = composeCardValidatingService(deepAgentService);

  let lastEvents: AgentEvent[] = [];
  let success = false;
  for (let attempt = 1; attempt <= 3 && !success; attempt += 1) {
    const events: AgentEvent[] = [];
    const attemptThread = `${REAL_THREAD}-a${attempt}`;
    for await (const e of svc.chat({
      userId: VALID_USER,
      message: "帮我做增肌计划，3天/周，家用哑铃",
      scenario: "plan",
      threadId: attemptThread,
    } as ChatRequest)) {
      events.push(e);
    }
    lastEvents = events;
    const tokens = events.filter((e) => e.type === "token");
    const hint = events.find((e) => e.type === "uiHint");
    const done = events.some((e) => e.type === "done");
    const transientError = events.some((e) => e.type === "error");
    if (tokens.length >= 1 && hint && done) {
      assert.equal((hint.card as { type?: string }).type, "plan_card");
      success = true;
    } else if (!transientError) {
      // Non-error, non-success shape is a real wiring failure — fail fast.
      assert.fail(`real chain did not yield token+uiHint+done; types=${JSON.stringify(events.map((e) => e.type))}`);
    }
    // else: transient model error -> retry next attempt (L009).
  }
  assert.ok(success, "real chain produced token(s) + uiHint(plan_card) + done within retry budget");

  await closeAgentPools();
});

realTest("B2: real chain persisted an agent_runtime checkpoint (isolated from public)", async () => {
  // Drive ONE real chat turn (raw DeepAgentService writes a checkpoint per
  // super-step via the M-RT PostgresSaver), then prove the row is in
  // agent_runtime and NOT in public.
  const { deepAgentService } = await import("../../src/services/agent/DeepAgentService.js");
  const threadId = `int-b2-${process.pid}-${Date.now()}`;
  let sawToken = false;
  for await (const e of (deepAgentService as AgentService).chat({
    userId: VALID_USER,
    message: "Reply with the single word: OK",
    scenario: "chat",
    threadId,
  } as ChatRequest)) {
    if (e.type === "token") {
      sawToken = true;
      break; // one super-step is enough to write a checkpoint
    }
  }
  assert.ok(sawToken, "real chat produced at least one token (checkpoint written)");

  const pg = (await import("pg")).default;
  const pool = new pg.Pool({ connectionString: REAL_DB as string });
  try {
    const rt = await pool.query(
      `SELECT count(*)::int AS n FROM "agent_runtime".checkpoints WHERE thread_id = $1`,
      [threadId],
    );
    assert.ok((rt.rows[0] as { n: number }).n >= 1, "agent_runtime.checkpoints has this thread");

    const leaked = await pool.query(
      `SELECT count(*)::int AS n FROM public.checkpoints WHERE thread_id = $1`,
      [threadId],
    );
    assert.equal((leaked.rows[0] as { n: number }).n, 0, "this thread did NOT land in public.checkpoints");
  } finally {
    await pool.end();
    await closeAgentPools();
  }
});
