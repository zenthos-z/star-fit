/**
 * B6 验证用 GLM mock 端点（issue #39 后端批）—— 纯 Node，零依赖。
 *
 * 用途：在无真实 GLM_API_KEY 的环境验证「chat SSE 进行中，建议缓存重算
 * 任务不抢占对话流」（验证门 c）。只伪造 LLM HTTP 层（OpenAI 兼容
 * /chat/completions），后端 Agent 管线（deepagents/工具/checkpoint）全部真实。
 *
 * 行为：
 * - POST /chat/completions（任意路径后缀），body.stream=true → SSE 分块（每个间隔
 *   MOCK_INTERVAL_MS 发 1 个 token，共 MOCK_TOKENS 个，然后 finish [DONE]）
 * - body.stream 缺省/false → 普通 JSON completion（一轮直达答案）
 * - GET /__health → 200（起服探针）
 *
 * env：PORT（默认 43199）/ MOCK_TOKENS（默认 30）/ MOCK_INTERVAL_MS（默认 800）
 */

import http from "node:http";

const PORT = Number(process.env.PORT) || 43199;
const MOCK_TOKENS = Number(process.env.MOCK_TOKENS) || 30;
const MOCK_INTERVAL_MS = Number(process.env.MOCK_INTERVAL_MS) || 800;
const MODEL = process.env.MOCK_MODEL || "glm-5.3-flash";

function chunk(content, finishReason = null, withRole = false) {
  return JSON.stringify({
    id: "chatcmpl-b6mock",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: MODEL,
    choices: [
      {
        index: 0,
        // 首个 delta 必须带 role:"assistant"——OpenAI 协议语义；缺失时
        // langchain-openai 会把 chunk 归为 ChatMessageChunk（而非
        // AIMessageChunk），deepagents 中间件校验直接报
        // "expected AIMessage or Command, got object"（实测踩坑）。
        delta: withRole ? { role: "assistant", content } : { content },
        finish_reason: finishReason,
      },
    ],
  });
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url.startsWith("/__health")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, mock: "b6-glm" }));
    return;
  }
  if (req.method !== "POST" || !req.url.includes("/chat/completions")) {
    res.writeHead(404);
    res.end("not found");
    return;
  }

  let body = "";
  req.on("data", (d) => {
    body += d;
  });
  req.on("end", () => {
    let stream = false;
    try {
      stream = JSON.parse(body || "{}").stream === true;
    } catch {
      stream = false;
    }
    // 每请求一行日志：验证门 c 排障时确认「Agent 管线是否真的打到了 mock」
    console.log(
      `[b6-mock-glm] ${req.method} ${req.url} stream=${stream} bytes=${body.length}`,
    );
    const answer =
      "收到。这轮对话由 B6 验证 mock 端点代答：建议缓存重算与对话隔离，" +
      "本流按固定节奏持续输出 token，用于观察期间后端空闲任务的行为。";

    if (!stream) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "chatcmpl-b6mock",
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: MODEL,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: answer },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
      return;
    }

    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    let sent = 0;
    const timer = setInterval(() => {
      if (sent >= MOCK_TOKENS) {
        clearInterval(timer);
        // 收尾与真实 OpenAI 一致：空 delta {}，finish_reason 承载 stop。
        // （空 content 的 delta 若无 role 同样会被归为 ChatMessageChunk，
        //  与首帧同坑，故此处直接给空对象。）
        res.write(
          `data: ${JSON.stringify({
            id: "chatcmpl-b6mock",
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: MODEL,
            choices: [
              { index: 0, delta: {}, finish_reason: "stop" },
            ],
          })}\n\n`,
        );
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }
      res.write(`data: ${chunk(`token${sent} `, null, sent === 0)}\n\n`);
      sent += 1;
    }, MOCK_INTERVAL_MS);
    // Node ≥16 语义：req 的 'close' 在请求体读毕即触发（不等连接断开），
    // 用它清 interval 会把流掐死在第一个 tick 前（实测：请求已记日志但
    // 零字节响应，LangChain 侧表现为无休止等待）。真正的「客户端断开」
    // 信号在 res 上。
    res.on("close", () => clearInterval(timer));
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[b6-mock-glm] listening on http://127.0.0.1:${PORT}`);
});
