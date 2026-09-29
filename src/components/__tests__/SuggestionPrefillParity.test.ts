/**
 * T7 预填参数与「应用建议」同源回归（issue #58）
 *
 * 断言两读点对同一动作产出同一 cacheKey → 同一缓存条目 → 逐字段相等的建议值：
 *   读点①清单预填：SuggestionService.resolveSync(name, suggestionQueryType(type), 7)
 *   读点②配置面板「应用建议」：ExerciseSettingsModal 内部
 *     resolveSync(name, normalizeType(action.type), metadata.targetRpe)
 *     其中 action = toExerciseAction(item)（adapter 真源实现）
 *
 * 根因（修复前）：toExerciseAction 的 metadata.originalType 直传库内 10 类
 * exerciseType，flexibility 不在 normalizeType 的 legacy 9 类词表 → 双兜底落
 * resistance → cacheKey 分叉（bodyweight:名 vs resistance:名）→ 预填 3×12
 * vs 应用建议 4 组+配重。
 *
 * 测试策略：真实 SuggestionService（仅 mock @/storage 为内存 map）+ 真实
 * deriveFromEntry，杜绝 mock 掩盖分叉。全部纯逻辑，不渲染组件。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// @/storage → 内存 map（真实 SuggestionService 的 loadCache/saveCache 读写它）
const memStore = new Map<string, unknown>();
vi.mock('@/storage', () => ({
  storageGet: vi.fn(async (key: string) => memStore.get(key) ?? null),
  storageSet: vi.fn(async (key: string, value: unknown) => { memStore.set(key, value); }),
}));

import { SuggestionService } from '../../services/suggestionService';
import { Keys, type SuggestionCache } from '@/storage/schemas';
import { normalizeSuggestionExerciseType, type SuggestionValues } from 'shared/contracts';
import {
  LEGACY_TYPE_MAP,
  toExerciseAction,
  resolveLegacyActionType,
  suggestionQueryType,
} from '../picker/pickerAdapter';
import { PROTOCOL_TYPE, type PickerExerciseType, type PickerSelectionItem } from '../picker/pickerData';

const storage = () => import('@/storage');

const NAME = '测试动作';

/** 构造清单条目（集合内容不影响 type 口径断言，空组即可） */
function makeItem(exerciseType: PickerExerciseType): PickerSelectionItem {
  return {
    exercise: {
      id: `lib-${exerciseType}`,
      name: NAME,
      nameEn: `Test ${exerciseType}`,
      exerciseType,
      muscle: 'chest',
      muscles: ['chest'],
      primaryMuscles: ['chest'],
      secondaryMuscles: [],
      equipment: 'barbell',
      equipmentLabel: '杠铃',
      difficulty: 'beginner',
    } as PickerSelectionItem['exercise'],
    sets: [],
    targetRpe: 7,
  };
}

/** 构造对账缓存条目（profile 形状对齐后端 GET /suggestions/cache 契约） */
function makeEntry(exerciseType: string) {
  return {
    exercise_name: NAME,
    exercise_type: exerciseType,
    baseline_rpe: 7,
    values: {},
    profile: {
      data_basis: 'type_default',
      modifiers: { injury_scale: 1, novice_cap: 1, recovery_scale: 1 },
    } as { data_basis: string; modifiers: Record<string, number> } & Record<string, unknown>,
    adjustment: {
      exercise_name: NAME,
      actions: [],
      reason: 'test',
    },
    source: 'formula' as const,
    generated_at: Date.now(),
    context_fingerprint: 'fp-t7-test',
  };
}

/** 把条目写入缓存（键 = normalize(type):name，与后端对账缓存同构）并预热秒回镜像 */
async function seedCache(type: string, mutate?: (entry: ReturnType<typeof makeEntry>) => void) {
  await SuggestionService.clearCache();
  const entry = makeEntry(type);
  mutate?.(entry);
  const cache: SuggestionCache = {
    entries: {
      [`${normalizeSuggestionExerciseType(type)}:${NAME}`]: entry,
    },
    meta: {
      version: 2,
      lastSyncTime: Date.now(),
      goal: 'muscle_gain',
      count: 1,
      stale: false,
    },
  };
  await (await storage()).storageSet(Keys.suggestionCache, cache);
  await SuggestionService.warmCache();
}

/** 两读点取值：复刻两处真实调用（与 ExercisePickerModal / ExerciseSettingsModal 逐字对应） */
function readBothPoints(item: PickerSelectionItem) {
  // 读点① 清单预填（ExercisePickerModal 预填 effect 原样）
  const prefillType = suggestionQueryType(item.exercise.exerciseType);
  const prefill = SuggestionService.resolveSync(item.exercise.name, prefillType, 7);
  // 读点② 配置面板「应用建议」（toExerciseAction → modal normalizeType → Smart RPE effect 原样）
  const action = toExerciseAction(item);
  const modalType = resolveLegacyActionType(action.type, action.metadata?.originalType);
  const apply = SuggestionService.resolveSync(item.exercise.name, modalType, action.metadata?.targetRpe ?? 7);
  return { prefill, apply, prefillType, modalType };
}

beforeEach(async () => {
  memStore.clear();
  vi.clearAllMocks();
});

describe('T7 两读点 type 口径收敛（issue #58）', () => {
  it('全部 10 类：预填 type 与配置面板 normalizeType 产出同一 cacheKey', () => {
    const allTypes = Object.keys(LEGACY_TYPE_MAP) as PickerExerciseType[];
    expect(allTypes).toHaveLength(10);
    for (const t of allTypes) {
      const item = makeItem(t);
      const action = toExerciseAction(item);
      const modalType = resolveLegacyActionType(action.type, action.metadata.originalType);
      expect(
        normalizeSuggestionExerciseType(suggestionQueryType(t)),
        `picker 类型 ${t} 两读点 cacheKey 不一致（预填 ${suggestionQueryType(t)} vs 面板 ${modalType}）`,
      ).toBe(normalizeSuggestionExerciseType(modalType));
    }
  });

  it('flexibility 回归：originalType 兜底必中 bodyweight（修复前双兜底落 resistance）', () => {
    const legacy = suggestionQueryType('flexibility');
    expect(legacy).toBe('bodyweight');
    // 修复前：PROTOCOL_TYPE.flexibility = 'flexibility' 直传 originalType → 不在 9 类词表 → 'resistance'
    expect(resolveLegacyActionType(PROTOCOL_TYPE.flexibility, 'flexibility')).toBe('resistance');
    // 修复后：originalType = suggestionQueryType → 兜底命中 bodyweight
    expect(resolveLegacyActionType(PROTOCOL_TYPE.flexibility, legacy)).toBe('bodyweight');
  });

  it('weight_only / reps_only：殊途（协议口径）同归（normalize 后同键）', () => {
    expect(PROTOCOL_TYPE.weight_only).toBe('heavy_weight');
    expect(resolveLegacyActionType(PROTOCOL_TYPE.weight_only, suggestionQueryType('weight_only'))).toBe('weight_only');
    expect(normalizeSuggestionExerciseType('weight_only')).toBe(normalizeSuggestionExerciseType('heavy_weight'));
    expect(normalizeSuggestionExerciseType('reps_only')).toBe(normalizeSuggestionExerciseType('rep_training'));
  });
});

describe('T7 预填 === 应用建议：同条目逐字段相等', () => {
  /** 自重类（3×12 特征，用户实测分叉形态）：缓存只有预填键的条目，
      面板若分叉到 resistance 键会 miss 返回 null → 用例即红 */
  it('flexibility 动作（bodyweight 键）：预填与「应用建议」逐字段相等', async () => {
    await seedCache('bodyweight');
    const { prefill, apply, modalType } = readBothPoints(makeItem('flexibility'));
    expect(modalType).toBe('bodyweight');
    expect(prefill).not.toBeNull();
    expect(apply, '面板读点 miss = cacheKey 分叉未根除').not.toBeNull();
    const v1 = prefill!.values;
    const v2 = apply!.values;
    // 逐字段：次数/组数/配重/RPE/时长/距离
    const fields: Array<keyof SuggestionValues> = ['reps', 'set_count', 'weight', 'target_rpe', 'duration_sec', 'distance_m'];
    for (const f of fields) {
      expect(v2[f], `字段 ${f} 两读点不一致`).toBe(v1[f]);
    }
    // 用户实测特征锁定：RPE7 自重 = 3 组 × 12 次
    expect(v1.reps).toBe(12);
    expect(v1.set_count).toBe(3);
    expect(v2.reps).toBe(12);
    expect(v2.set_count).toBe(3);
  });

  it('resistance 动作：est_1rm 配重推导两读点逐字段相等', async () => {
    await seedCache('resistance', (entry) => {
      entry.profile.est_1rm = 100;
      entry.profile.data_basis = 'history';
    });

    const { prefill, apply } = readBothPoints(makeItem('resistance'));
    expect(prefill).not.toBeNull();
    expect(apply).not.toBeNull();
    expect(apply!.values).toEqual(prefill!.values);
    expect(prefill!.values.weight).toBeGreaterThan(0);
    expect(prefill!.values.set_count).toBe(4); // DEFAULT_SET_COUNT.resistance
  });

  it('模拟修复前分叉（面板走 resistance 键）确认会 miss——防回归哨兵', async () => {
    await seedCache('bodyweight');
    // 复刻修复前行为：normalizeType 双兜底 'resistance' → 键分叉 → miss
    const diverged = SuggestionService.resolveSync(NAME, 'resistance', 7);
    expect(diverged).toBeNull();
  });
});
