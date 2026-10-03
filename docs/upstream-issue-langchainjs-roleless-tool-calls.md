# Upstream issue draft — langchain-ai/langchainjs

> Status: DRAFT ONLY (do not submit without maintainer sign-off internally).
> Target repo: langchain-ai/langchainjs · Package: `@langchain/openai`
> Drafted 2026-10-03, refs starfit PR #110 diagnosis.

---

## Title

Streaming: chat.completions deltas without `role` silently drop `tool_calls` — aggregate becomes `ChatMessageChunk` with empty content

## Package versions

- `@langchain/openai`: 1.5.13 **and** 1.6.2 (latest at time of writing — both affected)
- `@langchain/core`: 1.2.13 / 1.2.14
- `openai`: 7.15.0
- Node: v22.23.1, macOS

## Summary

When an OpenAI-compatible streaming response emits deltas that **never carry a `role` field** but do carry `tool_calls` fragments (with `finish_reason: "tool_calls"` at the end), `ChatOpenAI` silently discards every tool-call increment. The aggregated message is a `ChatMessageChunk` with `content: ""` and **no `tool_calls`**, which downstream consumers (e.g. LangGraph agents) accept as a valid terminal assistant turn — producing a full empty turn with no error.

We hit this in production with Zhipu GLM's OpenAI-compatible endpoint (`https://open.bigmodel.cn/...`), which intermittently omits `role` on **all** deltas of a turn. The stream is otherwise well-formed (the turn was billed for 58 completion tokens, `finish_reason=tool_calls`).

## Root cause

Two spots in `@langchain/openai` (line numbers from the 1.5.13 dist; the function body is byte-identical in 1.6.2):

1. `dist/converters/completions.js` — `convertCompletionsDeltaToBaseMessageChunk`:

   ```js
   const role = delta.role ?? defaultRole;          // :256
   let additional_kwargs;
   if (delta.function_call) ...
   else if (delta.tool_calls) additional_kwargs = { tool_calls: delta.tool_calls };  // :260
   ...
   else return new ChatMessageChunk({               // :313 — role undefined lands here
     content,
     role,
     response_metadata                              // additional_kwargs NOT passed → tool_calls dropped
   });
   ```

2. `dist/chat_models/completions.js:187/197-198` — the anchoring only helps once a chunk carries a role:

   ```js
   let defaultRole;                                 // :187 — stays undefined forever
   for await (const data of streamIterable) {
     ...
     const chunk = this._convertCompletionsDeltaToBaseMessageChunk(delta, data, defaultRole);
     defaultRole = delta.role ?? defaultRole;       // :198 — anchored only by a chunk that HAS role
   }
   ```

If no delta ever carries `role`, every delta of the turn (including all `tool_calls` fragments) is converted via the `else` branch, and the aggregate is `ChatMessageChunk(content='', no tool_calls)`.

## Minimal reproduction

Self-contained script (no network beyond a local loopback mock server; only requires `@langchain/openai`):

```js
// repro.mjs — node repro.mjs
import http from "node:http";

// 1. Mock an OpenAI-compatible SSE endpoint whose deltas NEVER carry `role`.
const chunks = [
  { delta: { tool_calls: [{ index: 0, id: "call_repro_001", type: "function",
      function: { name: "plan_generate", arguments: "" } }] }, finish_reason: null },
  { delta: { tool_calls: [{ index: 0, function: { arguments: '{"plan_' } }] }, finish_reason: null },
  { delta: { tool_calls: [{ index: 0, function: { arguments: 'id":"p-001",' } }] }, finish_reason: null },
  { delta: { tool_calls: [{ index: 0, function: { arguments: '"weeks":4}' } }] }, finish_reason: null },
  { delta: {}, finish_reason: "tool_calls" },
].map((c, i, a) => ({
  id: "chatcmpl-repro001", object: "chat.completion.chunk", created: 1759500000,
  model: "glm-4.6-repro",
  choices: [{ index: 0, delta: c.delta, logprobs: null, finish_reason: c.finish_reason }],
}));

const srv = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/event-stream" });
  res.end(chunks.map((p) => `data: ${JSON.stringify(p)}\n\n`).join("") + "data: [DONE]\n\n");
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const baseURL = `http://127.0.0.1:${srv.address().port}`;

// 2. Feed it to ChatOpenAI.
const { ChatOpenAI } = await import("@langchain/openai");
const model = new ChatOpenAI({
  apiKey: "sk-repro-local", model: "glm-4.6-repro", maxRetries: 0,
  configuration: { baseURL },
});

// Path A: stream + concat (what _generate's streaming branch and core's stream() do)
const collected = [];
for await (const c of await model.stream([{ role: "user", content: "make a 4-week plan" }]))
  collected.push(c);
const aggregate = collected.reduce((acc, c) => acc.concat(c));

// Path B: invoke with a streaming-preferring callback (what LangGraph's AgentNode does)
const invoked = await model.invoke([{ role: "user", content: "make a 4-week plan" }], {
  callbacks: [{ lc_prefer_streaming: true, handleLLMNewToken: () => {} }],
});

for (const [path, msg] of [["stream+concat", aggregate], ["invoke(stream-callback)", invoked]]) {
  console.log(path, {
    class: msg.constructor.name,                       // ChatMessageChunk  ← expected AIMessageChunk
    content: msg.content,                              // ""
    tool_calls: msg.tool_calls ?? msg.additional_kwargs?.tool_calls, // undefined ← expected the parsed call
  });
}
srv.close();
process.exit(0);
```

## Actual vs expected

| | `role` on first delta only (OpenAI shape) | `role` never present (GLM anomalous shape) |
| --- | --- | --- |
| aggregate class | `AIMessageChunk` ✅ | `ChatMessageChunk` ❌ |
| `content` | `""` | `""` |
| `tool_calls` | preserved + parsed ✅ | **silently dropped** ❌ |

Actual output on both 1.5.13 and 1.6.2 (identical):

```
stream+concat ChatMessageChunk { content: '', tool_calls: undefined }
invoke(stream-callback) ChatMessageChunk { content: '', tool_calls: undefined }
```

Expected: since the stream terminated with `finish_reason: "tool_calls"`, the aggregate should be an `AIMessageChunk` carrying the reconstructed tool call (`plan_generate({"plan_id":"p-001","weeks":4})`) — or, at minimum, the loss should not be silent.

## Why it matters

- **Silent data loss with a legal-looking result.** LangGraph accepts the `ChatMessageChunk` aggregate as a valid model response, ends the agent turn with empty output, and nothing errors — we only noticed via billing/finish_reason mismatch in production logs.
- **Any OpenAI-compatible provider can trigger it.** In the Chat Completions streaming schema, `delta` fields are optional; nothing guarantees `role` on any chunk. Providers/gateways that omit it entirely (as GLM intermittently does) turn every tool-calling turn into an empty turn.
- The `defaultRole` anchor only works if at least one chunk in the turn carries `role`.

## Suggested fixes (any one closes the hole)

1. Initialize the anchor to assistant — in `chat_models/completions.js` (`let defaultRole;` → `let defaultRole = "assistant";`): chat-completion stream deltas can only be assistant output, so this is the semantically correct default.
2. Or, in `convertCompletionsDeltaToBaseMessageChunk`, fall back when role is missing: `const role = delta.role ?? defaultRole ?? "assistant";`
3. Or, minimally, pass `additional_kwargs` into the `ChatMessageChunk` construction in the `else` branch so tool-call fragments survive even when the class stays `ChatMessageChunk`.

Option 1/2 also fix the sibling symptom where such turns break `AIMessage.isInstance` checks downstream.

## Version matrix (verified)

| @langchain/openai | @langchain/core | roleless stream + tool_calls |
| --- | --- | --- |
| 1.5.13 | 1.2.13 | tool_calls dropped (stream & invoke paths) |
| 1.6.2 (latest) | 1.2.14 | tool_calls dropped (stream & invoke paths) |

Diff between 1.5.13 and 1.6.2 confirms `convertCompletionsDeltaToBaseMessageChunk` is byte-identical and the `defaultRole` logic is untouched.
