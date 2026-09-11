import { z } from "zod";

/**
 * load_history 读取实现（2026-09-11 调整）：
 *
 * 训练历史以 sessions 表原始数据为准（每次 sync/push 都写的权威数据源），
 * 不再依赖 users.history_summary 的自动压缩摘要——压缩必然丢信息。
 * history_summary.sessions 仅作为补充源参与合并：它承载 Agent 通过
 * write_session 工具显式记录的记忆条目（与前端训练数据是两条独立写入流），
 * 这类记录不可丢弃。live 行（sessions 表）在去重中始终优先。
 */

/** sessions 表 raw_json 行的最小形状（宽松解析，容错字段缺失）。 */
const RawSessionRowSchema = z.object({
  id: z.string().optional(),
  session_id: z.string().optional(),
  start_time: z.union([z.string(), z.number()]).optional(),
  startTime: z.union([z.string(), z.number()]).optional(),
  end_time: z.union([z.string(), z.number()]).optional(),
  endTime: z.union([z.string(), z.number()]).optional(),
  title: z.string().optional(),
  exercises: z.array(z.any()).optional(),
  stats: z.record(z.any(), z.any()).optional(),
  notes: z.string().optional(),
});

export type RawSessionRow = z.infer<typeof RawSessionRowSchema>;

function toIso(value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined;
  const date =
    typeof value === "number" ? new Date(value) : new Date(String(value));
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

/** Normalize a raw_json row into the history_summary.sessions entry shape. */
export function normalizeSessionRow(raw: unknown): RawSessionRow | null {
  const parsed = RawSessionRowSchema.safeParse(raw);
  if (!parsed.success) return null;
  const s = parsed.data;
  const id = s.id ?? s.session_id;
  if (!id) return null;
  return {
    session_id: id,
    start_time: toIso(s.start_time ?? s.startTime),
    end_time: toIso(s.end_time ?? s.endTime),
    title: s.title,
    exercises: s.exercises,
    stats: s.stats,
    notes: s.notes,
  };
}

/** Key used to dedupe summary entries against live-session rows. */
function dedupeKey(entry: Record<string, unknown>): string {
  const id = entry.session_id ?? entry.id;
  return typeof id === "string" && id.length > 0
    ? id
    : JSON.stringify(entry).slice(0, 120);
}

/**
 * Merge Agent-recorded `history_summary.sessions` (write_session memory) with
 * real-time rows queried from the `sessions` table. Live rows win the dedupe
 * (sessions table is the authoritative training-data source). Result:
 * newest-first, capped at `limit`.
 */
export function mergeHistorySources(
  summarySessions: unknown,
  liveRows: Array<{ raw_json: unknown }>,
  limit: number,
): Record<string, unknown>[] {
  const seen = new Set<string>();
  const merged: Record<string, unknown>[] = [];

  // Live rows first (authoritative), newest-first by start_time.
  const normalizedLive = liveRows
    .map((r) => normalizeSessionRow(r.raw_json))
    .filter((v): v is RawSessionRow => v !== null)
    .sort((a, b) => {
      const ta = a.start_time ? Date.parse(String(a.start_time)) : 0;
      const tb = b.start_time ? Date.parse(String(b.start_time)) : 0;
      return tb - ta;
    });
  for (const s of normalizedLive) {
    const rec: Record<string, unknown> = { ...s };
    if (!rec.start_time) delete rec.start_time;
    if (rec.title === undefined) delete rec.title;
    seen.add(dedupeKey(rec));
    merged.push(rec);
  }

  // Then summary entries (Agent-recorded memory) not already covered by a live row.
  if (Array.isArray(summarySessions)) {
    for (const entry of summarySessions) {
      if (!entry || typeof entry !== "object") continue;
      const rec = entry as Record<string, unknown>;
      if (seen.has(dedupeKey(rec))) continue;
      merged.push(rec);
      seen.add(dedupeKey(rec));
    }
  }

  return merged.slice(0, limit);
}
