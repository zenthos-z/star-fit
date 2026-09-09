import type { FastifyBaseLogger } from "fastify";
import { putObject } from "./mediaStorage.js";
import { request } from "undici";
import {
  resolveImageModelConfig,
  getImageGenApiKey,
  DEFAULT_DMX_BASE_URL,
} from "./modelConfigService.js";

async function wait(ms: number) {
  return new Promise(res => setTimeout(res, ms));
}

async function withRetry<T>(fn: () => Promise<T>, log: FastifyBaseLogger, maxAttempts = 5, baseMs = 250) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err: any) {
      attempt++;
      const status = err?.status || err?.code;
      const retryable = [429, 500, 503].includes(Number(status)) || err?.retryable;
      if (!retryable || attempt >= maxAttempts) {
        log.error({ err, attempt }, "genai_request_failed");
        throw err;
      }
      const jitter = Math.floor(Math.random() * baseMs);
      const delay = Math.min(4000, baseMs * Math.pow(2, attempt)) + jitter;
      log.warn({ status, attempt, delay }, "genai_retry_backoff");
      await wait(delay);
    }
  }
}

// Image generation is slow — give the upstream request a generous window.
const IMAGE_GEN_TIMEOUT_MS = 120_000;

/**
 * Generate one image via an OpenAI-compatible /images/generations endpoint.
 *
 * Config comes from the real config chain (modelConfigService): provider dmx|openai,
 * model/baseURL (DB > env > default; dmx defaults to https://www.dmxapi.cn/v1) and
 * the IMAGE_GEN_API_KEY (DB > env). Without a key this throws (HTTP layer maps it
 * to 400) — no placeholder SVG anymore, unless DEBUG_PLACEHOLDER=true explicitly
 * opts back into the old dev placeholder.
 */
export async function generateImage(prompt: string, log: FastifyBaseLogger): Promise<string> {
  const apiKey = await getImageGenApiKey();
  if (!apiKey) {
    if (process.env.DEBUG_PLACEHOLDER === "true") {
      log.warn("IMAGE_GEN_API_KEY missing; DEBUG_PLACEHOLDER=true — returning placeholder SVG");
      return promptToSVG(prompt);
    }
    throw new Error("IMAGE_GEN_API_KEY missing: image generation is not configured. Set the key in Admin → Settings (IMAGE_GEN_API_KEY).");
  }

  const cfg = await resolveImageModelConfig();
  const baseURL = (cfg.baseURL || DEFAULT_DMX_BASE_URL).replace(/\/+$/, "");
  const endpoint = `${baseURL}/images/generations`;
  const model = cfg.model || "dall-e-2";

  const dataUrl = await withRetry(async () => {
    const response = await request(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      headersTimeout: IMAGE_GEN_TIMEOUT_MS,
      bodyTimeout: IMAGE_GEN_TIMEOUT_MS,
      body: JSON.stringify({
        model,
        prompt,
        n: 1,
        size: "1024x1024",
        response_format: "b64_json"
      })
    });

    if (response.statusCode >= 400) {
      const body = await response.body.text();
      let msg = `HTTP ${response.statusCode}`;
      try {
        const j = JSON.parse(body);
        msg = j?.error?.message || j?.error || msg;
      } catch {}
      const e: any = new Error(`Image generation failed: ${msg}`);
      e.status = response.statusCode;
      throw e;
    }

    const j: any = await response.body.json();
    const b64 = j?.data?.[0]?.b64_json;
    if (!b64) {
      throw new Error("Image generation response missing data[0].b64_json");
    }
    return "data:image/png;base64," + b64;
  }, log);

  try {
    if (process.env.PERSIST_POSTER === "true") {
      const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (m) {
        const mime = m[1];
        const buf = Buffer.from(m[2], "base64");
        await putObject(buf, mime);
        log.info({ size: buf.length, mime }, "poster_persisted");
      }
    }
  } catch (err: any) {
    log.warn({ err }, "poster_persist_failed");
  }

  return dataUrl;
}

// Kept only for the explicit DEBUG_PLACEHOLDER=true escape hatch (dev only).
function promptToSVG(prompt: string) {
  const text = (prompt || "").slice(0, 200).replace(/[<>&]/g, "");
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='900' height='1200'>
  <defs>
    <linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
      <stop offset='0%' stop-color='#FF5F1F'/>
      <stop offset='100%' stop-color='#000080'/>
    </linearGradient>
  </defs>
  <rect width='100%' height='100%' fill='url(#g)'/>
  <rect x='40' y='40' width='820' height='1120' fill='rgba(0,0,0,0.35)' stroke='#FF5F1F' stroke-width='4'/>
  <text x='60' y='100' font-size='32' font-family='monospace' fill='#FF5F1F'>ACID_POSTER</text>
  <text x='60' y='160' font-size='18' font-family='monospace' fill='#FFDFCF'>${text}</text>
</svg>`;
  return "data:image/svg+xml;base64," + Buffer.from(svg, "utf-8").toString("base64");
}
