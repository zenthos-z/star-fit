import { promises as fs } from "fs";
import * as path from "path";
import crypto from "crypto";

const MEDIA_DIR = path.resolve(process.cwd(), "data", "media");
const META_DIR = path.resolve(MEDIA_DIR, "meta");

// N 天未引用自动清理的窗口（默认 14 天，可用 MEDIA_RETENTION_DAYS 覆盖）
const RETENTION_DAYS = Math.max(
  1,
  parseInt(process.env.MEDIA_RETENTION_DAYS || "14", 10) || 14,
);
// 每天清理一次
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

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

export async function putObject(
  content: Buffer,
  mime: string,
): Promise<StoredObjectMeta> {
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
    version: "v1",
  };
  await fs.writeFile(
    path.join(META_DIR, `${id}.json`),
    JSON.stringify(meta, null, 2),
    "utf-8",
  );
  return meta;
}

export async function getObject(
  id: string,
): Promise<{ content: Buffer; mime: string } | null> {
  const filePath = path.join(MEDIA_DIR, id);
  try {
    const buf = await fs.readFile(filePath);
    const metaRaw = await fs
      .readFile(path.join(META_DIR, `${id}.json`), "utf-8")
      .catch(() => "{}");
    const meta = JSON.parse(metaRaw || "{}");
    const mime = meta?.mime || "application/octet-stream";
    // 刷新最近访问时间（异步不阻塞读取；失败不影响返回）——「N 天未引用」以本字段为准
    const touched = { ...meta, lastAccessedAt: new Date().toISOString() };
    fs.writeFile(
      path.join(META_DIR, `${id}.json`),
      JSON.stringify(touched, null, 2),
      "utf-8",
    ).catch(() => {});
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

/** 单个对象删除（文件 + 元数据；不存在时静默成功） */
export async function deleteObject(id: string): Promise<boolean> {
  const filePath = path.join(MEDIA_DIR, id);
  try {
    await fs.unlink(filePath);
    await fs.unlink(path.join(META_DIR, `${id}.json`)).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

/**
 * 「N 天未引用自动清理」维护任务。
 *
 * 「引用」的判定 = 对象最近一次被读取（lastAccessedAt，getObject 时刷新）：
 * - Agent 读图分析、前端 GET /api/media/:id 都会刷新时间戳；
 * - 聊天里仍在展示的图片消息被查看/加载时自然续期；
 * - 从未被访问的对象按上传时间（createdAt）计龄。
 * 超过 RETENTION_DAYS（默认 14 天，MEDIA_RETENTION_DAYS 可调）无访问 → 删除。
 *
 * 每天执行一次；出错只记日志不抛（清理失败不影响主链路）。
 */
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export function startMediaCleanup(): void {
  if (cleanupTimer) return;

  const run = async () => {
    try {
      const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
      const metas = await fs.readdir(META_DIR);
      let removed = 0;
      let bytes = 0;
      for (const m of metas) {
        if (!m.endsWith(".json")) continue;
        const id = m.slice(0, -5);
        try {
          const metaRaw = await fs.readFile(path.join(META_DIR, m), "utf-8");
          const meta = JSON.parse(metaRaw || "{}");
          const lastUsed = new Date(
            meta.lastAccessedAt || meta.createdAt,
          ).getTime();
          // 时间戳缺失/非法：一律跳过（宁可不删，勿误删）
          if (!Number.isFinite(lastUsed)) continue;
          if (lastUsed > cutoff) continue;
        } catch {
          // 元数据缺失/损坏：时间未知，跳过（宁可不删，勿误删）
          continue;
        }
        const st = await fs.stat(path.join(MEDIA_DIR, id)).catch(() => null);
        if (await deleteObject(id)) {
          removed++;
          bytes += st?.size || 0;
        }
      }
      if (removed > 0) {
        console.log(
          `[mediaCleanup] Removed ${removed} stale media object(s) (> ${RETENTION_DAYS}d unreferenced), ~${Math.round(bytes / 1024)}KB freed`,
        );
      }
    } catch (err) {
      console.error("[mediaCleanup] Failed:", err);
    }
  };

  // 启动后 1 分钟首跑，之后每天一次；unref 不阻塞进程退出
  setTimeout(run, 60 * 1000).unref?.();
  cleanupTimer = setInterval(run, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref?.();
}
