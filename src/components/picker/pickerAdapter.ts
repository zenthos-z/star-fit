/**
 * pickerAdapter — 新动作选择器 → 主流程旧接口的适配层（A8A9 接线）
 *
 * 主流程的接线缝是 ExerciseSettingsModal.handleLibrarySelect 的原语签名
 * （id/name/type/bodyCategory/muscles/equipment/nameEn，见 ExerciseLibraryModal
 * 旧库的 onSelect 口径）。本文件把购物车条目 PickerSelectionItem 映射为该口径。
 *
 * 类型映射：PickerExerciseType 与 legacy ExerciseType 基本一一对应，唯一例外
 * flexibility（legacy 无此类，协议枚举才有）——回退 bodyweight（自重口径，
 * 拉伸按秒配置在主流程配置面板为已知限制）。
 */

import type { PickerSelectionItem } from './pickerData';

export interface LibrarySelectPayload {
  id: string;
  name: string;
  type: string;
  bodyCategory: string;
  muscles: string[];
  equipment: string;
  nameEn: string;
}

const LEGACY_TYPE_MAP: Record<string, string> = {
  resistance: 'resistance',
  cardio: 'cardio',
  bodyweight: 'bodyweight',
  isometric: 'isometric',
  assisted: 'assisted',
  unilateral: 'unilateral',
  weight_only: 'weight_only',
  reps_only: 'reps_only',
  outdoor: 'outdoor',
  flexibility: 'bodyweight', // legacy 无 flexibility：拉伸回退自重口径
};

/** 购物车条目 → 旧库 onSelect 原语载荷（主流程回填 pendingExercise 用） */
export function pickerItemToLibrarySelect(item: PickerSelectionItem): LibrarySelectPayload {
  const { exercise } = item;
  return {
    id: exercise.id,
    name: exercise.name,
    type: LEGACY_TYPE_MAP[exercise.exerciseType] ?? 'resistance',
    bodyCategory: exercise.muscle,
    muscles: exercise.muscles,
    equipment: exercise.equipmentLabel,
    nameEn: exercise.nameEn,
  };
}
