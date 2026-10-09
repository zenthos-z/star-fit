/**
 * jev-spike 共享工具（spike 专用，非产品代码）。
 *
 * 用途：#160 意图路由层技术可行性 spike —— 封装 dmx TypeSafe 端点调用。
 * 红线：密钥只从环境变量 DMXAPI_API_KEY 读取，禁止写入任何被跟踪文件。
 */

export const DMX_BASE = "https://www.dmxapi.cn";
export const TYPESAFE_ENDPOINT = `${DMX_BASE}/typesafe/v1/systemone`;
export const MODELS_ENDPOINT = `${DMX_BASE}/v1/models`;
export const JEV_MODEL = "jev-1.13.0";

/** 读取 API key；缺失时打印明确提示并以非零码退出。 */
export function requireApiKey() {
  const key = process.env.DMXAPI_API_KEY;
  if (!key || key.trim() === "") {
    console.error(
      "[jev-spike] 缺少环境变量 DMXAPI_API_KEY —— 请在运行前设置（dmxapi.cn 账户密钥）。脚本不内置任何密钥。"
    );
    process.exit(2);
  }
  return key.trim();
}

/**
 * 调用 TypeSafe 结构化判研端点。
 * @param {{state: string, questions: Record<string, object>, model?: string, timeoutMs?: number, endpoint?: string}} req
 * @returns {Promise<{ok: true, status: number, body: object, ms: number} | {ok: false, status: number|null, body: object|string|null, ms: number, error: {name: string, message: string}}>}
 */
export async function callTypeSafe({ state, questions, model = JEV_MODEL, timeoutMs = 30_000, apiKey, endpoint = TYPESAFE_ENDPOINT }) {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ model, state, questions }),
      signal: controller.signal,
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    const ms = performance.now() - started;
    return { ok: res.ok, status: res.status, body, ms };
  } catch (err) {
    const ms = performance.now() - started;
    return { ok: false, status: null, body: null, ms, error: { name: err.name, message: String(err.message) } };
  } finally {
    clearTimeout(timer);
  }
}

/** 数组分位（线性插值，0<=p<=1）。 */
export function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return NaN;
  const idx = (sortedValues.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedValues[lo];
  return sortedValues[lo] + (sortedValues[hi] - sortedValues[lo]) * (idx - lo);
}

/** 保存 JSON 结果到 scripts/jev-spike/results/（仅数据，不含密钥）。 */
export async function saveResult(name, data) {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const dir = join(dirname(fileURLToPath(import.meta.url)), "results");
  await mkdir(dir, { recursive: true });
  const file = join(dir, name);
  await writeFile(file, JSON.stringify(data, null, 2) + "\n", "utf8");
  return file;
}
