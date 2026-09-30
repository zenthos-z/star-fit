/**
 * gen-exercise-type-index.mjs 类型声明（#88 分册1）
 * 渲染函数为纯函数：真源 defs 由调用方注入（CLI 从 shared/dist 加载，
 * 测试经 tsx 从 shared/contracts 源码加载），共享同一渲染实现。
 */

/** card-types 单一真源子集（渲染所需字段） */
export type ExerciseSourceFineType =
  | 'resistance'
  | 'unilateral'
  | 'bodyweight'
  | 'assisted'
  | 'isometric'
  | 'cardio'
  | 'flexibility'
  | 'heavy_weight'
  | 'rep_training'
  | 'outdoor';

export interface ExerciseTypeSource {
  readonly EXERCISE_TYPE_VALUES: readonly ExerciseSourceFineType[];
  readonly EXERCISE_TYPE_DEFS: Readonly<
    Record<string, {
      major: string;
      variant: string;
      label_zh: string;
      plan_required: string;
      plan_optional: string;
      scenario_zh: string;
      example: string;
      anchor_fields: readonly string[];
    }>
  >;
  readonly CARD_MAJOR_TYPES: readonly string[];
  readonly CARD_MAJOR_LABELS_ZH: Readonly<Record<string, string>>;
  readonly MAJOR_CARD_TYPES: Readonly<Record<string, string>>;
  readonly cardTypeForExerciseType: (fine: ExerciseSourceFineType) => string;
}

/** 渲染 knowledge-index.md 全文 */
export function renderKnowledgeIndex(source: ExerciseTypeSource): string;

/** 渲染 SKILL.md 类型表块（含 BEGIN/END GENERATED 标记） */
export function renderSkillTableBlock(source: ExerciseTypeSource): string;

/** 用生成的表格块替换 SKILL.md 标记区间（标记外内容原样保留） */
export function applySkillTable(skillMd: string, block: string): string;
