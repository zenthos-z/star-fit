/**
 * extract-tool-rounds.ts — 从 agent_runtime checkpointer 读 thread 消息，
 * 输出每 turn 的模型轮次与工具调用序列（replay-baseline 的离线补充；
 * collectToolRounds 在进程内跑时对消息类型识别失败，本脚本独立排查+取数）。
 *
 * 零 LLM 成本（纯 DB 读）。用法（backend/ 下）：
 *   DATABASE_URL=… npx tsx scripts/jev-nodes-research/extract-tool-rounds.ts <threadId> [<threadId>…]
 */
import { getAgentRuntimeCheckpointer } from "../../src/services/agent/agentRuntime.js";

async function main(): Promise<void> {
  const ids = process.argv.slice(2);
  if (ids.length === 0) {
    console.error("usage: extract-tool-rounds.ts <threadId>…");
    process.exit(2);
  }
  const cp = getAgentRuntimeCheckpointer() as unknown as {
    getTuple(cfg: {
      configurable: { thread_id: string };
    }): Promise<{
      checkpoint?: { channel_values?: { messages?: unknown[] } };
    } | undefined>;
  };
  for (const threadId of ids) {
    const tuple = await cp.getTuple({ configurable: { thread_id: threadId } });
    const msgs = (tuple?.checkpoint?.channel_values?.messages ?? []) as Array<
      Record<string, unknown>
    >;
    console.log(`\n=== thread ${threadId}: ${msgs.length} messages ===`);
    let turn = 0;
    let tools: string[] = [];
    let modelRounds = 0;
    const flush = (label: string) => {
      if (turn > 0)
        console.log(
          `turn ${turn} [${label}] 模型轮次=${modelRounds} 工具=[${tools.join(" → ")}]`,
        );
    };
    for (const msg of msgs) {
      const proto = Object.getPrototypeOf(msg) as { constructor?: { name?: string } };
      const ctor = proto?.constructor?.name ?? "?";
      // langchain 消息实例：用 _getType()（BaseMessage 契约）
      const t =
        typeof (msg as { _getType?: () => string })._getType === "function"
          ? (msg as { _getType: () => string })._getType()
          : ctor;
      if (t === "human") {
        flush("prev");
        turn += 1;
        tools = [];
        modelRounds = 0;
        const content = String(
          (msg as { content?: unknown }).content ?? "",
        ).slice(0, 30);
        console.log(`- human[${turn}]: ${content}…`);
      } else if (t === "ai") {
        modelRounds += 1;
        const calls = ((msg as { tool_calls?: Array<{ name?: string }> })
          .tool_calls ?? []) as Array<{ name?: string }>;
        for (const c of calls) tools.push(String(c.name ?? "?"));
      } else {
        console.log(`- (${t}/${ctor})`);
      }
    }
    flush("last");
  }
  process.exit(0);
}

void main();
