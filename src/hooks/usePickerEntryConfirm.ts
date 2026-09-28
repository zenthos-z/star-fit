/**
 * usePickerEntryConfirm — A10 入口场景确认（batch/append 直连，issue #32）
 *
 * 训练前批量挑选（batch）与训练中加动作（append）共用：confirm(items) =
 * 购物车条目 → 会话队尾追加（保持清单顺序）+ 库内批量创建。
 * 批量循环复用 #48 的 useBatchExerciseCreate（App 层顺序循环现有单条添加
 * API，进度/失败单条重试经 BatchAddBanner 呈现），不新造批量端点。
 * 单条入库失败不阻断会话追加（与 handleSave 的本地优先落账口径一致）。
 */

import { useCallback } from 'react';
import type { Exercise } from '../types/legacy';
import { useBatchExerciseCreate } from './useBatchExerciseCreate';
import { pickerItemToBatchPayload, pickerItemToSessionExercise } from '../components/picker/pickerAdapter';
import type { PickerSelectionItem } from '../components/picker/pickerData';

export function usePickerEntryConfirm(options: {
  /** 会话队尾追加回调（调用方落 session.exercises，保持 items 顺序） */
  onExercisesAdded: (exercises: Exercise[]) => void;
}) {
  const { onExercisesAdded } = options;
  const batch = useBatchExerciseCreate();
  const { runBatch } = batch;

  /** 购物车确认：先落会话（本地优先），再批量入库（进度走横幅） */
  const confirm = useCallback(
    (items: PickerSelectionItem[]) => {
      if (items.length === 0) return;
      // 先生成库 id：会话 Exercise 与批量入库载荷共用同一 id（对齐 handleSave
      // 的「session Exercise.id = 库 id」约定，历史/锚定反查不落空）
      const payloads = items.map(pickerItemToBatchPayload);
      const exercises = items.map((item, i) => pickerItemToSessionExercise(item, payloads[i].id));
      onExercisesAdded(exercises);
      runBatch(payloads);
    },
    [onExercisesAdded, runBatch],
  );

  return { confirm, ...batch };
}
