/**
 * System-area probe (issue #42 batch 42b) — measures the FULL system area the
 * model sees on the first call of a turn: composed system prompt (own
 * buildSystemPrompt + deepagents framework injections) + every tool's wire
 * schema (OpenAI function definitions), following the measurement method of
 * docs/agent-prompt-quality-diagnosis.md §1.4/§1.5.
 *
 * 口径 (same ruler before/after):
 *   - system chars  = request.systemMessage.text seen by the innermost
 *     wrapModelCall hook (i.e. AFTER all framework middleware appended their
 *     sections) — the exact string the model receives.
 *   - tool chars    = sum over tools of JSON.stringify(convertToOpenAITool(tool))
 *     (name + description + JSON-schema parameters, the wire format).
 *   - grand total   = system + tool chars.
 *
 * No DB / no network: tools are built with a stub client (construction is pure;
 * only invocation would touch PG), model is a dummy ChatOpenAI instance with a
 * fake key that is never invoked (the probe middleware throws a sentinel right
 * before the base handler). Skill mount is a pure filesystem read.
 *
 * Run: cd backend && npx tsx scripts/system-area-probe.mjs
 */
import { createDeepAgent } from "deepagents";
import { ChatOpenAI } from "@langchain/openai";
import { createMiddleware } from "langchain";
import { convertToOpenAITool } from "@langchain/core/utils/function_calling";
import { TASK_SYSTEM_PROMPT } from "deepagents";
import { TODO_LIST_MIDDLEWARE_SYSTEM_PROMPT } from "langchain";

import {
  buildSystemPrompt,
  frameworkTrimMiddleware,
} from "../src/services/agent/DeepAgentService.js";
import { buildMcpToolsWith } from "../src/services/agent/mcpTools.js";
import {
  loadAllSkills,
  toDeepAgentSkillMount,
} from "../src/services/agent/skillLoader.js";

class ProbeDone extends Error {}

/** LangGraph wraps middleware errors in MiddlewareError(cause) chains — unwrap. */
function isProbeDone(err) {
  for (let e = err, i = 0; e && i < 10; i++, e = e.cause) {
    if (e instanceof ProbeDone || e?.message === "probe-done") return true;
  }
  return false;
}

async function probeScenario(scenario) {
  const captured = { systemText: "", tools: [] };
  const probe = createMiddleware({
    name: "systemAreaProbe",
    wrapModelCall: async (request, _handler) => {
      captured.systemText = request.systemMessage?.text ?? "";
      captured.tools = request.tools ?? [];
      throw new ProbeDone("probe-done");
    },
  });

  const model = new ChatOpenAI({ model: "glm-5.3-flash", apiKey: "probe" });
  const skillMount = toDeepAgentSkillMount(loadAllSkills());
  const tools = buildMcpToolsWith(
    {},
    "00000000-0000-4000-8000-00000000probe".replace("probe", "0abc"),
  );

  const agent = createDeepAgent({
    model,
    tools,
    systemPrompt: buildSystemPrompt(scenario),
    // 与生产一致：frameworkTrimMiddleware 在 wrapModelCall 链上（数组首元素 =
    // 最外层）先于 probe（末元素 = 最内层）执行——probe 因此测到的是裁剪后、
    // 模型实际可见的 systemMessage 与 tools。若 deepagents 升级改了注入行为，
    // 下面的 hasTaskPrompt/hasTodoPrompt 断言会红。
    middleware: [frameworkTrimMiddleware, probe],
    responseFormat: undefined,
    name: "starfit-agent",
    backend: skillMount.backend,
    skills: skillMount.skills,
    permissions: skillMount.permissions,
  });

  try {
    await agent.invoke(
      { messages: [{ role: "user", content: "probe" }] },
      { configurable: {} },
    );
  } catch (err) {
    if (!isProbeDone(err)) throw err;
  }

  const systemChars = captured.systemText.length;
  const wireDefs = captured.tools.map((t) => JSON.stringify(convertToOpenAITool(t)));
  const toolChars = wireDefs.reduce((a, s) => a + s.length, 0);
  const perTool = captured.tools
    .map((t, i) => ({ name: t.name, chars: wireDefs[i].length }))
    .sort((a, b) => b.chars - a.chars);

  return {
    scenario: scenario ?? "default",
    systemChars,
    toolChars,
    grandTotal: systemChars + toolChars,
    toolCount: captured.tools.length,
    hasTaskPrompt: captured.systemText.includes(TASK_SYSTEM_PROMPT),
    hasTodoPrompt: captured.systemText.includes(TODO_LIST_MIDDLEWARE_SYSTEM_PROMPT),
    perTool,
  };
}

const scenarios = ["plan", undefined];
const results = [];
for (const s of scenarios) results.push(await probeScenario(s));

for (const r of results) {
  console.log(`\n=== scenario: ${r.scenario} ===`);
  console.log(
    `system chars: ${r.systemChars} | tool chars (wire): ${r.toolChars} | ` +
      `tools: ${r.toolCount} | GRAND TOTAL: ${r.grandTotal}`,
  );
  console.log(
    `TASK_SYSTEM_PROMPT in system: ${r.hasTaskPrompt} | todo prompt in system: ${r.hasTodoPrompt}`,
  );
  console.log("tools by wire chars:");
  for (const t of r.perTool) console.log(`  ${String(t.chars).padStart(6)}  ${t.name}`);
}

console.log(
  "\nJSON:" +
    JSON.stringify(
      Object.fromEntries(
        results.map((r) => [
          r.scenario,
          {
            system: r.systemChars,
            tools: r.toolChars,
            total: r.grandTotal,
            toolCount: r.toolCount,
            hasTaskPrompt: r.hasTaskPrompt,
            hasTodoPrompt: r.hasTodoPrompt,
          },
        ]),
      ),
    ),
);
