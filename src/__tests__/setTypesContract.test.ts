/**
 * A31 picker 契约批单测（issue #31）
 *
 * 1. set_type 契约：枚举全集（盘点自 picker 实际用法）、snake_case 口径、
 *    旧数据缺省兼容（无 set_type 的旧组 Zod 解析读出 working）；
 * 2. 前端同步：pickerData ROLE_* 与契约 SET_TYPE_VALUES 同源一致；
 * 3. 近期分区去重：契约纯函数 dedupeRecentRegions / rankWithRecent
 *    （后端为执行真源，前端仅共用语义做离线兜底）；
 * 4. 批量创建载荷映射：pickerItemToBatchPayload（id 合约、肌群/器械 slug、类型映射）。
 */

import { describe, expect, it } from 'vitest';
import {
  SET_TYPE_VALUES,
  DEFAULT_SET_TYPE,
  SetTypeSchema,
  WeeklyPlanSetSchema,
  SmartSortResponseSchema,
  dedupeRecentRegions,
  rankWithRecent,
  type SmartSortResponse,
} from 'shared/contracts';
import { ROLE_LABELS, ROLE_ORDER, ROLE_BADGE_CLASS, MOCK_EXERCISES } from '../components/picker/pickerData';
import { pickerItemToBatchPayload, createLibraryId } from '../components/picker/pickerAdapter';
import type { PickerSelectionItem } from '../components/picker/pickerData';

describe('set_type 契约扩展（data-contract-check）', () => {
  it('枚举全集 = 盘点自 picker 实际用法的 5 值（snake_case 红线）', () => {
    expect(SET_TYPE_VALUES).toEqual(['warmup', 'working', 'ramp_up', 'ramp_down', 'amrap']);
    expect(DEFAULT_SET_TYPE).toBe('working');
  });

  it('旧数据缺省兼容：无 set_type 的旧组解析读出 working', () => {
    const parsed = WeeklyPlanSetSchema.parse({ set: 1, weight: 60, reps: 8 });
    expect(parsed.set_type).toBe('working');
  });

  it('旧数据显式值保留：drop 组（递减）读回 ramp_down', () => {
    const parsed = SetTypeSchema.parse('ramp_down');
    expect(parsed).toBe('ramp_down');
    expect(() => SetTypeSchema.parse('rampUp')).toThrow(); // 前端旧 camelCase 值不入契约
  });

  it('前端 ROLE_* 与契约同源一致（前后端类型同步）', () => {
    expect(ROLE_ORDER).toEqual([...SET_TYPE_VALUES]);
    for (const v of SET_TYPE_VALUES) {
      expect(ROLE_LABELS[v]).toBeTruthy();
      expect(ROLE_BADGE_CLASS[v]).toBeTruthy();
    }
  });
});

describe('近期分区去重（契约纯函数，后端真源共用语义）', () => {
  const entry = (exerciseId: string, region: 'upper' | 'lower' | 'core' | 'cardio') => ({ exerciseId, region });

  it('同分区多次出现只计最新（去重规则）', () => {
    const deduped = dedupeRecentRegions([
      entry('e-chest-new', 'upper'), // 最新胸部（输入按新→旧）
      entry('e-leg', 'lower'),
      entry('e-chest-old', 'upper'), // 更早的胸部被丢弃
    ]);
    expect(deduped.regions).toEqual(['upper', 'lower']);
    expect(deduped.exerciseIds).toEqual(['e-chest-new', 'e-leg']);
  });

  it('limit 截断 + 同动作跨分区不重复计', () => {
    const deduped = dedupeRecentRegions(
      [entry('e1', 'upper'), entry('e1', 'lower'), entry('e2', 'core'), entry('e3', 'cardio')],
      2,
    );
    expect(deduped.exerciseIds).toEqual(['e1', 'e2']);
    expect(deduped.regions).toEqual(['upper', 'core']);
  });

  it('排序合成：近期置顶在前（新→旧），其余保持库序；库外 id 忽略', () => {
    const ranked = rankWithRecent(['a', 'b', 'c', 'd'], ['c', 'gone', 'a']);
    expect(ranked).toEqual(['c', 'a', 'b', 'd']);
  });

  it('SmartSortResponse 形态锁定（排序契约出库校验）', () => {
    const res: SmartSortResponse = {
      sort_version: 1,
      ranked_ids: ['a', 'b'],
      recent_exercise_ids: ['a'],
      recent_regions: ['upper'],
    };
    expect(SmartSortResponseSchema.parse(res)).toMatchObject(res);
    // recent_exercise_ids 超 limit 拒绝
    expect(
      SmartSortResponseSchema.safeParse({ ...res, recent_exercise_ids: ['a', 'b', 'c', 'd'] }).success,
    ).toBe(false);
  });
});

describe('pickerItemToBatchPayload（购物车批量添加载荷）', () => {
  const exercise = MOCK_EXERCISES[0];
  const item: PickerSelectionItem = { exercise, sets: [], targetRpe: 7 };

  it('id 合约：12-24 字符（exercises.id CHECK），每次生成新 id', () => {
    const p1 = pickerItemToBatchPayload(item);
    const p2 = pickerItemToBatchPayload(item);
    expect(p1.id.length).toBeGreaterThanOrEqual(12);
    expect(p1.id.length).toBeLessThanOrEqual(24);
    expect(p1.id).not.toBe(p2.id);
    expect(createLibraryId().length).toBe(20);
  });

  it('字段口径：英文规范名 + 17 肌群 slug + 器械 slug + 难度缺省 beginner', () => {
    const p = pickerItemToBatchPayload(item);
    expect(p.name).toBe(exercise.nameEn);
    expect(JSON.parse(p.targets)).toEqual({
      primary: exercise.primaryMuscles,
      secondary: exercise.secondaryMuscles,
    });
    expect(JSON.parse(p.equipment_required)).toEqual([exercise.equipment]);
    expect(['beginner', 'intermediate', 'advanced']).toContain(p.difficulty);
    expect(p.modified_by).toBe('system');
  });
});
