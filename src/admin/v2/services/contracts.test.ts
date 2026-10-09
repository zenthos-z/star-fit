/**
 * admin 动作写链契约单测（#171 止血批：P0-1 id 生成 / P0-2 器材枚举 / P1-3 契约透传）
 */
import { describe, it, expect } from 'vitest';
import { nanoid } from 'nanoid';
import {
  zExercise,
  toEquipmentEnum,
  zExercises,
} from './contracts';
import {
  EXERCISE_EQUIPMENT,
  EQUIPMENT_LABELS_ZH,
  EXERCISE_CATEGORIES,
  CATEGORY_LABELS_ZH,
  EXERCISE_BODY_PARTS,
  BODY_PART_LABELS_ZH,
} from 'shared/contracts';

// 后端 exercises_id_check 口径：NanoID，12-24 字符
const NANOID_CHECK = /^[A-Za-z0-9_-]{12,24}$/;

describe('#171 P0-1 新建动作 id（nanoid 前端生成）', () => {
  it('nanoid(21) 满足 exercises_id_check（12-24 字符、词表内字符）', () => {
    for (let i = 0; i < 100; i++) {
      const id = nanoid(21);
      expect(id).toMatch(NANOID_CHECK);
      expect(id.length).toBe(21);
    }
  });

  it('uuid（36 字符）确实不满足 CHECK——回归边界锚定', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    expect(uuid).not.toMatch(NANOID_CHECK);
  });
});

describe('#171 P0-2 器材枚举映射 toEquipmentEnum', () => {
  it('英文枚举值原样通过', () => {
    expect(toEquipmentEnum('barbell')).toBe('barbell');
    expect(toEquipmentEnum('bodyweight')).toBe('bodyweight');
  });

  it('旧视图键 JSON 数组字符串取首个枚举值', () => {
    expect(toEquipmentEnum('["dumbbell"]')).toBe('dumbbell');
  });

  it('中文自由标签（旧 TagInput 产出）→ null，不可写库', () => {
    expect(toEquipmentEnum('["杠铃"]')).toBeNull();
    expect(toEquipmentEnum('杠铃')).toBeNull();
  });

  it('空数组/空串/未知值 → null', () => {
    expect(toEquipmentEnum('[]')).toBeNull();
    expect(toEquipmentEnum('')).toBeNull();
    expect(toEquipmentEnum(null)).toBeNull();
    expect(toEquipmentEnum(undefined)).toBeNull();
    expect(toEquipmentEnum('nonexistent_machine')).toBeNull();
  });

  it('词表 15 值与中文标签一一对应（无缺键）', () => {
    expect(EXERCISE_EQUIPMENT).toHaveLength(15);
    for (const eq of EXERCISE_EQUIPMENT) {
      expect(EQUIPMENT_LABELS_ZH[eq]).toBeTruthy();
    }
  });

  it('类目/身体区域词表与中文标签一一对应', () => {
    for (const cat of EXERCISE_CATEGORIES) expect(CATEGORY_LABELS_ZH[cat]).toBeTruthy();
    for (const bp of EXERCISE_BODY_PARTS) expect(BODY_PART_LABELS_ZH[bp]).toBeTruthy();
  });
});

describe('#171 P1-3 zExercise 002 深化列透传（不再 strip）', () => {
  const fullRow = {
    id: 'V1StGXR8_Z5jdHi6B-myT',
    name: 'Barbell Bench Press',
    name_zh: '杠铃卧推',
    exercise_type: 'resistance',
    difficulty: 'intermediate',
    equipment: 'barbell',
    category: 'strength',
    body_part: 'chest',
    primary_muscles: ['chest', 'triceps'],
    secondary_muscles: ['shoulders'],
    instructions_zh: ['【步骤】', '仰卧于平凳…'],
    image_refs: ['/assets/exercises/bench-press.jpg'],
    video_urls: { male: 'https://cdn.example.com/bench-male.mp4' },
    poster_url: 'https://cdn.example.com/bench-poster.jpg',
    owner_user_id: null,
    created_at: '2026-10-01T08:00:00.000Z',
    updated_at: '2026-10-02T08:00:00.000Z',
    // 视图键
    targets: { primary: ['chest'], secondary: [] },
    equipment_required: '["barbell"]',
    content_html: '<p>…</p>',
    assets_json: '{}',
  };

  it('全部 002 新列经 parse 后保留原值', () => {
    const parsed = zExercise.parse(fullRow);
    expect(parsed.name_zh).toBe('杠铃卧推');
    expect(parsed.equipment).toBe('barbell');
    expect(parsed.category).toBe('strength');
    expect(parsed.body_part).toBe('chest');
    expect(parsed.primary_muscles).toEqual(['chest', 'triceps']);
    expect(parsed.secondary_muscles).toEqual(['shoulders']);
    expect(parsed.instructions_zh).toEqual(['【步骤】', '仰卧于平凳…']);
    expect(parsed.image_refs).toEqual(['/assets/exercises/bench-press.jpg']);
    expect(parsed.video_urls).toEqual({ male: 'https://cdn.example.com/bench-male.mp4' });
    expect(parsed.poster_url).toBe('https://cdn.example.com/bench-poster.jpg');
    expect(parsed.owner_user_id).toBeNull();
    expect(parsed.created_at).toBe('2026-10-01T08:00:00.000Z');
  });

  it('非法器材枚举值不炸解析（catch 兜底 undefined，展示层容错）', () => {
    const parsed = zExercise.parse({ ...fullRow, equipment: '未知器材' });
    expect(parsed.equipment).toBeUndefined();
  });

  it('缺失 002 列的旧行可解析（全可空兜底）', () => {
    const parsed = zExercise.parse({ id: 'abc123', name: 'Old Row' });
    expect(parsed.primary_muscles).toEqual([]);
    expect(parsed.name_zh).toBeUndefined();
    expect(parsed.created_at).toBe('');
  });

  it('zExercises 列表解析保留新列', () => {
    const list = zExercises.parse([fullRow]);
    expect(list[0].equipment).toBe('barbell');
    expect(list[0].name_zh).toBe('杠铃卧推');
  });
});
