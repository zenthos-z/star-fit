import type { FastifyBaseLogger } from "fastify";
import { putObject } from "./mediaStorage.js";

import { ConfigRepo } from "./knowledgeRepo.js";

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

export async function generateImage(prompt: string, log: FastifyBaseLogger): Promise<string> {
  const apiKey = (await ConfigRepo.getConfig('system', 'GOOGLE_API_KEY')) || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    log.warn("GOOGLE_API_KEY missing; returning placeholder image");
    return promptToSVG(prompt);
  }
  return await withRetry(async () => {
    // TODO: Integrate with Google GenAI image generation when available in environment.
    // For now, return placeholder to ensure end-to-end works in dev/prod without keys.
    const dataUrl = promptToSVG(prompt);
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
  }, log);
}
