/**
 * Exercise Library Contracts (动作库深化 — issue #4)
 *
 * 动作库要支撑「动作百科」式可视化，本文件是 exercises 表深化列的
 * 数据契约唯一真源，覆盖三块：
 *
 *  1. 受控词表（controlled vocabularies）
 *     - EXERCISE_MUSCLES     17 基准肌群（库1 free-exercise-db 枚举为基准，snake_case 化）
 *     - EXERCISE_EQUIPMENT   15 器材大类（库1 13 值 + 库3 13 值 + 存量中文 10 值归一）
 *     - EXERCISE_CATEGORIES  7 训练类目（库1 category 归一）
 *     - EXERCISE_BODY_PARTS  10 身体区域（库3 free-exercise-db-with-videos bodyPart 归一）
 *     - EXERCISE_FORCE_TYPES / EXERCISE_MECHANICS（库1 force/mechanic 归一）
 *
 *  2. 归一映射表（纯数据）
 *     - MUSCLE_ALIASES      三源肌群原值 → 17 基准（值 null = 非肌群目标，不映射）
 *     - EQUIPMENT_ALIASES   三源器材原值 → 15 大类
 *     - DIFFICULTY_ALIASES  库1 expert → advanced
 *     - CATEGORY_ALIASES / BODY_PART_ALIASES 源值空格 → snake_case
 *
 *  3. Zod Schema
 *     - ExerciseLibraryItemSchema 深化后的 exercises 完整行契约（新列全部可空，
 *       存量行回填前后均可通过）
 *     - ExerciseDetailUpdateSchema 深化列更新输入（白名单）
 *
 * 数据源拍板（issue #3 评估报告 2026-09-26，口径以 issue #4 任务书为准）：
 *   - 主源 free-exercise-db-with-videos 317 条（教学字段最全：steps/formCues/
 *     commonMistakes/breathing/aliases + male/female 视频）
 *   - 补充源 free-exercise-db 876 条（按常用度补缺）
 *   - RepDB 弃用（许可冲突：禁止数据集再分发）
 *   - 目标精收 300-500 条，不堆数量
 *
 * 命名：数据库与应用层统一 snake_case（CLAUDE.md 红线），
 * 字段形态对齐 PostgreSQL 表 exercises 深化列
 * （迁移 backend/src/db/postgresql/migrations/002_exercise_details.sql）。
 *
 * @version 1.0.0
 * @created 2026-09-26
 */

import { z } from 'zod';

// ============================================================================
// 受控词表 (Controlled Vocabularies)
// ============================================================================

/**
 * 17 基准肌群——库1 free-exercise-db 的 primary/secondary muscles 枚举
 * 为基准（snake_case 化：'lower back' → lower_back），库3 的 39 个 target
 * 与存量中文值全部映射归一到本词表（见 MUSCLE_ALIASES）。
 * 粒度为人体大肌群，服务「动作百科」按肌群筛选。
 */
export const EXERCISE_MUSCLES = [
  'abdominals',   // 腹肌（含腹直肌/腹斜肌）
  'abductors',    // 髋外展肌群
  'adductors',    // 髋内收肌群
  'biceps',       // 肱二头肌
  'calves',       // 小腿（含腓骨肌）
  'chest',        // 胸（不区分上/中下）
  'forearms',     // 前臂
  'glutes',       // 臀（不区分上/下/臀中）
  'hamstrings',   // 腘绳肌
  'lats',         // 背阔肌
  'lower_back',   // 下背（竖脊肌）
  'middle_back',  // 中背（菱形肌/上背）
  'neck',         // 颈
  'quadriceps',   // 股四头肌
  'shoulders',    // 肩（含前/中/后束、肩袖）
  'traps',        // 斜方肌
  'triceps',      // 肱三头肌
] as const;

export const ExerciseMuscleSchema = z.enum(EXERCISE_MUSCLES);

export type ExerciseMuscle = z.infer<typeof ExerciseMuscleSchema>;

/**
 * 15 器材大类——三源归一：
 * 库1 13 值（None/'body only' → bodyweight、'e-z curl bar' → barbell）、
 * 库3 13 值（rope → cable、leverage/sled/smith machine → machine）、
 * 存量中文 10 值（卧推凳/上斜凳 → bench、单杠/双杠 → pull_up_bar、深蹲架 → rack）。
 * 语义 = 完成该动作所需的「主器材」；无器材 → bodyweight（显式值，不用 null）。
 */
export const EXERCISE_EQUIPMENT = [
  'bodyweight',      // 徒手（源值 null/'body only'/'body weight'/None/空器材数组归一）
  'barbell',         // 杠铃（含 EZ 弯杠）
  'dumbbell',        // 哑铃
  'kettlebell',      // 壶铃
  'cable',           // 绳索拉力器（含绳索附件 rope）
  'machine',         // 器械（含 leverage/sled/smith/腿举机/腿弯举机）
  'band',            // 弹力带
  'bench',           // 凳（平凳/上斜凳）
  'rack',            // 深蹲架/力量架
  'pull_up_bar',     // 单杠/双杠等自重固定架
  'stability_ball',  // 瑞士球/稳定球
  'medicine_ball',   // 药球
  'foam_roller',     // 泡沫轴
  'weighted',        // 加重背心/外挂负重
  'other',           // 其他/未分类
] as const;

export const ExerciseEquipmentSchema = z.enum(EXERCISE_EQUIPMENT);

export type ExerciseEquipment = z.infer<typeof ExerciseEquipmentSchema>;

/**
 * 7 训练类目——库1 category 枚举归一（snake_case 化）。
 * 库3 无此维度，主源记录导入时可为 null。
 */
export const EXERCISE_CATEGORIES = [
  'strength',             // 力量
  'cardio',               // 有氧
  'stretching',           // 拉伸
  'plyometrics',          // 增强式训练
  'powerlifting',         // 力量举
  'strongman',            // 壮汉
  'olympic_weightlifting', // 奥林匹克举重
] as const;

export const ExerciseCategorySchema = z.enum(EXERCISE_CATEGORIES);

export type ExerciseCategory = z.infer<typeof ExerciseCategorySchema>;

/**
 * 10 身体区域——库3 bodyPart 枚举归一（snake_case 化）。
 * 库1 无此维度，补充源记录可为 null。
 */
export const EXERCISE_BODY_PARTS = [
  'back',        // 背部
  'cardio',      // 心肺（非肌群区域，有氧动作检索轴）
  'chest',       // 胸部
  'hips',        // 髋部
  'lower_arms',  // 前臂
  'lower_legs',  // 小腿
  'shoulders',   // 肩部
  'upper_arms',  // 上臂
  'upper_legs',  // 大腿
  'waist',       // 腰腹
] as const;

export const ExerciseBodyPartSchema = z.enum(EXERCISE_BODY_PARTS);

export type ExerciseBodyPart = z.infer<typeof ExerciseBodyPartSchema>;

/**
 * 力向——库1 force 枚举（None → null，不映射）。
 */
export const EXERCISE_FORCE_TYPES = ['push', 'pull', 'static'] as const;

export const ExerciseForceTypeSchema = z.enum(EXERCISE_FORCE_TYPES);

export type ExerciseForceType = z.infer<typeof ExerciseForceTypeSchema>;

/**
 * 动作机制——库1 mechanic 枚举（None → null，不映射）。
 */
export const EXERCISE_MECHANICS = ['compound', 'isolation'] as const;

export const ExerciseMechanicSchema = z.enum(EXERCISE_MECHANICS);

export type ExerciseMechanic = z.infer<typeof ExerciseMechanicSchema>;

// ============================================================================
// 归一映射表 (Normalization Mappings — 纯数据)
// ============================================================================
// 映射真源：本表是三源原值 → 受控词表的唯一对照。迁移 002 的 SQL 回填
// 内联了同一映射（注释互指）；如增改值，两处必须同步，契约测试锁定全等。
//
// 值语义：string = 映射到的基准值；null = 非肌群目标（cardiovascular system /
// full body 等不是骨骼肌，primary_muscles 归一为空数组，检索走 body_part）。

/**
 * 肌群映射：源原值 → 17 基准。
 * 分区：库1 17 原值 | 库3 39 target（任务书点名）| 存量中文脏值 | 18 中文词表值。
 */
export const MUSCLE_ALIASES: Readonly<Record<string, ExerciseMuscle | null>> = {
  // ---- 库1 free-exercise-db 17 原值（identity + 空格 → snake_case）----
  abdominals: 'abdominals',
  abductors: 'abductors',
  adductors: 'adductors',
  biceps: 'biceps',
  calves: 'calves',
  chest: 'chest',
  forearms: 'forearms',
  glutes: 'glutes',
  hamstrings: 'hamstrings',
  lats: 'lats',
  'lower back': 'lower_back',
  'middle back': 'middle_back',
  neck: 'neck',
  quadriceps: 'quadriceps',
  shoulders: 'shoulders',
  traps: 'traps',
  triceps: 'triceps',

  // ---- 库3 free-exercise-db-with-videos 39 target（同义词冗余归一）----
  abs: 'abdominals',
  'anterior deltoid': 'shoulders',
  'cardiovascular system': null, // 非肌群目标（有氧），检索走 body_part=cardio
  deltoids: 'shoulders',
  delts: 'shoulders',
  'erector spinae': 'lower_back',
  erectors: 'lower_back',
  'forearm extensors': 'forearms',
  'full body': null, // 非单肌群目标（全身复合），不强行归并
  'gluteus medius': 'abductors', // 臀中肌主司髋外展，解剖归位外展肌群
  'hip flexors': 'quadriceps', // 髋屈肌群：股直肌为其主骨骼肌成分（拉伸/举腿系动作）
  'neck flexors': 'neck',
  obliques: 'abdominals', // 腹斜肌归并腹肌域（库1 17 粒度不分侧腹）
  pectorals: 'chest',
  peroneals: 'calves', // 腓骨肌归小腿
  'posterior deltoid': 'shoulders',
  quads: 'quadriceps',
  'rear deltoids': 'shoulders',
  'rectus abdominis': 'abdominals',
  rhomboids: 'middle_back', // 菱形肌归中背
  'spinal erectors': 'lower_back',
  spine: 'lower_back', // 脊柱（拉伸/活动度类）归下背域
  sternocleidomastoid: 'neck', // 胸锁乳突肌归颈
  'thoracic spine': 'middle_back', // 胸椎区域归中背
  'upper back': 'middle_back',
  'upper pectorals': 'chest',

  // ---- 存量 exercises.attributes 中文脏值（25 条实测 distinct 全集）----
  ROTATOR_CUFF: 'shoulders', // 肩袖归肩域
  三角肌: 'shoulders',
  上胸: 'chest',
  下胸: 'chest',
  中下胸: 'chest',
  中束: 'shoulders',
  二头: 'biceps',
  三头: 'triceps',
  前束: 'shoulders',
  前肩: 'shoulders',
  前臂: 'forearms',
  后束: 'shoulders',
  后肩: 'shoulders',
  后链: 'hamstrings', // 后链（posterior chain）主链条归腘绳
  核心: 'abdominals',
  股四: 'quadriceps',
  肩膀: 'shoulders',
  背部厚度: 'middle_back', // 划船系厚度训练归中背
  背阔: 'lats',
  背阔肌: 'lats',
  腘绳: 'hamstrings',
  腹肌: 'abdominals',
  臀大: 'glutes',

  // ---- 18 中文词表值（MuscleTarget 全集兜底，存量/中文管道兼容）----
  小臂: 'forearms',
  小腿: 'calves',
  侧腹: 'abdominals',
  上臀部: 'glutes',
  下臀部: 'glutes',
  下背: 'lower_back',
  斜方肌: 'traps',
  背部: 'lats', // 泛背语义归背阔肌（宽度训练主域）
};

/**
 * 器材映射：源原值 → 15 大类。
 * 分区：库1 13 值 | 库3 13 值 | 存量中文 10 值。
 * 源 null / None / 'body only' / 'body weight' / 空器材数组 → bodyweight。
 */
export const EQUIPMENT_ALIASES: Readonly<Record<string, ExerciseEquipment>> = {
  // ---- 库1 free-exercise-db 13 值 ----
  None: 'bodyweight',
  'body only': 'bodyweight',
  bands: 'band',
  barbell: 'barbell',
  cable: 'cable',
  dumbbell: 'dumbbell',
  'e-z curl bar': 'barbell', // EZ 弯杠归杠铃（评估报告先例）
  'exercise ball': 'stability_ball',
  'foam roll': 'foam_roller',
  kettlebells: 'kettlebell',
  machine: 'machine',
  'medicine ball': 'medicine_ball',
  other: 'other',

  // ---- 库3 free-exercise-db-with-videos 13 值 ----
  band: 'band',
  'body weight': 'bodyweight',
  'ez barbell': 'barbell',
  kettlebell: 'kettlebell',
  'leverage machine': 'machine',
  rope: 'cable', // 绳索附件归拉力器
  'sled machine': 'machine',
  'smith machine': 'machine',
  'stability ball': 'stability_ball',
  weighted: 'weighted',

  // ---- 存量 exercises.attributes 中文 10 值 ----
  杠铃: 'barbell',
  哑铃: 'dumbbell',
  拉力器: 'cable',
  卧推凳: 'bench',
  上斜凳: 'bench',
  腿举机: 'machine',
  腿弯举机: 'machine',
  深蹲架: 'rack',
  单杠: 'pull_up_bar',
  双杠: 'pull_up_bar', // 双杠（dip station）归自重固定架
};

/**
 * 难度映射：库1 expert → advanced（starfit difficulty_level 三值口径）。
 * beginner/intermediate/advanced 恒等，不列入。
 */
export const DIFFICULTY_ALIASES: Readonly<Record<string, 'beginner' | 'intermediate' | 'advanced'>> = {
  expert: 'advanced',
};

/**
 * 类目映射：库1 category 原值（空格）→ snake_case。恒等值不列入。
 */
export const CATEGORY_ALIASES: Readonly<Record<string, ExerciseCategory>> = {
  'olympic weightlifting': 'olympic_weightlifting',
};

/**
 * 身体区域映射：库3 bodyPart 原值（空格）→ snake_case。恒等值不列入。
 */
export const BODY_PART_ALIASES: Readonly<Record<string, ExerciseBodyPart>> = {
  'lower arms': 'lower_arms',
  'lower legs': 'lower_legs',
  'upper arms': 'upper_arms',
  'upper legs': 'upper_legs',
};

// ============================================================================
// 归一函数 (Normalization Functions — 纯函数)
// ============================================================================

/**
 * 肌群原值 → 17 基准。
 * @returns 基准值；null = 非肌群目标或未知原值（调用方记日志，不静默映射）
 */
export function normalizeMuscle(raw: string): ExerciseMuscle | null {
  const trimmed = raw.trim();
  return MUSCLE_ALIASES[trimmed] ?? MUSCLE_ALIASES[trimmed.toLowerCase()] ?? null;
}

/**
 * 器材原值 → 15 大类。
 * @returns 大类值；null = 未知原值（调用方记日志）
 */
export function normalizeEquipment(raw: string): ExerciseEquipment | null {
  const trimmed = raw.trim();
  return EQUIPMENT_ALIASES[trimmed] ?? EQUIPMENT_ALIASES[trimmed.toLowerCase()] ?? null;
}

/**
 * 难度原值 → 三值口径（beginner/intermediate/advanced）。未知原值原样返回。
 */
export function normalizeDifficulty(
  raw: string,
): 'beginner' | 'intermediate' | 'advanced' | string {
  return DIFFICULTY_ALIASES[raw] ?? raw;
}

// ============================================================================
// 视频/海报资产引用 (Asset References — 存 URL 不落文件)
// ============================================================================

/**
 * 演示视频引用——库3 male/female 双版本 1080p MP4 的外链 URL。
 * 只存引用（自托管迁移后换为 OSS/CDN URL），不落文件本体。
 */
export const ExerciseVideoUrlsSchema = z.object({
  male: z.string().url().optional(),
  female: z.string().url().optional(),
});

export type ExerciseVideoUrls = z.infer<typeof ExerciseVideoUrlsSchema>;

// ============================================================================
// 既有 Exercise 契约（自 index.ts 迁入，单一真源整理）
// ============================================================================

/**
 * 肌肉目标选项 - 完整的肌肉分区列表
 * @deprecated 存量中文口径。新数据一律用 17 基准肌群（EXERCISE_MUSCLES）。
 */
export type MuscleTarget =
  | '上胸' | '中下胸'
  | '前束' | '中束' | '后束'
  | '二头' | '三头' | '小臂'
  | '背部' | '下背' | '斜方肌'
  | '腹肌' | '侧腹'
  | '股四' | '腘绳' | '小腿'
  | '上臀部' | '下臀部';

/**
 * Exercise Targets Schema（存量中文形态）
 * Defines primary and secondary target muscles
 * @deprecated 存量中文口径。新数据用 primary_muscles / secondary_muscles 列。
 */
export const ExerciseTargetsSchema = z.object({
  primary: z.array(z.string()),
  secondary: z.array(z.string()).optional(),
});

export type ExerciseTargets = z.infer<typeof ExerciseTargetsSchema>;

/**
 * Exercise Attributes Schema
 * attributes JSONB 兜底扩展位的结构化视图（存量动作）。
 * 深化列拆出后本结构继续有效：attributes 保留为兜底扩展位，
 * equipment/muscles 等结构化值以新列为准。
 */
export const ExerciseAttributesSchema = z.object({
  targets: ExerciseTargetsSchema,
  equipment_required: z.array(z.string()),
  impact_level: z.record(z.string(), z.number()).optional(),
  pattern: z.enum(['push', 'pull', 'squat', 'hinge', 'lunge', 'rotation']).optional(),
  movement_plane: z.enum(['sagittal', 'frontal', 'transverse']).optional(),
  stabilizers: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
});

export type ExerciseAttributes = z.infer<typeof ExerciseAttributesSchema>;

/**
 * Exercise Type Enum
 */
export const ExerciseTypeEnum = z.enum([
  'resistance',
  'unilateral',
  'bodyweight',
  'assisted',
  'isometric',
  'cardio',
  'flexibility',
  'heavy_weight',
  'rep_training',
  'outdoor',
]);

export type ExerciseType = z.infer<typeof ExerciseTypeEnum>;

/**
 * Exercise Type Values - Unified constant for exercise types
 * Used across the codebase to ensure consistency
 */
export const EXERCISE_TYPE_VALUES = [
  'resistance',    // 抗阻力训练
  'unilateral',    // 单侧训练
  'bodyweight',    // 自重训练
  'assisted',      // 辅助训练
  'isometric',     // 等长收缩
  'cardio',        // 有氧训练
  'flexibility',   // 柔韧性训练
  'heavy_weight',  // 大重量训练
  'rep_training',  // 次数训练
  'outdoor'        // 户外运动
] as const;

/**
 * Difficulty Level Enum（三值口径；库1 expert 经 DIFFICULTY_ALIASES 归一为 advanced）
 */
export const DifficultyLevelEnum = z.enum([
  'beginner',
  'intermediate',
  'advanced',
]);

export type DifficultyLevel = z.infer<typeof DifficultyLevelEnum>;

/**
 * Modified By Enum
 */
export const ModifiedByEnum = z.enum([
  'admin',
  'system',
  'mas',
  'user',
]);

export type ModifiedBy = z.infer<typeof ModifiedByEnum>;

/**
 * Exercise Schema（存量视图 — MAS/Admin 旧链路消费）
 * 深化后的完整行契约见 ExerciseLibraryItemSchema。
 */
export const ExerciseSchema = z.object({
  id: z.string().min(12).max(24), // NanoID format (14 chars by default, 12-24 allowed)
  name: z.string(),
  exercise_type: ExerciseTypeEnum,
  attributes: ExerciseAttributesSchema,
  difficulty: DifficultyLevelEnum,
  content_html: z.string().optional(),
  tutorials: z.record(z.string(), z.any()).optional(),
  tags_json: z.any().optional(),
  assets_json: z.any().optional(),
  modified_by: ModifiedByEnum.optional(),
  modified_at: z.any().optional(),
  created_at: z.any().optional(),
  updated_at: z.any().optional(),
});

export type Exercise = z.infer<typeof ExerciseSchema>;

/**
 * Exercise With Extracted Attributes
 * Same as Exercise but with targets and equipment_required at top level
 * for backward compatibility with frontend code
 */
export type ExerciseWithExtractedAttributes = Exercise & {
  targets: string; // JSON stringified ExerciseTargets
  equipment_required: string; // JSON stringified string[]
};

// ============================================================================
// 深化行契约 (ExerciseLibraryItem — issue #4 新列)
// ============================================================================

/**
 * 深化后的 exercises 完整行契约（含 002 迁移新增 16 列）。
 *
 * 新列语义：
 *  - 结构化分类列：可空（null = 未归一/源数据无此维度）；primary/secondary_muscles
 *    为 NOT NULL 数组（缺省 []，非肌群目标动作如纯有氧允许空数组）
 *  - 教学内容列：可空数组/文本（源库无此字段时 null，非空数组）
 *  - 资产引用列：只存 URL/路径引用，不落文件本体
 *  - 中文预留列：name_zh / instructions_zh 可空，AI 翻译管道后填
 *  - attributes 兜底扩展位保留（宽松 record：新导入动作无中文 targets 结构）
 */
export const ExerciseLibraryItemSchema = z.object({
  id: z.string().min(12).max(24), // NanoID（对齐 ExerciseSchema.id）
  name: z.string(),               // 源库规范名（英文为主）
  name_zh: z.string().nullable(), // 中文预留（AI 翻译管道后填；存量中文动作可回填）

  exercise_type: ExerciseTypeEnum,
  difficulty: DifficultyLevelEnum,

  // ---- 结构化分类（002 新列）----
  equipment: ExerciseEquipmentSchema.nullable(),      // 主器材；null = 未知
  category: ExerciseCategorySchema.nullable(),        // 训练类目；null = 源无此维度
  body_part: ExerciseBodyPartSchema.nullable(),       // 身体区域；null = 源无此维度
  primary_muscles: z.array(ExerciseMuscleSchema),     // 主肌群（17 基准；纯有氧可为 []）
  secondary_muscles: z.array(ExerciseMuscleSchema),   // 次肌群
  force_type: ExerciseForceTypeSchema.nullable(),     // 力向；null = 未知
  mechanic: ExerciseMechanicSchema.nullable(),        // 复合/孤立；null = 未知

  // ---- 教学内容（002 新列；可空数组 = 源库无此字段）----
  instructions: z.array(z.string()).nullable(),       // 步骤（短句数组，库3 steps 口径）
  form_cues: z.array(z.string()).nullable(),          // 要领提示（库3 formCues，独家）
  common_mistakes: z.array(z.string()).nullable(),    // 常见错误（库3 commonMistakes，独家）
  breathing: z.string().nullable(),                   // 呼吸法（库3 breathing，独家）
  aliases: z.array(z.string()).nullable(),            // 别名（库3 aliases，均 5.0 个）
  instructions_zh: z.array(z.string()).nullable(),    // 中文步骤预留（与 instructions 平行）

  // ---- 资产引用（002 新列；存 URL 不落文件）----
  image_refs: z.array(z.string()).nullable(),         // 图片引用（库1 jpg 路径/海报 URL）
  video_urls: ExerciseVideoUrlsSchema.nullable(),     // 演示视频 male/female URL
  poster_url: z.string().nullable(),                  // 首选海报 URL

  // ---- 兜底扩展位 + 系统列（既有列，形态不变）----
  attributes: z.record(z.string(), z.unknown()),      // JSONB 兜底（宽松：新导入动作无中文 targets）
  content_html: z.string().nullable().optional(),
  tutorials: z.record(z.string(), z.unknown()).nullable().optional(),
  tags_json: z.unknown().nullable().optional(),
  assets_json: z.unknown().nullable().optional(),
  modified_by: ModifiedByEnum.nullable().optional(),
  modified_at: z.string().datetime().nullable().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type ExerciseLibraryItem = z.infer<typeof ExerciseLibraryItemSchema>;

// ============================================================================
// 深化列更新输入 (Repository Update Input)
// ============================================================================

/**
 * 深化列更新输入——白名单字段（结构化分类 + 教学内容 + 资产引用 + 中文列）。
 * 至少一个字段；全部可空（null = 清空该列）。id/name/系统列不可经此更新。
 * 中文回写管道（name_zh/instructions_zh）与导入管道共用本入口。
 */
export const ExerciseDetailUpdateSchema = z
  .object({
    name_zh: z.string().nullable().optional(),
    equipment: ExerciseEquipmentSchema.nullable().optional(),
    category: ExerciseCategorySchema.nullable().optional(),
    body_part: ExerciseBodyPartSchema.nullable().optional(),
    primary_muscles: z.array(ExerciseMuscleSchema).optional(),
    secondary_muscles: z.array(ExerciseMuscleSchema).optional(),
    force_type: ExerciseForceTypeSchema.nullable().optional(),
    mechanic: ExerciseMechanicSchema.nullable().optional(),
    instructions: z.array(z.string()).nullable().optional(),
    form_cues: z.array(z.string()).nullable().optional(),
    common_mistakes: z.array(z.string()).nullable().optional(),
    breathing: z.string().nullable().optional(),
    aliases: z.array(z.string()).nullable().optional(),
    instructions_zh: z.array(z.string()).nullable().optional(),
    image_refs: z.array(z.string()).nullable().optional(),
    video_urls: ExerciseVideoUrlsSchema.nullable().optional(),
    poster_url: z.string().nullable().optional(),
  })
  .refine(
    (patch) => Object.keys(patch).length > 0,
    { message: '深化列更新输入至少包含一个字段' },
  );

export type ExerciseDetailUpdate = z.infer<typeof ExerciseDetailUpdateSchema>;

/**
 * 深化列检索输入——动作百科筛选轴（全部可选，空 = 不筛）。
 */
export const ExerciseSearchFilterSchema = z.object({
  muscle: ExerciseMuscleSchema.optional(),        // 命中 primary 或 secondary
  equipment: ExerciseEquipmentSchema.optional(),
  category: ExerciseCategorySchema.optional(),
  body_part: ExerciseBodyPartSchema.optional(),
  difficulty: DifficultyLevelEnum.optional(),
});

export type ExerciseSearchFilter = z.infer<typeof ExerciseSearchFilterSchema>;
