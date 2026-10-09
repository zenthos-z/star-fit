/**
 * #80（2026-10-09）：toolResultFlats 复述锚无界增长——同消息 id 跨快照只收集一次。
 *
 * 背景：PR #79 独立验收观察项（issue #80 #1，"最有价值"项）。classifyAgentStream
 * 每个快照都调 collectToolResults，长会话中 before_agent 历史重放把 checkpoint
 * 里全部工具返回随快照重新下发——同一条 ToolMessage 反复扁平化进 sink。sink
 * 只做 includes 存在性判定（isToolResultEcho），重复条目零语义价值，却让重复
 * 扁平化与 O(n·m) 扫描开销随会话轮次累积。
 *
 * 修复=按消息 id 去重（checkpoint 持久化、跨轮稳定；id 命中在扁平化前短路，
 * 重放快照不再重复付扁平化成本），无 id 消息按扁平文本兜底（内容相同 ⟹ 锚值
 * 相同）。二选一里选了「去重」而非「最新窗口」：窗口会丢历史锚，改变吞卡救援
 * （refs #73）的判别语义；去重语义零变化。
 *
 * Runner: node:test via tsx（与 __tests__ 其余文件一致）。
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { collectToolResults } from "../DeepAgentService.js";

/** 构造一条 tool 消息（_getType 形态，与生产 LangChain ToolMessage 同构）。 */
function toolMsg(content: string, id?: string): Record<string, unknown> {
  return { _getType: () => "tool", content, ...(id ? { id } : {}) };
}

/** 构造一个 updates 快照：{ nodeName: { messages } }。 */
function snapshot(
  node: string,
  messages: unknown[],
): Record<string, { messages?: unknown[] }> {
  return { [node]: { messages } };
}

describe("#80 collectToolResults 同消息去重（sink 存在性判定零语义损失）", () => {
  it("1. 同消息 id 跨快照只收集一次（确定性断言）", () => {
    const sink: string[] = [];
    const seen = new Set<string>();
    const receipt = toolMsg(
      '{"ok":true,"userId":"u1","key":"post_workout_feedback_20261008"}',
      "msg-1",
    );
    // tools 节点快照：新工具返回落地
    collectToolResults(snapshot("tools", [receipt]), sink, seen);
    assert.equal(sink.length, 1);
    // before_agent 历史重放：同一条 ToolMessage 随 checkpoint 历史再次下发
    collectToolResults(snapshot("before_agent", [receipt]), sink, seen);
    assert.equal(sink.length, 1, "同 id 重复快照不得重复收集");
    // 新消息照常收集
    collectToolResults(
      snapshot("tools", [toolMsg("另一个返回", "msg-2")]),
      sink,
      seen,
    );
    assert.equal(sink.length, 2);
    // 锚值语义不丢：先收的返回仍可命中 includes 存在性判定
    assert.ok(sink[0]!.includes('"ok":true'));
    assert.ok(sink.some((t) => t === "另一个返回"));
  });

  it("2. id 命中在扁平化前短路——重放快照不再重复读取/扁平化 content", () => {
    const sink: string[] = [];
    const seen = new Set<string>();
    collectToolResults(
      snapshot("before_agent", [toolMsg("X".repeat(4096), "msg-heavy")]),
      sink,
      seen,
    );
    assert.equal(sink.length, 1);
    let contentReads = 0;
    const spyMsg = {
      get _getType(): () => string {
        return () => "tool";
      },
      get id(): string {
        return "msg-heavy";
      },
      get content(): string {
        contentReads += 1;
        return "X".repeat(4096);
      },
    };
    collectToolResults(snapshot("before_agent", [spyMsg]), sink, seen);
    assert.equal(sink.length, 1, "同 id 仍不重复收集");
    assert.equal(contentReads, 0, "id 命中后不得再次读取 content（短路）");
  });

  it("3. 无 id 消息按扁平文本兜底去重；不同内容照常收集", () => {
    const sink: string[] = [];
    const seen = new Set<string>();
    collectToolResults(snapshot("tools", [toolMsg('{"a":1}')]), sink, seen);
    // 重放：无 id 但内容相同 → 兜底去重（内容相同 ⟹ 锚值相同，零语义损失）
    collectToolResults(
      snapshot("before_agent", [toolMsg('{"a":  1 }')]),
      sink,
      seen,
    );
    assert.equal(sink.length, 1, "无 id 同内容（扁平化后相同）兜底去重");
    collectToolResults(snapshot("tools", [toolMsg('{"a":2}')]), sink, seen);
    assert.equal(sink.length, 2);
  });

  it("4. 缺省 seen（旧调用方兼容）：每快照独立集合，行为与旧版一致", () => {
    const sink: string[] = [];
    collectToolResults(snapshot("tools", [toolMsg("A", "id-a")]), sink);
    collectToolResults(snapshot("tools", [toolMsg("A", "id-a")]), sink);
    assert.equal(sink.length, 2, "缺省 seen 不跨调用去重（向后兼容）");
  });

  it("5. 非 tool 消息 / 空 content 照旧忽略；扁平化空白归一不回归", () => {
    const sink: string[] = [];
    const seen = new Set<string>();
    collectToolResults(
      snapshot("tools", [
        { _getType: () => "ai", content: "不是工具消息", id: "m1" },
        toolMsg("  带\n空白\t的  返回  ", "m2"),
        toolMsg("   ", "m3"),
      ]),
      sink,
      seen,
    );
    assert.deepEqual(sink, ["带空白的返回"]);
  });
});
