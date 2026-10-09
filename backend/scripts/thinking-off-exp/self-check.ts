/**
 * 关思考实验 A2b（#155 #160）——环境与配置链路自检（零 LLM 成本）。
 *
 * 目的：在烧配额前证实 THINKING_DISABLED 开关从 env 到请求体的整条链路，
 * 并记录任务书候选键 `THINKING_DISABLED_PLAN=1` 的两处陷阱：
 *   ① scenario 名不匹配：回放剧本 scenario 恒为 "chat"（#160 实锤 isPlanMode
 *      死路），`THINKING_DISABLED_PLAN` 对 chat 轮不生效——正确键是
 *      `THINKING_DISABLED_CHAT`；
 *   ② 值格式陷阱：resolveThinkingConfig 的 parseDisabledFlag 只认
 *      "true"/"false"（trim + 大小写不敏感），"1" 被视为未配置落穿到下一层。
 *
 * 检查项（全部零 LLM 调用——loadModel 只构造客户端不发请求）：
 *   S1 DB 连通 + app_configs 无 THINKING_DISABLED* 行（DB 层优先于 env，
 *      必须确认为空，env 才是生效层）
 *   S2 resolveThinkingConfig("chat") 默认 → thinking:true / default
 *   S3 THINKING_DISABLED_CHAT=true → thinking:false / env（本实验生效键）
 *   S4 THINKING_DISABLED_CHAT=1 → 仍 default（值陷阱实证）
 *   S5 THINKING_DISABLED_PLAN=true（scenario=chat）→ 仍 default（键名陷阱实证）
 *   S6 THINKING_DISABLED_CHAT=true 下 loadModel("chat") 构造体
 *      modelKwargs.thinking.type === "disabled"
 *   S7 无 env 时 loadModel("chat") 不带 modelKwargs（现状默认链不回归）
 *
 * 用法（backend/ 下）：
 *   DATABASE_URL=… GLM_API_KEY=… npx tsx scripts/thinking-off-exp/self-check.ts
 * 退出码：全过 0；任一失败 1。
 */
import { getPostgresClient } from "../../src/db/postgresql/index.js";
import { loadModel } from "../../src/services/llm.js";
import { resolveThinkingConfig } from "../../src/services/modelConfigService.js";

interface CheckResult {
  id: string;
  name: string;
  pass: boolean;
  detail: string;
}

const results: CheckResult[] = [];

function record(id: string, name: string, pass: boolean, detail: string): void {
  results.push({ id, name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${id} ${name} — ${detail}`);
}

async function main(): Promise<void> {
  // S1: DB 连通 + THINKING_DISABLED* 行为空（env 层才不被 DB 覆盖）
  try {
    const client = getPostgresClient();
    const rows = await client.query(
      `SELECT key FROM app_configs WHERE key ILIKE 'THINKING_DISABLED%'`,
    );
    record(
      "S1",
      "DB 无 THINKING_DISABLED* 配置行",
      rows.rowCount === 0,
      rows.rowCount === 0
        ? "app_configs 0 行（env 层即生效层）"
        : `存在覆盖行: ${rows.rows.map((r) => r.key).join(", ")}`,
    );
  } catch (err) {
    record("S1", "DB 连通", false, String(err));
  }

  // S2: 默认链（清掉本进程可能继承的 THINKING* env）
  for (const k of Object.keys(process.env)) {
    if (k.startsWith("THINKING_DISABLED")) delete process.env[k];
  }
  const def = await resolveThinkingConfig("chat");
  record(
    "S2",
    "默认 chat 场景 thinking 开",
    def.thinking === true && def.source === "default",
    JSON.stringify(def),
  );

  // S3: 正确键 THINKING_DISABLED_CHAT=true
  process.env.THINKING_DISABLED_CHAT = "true";
  const on = await resolveThinkingConfig("chat");
  record(
    "S3",
    "THINKING_DISABLED_CHAT=true 关闭 chat 思考",
    on.thinking === false && on.source === "env",
    JSON.stringify(on),
  );

  // S4: 值陷阱 "1"
  process.env.THINKING_DISABLED_CHAT = "1";
  const trapValue = await resolveThinkingConfig("chat");
  record(
    "S4",
    "值陷阱: =1 不生效（只认 true/false）",
    trapValue.thinking === true && trapValue.source === "default",
    JSON.stringify(trapValue),
  );

  // S5: 键名陷阱 PLAN（scenario=chat 不读 PLAN 键）
  delete process.env.THINKING_DISABLED_CHAT;
  process.env.THINKING_DISABLED_PLAN = "true";
  const trapKey = await resolveThinkingConfig("chat");
  record(
    "S5",
    "键名陷阱: THINKING_DISABLED_PLAN 对 chat 不生效",
    trapKey.thinking === true && trapKey.source === "default",
    JSON.stringify(trapKey),
  );
  delete process.env.THINKING_DISABLED_PLAN;

  // S6: loadModel 构造体带 disabled kwargs
  process.env.THINKING_DISABLED_CHAT = "true";
  const modelOff = (await loadModel("chat")) as unknown as {
    modelKwargs?: { thinking?: { type?: string } };
  };
  const kwOff = modelOff.modelKwargs?.thinking?.type;
  record(
    "S6",
    "loadModel 携带 thinking:{type:'disabled'}",
    kwOff === "disabled",
    `modelKwargs.thinking.type=${String(kwOff)}（model=${String(
      (modelOff as unknown as { model?: string }).model,
    )}）`,
  );

  // S7: 默认链构造体不带 thinking kwarg（langchain 会把 modelKwargs 默认成
  // 空对象 {}，判据应为「无 thinking 子键」而非整个字段缺省）
  delete process.env.THINKING_DISABLED_CHAT;
  const modelOn = (await loadModel("chat")) as unknown as {
    modelKwargs?: { thinking?: { type?: string } };
  };
  const kwOn = modelOn.modelKwargs?.thinking?.type;
  record(
    "S7",
    "默认链不带 thinking kwarg（不回归）",
    kwOn === undefined,
    `modelKwargs=${JSON.stringify(modelOn.modelKwargs)}`,
  );

  const failed = results.filter((r) => !r.pass);
  console.log(
    `\n=== self-check: ${results.length - failed.length}/${results.length} passed ===`,
  );
  process.exit(failed.length > 0 ? 1 : 0);
}

void main();
