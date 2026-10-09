/**
 * #46（2026-10-09）：stripImageForTextModel 偶发类型错误——响应出口类型收窄。
 *
 * 背景：42a/b5b 验收实录（2026-09-28）——`Invalid response from
 * "wrapModelCall" in middleware "stripImageForTextModel": expected AIMessage
 * or Command, got object`，一次剧本出现、重试即无。考古结论（issue #46）：
 * 观察时点（ca7d2cd）本中间件是唯一自定义中间件
 * （`middleware = hasImage ? undefined : [stripImageMiddleware]`），GLM 无
 * role 尾包把聚合结果映射成 ChatMessageChunk（非 AIMessage 实例，#110/#111
 * 家族）直穿本层，langchain AgentNode 的 isInternalModelResponse 校验在本层
 * 返回处拒绝。#112/#116（2026-10-03）落地后 frameworkTrimMiddleware 在内层
 * 已按 constructor.name 重水化 ChatMessageChunk 家族；本修复=本层响应出口
 * 类型收窄作纵深：内层漏出的「字段同构的消息形对象」（constructor.name 探测
 * 漏判 / 未来 provider 形状漂移）按 42b 先例重水化为 AIMessage（字段同构只
 * 补类型，语义零改动），非消息形对象原样返回交框架校验（行为不变，不吞错）。
 *
 * Runner: node:test via tsx（与 __tests__ 其余文件一致；DeepAgentService 顶层
 * import 链含 skillLoader 的 import.meta，jest CJS 加载不了——同 splitLeaked
 * Reasoning 拆分先例的约束面）。
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { AIMessage, HumanMessage } from "@langchain/core/messages";

import { stripImageMiddleware } from "../DeepAgentService.js";

type Handler = (req: unknown) => Promise<unknown>;

/** 直接驱动 wrapModelCall（与 tests/unit emptyTurnRetry.test.ts 同款姿势）。 */
function callWrap(request: unknown, handler: Handler): Promise<unknown> {
  const hook = stripImageMiddleware.wrapModelCall as unknown as (
    req: unknown,
    h: Handler,
  ) => Promise<unknown>;
  if (typeof hook !== "function") throw new Error("wrapModelCall 缺失");
  return hook(request, handler);
}

describe("#46 stripImageForTextModel 响应出口类型收窄", () => {
  it("1. handler 返回字段同构的消息形对象 → 重水化为 AIMessage（#46 实录家族）", async () => {
    const leaked = {
      content: "回复正文",
      additional_kwargs: {},
      response_metadata: { model_provider: "openai" },
      id: "leak-1",
    };
    const out = await callWrap({ messages: [] }, async () => leaked);
    assert.ok(
      AIMessage.isInstance(out),
      `字段同构消息形对象应重水化为 AIMessage 实例，实际 ${typeof out}`,
    );
    assert.equal((out as AIMessage).content, "回复正文");
    assert.equal((out as { id?: string }).id, "leak-1", "字段同构保留");
  });

  it("2. handler 返回合法 AIMessage → 原样透传（引用相等，零改动）", async () => {
    const msg = new AIMessage({ content: "ok" });
    const out = await callWrap({ messages: [] }, async () => msg);
    assert.ok(out === msg, "合法响应必须原样透传");
  });

  it("3. 非消息形对象（无 content）→ 原样返回交框架校验（行为不变，不吞错）", async () => {
    const weird = { foo: "bar" };
    const out = await callWrap({ messages: [] }, async () => weird);
    assert.ok(out === weird, "非消息形对象不重水化，保持框架既有拒绝路径");
  });

  it("4. structuredResponse+messages 形（结构化输出合同）→ 原样透传", async () => {
    const structured = {
      structuredResponse: { plan: [] },
      messages: [new AIMessage({ content: "" })],
    };
    const out = await callWrap({ messages: [] }, async () => structured);
    assert.ok(out === structured, "三形合同之结构化输出对象原样透传");
  });

  it("5. 洗图行为不回归：带图历史消息 → HumanMessage 纯文本占位，文本保留", async () => {
    const withImage = new HumanMessage({
      content: [
        { type: "text", text: "看我这张图" },
        { type: "image_url", image_url: { url: "data:image/png;base64,xxx" } },
      ],
    });
    let seenReq: unknown;
    const out = await callWrap({ messages: [withImage] }, async (req) => {
      seenReq = req;
      return new AIMessage({ content: "收到" });
    });
    const cleanedMsgs = (seenReq as { messages: unknown[] }).messages;
    assert.equal(cleanedMsgs.length, 1, "消息数不变（原位替换）");
    const replaced = cleanedMsgs[0] as { content: unknown };
    assert.ok(typeof replaced.content === "string", "多模态块数组替换为纯文本");
    assert.ok(String(replaced.content).includes("看我这张图"), "文本块保留");
    assert.ok(String(replaced.content).includes("不再附带"), "占位说明追加");
    assert.equal((out as AIMessage).content, "收到", "响应照常透传");
  });

  it("6. 无图请求 → request 原样透传给 handler（零拷贝路径不回归）", async () => {
    const plain = new HumanMessage({ content: "普通文本" });
    const req = { messages: [plain] };
    let seenReq: unknown;
    await callWrap(req, async (r) => {
      seenReq = r;
      return new AIMessage({ content: "好" });
    });
    assert.ok(seenReq === req, "无图请求原样透传（touched=false 路径）");
  });

  it("7. 非 text/image_url 块（含字符串原语 part）不再依赖可选链兜底——剥离只认对象块", async () => {
    // 原语 part（协议漂移防御）：旧实现 `"x"?.type` 走原语属性访问兜底返回
    // undefined，行为等同跳过；收窄后显式对象判定，同型输入行为不变。
    const odd = new HumanMessage({
      // 测试注入非标准 content（原语 part 混入块数组）——生产不会构造该形态，
      // 类型上按字符串强转绕过 ContentBlock 联合检查。
      content: [
        "str-part",
        { type: "image_url", image_url: { url: "data:image/png;base64,y" } },
      ] as unknown as string,
    });
    let seenReq: unknown;
    await callWrap({ messages: [odd] }, async (req) => {
      seenReq = req;
      return new AIMessage({ content: "好" });
    });
    const replaced = (seenReq as { messages: unknown[] }).messages[0] as {
      content: unknown;
    };
    assert.ok(
      typeof replaced.content === "string",
      "原语 part 被安全跳过，仅追加占位文本",
    );
  });
});
