/**
 * End-to-end SSE tests over the REAL Fastify HTTP path + REAL SSE transport
 * (hijack / sseEncode / raw.end). Only the unstable LLM is faked (A018/L100:
 * never fake the SSE layer — that is the real path under test).
 *
 * Covers:
 *   B3 — error isolation: a throwing agent -> client receives a typed error
 *        frame and the connection CLOSES (does not hang).
 *   B4 — real SSE streaming: fake agent -> client receives >=2 token frames
 *        and exactly 1 done frame over a real chunked stream.
 *
 * The fake agents emit deepagents-shaped RAW chunks and convert them to token
 * AgentEvents via the shared `tokenFromChunk` extractor (P007), proving the
 * extractor is load-bearing on the real SSE path.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify, { type FastifyInstance } from "fastify";
import type { AgentEvent, AgentService, ChatRequest } from "shared/contracts";
import {
  postChat,
  setAgentServiceResolver,
} from "../../src/controllers/chatController.js";
import { tokenFromChunk } from "../../src/sse/agentSse.js";

const VALID_USER = "00000000-0000-0000-0000-0000000000aa";

/** Start a minimal Fastify app exposing /api/chat. */
async function startApp(): Promise<{ app: FastifyInstance; baseUrl: string }> {
  const app = Fastify({ logger: false });
  app.post("/api/chat", postChat);
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return { app, baseUrl: `http://127.0.0.1:${port}` };
}

/** Parse all SSE frames from a fetch Response stream into AgentEvent objects. */
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
    // SSE frames are separated by a blank line (\n\n).
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

/** POST JSON helper. */
async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-user-id": VALID_USER,
    },
    body: JSON.stringify(body),
  });
}

test.afterEach(() => {
  // Restore the real DeepAgentService resolver so tests never leak a fake.
  setAgentServiceResolver(null);
});

// ---------------------------------------------------------------------------
// B4: real SSE streaming — >=2 token frames + 1 done, real transport layer
// ---------------------------------------------------------------------------

test("B4 real SSE: fake agent streams >=2 token frames + 1 done over /api/chat", async () => {
  // Probe-style fake agent (L009/L100): emits deepagents-shaped RAW chunks
  // ([AIMessageChunk, metadata] tuples) and converts them to token AgentEvents
  // via the SHARED tokenFromChunk extractor (P007). The SSE transport stays real.
  const fakeAgent: AgentService = {
    chat(_req: ChatRequest): AsyncIterable<AgentEvent> {
      return (async function* generate(): AsyncIterable<AgentEvent> {
        const rawChunks: unknown[] = [
          [{ content: "Hello" }, { langgraph_node: "agent" }],
          [{ content: " world" }, { langgraph_node: "agent" }],
          // tool-call-only chunk -> extractor yields no token (still fine)
          [{ content: [{ type: "tool_use", name: "x", id: "t1" }] }, {}],
          [{ content: "!" }, {}],
        ];
        for (const chunk of rawChunks) {
          const text = tokenFromChunk(chunk);
          if (text !== null) {
            yield { type: "token", text };
          }
        }
        yield { type: "done" };
      })();
    },
  };
  setAgentServiceResolver(async () => fakeAgent);

  const { app, baseUrl } = await startApp();
  try {
    const res = await postJson(`${baseUrl}/api/chat`, { message: "hi" });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "text/event-stream; charset=utf-8");

    const events = await readSseFrames(res);
    const tokens = events.filter((e) => e.type === "token");
    const done = events.filter((e) => e.type === "done");

    assert.ok(tokens.length >= 2, `expected >=2 token frames, got ${tokens.length}`);
    assert.equal(done.length, 1, "expected exactly 1 done frame");
    assert.deepEqual(
      tokens.map((e) => e.text),
      ["Hello", " world", "!"],
    );
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// B3: error isolation — throwing agent -> error frame + connection CLOSES
// ---------------------------------------------------------------------------

test("B3 error isolation: throwing agent yields error frame and connection closes (no hang)", async () => {
  const throwingAgent: AgentService = {
    chat(_req: ChatRequest): AsyncIterable<AgentEvent> {
      return (async function* generate(): AsyncIterable<AgentEvent> {
        yield { type: "token", text: "partial" };
        throw new Error("agent stream exploded");
      })();
    },
  };
  setAgentServiceResolver(async () => throwingAgent);

  const { app, baseUrl } = await startApp();
  try {
    const res = await postJson(`${baseUrl}/api/chat`, { message: "hi" });
    assert.equal(res.status, 200);

    // readSseFrames RESOLVES only when the reader hits `done` — i.e. the server
    // closed the connection. If the connection hung, this await would hang and
    // the test would time out. Reaching this line proves the connection closed.
    const events = await readSseFrames(res);

    const tokens = events.filter((e) => e.type === "token");
    const errors = events.filter((e) => e.type === "error");

    assert.equal(tokens.length, 1, "the partial token before the throw is flushed");
    assert.equal(errors.length, 1, "exactly one typed error frame");
    assert.equal(errors[0].error?.code, "INTERNAL");
    assert.equal(errors[0].error?.message, "agent stream exploded");
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// (B5 removed) /agent/plan endpoint + planController deleted in Phase 0 cleanup.
// Plan generation now lives exclusively behind /api/chat (scenario=plan).
// ---------------------------------------------------------------------------
