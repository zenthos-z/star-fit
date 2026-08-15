/**
 * Unit tests for the SSE transport pure functions + P007 hijack skeleton.
 * Covers B1 (sseEncode / tokenFromChunk pure) and B2 (hijack + finally end).
 *
 * No HTTP, no DB, no LLM — these exercise the pure encoding surface and the
 * streamAgentSSE control-flow skeleton against a mock FastifyReply.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyReply } from "fastify";
import type { AgentEvent } from "shared/contracts";
import { sseEncode, tokenFromChunk, streamAgentSSE } from "../../src/sse/agentSse.js";

// ---------------------------------------------------------------------------
// B1: sseEncode — pure, one frame per AgentEvent, double-newline terminated
// ---------------------------------------------------------------------------

test("B1 sseEncode: token event -> data frame with double newline", () => {
  const out = sseEncode({ type: "token", text: "Hello" });
  assert.equal(out, 'data: {"type":"token","text":"Hello"}\n\n');
  // SSE frame terminator: exactly one blank line (double \n) after the payload.
  assert.ok(out.endsWith("\n\n"));
});

test("B1 sseEncode: uiHint event carries the card payload", () => {
  const ev: AgentEvent = {
    type: "uiHint",
    card: { type: "plan", title: "Day 1", data: { sets: 3 }, priority: 1 },
  };
  const out = sseEncode(ev);
  assert.ok(out.startsWith("data: "));
  assert.ok(out.endsWith("\n\n"));
  const payload = JSON.parse(out.slice("data: ".length, -2));
  assert.equal(payload.type, "uiHint");
  assert.equal(payload.card.title, "Day 1");
});

test("B1 sseEncode: done event has no extra fields", () => {
  const out = sseEncode({ type: "done" });
  assert.equal(out, 'data: {"type":"done"}\n\n');
});

test("B1 sseEncode: error event carries structured error", () => {
  const ev: AgentEvent = {
    type: "error",
    error: { code: "MODEL_ERROR", message: "boom" },
  };
  const out = sseEncode(ev);
  const payload = JSON.parse(out.slice("data: ".length, -2));
  assert.equal(payload.type, "error");
  assert.equal(payload.error.code, "MODEL_ERROR");
  assert.equal(payload.error.message, "boom");
});

test("B1 sseEncode: pure — same input yields identical output, no mutation", () => {
  const ev: AgentEvent = { type: "token", text: "x" };
  const a = sseEncode(ev);
  const b = sseEncode(ev);
  assert.equal(a, b);
  assert.deepEqual(ev, { type: "token", text: "x" }); // input not mutated
});

// ---------------------------------------------------------------------------
// B1: tokenFromChunk — defensive over all chunk shapes
// ---------------------------------------------------------------------------

test("B1 tokenFromChunk: bare string", () => {
  assert.equal(tokenFromChunk("hello"), "hello");
  assert.equal(tokenFromChunk(""), null);
});

test("B1 tokenFromChunk: [AIMessageChunk, metadata] tuple with string content", () => {
  const chunk = [{ content: "token!" }, { langgraph_node: "agent" }];
  assert.equal(tokenFromChunk(chunk), "token!");
});

test("B1 tokenFromChunk: tuple with multimodal content blocks concatenates text", () => {
  const chunk = [
    { content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] },
    {},
  ];
  assert.equal(tokenFromChunk(chunk), "ab");
});

test("B1 tokenFromChunk: tool-call-only chunk -> null (no prose)", () => {
  const chunk = [{ content: [{ type: "tool_use", name: "search", id: "t1" }] }, {}];
  assert.equal(tokenFromChunk(chunk), null);
});

test("B1 tokenFromChunk: state object with .messages uses last message", () => {
  const chunk = { messages: [{ content: "old" }, { content: "new" }] };
  assert.equal(tokenFromChunk(chunk), "new");
});

test("B1 tokenFromChunk: empty / metadata-only / null -> null", () => {
  assert.equal(tokenFromChunk(null), null);
  assert.equal(tokenFromChunk(undefined), null);
  assert.equal(tokenFromChunk({}), null);
  assert.equal(tokenFromChunk([]), null);
  assert.equal(tokenFromChunk({ messages: [] }), null);
});

// ---------------------------------------------------------------------------
// B2: streamAgentSSE hijack skeleton — mock FastifyReply
// ---------------------------------------------------------------------------

/**
 * Minimal mock of the FastifyReply surface streamAgentSSE touches: hijack(),
 * raw.writeHead / raw.write / raw.once('drain') / raw.end. Records frames and
 * whether hijack + end were invoked.
 */
interface MockReply {
  hijacked: boolean;
  ended: boolean;
  writeHeadStatus: number | null;
  writeHeadHeaders: Record<string, string> | null;
  frames: string[];
  raw: {
    writeHead(status: number, headers: Record<string, string>): void;
    write(frame: string): boolean;
    once(_event: string, cb: () => void): void;
    end(): void;
  };
}

function makeMockReply(): MockReply {
  const mock: MockReply = {
    hijacked: false,
    ended: false,
    writeHeadStatus: null,
    writeHeadHeaders: null,
    frames: [],
    raw: {
      writeHead(status: number, headers: Record<string, string>) {
        mock.writeHeadStatus = status;
        mock.writeHeadHeaders = headers;
      },
      write(frame: string): boolean {
        mock.frames.push(frame);
        return true; // no backpressure
      },
      once() {
        /* drain listener never needed: write always returns true */
      },
      end() {
        mock.ended = true;
      },
    },
  };
  return mock;
}

/** Build a mock typed as FastifyReply for streamAgentSSE (test-only cast). */
function asReply(mock: MockReply): FastifyReply {
  return {
    hijack: () => {
      mock.hijacked = true;
    },
    raw: mock.raw,
  } as unknown as FastifyReply;
}

test("B2 streamAgentSSE: hijacks, writes SSE headers, encodes each event, ends once", async () => {
  const mock = makeMockReply();
  async function* events(): AsyncIterable<AgentEvent> {
    yield { type: "token", text: "Hi" };
    yield { type: "done" };
  }

  await streamAgentSSE(asReply(mock), events());

  assert.equal(mock.hijacked, true, "reply.hijack() must be called");
  assert.equal(mock.writeHeadStatus, 200);
  assert.equal(mock.writeHeadHeaders?.["Content-Type"], "text/event-stream; charset=utf-8");
  assert.equal(mock.frames.length, 2, "one frame per event");
  assert.equal(mock.frames[0], 'data: {"type":"token","text":"Hi"}\n\n');
  assert.equal(mock.frames[1], 'data: {"type":"done"}\n\n');
  assert.equal(mock.ended, true, "finally must call raw.end()");
});

test("B2/B3 streamAgentSSE: throwing generator -> typed error frame, then end (never hangs)", async () => {
  const mock = makeMockReply();
  async function* boom(): AsyncIterable<AgentEvent> {
    yield { type: "token", text: "partial" };
    throw new Error("generator exploded");
  }

  await streamAgentSSE(asReply(mock), boom());

  // The token before the throw is still flushed.
  assert.equal(mock.frames.length, 2);
  assert.equal(mock.frames[0], 'data: {"type":"token","text":"partial"}\n\n');
  // The catch emits exactly one typed error frame (never rethrows).
  const errPayload = JSON.parse(mock.frames[1].slice("data: ".length, -2));
  assert.equal(errPayload.type, "error");
  assert.equal(errPayload.error.code, "INTERNAL");
  assert.equal(errPayload.error.message, "generator exploded");
  // finally ALWAYS ends the connection — the core P007 anti-hang guarantee.
  assert.equal(mock.ended, true);
});

test("B2 streamAgentSSE: error event from the seam is encoded verbatim (not re-mapped)", async () => {
  const mock = makeMockReply();
  async function* events(): AsyncIterable<AgentEvent> {
    yield { type: "error", error: { code: "MODEL_ERROR", message: "rate limited" } };
  }

  await streamAgentSSE(asReply(mock), events());

  assert.equal(mock.frames.length, 1);
  const payload = JSON.parse(mock.frames[0].slice("data: ".length, -2));
  assert.equal(payload.error.code, "MODEL_ERROR");
  assert.equal(mock.ended, true);
});
