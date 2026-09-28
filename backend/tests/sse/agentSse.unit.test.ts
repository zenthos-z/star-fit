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
import {
  sseEncode,
  tokenFromChunk,
  streamAgentSSE,
  SSE_PING_INTERVAL_MS,
} from "../../src/sse/agentSse.js";

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
    {
      content: [
        { type: "text", text: "a" },
        { type: "text", text: "b" },
      ],
    },
    {},
  ];
  assert.equal(tokenFromChunk(chunk), "ab");
});

test("B1 tokenFromChunk: tool-call-only chunk -> null (no prose)", () => {
  const chunk = [
    { content: [{ type: "tool_use", name: "search", id: "t1" }] },
    {},
  ];
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
    // streamAgentSSE reads reply.request.headers.origin for the hijacked-CORS
    // mirror — a bare mock without `request` crashes there (the 3 pre-existing
    // failures this mock now repairs).
    request: { headers: {} },
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
  assert.equal(
    mock.writeHeadHeaders?.["Content-Type"],
    "text/event-stream; charset=utf-8",
  );
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
    yield {
      type: "error",
      error: { code: "MODEL_ERROR", message: "rate limited" },
    };
  }

  await streamAgentSSE(asReply(mock), events());

  assert.equal(mock.frames.length, 1);
  const payload = JSON.parse(mock.frames[0].slice("data: ".length, -2));
  assert.equal(payload.error.code, "MODEL_ERROR");
  assert.equal(mock.ended, true);
});

// ---------------------------------------------------------------------------
// B5b: 15s ping keepalive frames (issue #38 SSE ①)
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

test("B5b keepalive constant: ping interval is 15s", () => {
  assert.equal(SSE_PING_INTERVAL_MS, 15_000);
});

test("B5b streamAgentSSE: idle generator emits ': ping' comment frames, stalled event still delivered exactly once", async () => {
  const mock = makeMockReply();
  // Generator stalls 60ms between events; ping interval 10ms -> several pings.
  async function* slowEvents(): AsyncIterable<AgentEvent> {
    yield { type: "token", text: "before-stall" };
    await sleep(60);
    yield { type: "token", text: "after-stall" };
    await sleep(60);
    yield { type: "done" };
  }

  await streamAgentSSE(asReply(mock), slowEvents(), { pingIntervalMs: 10 });

  const pings = mock.frames.filter((f) => f === ": ping\n\n");
  assert.ok(
    pings.length >= 2,
    `expected keepalive pings during stalls, got ${pings.length}`,
  );
  // Pings are SSE comment frames — no `data:` line, invisible to parsers.
  for (const p of pings) {
    assert.ok(
      !p.startsWith("data: "),
      "ping frame must not carry a data: line",
    );
  }
  // The stalled events still arrive exactly once (pending next() preserved
  // across ping rounds — no loss, no duplication).
  const dataFrames = mock.frames.filter((f) => f.startsWith("data: "));
  assert.deepEqual(
    dataFrames.map(
      (f) => JSON.parse(f.slice("data: ".length, -2)).text ?? "<none>",
    ),
    ["before-stall", "after-stall", "<none>"],
  );
  // Frame ORDER: every ping sits between the surrounding data frames.
  assert.equal(
    mock.frames[0],
    'data: {"type":"token","text":"before-stall"}\n\n',
  );
  const lastData = dataFrames[dataFrames.length - 1];
  assert.equal(lastData, 'data: {"type":"done"}\n\n');
  assert.equal(mock.ended, true);
});

test("B5b streamAgentSSE: fast generator emits NO ping frames (default-like cadence)", async () => {
  const mock = makeMockReply();
  async function* fastEvents(): AsyncIterable<AgentEvent> {
    yield { type: "token", text: "a" };
    yield { type: "token", text: "b" };
    yield { type: "done" };
  }

  // Even with a 10ms ping interval, a generator that never stalls loses the
  // race every time (events resolve on the same microtask chain).
  await streamAgentSSE(asReply(mock), fastEvents(), { pingIntervalMs: 10 });

  assert.equal(mock.frames.filter((f) => f === ": ping\n\n").length, 0);
  assert.equal(mock.frames.length, 3, "one frame per event, zero pings");
  assert.equal(mock.ended, true);
});

test("B5b streamAgentSSE: no ping after the stream ends (timer path retired)", async () => {
  const mock = makeMockReply();
  async function* events(): AsyncIterable<AgentEvent> {
    yield { type: "done" };
  }

  await streamAgentSSE(asReply(mock), events(), { pingIntervalMs: 5 });
  const framesAtEnd = mock.frames.length;
  assert.equal(mock.ended, true);

  // Wait past several ping intervals after completion — nothing more is written.
  await sleep(40);
  assert.equal(mock.frames.length, framesAtEnd, "no frames after end()");
});

test("B5b streamAgentSSE: throwing generator during stall -> error frame after pings, end still called", async () => {
  const mock = makeMockReply();
  async function* stallThenThrow(): AsyncIterable<AgentEvent> {
    yield { type: "token", text: "partial" };
    await sleep(40);
    throw new Error("died mid-stall");
  }

  await streamAgentSSE(asReply(mock), stallThenThrow(), { pingIntervalMs: 10 });

  // Pings flowed during the stall, then the typed error frame closed it out.
  assert.ok(mock.frames.filter((f) => f === ": ping\n\n").length >= 1);
  const errFrame = mock.frames[mock.frames.length - 1];
  const payload = JSON.parse(errFrame.slice("data: ".length, -2));
  assert.equal(payload.type, "error");
  assert.equal(payload.error.message, "died mid-stall");
  assert.equal(mock.ended, true);
});
