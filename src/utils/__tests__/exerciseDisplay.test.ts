/**
 * A6 中文优先展示名解析单测（issue #19 PR 返工）——纯函数，无 DB / 无网络。
 *
 * 覆盖：汉字直通、libraryId 命中 name_zh、英文名按名匹配、未命中回退、
 * 空索引/空名安全、库行 name_zh 空白回退英文名。
 */

import { describe, it, expect } from 'vitest';
import {
  EMPTY_LIBRARY_INDEX,
  hasCJK,
  libraryDisplayName,
  resolveExerciseDisplayName,
  type ExerciseLibraryIndex,
} from '../exerciseDisplay';
import type { Exercise } from '@/storage/schemas';

const mkExercise = (over: Partial<Exercise> & { id: string; name: string }): Exercise => ({
  exercise_type: 'resistance',
  targets: { primary: [] },
  difficulty: 'beginner',
  ...over,
});

const LIB: ExerciseLibraryIndex = {
  byId: new Map([
    ['abc123', mkExercise({ id: 'abc123', name: 'Barbell Bench Press', name_zh: '平板杠铃卧推' })],
    ['def456', mkExercise({ id: 'def456', name: 'Squat', name_zh: '   ' })], // 空白 name_zh
  ]),
  byName: new Map([
    ['Romanian Deadlift', mkExercise({ id: 'xyz789', name: 'Romanian Deadlift', name_zh: '罗马尼亚硬拉' })],
    ['Burpee', mkExercise({ id: 'bbb000', name: 'Burpee', name_zh: '波比跳' })],
  ]),
};

describe('hasCJK', () => {
  it('汉字判定：中文名直通场景的开关', () => {
    expect(hasCJK('平板杠铃卧推')).toBe(true);
    expect(hasCJK('Bench Press')).toBe(false);
    expect(hasCJK('')).toBe(false);
    expect(hasCJK(null)).toBe(false);
  });
});

describe('libraryDisplayName', () => {
  it('name_zh 优先；空白/缺失回退英文名', () => {
    expect(libraryDisplayName(LIB.byId.get('abc123'))).toBe('平板杠铃卧推');
    expect(libraryDisplayName(LIB.byId.get('def456'))).toBe('Squat');
    expect(libraryDisplayName(undefined)).toBeNull();
  });
});

describe('resolveExerciseDisplayName', () => {
  it('中文存储名原样直通（不查库）', () => {
    expect(resolveExerciseDisplayName('罗马尼亚硬拉', { library: LIB })).toBe('罗马尼亚硬拉');
  });

  it('英文存储名 + libraryId 命中 → name_zh', () => {
    expect(
      resolveExerciseDisplayName('Barbell Bench Press', {
        library: LIB,
        libraryId: 'abc123',
      }),
    ).toBe('平板杠铃卧推');
  });

  it('英文存储名无 id → 按名匹配 name_zh（历史会话场景）', () => {
    expect(resolveExerciseDisplayName('Romanian Deadlift', { library: LIB })).toBe('罗马尼亚硬拉');
  });

  it('库行 name_zh 为空白 → 回退英文名（不虚构）', () => {
    expect(resolveExerciseDisplayName('Squat', { library: LIB, libraryId: 'def456' })).toBe('Squat');
  });

  it('未命中库/无索引 → 原样返回（自建动作/AI 命名）', () => {
    expect(resolveExerciseDisplayName('My Custom Move', { library: LIB })).toBe('My Custom Move');
    expect(resolveExerciseDisplayName('Bench Press', { library: null })).toBe('Bench Press');
    expect(resolveExerciseDisplayName('Bench Press', {})).toBe('Bench Press');
  });

  it('空索引安全', () => {
    expect(resolveExerciseDisplayName('Anything', { library: EMPTY_LIBRARY_INDEX })).toBe('Anything');
  });

  it('空名返回空串（falsy → 调用方 `|| 占位` 生效）', () => {
    expect(resolveExerciseDisplayName('', { library: LIB })).toBe('');
    expect(resolveExerciseDisplayName(null)).toBe('');
    expect(resolveExerciseDisplayName(undefined)).toBe('');
  });
});
