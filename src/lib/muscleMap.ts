/**
 * muscleMap — 肌群可视化映射层（A4，issue #12 定案）。
 *
 * 职责：
 * - 17 基准肌群（shared/contracts 受控词表）→ MuscleMap 36 肌群枚举（rawValue
 *   slug）映射表；iOS 原生 MuscleMapPlugin 据此高亮（github.com/melihcolpan/
 *   MuscleMap，MIT）
 * - 肌群胶囊与人体图的高亮配色（项目色板 orange 系，纯色非渐变：
 *   主发力高饱和橙红、次发力同色系低饱和——issue #12 用户拍板）
 *
 * 词表真源 = shared/contracts EXERCISE_MUSCLES；本表仅做可视化近似映射，
 * 不回写库。非骨骼肌区域（无 mapping）返回空数组，仅显示胶囊。
 */

import {
  EXERCISE_MUSCLES,
  MUSCLE_LABELS_ZH,
  type ExerciseMuscle,
} from 'shared/contracts';

/** MuscleMap 枚举 rawValue（36 值；子群默认隐藏，仅用常态可见肌群） */
export const MUSCLEMAP_SLUGS = [
  'abs', 'biceps', 'calves', 'chest', 'deltoids', 'feet', 'forearm',
  'gluteal', 'hamstring', 'hands', 'head', 'knees', 'lower-back',
  'obliques', 'quadriceps', 'tibialis', 'trapezius', 'triceps',
  'upper-back', 'rotator-cuff', 'serratus', 'rhomboids',
  'ankles', 'adductors', 'neck', 'hip-flexors', 'upper-chest',
  'lower-chest', 'inner-quad', 'outer-quad', 'upper-abs', 'lower-abs',
  'front-deltoid', 'rear-deltoid', 'upper-trapezius', 'lower-trapezius',
] as const;

export type MuscleMapSlug = (typeof MUSCLEMAP_SLUGS)[number];

/**
 * 17 基准肌群 → MuscleMap slug（受控映射，一肌可多区）。
 * 近似口径：
 * - lats → upper-back：背阔肌占上背大面积（MuscleMap 无独立背阔肌）
 * - middle_back → rhomboids：中背=菱形肌/上背
 * - abductors → gluteal：髋外展主要由臀中肌承担，位于臀区
 * - abdominals → abs + obliques：腹肌含腹直肌/腹斜肌（契约口径）
 */
export const MUSCLE_TO_MUSCLEMAP: Readonly<Record<ExerciseMuscle, MuscleMapSlug[]>> = {
  abdominals: ['abs', 'obliques'],
  abductors: ['gluteal'],
  adductors: ['adductors'],
  biceps: ['biceps'],
  calves: ['calves'],
  chest: ['chest'],
  forearms: ['forearm'],
  glutes: ['gluteal'],
  hamstrings: ['hamstring'],
  lats: ['upper-back'],
  lower_back: ['lower-back'],
  middle_back: ['rhomboids'],
  neck: ['neck'],
  quadriceps: ['quadriceps'],
  shoulders: ['deltoids'],
  traps: ['trapezius'],
  triceps: ['triceps'],
};

/** 词表肌群 → MuscleMap slug 列表（去重保序；非词表值原样尝试，原生不识别即忽略） */
export function toMuscleMapSlugs(muscles: readonly string[]): MuscleMapSlug[] {
  const out: MuscleMapSlug[] = [];
  for (const m of muscles) {
    const mapped =
      (EXERCISE_MUSCLES as readonly string[]).includes(m)
        ? MUSCLE_TO_MUSCLEMAP[m as ExerciseMuscle]
        : ([m as MuscleMapSlug]);
    for (const slug of mapped ?? []) {
      if (!out.includes(slug)) out.push(slug);
    }
  }
  return out;
}

/** 肌群中文显示名（shared/contracts 单一真源；未知值原样） */
export function muscleLabelZh(muscle: string): string {
  return (MUSCLE_LABELS_ZH as Record<string, string>)[muscle] ?? muscle;
}

// ---------------------------------------------------------------------------
// 配色（issue #12 定案：纯色填充、按刺激贡献度分级；色值取项目色板 orange 系）
// ---------------------------------------------------------------------------

/** 主发力：高饱和橙红（Tailwind orange-600 #EA580C） */
export const MUSCLE_PRIMARY_COLOR = '#EA580C';
/** 次发力：同色系低饱和（Tailwind orange-400 #FB923C） */
export const MUSCLE_SECONDARY_COLOR = '#FB923C';
/** 次发力在人体图上的叠加透明度（贡献度低于主发力，视觉让位） */
export const MUSCLE_SECONDARY_OPACITY = 0.55;

/** 胶囊样式（纯色底；主=橙红底白字，次=同色系低饱和底白字） */
export const MUSCLE_PRIMARY_CHIP_CLASS =
  'bg-orange-600 text-white';
export const MUSCLE_SECONDARY_CHIP_CLASS =
  'bg-orange-400 text-white';
