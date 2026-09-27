/**
 * MuscleMapSection — 肌群可视化区（A4 → v5 Web 化，issue #20）
 *
 * v5：SVG 数据驱动渲染（MuscleMapSvg，普通 DOM 随滚动自然流动）整体替换
 * 原生 MuscleMapPlugin 桥路径——从机制上消灭坐标漂移（#11 用户模拟器复测）。
 * 原生桥文件（nativeMuscleMap.ts / MuscleMapPlugin.swift）保留不删（回退价值），
 * 但不再被本组件调用。
 * 胶囊图例常驻（图例语义，与定稿参考布局一致）。
 */

import React from 'react';
import {
  MUSCLE_PRIMARY_CHIP_CLASS,
  MUSCLE_SECONDARY_CHIP_CLASS,
  muscleLabelZh,
  toMuscleMapSlugs,
} from '../../lib/muscleMap';
import { MuscleMapSvg } from './MuscleMapSvg';

interface MuscleMapSectionProps {
  /** 主发力肌群（17 基准词表值或原样字符串） */
  primary: string[];
  /** 次发力肌群 */
  secondary: string[];
  /** 兼容参数（原生桥时代的交互锁定语义；Web 版随 DOM 流动，无需处理） */
  interactive?: boolean;
}

export const MuscleMapSection: React.FC<MuscleMapSectionProps> = ({
  primary,
  secondary,
  interactive: _interactive,
}) => {
  void _interactive; // 兼容保留：调用方仍传，Web 版不再需要

  const primarySlugs = toMuscleMapSlugs(primary);
  const secondarySlugs = toMuscleMapSlugs(secondary);

  return (
    <div className="mt-5" role="group" aria-label="发力肌群">
      <div className="text-xs text-gray-400 font-medium mb-2">发力肌群</div>

      {/* SVG 人体图（front/back 双视图，随页面滚动自然流动，零漂移） */}
      <div className="w-full h-48 rounded-2xl bg-gray-50 overflow-hidden flex items-center justify-center">
        <MuscleMapSvg primary={primarySlugs} secondary={secondarySlugs} className="h-full py-1" />
      </div>

      {/* 胶囊图例（常驻） */}
      <div className="flex flex-wrap gap-2 mt-3">
        {primary.map((mg, i) => (
          <span
            key={`p-${i}`}
            className={`px-3 py-1.5 rounded-full text-xs font-medium ${MUSCLE_PRIMARY_CHIP_CLASS}`}
          >
            {muscleLabelZh(mg)}
          </span>
        ))}
        {secondary.map((mg, i) => (
          <span
            key={`s-${i}`}
            className={`px-3 py-1.5 rounded-full text-xs font-medium ${MUSCLE_SECONDARY_CHIP_CLASS}`}
          >
            {muscleLabelZh(mg)}
          </span>
        ))}
      </div>
    </div>
  );
};
