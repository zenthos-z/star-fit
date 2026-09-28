/**
 * pickerAdapter — 新动作选择器 → 主流程接口的适配层
 *
 * 两个职责：
 * 1. 主流程接线缝：ExerciseSettingsModal.handleLibrarySelect 的原语签名
 *    （id/name/type/bodyCategory/muscles/equipment/nameEn）映射；
 * 2. 参数建议统一挂 SuggestionService（链路 A，issue #31）：
 *    PickerExerciseType → legacy 类型（flexibility 回退 bodyweight）、
 *    SuggestionValues → 草稿组。
 */

import type { SuggestionValues } from 'shared/contracts';

import type { Exercise } from '../../types/legacy';
import { createDraftId, type PickerDraftSet } from './pickerLogic';
import type { PickerExerciseType, PickerSelectionItem } from './pickerData';

/** legacy 类型映射表（flexibility → bodyweight，legacy 无该类） */
export const LEGACY_TYPE_MAP: Record<PickerExerciseType, string> = {
  resistance: 'resistance',
  cardio: 'cardio',
  bodyweight: 'bodyweight',
  isometric: 'isometric',
  assisted: 'assisted',
  unilateral: 'unilateral',
  weight_only: 'weight_only',
  reps_only: 'reps_only',
  outdoor: 'outdoor',
  flexibility: 'bodyweight',
};

export function toLegacyType(t: PickerExerciseType): string {
  return LEGACY_TYPE_MAP[t] ?? 'resistance';
}

/** SuggestionValues → 草稿组（清单/配置全链路同源；时长型/次数型二分支） */
export function valuesToDraftSets(v: SuggestionValues): PickerDraftSet[] {
  const count = Math.max(1, Math.min(10, v.set_count ?? 3));
  if ((v.duration_sec ?? 0) > 0) {
    return Array.from({ length: count }, () => ({
      id: createDraftId(),
      role: 'working' as const,
      weight: 0,
      reps: 0,
      durationSec: v.duration_sec as number,
    }));
  }
  return Array.from({ length: count }, () => ({
    id: createDraftId(),
    role: 'working' as const,
    weight: v.weight ?? 0,
    reps: v.reps ?? 10,
    durationSec: 0,
  }));
}

export interface LibrarySelectPayload {
  id: string;
  name: string;
  type: string;
  bodyCategory: string;
  muscles: string[];
  equipment: string;
  nameEn: string;
}

/** 购物车条目 → 旧库 onSelect 原语载荷（主流程回填 pendingExercise 用） */
export function pickerItemToLibrarySelect(item: PickerSelectionItem): LibrarySelectPayload {
  const { exercise } = item;
  return {
    id: exercise.id,
    name: exercise.name,
    type: toLegacyType(exercise.exerciseType),
    bodyCategory: exercise.muscle,
    muscles: exercise.muscles,
    equipment: exercise.equipmentLabel,
    nameEn: exercise.nameEn,
  };
}

// ---------------------------------------------------------------------------
// 批量创建载荷（A31 购物车批量添加，issue #31）
// ---------------------------------------------------------------------------

/**
 * 动作库行 id（12-24 字符，对齐 exercises.id 约束）。
 * uuid（36 字符）超长，取 hex 前 20 位；冲突概率忽略，唯一性由库层兜底。
 */
export function createLibraryId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 20);
}

/** POST /api/exercises（现有单条添加 API）的请求体形态（ExerciseServiceV2.Exercise 同构） */
export interface BatchCreatePayload {
  id: string;
  name: string;
  exercise_type: import('../../services/api/ExerciseServiceV2').ExerciseType;
  targets: string;
  equipment_required: string;
  difficulty: import('../../services/api/ExerciseServiceV2').Difficulty;
  modified_by: 'system';
}

/** 购物车条目 → 单条添加载荷（与 ExerciseSettingsModal.handleSave 的持久化字段口径一致：
 *  英文规范名 + 17 肌群 slug + 器械 slug；id 由 App 层生成——库内已有行不覆盖） */
export function pickerItemToBatchPayload(item: PickerSelectionItem): BatchCreatePayload {
  const { exercise } = item;
  return {
    id: createLibraryId(),
    name: exercise.nameEn,
    exercise_type: toLegacyType(exercise.exerciseType) as BatchCreatePayload['exercise_type'],
    targets: JSON.stringify({ primary: exercise.primaryMuscles, secondary: exercise.secondaryMuscles }),
    equipment_required: JSON.stringify([exercise.equipment]),
    difficulty: (exercise.difficulty || 'beginner') as BatchCreatePayload['difficulty'],
    modified_by: 'system',
  };
}

// ---------------------------------------------------------------------------
// 会话直连（A10 batch/append 确认，issue #32）
// ---------------------------------------------------------------------------

/**
 * 购物车条目 → 会话 Exercise（batch/append 确认时直接追加进 session.exercises，
 * 跳过逐条配置表单——参数已在清单页经链路 A 填充/可调）。
 * 字段口径对齐 ExerciseSettingsModal.handleSave → App.onSave 的落账形态：
 * name 存中文展示名（A6）、type 走 legacy 映射、组序即清单顺序；
 * id 由调用方传入并要求与批量入库载荷同源（对齐「session Exercise.id = 库 id」约定）。
 */
export function pickerItemToSessionExercise(item: PickerSelectionItem, id: string): Exercise {
  const { exercise, sets, targetRpe } = item;
  const legacyType = toLegacyType(exercise.exerciseType);
  return {
    id,
    libraryId: id,
    name: exercise.name,
    type: legacyType as Exercise['type'],
    sets: sets.map(s => ({
      id: s.id,
      reps: s.reps,
      weight: s.weight,
      duration: s.durationSec > 0 ? s.durationSec : undefined,
      completed: false,
      status: 'PLANNED' as const,
    })),
    targetRpe,
    primaryMuscles: exercise.muscles,
    equipment: exercise.equipmentLabel,
    bodyCategory: exercise.muscle,
    metadata: {
      libraryId: id,
      name: exercise.name,
      nameEn: exercise.nameEn,
      targetRpe,
      originalType: legacyType,
      primaryMuscles: exercise.muscles,
      equipment: exercise.equipmentLabel,
      bodyCategory: exercise.muscle,
    },
  };
}
