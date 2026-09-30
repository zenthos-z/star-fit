/**
 * 法证辅助（refs #73 验收）：用生产 checkpointer 反序列化指定 thread 的最终
 * 状态，打印消息清单（类型 / tool_calls / 内容摘要）——排查回放轮次里
 * 「零送达」时模型到底产出了什么。只读，不写库。
 *
 * 用法: npx tsx scripts/dump-thread-state.ts <threadId>
 */
import { getAgentRuntimeCheckpointer } from "../src/services/agent/agentRuntime.js";

async function main() {
  const threadId = process.argv[2];
  if (!threadId) throw new Error("usage: dump-thread-state.ts <threadId>");
  const cp = getAgentRuntimeCheckpointer() as any;
  const tuple = await cp.getTuple({ configurable: { thread_id: threadId } });
  const msgs = (tuple?.checkpoint?.channel_values?.messages ?? []) as Array<
    Record<string, any>
  >;
  console.log(
    `thread=${threadId} messages=${msgs.length} next=${JSON.stringify(tuple?.metadata?.step ?? tuple?.checkpoint?.v ?? "?")}`,
  );
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i]!;
    const kind =
      typeof m._getType === "function"
        ? m._getType()
        : String(m.type ?? m.role ?? "?");
    const tools = (m.tool_calls ?? [])
      .map((t: any) => t?.name ?? "?")
      .join(",");
    let content = m.content;
    if (Array.isArray(content)) {
      content = content
        .map((b: any) => (b.type === "text" ? b.text : `[${b.type}]`))
        .join("|");
    }
    const text = String(content ?? "");
    const head = text.replace(/\s+/g, " ").slice(0, 160);
    console.log(
      `[${i}] ${kind}${tools ? ` tools=(${tools})` : ""} len=${text.length}: ${head}`,
    );
  }
  process.exit(0);
}
main().catch((e) => {
  console.error("DUMP_FAIL:", e?.message ?? e);
  process.exit(1);
});
