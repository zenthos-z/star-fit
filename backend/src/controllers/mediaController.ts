import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { putObject, getObject, getSignedUrl, svgPlaceholder } from "../services/mediaStorage.js";

const UploadSchema = z.object({
  // 支持 dataUrl 或纯 base64 内容
  dataUrl: z.string().optional(),
  base64: z.string().optional(),
  mime: z.string().default("image/svg+xml")
});

function parseDataUrl(dataUrl?: string): { mime: string; buffer: Buffer } | null {
  if (!dataUrl) return null;
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  const mime = m[1];
  const b64 = m[2];
  return { mime, buffer: Buffer.from(b64, "base64") };
}

export async function postUpload(req: FastifyRequest, reply: FastifyReply) {
  try {
    const body = UploadSchema.parse((req.body ?? {}) as any);
    let mime = body.mime;
    let buffer: Buffer | null = null;
    const parsed = parseDataUrl(body.dataUrl);
    if (parsed) {
      mime = parsed.mime;
      buffer = parsed.buffer;
    } else if (body.base64) {
      buffer = Buffer.from(body.base64, "base64");
    }
    if (!buffer) {
      return reply.status(400).send({ error: "Missing dataUrl/base64", traceId: req.id });
    }
    const meta = await putObject(buffer, mime);
    const url = getSignedUrl(meta.id);
    return reply.status(200).send({ id: meta.id, url, hash: meta.hash, size: meta.size, mime: meta.mime, version: meta.version, traceId: req.id });
  } catch (err: any) {
    req.log.error({ err }, "media_upload_failed");
    return reply.status(400).send({ error: err?.message || "Bad Request", traceId: req.id });
  }
}

export async function getMedia(req: FastifyRequest, reply: FastifyReply) {
  try {
    const id = (req.params as any)?.id as string;
    const found = await getObject(id);
    if (!found) {
      const buf = svgPlaceholder(`missing id: ${id}`);
      reply.header("content-type", "image/svg+xml");
      return reply.status(200).send(buf);
    }
    reply.header("content-type", found.mime || "application/octet-stream");
    return reply.status(200).send(found.content);
  } catch (err: any) {
    req.log.error({ err }, "media_read_failed");
    return reply.status(404).send({ error: "Not Found", traceId: req.id });
  }
}
