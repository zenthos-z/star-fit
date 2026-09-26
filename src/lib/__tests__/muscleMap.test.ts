import { describe, it, expect } from 'vitest';
import { EXERCISE_MUSCLES } from 'shared/contracts';
import {
  MUSCLEMAP_SLUGS,
  MUSCLE_TO_MUSCLEMAP,
  muscleLabelZh,
  toMuscleMapSlugs,
  MUSCLE_PRIMARY_COLOR,
  MUSCLE_SECONDARY_COLOR,
} from '../muscleMap';

describe('MUSCLE_TO_MUSCLEMAP（17 词表 → MuscleMap 映射）', () => {
  it('17 基准肌群全覆盖（编译期 Record 约束 + 运行期断言双保险）', () => {
    for (const muscle of EXERCISE_MUSCLES) {
      expect(MUSCLE_TO_MUSCLEMAP[muscle]).toBeDefined();
      expect(MUSCLE_TO_MUSCLEMAP[muscle].length).toBeGreaterThan(0);
    }
  });

  it('映射值全部是 MuscleMap 合法 slug', () => {
    const valid = new Set<string>(MUSCLEMAP_SLUGS);
    for (const slugs of Object.values(MUSCLE_TO_MUSCLEMAP)) {
      for (const slug of slugs) {
        expect(valid.has(slug)).toBe(true);
      }
    }
  });

  it('中文标签与词表一一对应', () => {
    for (const muscle of EXERCISE_MUSCLES) {
      expect(muscleLabelZh(muscle)).not.toBe(muscle); // 全部有中文显示名
    }
    expect(muscleLabelZh('unknown_muscle')).toBe('unknown_muscle'); // 未知值原样
  });
});

describe('toMuscleMapSlugs', () => {
  it('词表值 → slug；跨肌群重叠去重保序', () => {
    // abdominals(abs,obliques) + glutes(gluteal) + abductors(gluteal) → gluteal 只出现一次
    expect(toMuscleMapSlugs(['abdominals', 'glutes', 'abductors'])).toEqual([
      'abs',
      'obliques',
      'gluteal',
    ]);
  });

  it('非词表值原样透传（原生不识别即忽略，不炸）', () => {
    expect(toMuscleMapSlugs(['serratus'])).toEqual(['serratus']);
    expect(toMuscleMapSlugs([])).toEqual([]);
  });
});

describe('配色常量（PR #18 返工定案：纯色、项目 accent 色系派生）', () => {
  it('主发力=项目强调色高饱和 / 次发力同色系低饱和，均为合法十六进制纯色', () => {
    expect(MUSCLE_PRIMARY_COLOR).toMatch(/^#[0-9A-F]{6}$/i);
    expect(MUSCLE_SECONDARY_COLOR).toMatch(/^#[0-9A-F]{6}$/i);
    // 主发力=项目强调色真值（star-accent #3B82F6 = Tailwind blue-500）
    expect(MUSCLE_PRIMARY_COLOR.toUpperCase()).toBe('#3B82F6');
    // 主发力饱和度高于次发力（同色相系）
    const sat = (hex: string) => {
      const r = parseInt(hex.slice(1, 3), 16) / 255;
      const g = parseInt(hex.slice(3, 5), 16) / 255;
      const b = parseInt(hex.slice(5, 7), 16) / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      return max === 0 ? 0 : (max - min) / max;
    };
    expect(sat(MUSCLE_PRIMARY_COLOR)).toBeGreaterThan(sat(MUSCLE_SECONDARY_COLOR));
  });
});
