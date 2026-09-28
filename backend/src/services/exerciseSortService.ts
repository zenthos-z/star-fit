/**
 * ExerciseSortService — picker 智能排序后端真源（issue #31）
 *
 * 职责：以用户近期训练为输入，产出 picker 展示排序（SmartSortResponse）。
 * 排序真源在后端，前端只呈现（含离线兜底，不在本服务）。
 *
 * 近期分区判定（本批核心规则，issue #31「近期分区去重」）：
 *   - 窗口：最近 N 次训练（SMART_SORT_RECENT_SESSION_LIMIT，start_time 倒序）；
 *   - 去重：按时间新→旧遍历训练动作，同分区多次出现只计最新一条
 *     （dedupeRecentRegions，契约层纯函数，前后端共用语义）；
 *   - 分区解析：session 动作 → 动作库行（libraryId 优先，name/name_zh 兜底）
 *     → body_part → 四分区（BODY_PART_REGION）；body_part 缺省时按
 *     primary_muscles 肌群兜底（MUSCLE_REGION，覆盖 POST 建的动作）；
 *     解析不出的条目跳过；
 *   - 排序合成：近期置顶动作（去重后 ≤ limit）按新→旧排头部，
 *     其余动作保持库序（rankWithRecent）。
 *
 * 防御口径：userId 缺失/非法、无训练、库为空均返回确定性基线
 * （recent_* 空 + 纯库序），不抛错——排序属呈现增强，失败不阻断选动作。
 *
 * 红线遵守：数据访问只经 SessionRepo / ExerciseRepository，不直连库；
 * 不触碰 services/agent/** 与 services/suggestions/**。
 *
 * @version 1.0.0
 * @created 2026-09-29
 */

import {
  SmartSortResponseSchema,
  dedupeRecentRegions,
  rankWithRecent,
  BODY_PART_REGION,
  MUSCLE_REGION,
  SMART_SORT_RECENT_SESSION_LIMIT,
  SMART_SORT_RECENT_EXERCISE_LIMIT,
  UUIDSchema,
  parseJSONSafe,
  type SmartSortResponse,
  type ExerciseRegion,
  type RecentTrainedEntry,
} from "../../../shared/dist/contracts/index.js";
import { SessionRepo } from "./sessionRepo.js";
import { createExerciseRepository } from "../db/postgresql/repository/index.js";
import { getPostgresClient } from "../db/postgresql/client/postgres-client.js";

/** 库投影行 → 分区：body_part 优先；缺省（POST /exercises 建的动作）按
 *  primary_muscles 肌群兜底（契约 MUSCLE_REGION 与 body_part 解耦口径）。
 *  两者皆判不出返回 null 由调用方跳过。 */
function regionOfRow(row: {
  body_part: string | null;
  primary_muscles: string[] | null;
}): ExerciseRegion | null {
  if (row.body_part) {
    const byBodyPart = BODY_PART_REGION[row.body_part];
    if (byBodyPart) return byBodyPart;
  }
  for (const muscle of row.primary_muscles ?? []) {
    const byMuscle = MUSCLE_REGION[muscle];
    if (byMuscle) return byMuscle;
  }
  return null;
}

/** session raw_json 内单个动作条目的最小读取形态 */
interface SessionExerciseEntry {
  libraryId: string | null;
  name: string;
}

/** 从一节训练 raw_json 提取动作条目（防御性读取：非数组/缺字段静默跳过） */
function extractSessionExercises(rawJson: unknown): SessionExerciseEntry[] {
  if (!rawJson || typeof rawJson !== "object") return [];
  const exercises = (rawJson as { exercises?: unknown }).exercises;
  if (!Array.isArray(exercises)) return [];
  const out: SessionExerciseEntry[] = [];
  for (const ex of exercises) {
    if (!ex || typeof ex !== "object") continue;
    const rec = ex as Record<string, unknown>;
    const name = typeof rec.name === "string" ? rec.name : "";
    const meta = rec.metadata as Record<string, unknown> | undefined;
    const metaLibraryId =
      meta && typeof meta.libraryId === "string" ? meta.libraryId : null;
    const legacyLibraryId =
      typeof rec.libraryId === "string" && rec.libraryId ? rec.libraryId : null;
    // libraryId 缺省时用动作名兜底（name_zh 匹配在库投影查找侧完成）
    out.push({
      libraryId: metaLibraryId ?? legacyLibraryId,
      name,
    });
  }
  return out;
}

export const ExerciseSortService = {
  /**
   * picker 智能排序（后端真源）。
   * @param userId 用户 UUID；缺失/非法时返回纯库序基线（不抛错）
   */
  async getSmartSort(userId?: string | null): Promise<SmartSortResponse> {
    // 1. 库投影（排序基线 = 库序）
    const client = getPostgresClient();
    const repo = createExerciseRepository(client);
    const library = await repo.listSortProjection();
    const libIds = library.map((row) => row.id);
    const byId = new Map(library.map((row) => [row.id, row]));
    const idByNameZh = new Map<string, string>();
    const idByName = new Map<string, string>();
    for (const row of library) {
      if (row.name_zh && !idByNameZh.has(row.name_zh))
        idByNameZh.set(row.name_zh, row.id);
      if (!idByName.has(row.name)) idByName.set(row.name, row.id);
    }

    // 2. 近期训练条目（新→旧）：session 倒序已是新→旧，节内按 exercises 顺序
    const entries: RecentTrainedEntry[] = [];
    if (userId && UUIDSchema.safeParse(userId).success) {
      const sessions = await SessionRepo.getAllUserSessions(
        userId,
        SMART_SORT_RECENT_SESSION_LIMIT,
      );
      for (const session of sessions) {
        let raw = session.raw_json;
        if (typeof raw === "string") {
          // 契约红线：JSON 解析一律 parseJSONSafe（带 context 记日志）；
          // dev 态其抛错亦吞掉——排序属呈现增强，坏行不阻断
          try {
            raw = parseJSONSafe<unknown>(
              raw,
              "exerciseSortService session.raw_json",
            );
          } catch {
            continue;
          }
          if (!raw) continue;
        }
        for (const ex of extractSessionExercises(raw)) {
          // 动作 → 库行：libraryId 优先，name/name_zh 兜底
          const libId =
            (ex.libraryId && byId.has(ex.libraryId) ? ex.libraryId : null) ??
            idByName.get(ex.name) ??
            idByNameZh.get(ex.name) ??
            null;
          if (!libId) continue;
          const libRow = byId.get(libId);
          if (!libRow) continue;
          const region = regionOfRow(libRow);
          if (!region) continue;
          entries.push({ exerciseId: libId, region });
        }
      }
    }

    // 3. 近期分区去重（同分区只计最新）+ 排序合成
    const deduped = dedupeRecentRegions(
      entries,
      SMART_SORT_RECENT_EXERCISE_LIMIT,
    );
    const response: SmartSortResponse = {
      sort_version: 1,
      ranked_ids: dedupeRankedIds(rankWithRecent(libIds, deduped.exerciseIds)),
      recent_exercise_ids: deduped.exerciseIds,
      recent_regions: deduped.regions,
    };
    return SmartSortResponseSchema.parse(response);
  },
};

/** ranked_ids 防御性去重（rankWithRecent 已保证，此处兜底契约 min(1) 形态） */
function dedupeRankedIds(ids: string[]): string[] {
  return [...new Set(ids)];
}
