import React from 'react';
import { HeartPulse, Mountain } from 'lucide-react';
import { EXERCISE_TYPES_CONFIG } from '../../constants';

/**
 * 获取运动类型的显示标签
 * @param type - exercise type (如 'resistance', 'bodyweight' 等)
 * @returns 中文标签 (如 '常规负重', '自重训练')，未知类型返回 '未知类型'
 */
export const getExerciseTypeLabel = (type: string): string => {
  if (!type) {
    return '未知类型';
  }
  const config = EXERCISE_TYPES_CONFIG[type as keyof typeof EXERCISE_TYPES_CONFIG];
  if (!config) {
    console.warn(`Unknown exercise type: ${type}, returning default label`);
    return '未知类型';
  }
  return config.label;
};

/* ============================================================
 * SF Symbols 风格类型图标（用户拍板 2026-09-09）
 * 造型复刻苹果 SF Symbols（weight/dumbbell 等），Web 侧无法直接用 SF Symbols 字体，
 * 手写 SVG 1.8pt 线条等价复刻；有氧/户外用 lucide 通用符号（心率/山峰）。
 * 所有类型统一蓝色（text-blue-500 = star-accent），2026-09-09 用户拍板。
 * ============================================================ */

const S = 24; // viewBox 尺寸

/** 通用线条属性：1.5pt 描边、圆角端点（SF Symbols 中等 weight 手感） */
const strokeProps = {
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
};

/** SF Symbols 风格图标集，按 exercise type 键控 */
export const EXERCISE_TYPE_ICONS: Record<string, React.FC<{ className?: string }>> = {
  // 常规负重 / 单侧 / 大重量 / 次数训练 → dumbbell (SF: dumbbell)
  resistance: function DumbbellIcon({ className }) {
    return (
      <svg className={className} viewBox={`0 0 ${S} ${S}`} {...strokeProps} aria-hidden="true">
        <path d="M7.5 8.5v7M4.5 9.5v5M16.5 8.5v7M19.5 9.5v5M7.5 12h9M2.5 12h2M19.5 12h2" />
      </svg>
    );
  },
  unilateral: function UnilateralIcon({ className }) {
    return (
      <svg className={className} viewBox={`0 0 ${S} ${S}`} {...strokeProps} aria-hidden="true">
        <path d="M9.5 8.5v7M6.5 9.5v5M14.5 12h5M6.5 12h3M19.5 9.5v5" />
      </svg>
    );
  },
  // 自重训练 → figure.arms.open (SF: figure.arms.open 简化为人形开手)
  bodyweight: function BodyweightIcon({ className }) {
    return (
      <svg className={className} viewBox={`0 0 ${S} ${S}`} {...strokeProps} aria-hidden="true">
        <circle cx="12" cy="4.5" r="1.8" />
        <path d="M12 8.5v6M12 10.5l-3.5-2.5M12 10.5l3.5-2.5M12 14.5l-2.5 5M12 14.5l2.5 5" />
      </svg>
    );
  },
  // 辅助器械 → hands.and.sparkles 简化（辅助把手）
  assisted: function AssistedIcon({ className }) {
    return (
      <svg className={className} viewBox={`0 0 ${S} ${S}`} {...strokeProps} aria-hidden="true">
        <path d="M5 4v16M19 4v16M5 8h4M15 8h4M9 8a3 3 0 0 0 6 0" />
      </svg>
    );
  },
  // 静力/等长 → timer (SF: timer)
  isometric: function TimerIcon({ className }) {
    return (
      <svg className={className} viewBox={`0 0 ${S} ${S}`} {...strokeProps} aria-hidden="true">
        <circle cx="12" cy="13" r="7.5" />
        <path d="M12 13V9.5M9.5 3h5" />
      </svg>
    );
  },
  // 有氧运动 → 心率（HeartPulse，有氧/心率全球通用符号，2026-09-09 用户拍板替换 figure.run）
  cardio: function CardioIcon({ className }) {
    return <HeartPulse className={className} strokeWidth={1.8} aria-hidden="true" />;
  },
  // 柔韧拉伸 → figure.flexibility (SF: figure.flexibility 简化体前屈)
  flexibility: function FlexibilityIcon({ className }) {
    return (
      <svg className={className} viewBox={`0 0 ${S} ${S}`} {...strokeProps} aria-hidden="true">
        <circle cx="16.5" cy="5.5" r="1.8" />
        <path d="M15 8.5c-3 1-5 3-5.5 6.5M9.5 15L5 19M9.5 15l4.5 1.5M15 8.5l-1.5 4" />
      </svg>
    );
  },
  // 户外运动 → 山峰（Mountain，徒步/登山最常见符号，2026-09-09 用户拍板替换 figure.hiking）
  outdoor: function OutdoorIcon({ className }) {
    return <Mountain className={className} strokeWidth={1.8} aria-hidden="true" />;
  }
};

/** 未知类型的兜底图标：问号圆圈 (SF: questionmark.circle) */
const UnknownIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox={`0 0 ${S} ${S}`} {...strokeProps} aria-hidden="true">
    <circle cx="12" cy="12" r="8.5" />
    <path d="M9.8 9.8a2.2 2.2 0 1 1 3.1 2.4c-.7.3-.9.8-.9 1.5M12 16.5h.01" />
  </svg>
);

/**
 * 获取运动类型的 SF Symbols 风格图标组件
 * @param type - exercise type
 * @returns 图标组件（未知类型返回问号圆圈兜底）
 */
export const getExerciseTypeIcon = (type: string): React.FC<{ className?: string }> => {
  return EXERCISE_TYPE_ICONS[type] || UnknownIcon;
};
