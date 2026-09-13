import type { FastifyBaseLogger } from "fastify";
import { putObject } from "./mediaStorage.js";
import { request } from "undici";
import {
  resolveImageModelConfig,
  getImageGenApiKey,
  DEFAULT_DMX_BASE_URL,
} from "./modelConfigService.js";

async function wait(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  log: FastifyBaseLogger,
  maxAttempts = 5,
  baseMs = 250,
) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err: any) {
      attempt++;
      const status = err?.status || err?.code;
      const retryable =
        [429, 500, 503].includes(Number(status)) || err?.retryable;
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
 * Generate one image.
 *
 * Two provider families (resolved via modelConfigService, provider dmx|openai|gemini):
 * - "gemini": native Gemini generateContent API (gemini-*-image models return
 *   inlineData base64 in candidates). DMX proxies this exact API shape at
 *   https://www.dmxapi.cn. Chosen for strong in-image text rendering.
 * - "dmx"/"openai": OpenAI-compatible /images/generations endpoint.
 *
 * Config comes from the real config chain (modelConfigService): model/baseURL
 * (DB > env > default) and the IMAGE_GEN_API_KEY (DB > env). Without a key this
 * throws (HTTP layer maps it to 400) — no placeholder SVG anymore, unless
 * DEBUG_PLACEHOLDER=true explicitly opts back into the old dev placeholder.
 */
const GEMINI_IMAGE_DEFAULT_BASE = "https://www.dmxapi.cn";
const GEMINI_IMAGE_DEFAULT_MODEL = "gemini-3.1-flash-image";

export async function generateImage(
  prompt: string,
  log: FastifyBaseLogger,
): Promise<string> {
  const apiKey = await getImageGenApiKey();
  if (!apiKey) {
    if (process.env.DEBUG_PLACEHOLDER === "true") {
      log.warn(
        "IMAGE_GEN_API_KEY missing; DEBUG_PLACEHOLDER=true — returning placeholder SVG",
      );
      return promptToSVG(prompt);
    }
    throw new Error(
      "IMAGE_GEN_API_KEY missing: image generation is not configured. Set the key in Admin → Settings (IMAGE_GEN_API_KEY).",
    );
  }

  const cfg = await resolveImageModelConfig();
  const useGemini =
    cfg.provider === "gemini" || /gemini.*image|imagen/i.test(cfg.model || "");

  const dataUrl = useGemini
    ? await generateImageGemini(prompt, cfg, apiKey, log)
    : await generateImageOpenAI(prompt, cfg, apiKey, log);

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

// ---------------------------------------------------------------------------
// Provider implementations
// ---------------------------------------------------------------------------

type ImageCfg = { provider: string; model: string; baseURL?: string };

/** Native Gemini generateContent API (also proxied by DMX at dmxapi.cn). */
async function generateImageGemini(
  prompt: string,
  cfg: ImageCfg,
  apiKey: string,
  log: FastifyBaseLogger,
): Promise<string> {
  const base = (cfg.baseURL || GEMINI_IMAGE_DEFAULT_BASE).replace(/\/+$/, "");
  const model = cfg.model || GEMINI_IMAGE_DEFAULT_MODEL;
  // baseURL may already include /v1beta or be a bare host
  const endpoint = base.includes("/v1beta")
    ? `${base}/models/${model}:generateContent`
    : `${base}/v1beta/models/${model}:generateContent`;

  return withRetry(async () => {
    const response = await request(endpoint, {
      method: "POST",
      // DMX's native-Gemini proxy authenticates with x-goog-api-key (Google style),
      // not Authorization Bearer.
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      headersTimeout: IMAGE_GEN_TIMEOUT_MS,
      bodyTimeout: IMAGE_GEN_TIMEOUT_MS,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["IMAGE"] },
      }),
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
    const parts = j?.candidates?.[0]?.content?.parts ?? [];
    const inline =
      parts.find((p: any) => p?.inlineData?.data)?.inlineData ??
      parts.find((p: any) => p?.inline_data?.data)?.inline_data;
    if (!inline?.data) {
      throw new Error(
        "Gemini image response missing candidates[0].content.parts[].inlineData",
      );
    }
    const mime = inline.mimeType || inline.mime_type || "image/png";
    return `data:${mime};base64,${inline.data}`;
  }, log);
}

/** OpenAI-compatible /images/generations endpoint (dmx/openai providers). */
async function generateImageOpenAI(
  prompt: string,
  cfg: ImageCfg,
  apiKey: string,
  log: FastifyBaseLogger,
): Promise<string> {
  const baseURL = (cfg.baseURL || DEFAULT_DMX_BASE_URL).replace(/\/+$/, "");
  const endpoint = `${baseURL}/images/generations`;
  const model = cfg.model || "dall-e-2";

  return withRetry(async () => {
    const response = await request(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      headersTimeout: IMAGE_GEN_TIMEOUT_MS,
      bodyTimeout: IMAGE_GEN_TIMEOUT_MS,
      body: JSON.stringify({
        model,
        prompt,
        n: 1,
        size: "1024x1024",
        response_format: "b64_json",
      }),
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
    if (b64) {
      return "data:image/png;base64," + b64;
    }
    // Some OpenAI-compatible providers (e.g. bigmodel CogView) return a URL
    // instead of b64_json — fetch and inline it so callers always get a data URL.
    const imageUrl = j?.data?.[0]?.url;
    if (!imageUrl) {
      throw new Error("Image generation response missing data[0].b64_json/url");
    }
    const imgRes = await request(imageUrl, { method: "GET" });
    if (imgRes.statusCode >= 400) {
      throw new Error(
        `Failed to fetch generated image URL: HTTP ${imgRes.statusCode}`,
      );
    }
    const imgBuf = await imgRes.body.arrayBuffer();
    return "data:image/png;base64," + Buffer.from(imgBuf).toString("base64");
  }, log);
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
  return (
    "data:image/svg+xml;base64," + Buffer.from(svg, "utf-8").toString("base64")
  );
}
