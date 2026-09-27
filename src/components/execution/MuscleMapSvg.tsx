/**
 * MuscleMapSvg — Web 版肌群可视化人体图（issue #20 A7，v5 定案实现）
 *
 * 数据真源：MuscleMap Swift Package (MIT) 的 SVG path 数据
 * （paths/male-front-paths.ts 等，由 scripts/gen-musclemap-paths.mjs 确定性
 * 提取自 Sources/MuscleMap/Data/*Paths.swift），非自绘素材。
 * front/back 双视图，viewBox 与原包 BodyViewBox 一致（male：front "0 95 727 1280"、
 * back "718 95 727 1280"）。
 *
 * 子群继承沿原包 Muscle.parentGroup 语义：子群 slug 无独立 path 时高亮父群
 * （如 upper-trapezius → trapezius、rear-deltoid → deltoids）。
 * 高亮配色取 lib/muscleMap 常量（主发力=强调色高饱和、次发力=同色低饱和），
 * 未选中肌群=原包默认灰（mmDefaultFill = white 0.78 → #C7C7C7）。
 * 普通 DOM/SVG 随页面滚动自然流动，从机制上消除原生桥坐标漂移（#11）。
 */

import React from 'react';
import {
  MUSCLEMAP_SLUGS,
  MUSCLE_PRIMARY_COLOR,
  MUSCLE_SECONDARY_COLOR,
  MUSCLE_SECONDARY_OPACITY,
  type MuscleMapSlug,
} from '../../lib/muscleMap';
import { MALE_FRONT_PATHS, type MusclePathEntry } from '../musclemap/paths/male-front-paths';
import { MALE_BACK_PATHS } from '../musclemap/paths/male-back-paths';
import { FEMALE_FRONT_PATHS } from '../musclemap/paths/female-front-paths';
import { FEMALE_BACK_PATHS } from '../musclemap/paths/female-back-paths';

// 原包默认填充色（BodyViewStyle.mmDefaultFill = Color(white: 0.78)）
const DEFAULT_FILL = '#C7C7C7';

// 子群 → 父群（沿原包 Muscle.parentGroup；用于 path 继承解析）
const PARENT_GROUP: Partial<Record<MuscleMapSlug, MuscleMapSlug>> = {
  'upper-chest': 'chest',
  'lower-chest': 'chest',
  'inner-quad': 'quadriceps',
  'outer-quad': 'quadriceps',
  'hip-flexors': 'quadriceps',
  'upper-abs': 'abs',
  'lower-abs': 'abs',
  'front-deltoid': 'deltoids',
  'rear-deltoid': 'deltoids',
  'upper-trapezius': 'trapezius',
  'lower-trapezius': 'trapezius',
  serratus: 'obliques',
  ankles: 'feet',
  adductors: 'hamstring',
  neck: 'head',
};

function pathsForSlug(entries: MusclePathEntry[], slug: MuscleMapSlug): string[] {
  const direct = entries.find(e => e.slug === slug);
  if (direct) return [...direct.common, ...direct.left, ...direct.right];
  const parent = PARENT_GROUP[slug];
  if (parent) return pathsForSlug(entries, parent);
  return [];
}

/** 子群 slug → 根群 slug（沿原包 Muscle.parentGroup 链） */
function resolveToRoot(slug: string): string {
  let cur = slug;
  while (PARENT_GROUP[cur as MuscleMapSlug]) cur = PARENT_GROUP[cur as MuscleMapSlug]!;
  return cur;
}

/** 条目（父群）着色判定：自身或其任意子群被高亮即生效（primary 优先于 secondary） */
function fillForSlug(
  entrySlug: string,
  primary: ReadonlySet<string>,
  secondary: ReadonlySet<string>,
): { fill: string; fillOpacity: number } {
  const hits = (set: ReadonlySet<string>): boolean => {
    for (const highlighted of set) {
      if (resolveToRoot(highlighted) === entrySlug) return true;
    }
    return false;
  };
  if (hits(primary)) return { fill: MUSCLE_PRIMARY_COLOR, fillOpacity: 1 };
  if (hits(secondary)) return { fill: MUSCLE_SECONDARY_COLOR, fillOpacity: MUSCLE_SECONDARY_OPACITY };
  return { fill: DEFAULT_FILL, fillOpacity: 1 };
}

interface ViewProps {
  entries: MusclePathEntry[];
  viewBox: string;
  primary: ReadonlySet<MuscleMapSlug>;
  secondary: ReadonlySet<MuscleMapSlug>;
  label: string;
}

function BodyView({ entries, viewBox, primary, secondary, label }: ViewProps) {
  return (
    <svg viewBox={viewBox} className="h-full w-auto" role="img" aria-label={label}>
      {entries.map(({ slug, common, left, right }) => {
        const { fill, fillOpacity } = fillForSlug(slug, primary, secondary);
        const draw = (d: string, key: string) => (
          <path key={key} d={d} data-slug={slug} fill={fill} fillOpacity={fillOpacity} />
        );
        return (
          <React.Fragment key={slug}>
            {common.map((d, i) => draw(d, `c-${i}`))}
            {left.map((d, i) => draw(d, `l-${i}`))}
            {right.map((d, i) => draw(d, `r-${i}`))}
          </React.Fragment>
        );
      })}
    </svg>
  );
}

interface MuscleMapSvgProps {
  /** MuscleMap slug（已由 toMuscleMapSlugs 归一） */
  primary: ReadonlyArray<MuscleMapSlug>;
  secondary: ReadonlyArray<MuscleMapSlug>;
  className?: string;
  /** 体型数据集（默认 male；库含 female 双版本） */
  gender?: 'male' | 'female';
}

/**
 * dev 期完整性自检：36 肌群 slug 均可解析出 path（直接或经父群继承）。
 * 已知例外（包数据如此，非缺失）：rotator-cuff / rhomboids 在 MuscleMap 包内
 * 只有枚举与命名、无独立几何 path，原生渲染同样不绘制。
 */
const KNOWN_NO_PATH: ReadonlySet<string> = new Set(['rotator-cuff', 'rhomboids']);
if (process.env.NODE_ENV !== 'production') {
  const all = [...MALE_FRONT_PATHS, ...MALE_BACK_PATHS];
  const unresolved = MUSCLEMAP_SLUGS.filter(
    slug => !KNOWN_NO_PATH.has(slug) && pathsForSlug(all, slug).length === 0,
  );
  if (unresolved.length) console.error('[MuscleMapSvg] 无 path 的肌群:', unresolved);
}

export const MuscleMapSvg: React.FC<MuscleMapSvgProps> = ({
  primary,
  secondary,
  className,
  gender = 'male',
}) => {
  const p = new Set(primary);
  const s = new Set(secondary);
  const front = gender === 'male' ? MALE_FRONT_PATHS : FEMALE_FRONT_PATHS;
  const back = gender === 'male' ? MALE_BACK_PATHS : FEMALE_BACK_PATHS;
  return (
    <div className={`flex items-stretch justify-center gap-1 ${className ?? ''}`} role="img" aria-label="肌群可视化人体图（前/后视图）">
      <BodyView entries={front} viewBox={gender === 'male' ? '0 95 727 1280' : '0 0 650 1450'} primary={p} secondary={s} label="正面" />
      <BodyView entries={back} viewBox={gender === 'male' ? '718 95 727 1280' : '823 0 650 1450'} primary={p} secondary={s} label="背面" />
    </div>
  );
};

export default MuscleMapSvg;
