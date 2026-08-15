import { promises as fs } from "fs";
import * as path from "path";
import crypto from "crypto";

const MEDIA_DIR = path.resolve(process.cwd(), "data", "media");
const META_DIR = path.resolve(MEDIA_DIR, "meta");

async function ensureDirs() {
  await fs.mkdir(MEDIA_DIR, { recursive: true });
  await fs.mkdir(META_DIR, { recursive: true });
}

export type StoredObjectMeta = {
  id: string;
  hash: string;
  size: number;
  mime: string;
  createdAt: string;
  version?: string;
};

export async function putObject(content: Buffer, mime: string): Promise<StoredObjectMeta> {
  await ensureDirs();
  const hash = crypto.createHash("sha256").update(content).digest("hex");
  const id = hash;
  const filePath = path.join(MEDIA_DIR, id);
  await fs.writeFile(filePath, content);
  const meta: StoredObjectMeta = {
    id,
    hash,
    size: content.length,
    mime,
    createdAt: new Date().toISOString(),
    version: "v1"
  };
  await fs.writeFile(path.join(META_DIR, `${id}.json`), JSON.stringify(meta, null, 2), "utf-8");
  return meta;
}

export async function getObject(id: string): Promise<{ content: Buffer; mime: string } | null> {
  const filePath = path.join(MEDIA_DIR, id);
  try {
    const buf = await fs.readFile(filePath);
    const metaRaw = await fs.readFile(path.join(META_DIR, `${id}.json`), "utf-8").catch(() => "{}");
    const meta = JSON.parse(metaRaw || "{}");
    const mime = meta?.mime || "application/octet-stream";
    return { content: buf, mime };
  } catch {
    return null;
  }
}

export function getSignedUrl(id: string): string {
  // 简化版签名：返回 API 路径，由控制器内部校验即可；后续可替换为带 token 的签名 URL
  return `/api/media/${id}`;
}

export function svgPlaceholder(text: string): Buffer {
  const safe = (text || "").slice(0, 120).replace(/[<>&]/g, "");
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='900' height='1200'>
  <rect width='100%' height='100%' fill='#111'/>
  <rect x='40' y='40' width='820' height='1120' fill='rgba(255,255,255,0.08)' stroke='#FF5F1F' stroke-width='4'/>
  <text x='60' y='120' font-size='28' font-family='monospace' fill='#FF5F1F'>MEDIA_PLACEHOLDER</text>
  <text x='60' y='180' font-size='18' font-family='monospace' fill='#FFDFCF'>${safe}</text>
</svg>`;
  return Buffer.from(svg, "utf-8");
}

