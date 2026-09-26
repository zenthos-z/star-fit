/**
 * Exercise Repository
 *
 * 动作库深化列（issue #4 / 迁移 002）的唯一数据访问层。所有深化列读写
 * 经由本 Repository，禁止绕过直连数据库。覆盖三组操作：
 *  - 单条读取（按 id / name，动作百科详情页路径）
 *  - 多维筛选（肌群/器材/类目/身体区域/难度，动作百科列表路径）
 *  - 深化列更新（白名单字段，含 name_zh / instructions_zh 中文回写管道入口）
 *
 * 校验回路（CLAUDE.md 红线）：
 *  - 入库前：ExerciseDetailUpdateSchema / ExerciseSearchFilterSchema 经
 *    validateOrThrow 或 safeParse 快速失败（失败即抛 ServiceError）
 *  - 出库后：ExerciseLibraryItemSchema 经 validateOrThrow（失败即抛）
 *  - JSONB：video_urls 解析一律 parseJSONSafe（失败告警不静默）
 *
 * 002 返工后 exercises 无 attributes 列（新列完全接管）；A3 导入管道与
 * 中文回写管道经本 Repository / Service 层写入结构化列。
 */

import { PostgresClient } from "../client/postgres-client.js";
import { BaseRepository } from "./base.repository.js";
import {
  ServiceError,
  ServiceErrorCode,
} from "../../../services/errors/ServiceError.js";
import {
  validateOrThrow,
  parseJSONSafe,
  ExerciseLibraryItemSchema,
  ExerciseDetailUpdateSchema,
  ExerciseSearchFilterSchema,
  type ExerciseLibraryItem,
  type ExerciseDetailUpdate,
  type ExerciseSearchFilter,
} from "../../../../../shared/dist/contracts/index.js";

/** exercises 原始行（pg 驱动形态：timestamptz → Date；text[] → string[]；jsonb → 对象） */
interface ExerciseRow {
  id: string;
  name: string;
  name_zh: string | null;
  exercise_type: string;
  difficulty: string;
  equipment: string | null;
  category: string | null;
  body_part: string | null;
  primary_muscles: string[] | null;
  secondary_muscles: string[] | null;
  force_type: string | null;
  mechanic: string | null;
  instructions: string[] | null;
  form_cues: string[] | null;
  common_mistakes: string[] | null;
  breathing: string | null;
  aliases: string[] | null;
  instructions_zh: string[] | null;
  image_refs: string[] | null;
  video_urls: Record<string, unknown> | null;
  poster_url: string | null;
  owner_user_id: string | null;
  content_html: string | null;
  tutorials: Record<string, unknown> | null;
  tags_json: unknown;
  assets_json: unknown;
  modified_by: string | null;
  modified_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** 读取列清单（显式列出，防未来加列炸映射） */
const ITEM_SELECT_SQL = `
  SELECT
    id, name, name_zh, exercise_type, difficulty,
    equipment, category, body_part,
    primary_muscles, secondary_muscles, force_type, mechanic,
    instructions, form_cues, common_mistakes, breathing, aliases, instructions_zh,
    image_refs, video_urls, poster_url, owner_user_id,
    content_html, tutorials, tags_json, assets_json,
    modified_by, modified_at, created_at, updated_at
  FROM exercises
`;

/** exercises 行 → 契约形态（出库校验，失败即抛） */
function mapItemRow(row: ExerciseRow): ExerciseLibraryItem {
  // 红线：JSONB 解析一律 parseJSONSafe（对象直通、失败告警返回 null）
  const videoUrls = parseJSONSafe(
    row.video_urls,
    "ExerciseRepository.mapItemRow.video_urls",
  );

  return validateOrThrow(
    ExerciseLibraryItemSchema,
    {
      id: row.id,
      name: row.name,
      name_zh: row.name_zh,
      exercise_type: row.exercise_type,
      difficulty: row.difficulty,
      equipment: row.equipment,
      category: row.category,
      body_part: row.body_part,
      primary_muscles: row.primary_muscles ?? [],
      secondary_muscles: row.secondary_muscles ?? [],
      force_type: row.force_type,
      mechanic: row.mechanic,
      instructions: row.instructions,
      form_cues: row.form_cues,
      common_mistakes: row.common_mistakes,
      breathing: row.breathing,
      aliases: row.aliases,
      instructions_zh: row.instructions_zh,
      image_refs: row.image_refs,
      video_urls:
        videoUrls && Object.keys(videoUrls).length > 0 ? videoUrls : null,
      poster_url: row.poster_url,
      owner_user_id: row.owner_user_id,
      content_html: row.content_html,
      tutorials: row.tutorials ?? undefined,
      tags_json: row.tags_json,
      assets_json: row.assets_json,
      modified_by: row.modified_by,
      modified_at: row.modified_at ? row.modified_at.toISOString() : null,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    },
    "ExerciseRepository.mapItemRow",
  );
}

/** 深化列更新白名单：契约字段名 = 数据库列名（snake_case 红线），动态 SET 的防注入边界 */
const UPDATEABLE_COLUMNS: Record<string, string> = {
  name_zh: "name_zh",
  equipment: "equipment",
  category: "category",
  body_part: "body_part",
  primary_muscles: "primary_muscles",
  secondary_muscles: "secondary_muscles",
  force_type: "force_type",
  mechanic: "mechanic",
  instructions: "instructions",
  form_cues: "form_cues",
  common_mistakes: "common_mistakes",
  breathing: "breathing",
  aliases: "aliases",
  instructions_zh: "instructions_zh",
  image_refs: "image_refs",
  video_urls: "video_urls",
  poster_url: "poster_url",
};

/** 枚举列集合：UPDATE 需显式 cast 到 public.exercise_<column> 类型 */
const ENUM_COLUMNS = new Set([
  "equipment",
  "category",
  "body_part",
  "force_type",
  "mechanic",
]);

function isEnumColumn(field: string): boolean {
  return ENUM_COLUMNS.has(field);
}

/** 契约字段 → SQL 参数形态（jsonb 需 stringify，其余原样；枚举列在 SQL 侧 cast） */
function toSqlValue(field: string, value: unknown): unknown {
  if (field === "video_urls") {
    return value === null ? null : JSON.stringify(value);
  }
  return value;
}

export class ExerciseRepository extends BaseRepository {
  constructor(client: PostgresClient) {
    super(client);
  }

  /**
   * 按 id 读取动作（动作百科详情路径）。
   * 未命中返回 null。出库经 ExerciseLibraryItemSchema 校验（失败即抛）。
   */
  async getItemById(id: string): Promise<ExerciseLibraryItem | null> {
    if (typeof id !== "string" || id.length < 12 || id.length > 24) {
      throw new ServiceError(
        ServiceErrorCode.INVALID_PARAMS,
        `id 必须为 NanoID（12-24 字符，当前: ${id}）`,
        { id },
      );
    }
    const row = await this.queryOne<ExerciseRow>(
      `${ITEM_SELECT_SQL} WHERE id = $id`,
      { id },
    );
    return row ? mapItemRow(row) : null;
  }

  /**
   * 按名称读取动作（教学页/别名检索路径）。
   * 未命中返回 null。
   */
  async getItemByName(name: string): Promise<ExerciseLibraryItem | null> {
    if (typeof name !== "string" || name.trim().length === 0) {
      throw new ServiceError(
        ServiceErrorCode.INVALID_PARAMS,
        `name 必须为非空字符串`,
        { name },
      );
    }
    const row = await this.queryOne<ExerciseRow>(
      `${ITEM_SELECT_SQL} WHERE name = $name`,
      { name },
    );
    return row ? mapItemRow(row) : null;
  }

  /**
   * 多维筛选动作（动作百科列表路径）。
   * 筛选轴：肌群（命中 primary 或 secondary）/ 器材 / 类目 / 身体区域 / 难度，
   * 全部可选、可组合（AND）。结果按 name 排序，上限 500 条（百科全量护栏）。
   */
  async searchItems(
    filter: ExerciseSearchFilter,
  ): Promise<ExerciseLibraryItem[]> {
    // 入库前契约校验（Zod 失败即抛 —— 红线：禁止静默吞错）
    const f = validateOrThrow(
      ExerciseSearchFilterSchema,
      filter,
      "ExerciseRepository.searchItems",
    );

    const conditions: string[] = [];
    const params: Record<string, unknown> = {};
    if (f.muscle) {
      conditions.push(
        `($muscle::text = ANY(primary_muscles) OR $muscle::text = ANY(secondary_muscles))`,
      );
      params.muscle = f.muscle;
    }
    if (f.equipment) {
      conditions.push(`equipment = $equipment::public.exercise_equipment`);
      params.equipment = f.equipment;
    }
    if (f.category) {
      conditions.push(`category = $category::public.exercise_category`);
      params.category = f.category;
    }
    if (f.body_part) {
      conditions.push(`body_part = $bodyPart::public.exercise_body_part`);
      params.bodyPart = f.body_part;
    }
    if (f.difficulty) {
      conditions.push(`difficulty = $difficulty::public.difficulty_level`);
      params.difficulty = f.difficulty;
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = await this.queryMany<ExerciseRow>(
      `${ITEM_SELECT_SQL} ${where} ORDER BY name LIMIT 500`,
      params,
    );
    return rows.map(mapItemRow);
  }

  /**
   * 更新深化列（白名单，含中文回写管道入口 name_zh / instructions_zh）。
   *
   * 只更新 ExerciseDetailUpdateSchema 允许的字段；同时刷新 modified_by /
   * modified_at（updated_at 由触发器维护）。返回更新后的完整行；
   * 动作不存在 → null。
   */
  async updateDetail(
    id: string,
    patch: ExerciseDetailUpdate,
    modifiedBy: "admin" | "system" | "mas" | "user" = "system",
  ): Promise<ExerciseLibraryItem | null> {
    if (typeof id !== "string" || id.length < 12 || id.length > 24) {
      throw new ServiceError(
        ServiceErrorCode.INVALID_PARAMS,
        `id 必须为 NanoID（12-24 字符，当前: ${id}）`,
        { id },
      );
    }
    // 入库前契约校验（白名单 + 至少一字段，Zod 失败即抛）
    const data = validateOrThrow(
      ExerciseDetailUpdateSchema,
      patch,
      "ExerciseRepository.updateDetail",
    );

    // 动态 SET：列名取自 UPDATEABLE_COLUMNS 白名单（防注入边界），值走命名参数
    const sets: string[] = [];
    const params: Record<string, unknown> = {};
    for (const [field, column] of Object.entries(UPDATEABLE_COLUMNS)) {
      if (field in data) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const value = (data as any)[field];
        if (field === "primary_muscles" || field === "secondary_muscles") {
          sets.push(`${column} = $${field}::text[]`);
        } else if (field === "video_urls") {
          sets.push(`${column} = $${field}::jsonb`);
        } else if (isEnumColumn(field)) {
          // 枚举列（equipment/category/body_part/force_type/mechanic）：
          // PG 类型名与列名同名约定 public.exercise_<column>
          sets.push(`${column} = $${field}::public.exercise_${column}`);
        } else {
          sets.push(`${column} = $${field}`);
        }
        params[field] = toSqlValue(field, value);
      }
    }
    sets.push(`modified_by = $modifiedBy::public.modified_by_type`);
    sets.push(`modified_at = now()`);
    params.id = id;
    params.modifiedBy = modifiedBy;

    const row = await this.queryOne<ExerciseRow>(
      `UPDATE exercises SET ${sets.join(", ")}
       WHERE id = $id
       RETURNING
         id, name, name_zh, exercise_type, difficulty,
         equipment, category, body_part,
         primary_muscles, secondary_muscles, force_type, mechanic,
         instructions, form_cues, common_mistakes, breathing, aliases, instructions_zh,
         image_refs, video_urls, poster_url, owner_user_id,
         content_html, tutorials, tags_json, assets_json,
         modified_by, modified_at, created_at, updated_at`,
      params,
    );
    return row ? mapItemRow(row) : null;
  }
}

export function createExerciseRepository(
  client: PostgresClient,
): ExerciseRepository {
  return new ExerciseRepository(client);
}
