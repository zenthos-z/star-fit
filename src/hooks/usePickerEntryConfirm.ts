/**
 * usePickerEntryConfirm — A10 入口场景确认（batch/append 直连，issue #32）
 *
 * 训练前批量挑选（batch）与训练中加动作（append）共用：confirm(items) =
 * 购物车条目 → 会话队尾追加（保持清单顺序）+ 自建条目批量创建。
 * 批量循环复用 #48 的 useBatchExerciseCreate（App 层顺序循环现有单条添加
 * API，进度/失败单条重试经 BatchAddBanner 呈现），不新造批量端点。
 * 单条入库失败不阻断会话追加（与 handleSave 的本地优先落账口径一致）。
 */

import { useCallback } from 'react';
import type { Exercise } from '../types/legacy';
import { useBatchExerciseCreate } from './useBatchExerciseCreate';
import {
  pickerItemToBatchPayload,
  pickerItemToSessionExercise,
  type BatchCreatePayload,
} from '../components/picker/pickerAdapter';
import type { PickerSelectionItem } from '../components/picker/pickerData';

export function usePickerEntryConfirm(options: {
  /** 会话队尾追加回调（调用方落 session.exercises，保持 items 顺序） */
  onExercisesAdded: (exercises: Exercise[]) => void;
}) {
  const { onExercisesAdded } = options;
  const batch = useBatchExerciseCreate();
  const { runBatch } = batch;

  /** 购物车确认：先落会话（本地优先），再按来源分流批量入库（进度走横幅）。
   *  来源分流（issue #85）：批量创建仅对自建条目——库内动作在库中已有行，
   *  POST /api/exercises 必撞 exercises_name_key 唯一约束 → 全数计「失败」
   *  弹假失败横幅。库内条目只做会话追加，session Exercise.id 直接锚定库行 id；
   *  全库内批次 payloads 为空 → runBatch 空数组幂等直返，状态保持 idle（不弹横幅）。 */
  const confirm = useCallback(
    (items: PickerSelectionItem[]) => {
      if (items.length === 0) return;
      const payloads: BatchCreatePayload[] = [];
      const exercises = items.map(item => {
        if (item.exercise.source === 'custom') {
          // 自建条目：会话 Exercise 与批量入库载荷共用同一生成 id（对齐 handleSave
          // 的「session Exercise.id = 库 id」约定，历史/锚定反查不落空）
          const payload = pickerItemToBatchPayload(item);
          payloads.push(payload);
          return pickerItemToSessionExercise(item, payload.id);
        }
        return pickerItemToSessionExercise(item, item.exercise.id);
      });
      onExercisesAdded(exercises);
      runBatch(payloads);
    },
    [onExercisesAdded, runBatch],
  );

  return { confirm, ...batch };
}
