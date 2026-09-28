/**
 * useBatchExerciseCreate — 购物车批量添加（App 层循环，issue #31）
 *
 * 既定方案：不造新批量端点，App 层顺序循环调现有单条添加 API
 * （POST /api/exercises，经 ExerciseService.createExercise）。
 *
 * 状态机：
 *   idle ──runBatch──▶ running ──全成──▶ done（横幅自动收起）
 *                        │ 全失败/部分失败
 *                        ▼
 *                     partial ──retryFailed──▶ running（仅重试失败单条）
 *
 * 失败语义：单条失败不中断后续（progress 照走），失败项留在 failed 里
 * 供单条重试；重试沿用原载荷（原 id 不变，避免半成功副本堆积）。
 */

import { useCallback, useRef, useState } from 'react';
import { ExerciseService } from '../services/api/ExerciseServiceV2';
import type { BatchCreatePayload } from '../components/picker/pickerAdapter';

export type BatchCreateStatus = 'idle' | 'running' | 'partial' | 'done';

export interface BatchCreateState {
  status: BatchCreateStatus;
  /** 本轮总数（重试时 = 失败数） */
  total: number;
  /** 已成功条数（跨轮累计） */
  succeeded: number;
  /** 待处理失败单条（重试寻址用） */
  failed: BatchCreatePayload[];
}

const INITIAL_STATE: BatchCreateState = {
  status: 'idle',
  total: 0,
  succeeded: 0,
  failed: [],
};

export function useBatchExerciseCreate() {
  const [state, setState] = useState<BatchCreateState>(INITIAL_STATE);
  /** 防重入：批量进行中再次 confirm 直接忽略（UI 上横幅已给出反馈） */
  const runningRef = useRef(false);

  /** 顺序执行一批（循环单条添加 API）；每条落账一次进度 */
  const runOnce = useCallback(async (items: BatchCreatePayload[], succeededBefore: number) => {
    runningRef.current = true;
    setState({ status: 'running', total: items.length, succeeded: succeededBefore, failed: [] });
    const failed: BatchCreatePayload[] = [];
    let succeeded = succeededBefore;
    for (const payload of items) {
      try {
        await ExerciseService.createExercise(payload);
        succeeded += 1;
      } catch {
        // 单条失败不中断：留待横幅单条重试（红线：不静默吞错——横幅呈现失败态）
        failed.push(payload);
      }
      setState({ status: 'running', total: items.length, succeeded, failed: [...failed] });
    }
    runningRef.current = false;
    setState({ status: failed.length > 0 ? 'partial' : 'done', total: items.length, succeeded, failed });
  }, []);

  /** 批量添加入口（购物车 confirm 时 items[1..]；首项走表单流单独保存） */
  const runBatch = useCallback(
    (items: BatchCreatePayload[]) => {
      if (runningRef.current || items.length === 0) return;
      void runOnce(items, 0);
    },
    [runOnce],
  );

  /** 失败单条重试（仅重跑 failed，成功项不重复创建） */
  const retryFailed = useCallback(() => {
    setState(prev => {
      if (runningRef.current || prev.failed.length === 0) return prev;
      void runOnce(prev.failed, prev.succeeded);
      return prev;
    });
  }, [runOnce]);

  /** 横幅收起（完成后手动关闭/自动定时收起共用） */
  const dismiss = useCallback(() => setState(INITIAL_STATE), []);

  return { state, runBatch, retryFailed, dismiss };
}
