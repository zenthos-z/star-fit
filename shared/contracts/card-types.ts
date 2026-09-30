/**
 * 卡片类型两级体系 — 类型统一单一真源（issue #88 分册1）
 *
 * 背景：#88 实查发现规范地基两套口径——契约层 5 类弱枚举
 * （unknown/strength/cardio/hiit/stretch）与技能层 exercise-type-guide
 * 10 细类（resistance/.../outdoor）各自为政，卡片分发键（cardType）
 * 又是第三套手写值。本文件把三套口径收敛为一个定义源：
 *
 *   5 大类 (major)  ── CARD_MAJOR_TYPES
 *   10 细类 (fine)  ── EXERCISE_TYPE_DEFS（唯一手写处）
 *   cardType 映射  ── 大类 + 渲染变体 → `{major}_{variant}`
 *
 * 派生关系（全代码库从本文件取，禁再手写第二套）：
 *   - ExerciseTypeEnum / EXERCISE_TYPE_VALUES：10 细类枚举
 *     （= exercises 表 exercise_type_enum，= 技能知识库 knowledge/ 文件键）
 *   - cardType：两级分发键 `{major}_{variant}`（如 resistance_standard、
 *     cardio_running）。卡片 = 信息流传递与可视化单元（CONTEXT.md），
 *     不预设为「运动」；variant 是渲染变体（standard/running/timer/…），
 *     不是细类的直接平铺——多个细类可共用一张标准卡
 *   - ExerciseActionTypeEnum：会话动作类型 = 10 细类 + hiit + unknown
 *     （hiit 为训练编排格式，无动作库细类，仅在动作/cardType 层有效）
 *   - LEGACY_EXERCISE_TYPE_ALIASES：旧 5 类协议值等存量值 → 细类
 *     （兼容读取唯一对照；禁直接破坏存量数据语义）
 *   - EXERCISE_TYPE_FIELDS：锚点必需字段（LoadAnchor 校验轴）
 *
 * 同源生成：技能知识库索引
 * （backend/src/services/mas/skills/exercise-type-guide/knowledge-index.md
 * 与 SKILL.md 动作类型表）由 scripts/gen-exercise-type-index.mjs 从本文件
 * 生成；漂移由 backend/src/services/agent/__tests__/exerciseTypeSync.test.ts
 * 守门（--check 模式比对磁盘文件）。
 *
 * 命名：数据库与应用层统一 snake_case（CLAUDE.md 红线）。
 *
 * @version 1.0.0
 * @created 2026-09-30
 */

import { z } from 'zod';

// ============================================================================
// 5 大类 (Major Types)
// ============================================================================

/**
 * 5 大类——两级体系的第一级，cardType 的前缀域。
 * 拍板（issue #88）：5 大类 + variant，替代 10+ 细类平铺。
 * 语义上是大类的训练模态分组，非动作库检索轴（检索仍走 10 细类）。
 */
export const CARD_MAJOR_TYPES = [
  'resistance',  // 抗阻系（旧 strength 语义改名）
  'cardio',      // 有氧系
  'hiit',        // 高强度间歇（无细类，动作/cardType 层有效）
  'isometric',   // 等长系
  'stretch',     // 柔韧拉伸系
] as const;

export type CardMajorType = (typeof CARD_MAJOR_TYPES)[number];

/** 5 大类中文显示名（纯数据，技能层/管理台共用） */
export const CARD_MAJOR_LABELS_ZH: Readonly<Record<CardMajorType, string>> = {
  resistance: '抗阻训练',
  cardio: '有氧训练',
  hiit: '高强度间歇',
  isometric: '等长训练',
  stretch: '柔韧拉伸',
};

// ============================================================================
// 10 细类 (Fine Types) — 唯一手写定义处
// ============================================================================
// 值域 = exercises 表 exercise_type_enum（000_baseline.sql）
//      = 技能知识库 knowledge/{fine}.md 文件名
// 顺序 = 既有 EXERCISE_TYPE_VALUES 顺序（稳定，禁随意重排）。

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
  'outdoor',       // 户外运动
] as const;

export type ExerciseFineType = (typeof EXERCISE_TYPE_VALUES)[number];

/** 细类定义（除 type 本体外全部元数据的唯一手写处） */
export interface ExerciseTypeDef {
  /** 所属 5 大类（cardType 前缀） */
  readonly major: CardMajorType;
  /** 渲染变体（cardType 后缀；多个细类可共用同一变体 → 同一张卡） */
  readonly variant: string;
  /** 中文显示名 */
  readonly label_zh: string;
  /**
   * 计划参数必需约束（人类可读，供技能知识索引；
   * 强校验真源 = uiHintSchemas ExercisePlanSchema superRefine）
   */
  readonly plan_required: string;
  /** 计划参数可选字段（技能知识索引「可选字段」列；'-' = 无） */
  readonly plan_optional: string;
  /** 典型场景（技能知识索引表用） */
  readonly scenario_zh: string;
  /** 典型示例（技能知识索引表用） */
  readonly example: string;
  /**
   * 锚点必需字段（EXERCISE_TYPE_FIELDS 派生源；
   * LoadAnchor 校验轴，与 plan 参数是两个字段域）
   */
  readonly anchor_fields: readonly string[];
}

/**
 * 细类元数据表——Record 键类型钉死全集，新增细类时编译期强制补齐本表
 * + DB 枚举迁移 + 技能知识文档（exerciseTypeSync 测试守门）。
 */
export const EXERCISE_TYPE_DEFS: Readonly<Record<ExerciseFineType, ExerciseTypeDef>> = {
  resistance: {
    major: 'resistance',
    variant: 'standard',
    label_zh: '抗阻力训练',
    plan_required: 'weight > 0',
    plan_optional: '-',
    scenario_zh: '增肌、力量',
    example: '深蹲: weight=60',
    anchor_fields: ['best_weight', 'best_reps'],
  },
  unilateral: {
    major: 'resistance',
    variant: 'standard',
    label_zh: '单侧训练',
    plan_required: 'weight > 0',
    plan_optional: '-',
    scenario_zh: '单侧强化',
    example: '箭步蹲: weight=20',
    anchor_fields: ['best_weight', 'best_reps'],
  },
  bodyweight: {
    major: 'resistance',
    variant: 'standard',
    label_zh: '自重训练',
    plan_required: '无（weight 默认 0）',
    plan_optional: 'weight=0',
    scenario_zh: '徒手训练',
    example: '俯卧撑: weight=0',
    anchor_fields: ['best_reps'],
  },
  assisted: {
    major: 'resistance',
    variant: 'standard',
    label_zh: '辅助训练',
    plan_required: 'weight <= 0（负值助力，如 -20 = 辅助 20kg）',
    plan_optional: '-',
    scenario_zh: '助力完成',
    example: '助力引体: weight=-10',
    anchor_fields: ['best_weight', 'best_reps'],
  },
  isometric: {
    major: 'isometric',
    variant: 'static',
    label_zh: '等长收缩',
    plan_required: 'duration > 0（reps 应为 1）',
    plan_optional: 'weight',
    scenario_zh: '核心稳定',
    example: '平板支撑: duration=30',
    anchor_fields: ['best_duration'],
  },
  cardio: {
    major: 'cardio',
    variant: 'running',
    label_zh: '有氧训练',
    plan_required: 'duration > 0',
    plan_optional: 'distance',
    scenario_zh: '心肺功能',
    example: '跑步: duration=600',
    anchor_fields: ['best_pace'],
  },
  flexibility: {
    major: 'stretch',
    variant: 'standard',
    label_zh: '柔韧性训练',
    plan_required: '无（可选 duration）',
    plan_optional: 'duration',
    scenario_zh: '拉伸放松',
    example: '拉伸: duration=30',
    anchor_fields: [],
  },
  heavy_weight: {
    major: 'resistance',
    variant: 'standard',
    label_zh: '大重量训练',
    plan_required: 'weight > 0',
    plan_optional: '-',
    scenario_zh: '1RM 突破',
    example: '硬拉: weight=100',
    anchor_fields: ['best_weight', 'best_reps'],
  },
  rep_training: {
    major: 'resistance',
    variant: 'standard',
    label_zh: '次数训练',
    plan_required: '无（weight 默认 0）',
    plan_optional: '-',
    scenario_zh: '次数挑战',
    example: '次数训练: weight=0',
    anchor_fields: ['best_reps'],
  },
  outdoor: {
    major: 'cardio',
    variant: 'outdoor',
    label_zh: '户外运动',
    plan_required: 'distance > 0',
    plan_optional: 'duration',
    scenario_zh: '户外跑步',
    example: '户外跑: distance=3000',
    anchor_fields: ['best_pace'],
  },
};

/** 细类中文显示名（派生，管理台/mcpTools 描述共用） */
export const EXERCISE_TYPE_LABELS_ZH: Readonly<Record<ExerciseFineType, string>> =
  Object.fromEntries(
    EXERCISE_TYPE_VALUES.map((t) => [t, EXERCISE_TYPE_DEFS[t].label_zh]),
  ) as Readonly<Record<ExerciseFineType, string>>;

/**
 * 细类枚举（Zod）——exercises 表 exercise_type 列口径。
 * 旧调用方从 exercise-library.ts / contracts index 的既有导出名不变。
 */
export const ExerciseTypeEnum = z.enum(EXERCISE_TYPE_VALUES);

export type ExerciseType = z.infer<typeof ExerciseTypeEnum>;

// ============================================================================
// cardType 两级分发键 (Card Dispatch Keys)
// ============================================================================
// cardType = `{major}_{variant}`：major ∈ 5 大类，variant 为渲染变体。
// 卡片（信息流传递与可视化单元）经 cardType 分发到渲染插件；
// 分册3（插件注册 API）以本表为注册键真源。

/** 标准两级 cardType 全集（由细类定义派生，测试断言与 DEFS 一致） */
export const CARD_TYPE_VALUES = [
  'resistance_standard',
  'cardio_running',
  'cardio_outdoor',
  'hiit_timer',
  'isometric_static',
  'stretch_standard',
] as const;

export type CardTypeValue = (typeof CARD_TYPE_VALUES)[number];

/**
 * 5 大类的缺省卡（旧 5 类值的兼容映射落点）：
 * strength → resistance_standard；cardio → cardio_running；
 * hiit → hiit_timer；stretch → stretch_standard。
 */
export const MAJOR_CARD_TYPES: Readonly<Record<CardMajorType, CardTypeValue>> = {
  resistance: 'resistance_standard',
  cardio: 'cardio_running',
  hiit: 'hiit_timer',
  isometric: 'isometric_static',
  stretch: 'stretch_standard',
};

/**
 * 旧 cardType 值 → 标准值（兼容读取）。
 * running_gps：两级体系落地前的户外卡键（PluginRegistry 既有键，
 * 渲染层禁碰，故保留合法值身份）；outdoor_gps：ExerciseCardV2 客户端
 * 派生值。两者语义 = 户外有氧卡 → cardio_outdoor。
 */
export const CARD_TYPE_ALIASES: Readonly<Record<string, CardTypeValue>> = {
  running_gps: 'cardio_outdoor',
  outdoor_gps: 'cardio_outdoor',
};

/**
 * CardType 合法值全集 = UNKNOWN 哨兵 + 标准值 + 兼容别名。
 * 别名键字面量列出（Object.keys 展开会拓宽元组类型破坏 z.enum 推断）；
 * 与 CARD_TYPE_ALIASES 键集的一致性由 typeUnification 测试守门。
 */
const CARD_TYPE_ENUM_VALUES = [
  'UNKNOWN',
  ...CARD_TYPE_VALUES,
  'running_gps',
  'outdoor_gps',
] as const;

/**
 * CardType Schema（两级分发键校验）。
 * 接受标准两级值与既有渲染层别名；输出保持输入原值（不在校验层改写），
 * 需要归一时用 normalizeCardType。
 */
export const CardTypeSchema = z.enum(CARD_TYPE_ENUM_VALUES).default('UNKNOWN');

export type CardType = z.infer<typeof CardTypeSchema>;

/** 细类 → 标准分发卡 */
export function cardTypeForExerciseType(fine: ExerciseFineType): CardTypeValue {
  const def = EXERCISE_TYPE_DEFS[fine];
  return `${def.major}_${def.variant}` as CardTypeValue;
}

/** 任意 cardType 原值 → 标准两级值；不认识 → 'UNKNOWN'（调用方记日志） */
export function normalizeCardType(raw: string): CardTypeValue | 'UNKNOWN' {
  const trimmed = String(raw ?? '').trim();
  if ((CARD_TYPE_VALUES as readonly string[]).includes(trimmed)) {
    return trimmed as CardTypeValue;
  }
  return CARD_TYPE_ALIASES[trimmed] ?? 'UNKNOWN';
}

// ============================================================================
// 会话动作类型 (ExerciseAction type)
// ============================================================================

/**
 * 会话动作类型全集 = 10 细类 + hiit + unknown。
 * 细类承接动作库/计划维度；hiit 保留旧协议语义（间歇编排格式，
 * 无细类对应，公式域按既有拍板落 cardio——见 suggestions.ts）；
 * unknown 为兜底哨兵。
 */
export const EXERCISE_ACTION_TYPE_VALUES = [
  ...EXERCISE_TYPE_VALUES,
  'hiit',
  'unknown',
] as const;

export type ExerciseActionType = (typeof EXERCISE_ACTION_TYPE_VALUES)[number];

export const ExerciseActionTypeEnum = z.enum(EXERCISE_ACTION_TYPE_VALUES);

// ============================================================================
// 存量值兼容映射 (Legacy Aliases — 兼容读取唯一对照)
// ============================================================================
// 旧 5 类协议枚举（unknown/strength/cardio/hiit/stretch）与
// legacy.ts 历史漂移值（weight_only/reps_only）→ 10 细类。
//
// 语义保真说明：
//   strength → resistance   同义改名（抗阻 = 力量训练）
//   stretch  → flexibility  同义改名（拉伸 = 柔韧性）
//   cardio / unknown        本就在细类/哨兵域内，恒等，不列入
//   hiit                   动作层合法值（见 EXERCISE_ACTION_TYPE_VALUES），
//                          不做细类归并，禁语义降级
//   weight_only / reps_only protocol.ts 历史笔误 → heavy_weight / rep_training

export const LEGACY_EXERCISE_TYPE_ALIASES: Readonly<Record<string, ExerciseFineType>> = {
  strength: 'resistance',
  stretch: 'flexibility',
  weight_only: 'heavy_weight',
  reps_only: 'rep_training',
};

/**
 * 任意类型原值 → 细类（兼容读取入口）。
 * @returns 细类值；'unknown' = 无法归一（调用方记日志，不静默编造）
 */
export function normalizeExerciseType(
  raw: string,
): ExerciseFineType | 'unknown' {
  const lower = String(raw ?? '').toLowerCase().trim();
  if ((EXERCISE_TYPE_VALUES as readonly string[]).includes(lower)) {
    return lower as ExerciseFineType;
  }
  return LEGACY_EXERCISE_TYPE_ALIASES[lower] ?? 'unknown';
}

/**
 * 任意类型原值 → 会话动作类型（细类 ∪ hiit ∪ unknown）。
 * 与 normalizeExerciseType 的差异：hiit 原样保留（动作层合法），
 * 供 ExerciseAction 读取链路使用。
 */
export function normalizeExerciseActionType(
  raw: string,
): ExerciseActionType {
  const lower = String(raw ?? '').toLowerCase().trim();
  if (lower === 'hiit') return 'hiit';
  return normalizeExerciseType(lower);
}

// ============================================================================
// 锚点必需字段 (Anchor Required Fields — EXERCISE_TYPE_FIELDS 真源)
// ============================================================================

/**
 * 细类 → 负荷锚点必需字段（派生自 EXERCISE_TYPE_DEFS.anchor_fields）。
 * 兼容历史导出名（contracts index 再导出）；LoadAnchorsEditor 与
 * validateAnchorForExerciseType 消费。
 */
export const EXERCISE_TYPE_FIELDS: {
  readonly [T in ExerciseFineType]: readonly string[];
} = Object.fromEntries(
  EXERCISE_TYPE_VALUES.map((t) => [t, EXERCISE_TYPE_DEFS[t].anchor_fields]),
) as { readonly [T in ExerciseFineType]: readonly string[] };
