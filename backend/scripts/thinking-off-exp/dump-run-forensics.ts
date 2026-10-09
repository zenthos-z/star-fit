/**
 * 关思考实验取证 dump（零 LLM 成本，纯 DB 读）——把 KEEP=1 保留的实验 thread
 * 全量导出为 JSON：逐消息（类型/tool_calls 名+参数/工具返回全文），供质量门
 * 离线分析（submit 参数完整性、instantiate 空壳形态、剂量抽查）。
 *
 * 用法（backend/ 下）：
 *   DATABASE_URL=… npx tsx scripts/thinking-off-exp/dump-run-forensics.ts <cpThreadId>… > out.json
 */
import { getAgentRuntimeCheckpointer } from "../../src/services/agent/agentRuntime.js";

async function main(): Promise<void> {
  const ids = process.argv.slice(2);
  if (ids.length === 0) {
    console.error("usage: dump-run-forensics.ts <cpThreadId>…");
    process.exit(2);
  }
  const cp = getAgentRuntimeCheckpointer() as unknown as {
    getTuple(cfg: {
      configurable: { thread_id: string };
    }): Promise<{
      checkpoint?: { channel_values?: { messages?: unknown[] } };
    } | undefined>;
  };
  const out: unknown[] = [];
  for (const id of ids) {
    const tuple = await cp.getTuple({ configurable: { thread_id: id } });
    const msgs = (tuple?.checkpoint?.channel_values?.messages ?? []) as Array<
      Record<string, any>
    >;
    out.push({
      thread: id,
      messages: msgs.map((m, i) => {
        const kind =
          typeof m._getType === "function"
            ? m._getType()
            : String(m.type ?? m.role ?? "?");
        const calls = (m.tool_calls ?? []).map((t: any) => ({
          name: t?.name,
          args: t?.args,
        }));
        return {
          i,
          kind,
          tool_calls: calls.length ? calls : undefined,
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
        };
      }),
    });
  }
  process.stdout.write(JSON.stringify(out, null, 1));
  process.exit(0);
}

void main();
