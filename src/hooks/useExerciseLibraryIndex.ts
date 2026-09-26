/**
 * useExerciseLibraryIndex — 动作库索引订阅 hook（A6 中文优先展示，issue #19 PR 返工）
 *
 * 订阅前端 ExerciseLibraryService（localStorage 缓存 + 后端同步），
 * 构建 id → 行 / 英文名 → 行 两个索引，供展示名解析（resolveExerciseDisplayName）
 * 查询 name_zh。库未加载时返回空索引（解析器自动回退存储名，不阻塞渲染）。
 */

import { useEffect, useState } from 'react';
import { ExerciseLibraryService } from '@/services/exerciseLibraryService';
import type { Exercise } from '@/storage/schemas';
import {
  EMPTY_LIBRARY_INDEX,
  type ExerciseLibraryIndex,
} from '@/utils/exerciseDisplay';

function buildIndex(exercises: Exercise[]): ExerciseLibraryIndex {
  const byId = new Map<string, Exercise>();
  const byName = new Map<string, Exercise>();
  for (const ex of exercises) {
    if (ex?.id) byId.set(ex.id, ex);
    if (ex?.name) byName.set(ex.name, ex);
  }
  return { byId, byName };
}

export function useExerciseLibraryIndex(): ExerciseLibraryIndex {
  const [index, setIndex] = useState<ExerciseLibraryIndex>(EMPTY_LIBRARY_INDEX);

  useEffect(() => {
    let mounted = true;

    const refresh = async () => {
      try {
        const exercises = await ExerciseLibraryService.getExercises();
        if (mounted) setIndex(buildIndex(exercises));
      } catch (error) {
        console.error(
          '[useExerciseLibraryIndex] Failed to load exercise library:',
          error,
        );
      }
    };

    refresh();
    const unsubscribe = ExerciseLibraryService.subscribe(refresh);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return index;
}
