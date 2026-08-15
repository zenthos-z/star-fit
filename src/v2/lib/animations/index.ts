/**
 * Starfit Animation System v2
 * 动效视觉规范实现
 *
 * 架构：
 * - variants: 可复用的动画变体
 * - transitions: 过渡配置
 * - hooks: 动画相关的 React Hooks
 * - utils: 动画工具函数
 */

import { Variants, Transition, useReducedMotion } from 'framer-motion';
import { useMemo } from 'react';
import {
  animation,
  accessibility,
  primitives,
  semantic,
} from '../design-tokens';

// ============================================
// 基础过渡配置
// ============================================

export const transitions = {
  instant: { duration: 0 },
  fast: { duration: 0.15, ease: [0, 0, 0.58, 1] },
  normal: { duration: 0.2, ease: [0, 0, 0.58, 1] },
  slow: { duration: 0.3, ease: [0.4, 0, 0.2, 1] },
  slower: { duration: 0.5, ease: [0.4, 0, 0.2, 1] },
  spring: { type: 'spring' as const, stiffness: 300, damping: 25 },
  springGentle: { type: 'spring' as const, stiffness: 200, damping: 20 },
  springBouncy: { type: 'spring' as const, stiffness: 400, damping: 15 },
  springStiff: { type: 'spring' as const, stiffness: 400, damping: 38, mass: 1 },
} as const;

// ============================================
// 核心动画变体
// ============================================

/**
 * 淡入动画
 * 用途：通用内容入场
 * 性能：仅使用 opacity，GPU 友好
 */
export const fadeIn: Variants = {
  initial: { opacity: 0 },
  animate: {
    opacity: 1,
    transition: transitions.normal,
  },
  exit: {
    opacity: 0,
    transition: transitions.fast,
  },
};

/**
 * 缩放淡入
 * 用途：弹窗、提示、卡片入场
 */
export const fadeScale: Variants = {
  initial: { opacity: 0, scale: 0.95 },
  animate: {
    opacity: 1,
    scale: 1,
    transition: transitions.springGentle,
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    transition: transitions.fast,
  },
};

/**
 * 缩放入场（从更小开始）
 * 用途：重要元素强调入场
 */
export const scaleIn: Variants = {
  initial: { opacity: 0, scale: 0.8 },
  animate: {
    opacity: 1,
    scale: 1,
    transition: transitions.spring,
  },
  exit: {
    opacity: 0,
    scale: 0.8,
    transition: transitions.fast,
  },
};

/**
 * 上滑入场
 * 用途：列表项、底部内容
 */
export const slideUp: Variants = {
  initial: { opacity: 0, y: 20 },
  animate: {
    opacity: 1,
    y: 0,
    transition: transitions.normal,
  },
  exit: {
    opacity: 0,
    y: 20,
    transition: transitions.fast,
  },
};

/**
 * 下滑入场
 * 用途：顶部通知、下拉内容
 */
export const slideDown: Variants = {
  initial: { opacity: 0, y: -20 },
  animate: {
    opacity: 1,
    y: 0,
    transition: transitions.normal,
  },
  exit: {
    opacity: 0,
    y: -20,
    transition: transitions.fast,
  },
};

/**
 * 左滑入场
 * 用途：侧边栏、返回按钮
 */
export const slideLeft: Variants = {
  initial: { opacity: 0, x: 20 },
  animate: {
    opacity: 1,
    x: 0,
    transition: transitions.normal,
  },
  exit: {
    opacity: 0,
    x: 20,
    transition: transitions.fast,
  },
};

/**
 * 右滑入场
 * 用途：前进导航、新页面
 */
export const slideRight: Variants = {
  initial: { opacity: 0, x: -20 },
  animate: {
    opacity: 1,
    x: 0,
    transition: transitions.normal,
  },
  exit: {
    opacity: 0,
    x: -20,
    transition: transitions.fast,
  },
};

// ============================================
// 模态框与覆盖层动画
// ============================================

/**
 * 模态框背景遮罩
 */
export const modalBackdrop: Variants = {
  initial: { opacity: 0 },
  animate: {
    opacity: 1,
    transition: { duration: 0.25 },
  },
  exit: {
    opacity: 0,
    transition: { duration: 0.15 },
  },
};

/**
 * 模态框内容 - 标准弹簧动画
 * 符合全局覆盖层动画规范
 */
export const modalContent: Variants = {
  initial: { opacity: 0, scale: 0.92, y: 20 },
  animate: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      type: 'spring',
      stiffness: 300,
      damping: 25,
      mass: 0.8,
    },
  },
  exit: {
    opacity: 0,
    scale: 0.92,
    y: 20,
    transition: { duration: 0.15, ease: 'easeIn' },
  },
};

/**
 * 模态框内容 - Q弹全局覆盖层版本
 * 用于全屏覆盖层，符合 stiffness: 400, damping: 38 规范
 */
export const modalContentBouncy: Variants = {
  initial: { opacity: 0, scale: 0, borderRadius: '40px' },
  animate: {
    opacity: 1,
    scale: 1,
    borderRadius: '0px',
    transition: {
      type: 'spring',
      stiffness: 400,
      damping: 38,
      mass: 1,
    },
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    transition: transitions.fast,
  },
};

/**
 * 底部 Sheet 滑入
 */
export const sheetContent: Variants = {
  initial: { y: '100%' },
  animate: {
    y: 0,
    transition: transitions.springGentle,
  },
  exit: {
    y: '100%',
    transition: transitions.fast,
  },
};

// ============================================
// 微交互
// ============================================

/**
 * 点击缩放 - 通用
 * 配合 whileTap 使用
 */
export const tapScale = {
  scale: 0.92,
  transition: transitions.fast,
};

/**
 * 按钮按压效果
 * 包含悬停和点击状态
 */
export const buttonPress = {
  whileHover: {
    scale: 1.08,
    transition: { duration: 0.15 },
  },
  whileTap: {
    scale: 0.92,
  },
};

/**
 * 卡片悬停效果
 * 上浮 + 阴影增强
 */
export const cardHover = {
  whileHover: {
    y: -6,
    boxShadow: '0 8px 30px -4px rgba(0, 0, 0, 0.15)',
    transition: transitions.normal,
  },
  whileTap: {
    scale: 0.96,
  },
};

/**
 * 列表项悬停
 */
export const listItemHover = {
  whileHover: {
    backgroundColor: 'rgba(0, 0, 0, 0.02)',
    transition: transitions.fast,
  },
  whileTap: {
    scale: 0.98,
  },
};

// ============================================
// 加载与状态动画
// ============================================

/**
 * 脉冲呼吸效果
 * 用于骨架屏、加载状态
 */
export const pulse: Variants = {
  initial: { opacity: 0.6 },
  animate: {
    opacity: [0.6, 1, 0.6],
    transition: {
      duration: 1.5,
      repeat: Infinity,
      ease: 'easeInOut',
    },
  },
};

/**
 * 闪烁效果（Shimmer）
 * 用于 AI 按钮、智能推荐
 */
export const shimmer: Variants = {
  initial: { x: '-100%' },
  animate: {
    x: '200%',
    transition: {
      duration: 2,
      repeat: Infinity,
      ease: 'linear',
    },
  },
};

/**
 * 弹跳效果
 * 用于通知、提醒
 */
export const bounce: Variants = {
  initial: { y: 0 },
  animate: {
    y: [0, -10, 0],
    transition: {
      duration: 1,
      repeat: Infinity,
      ease: 'easeInOut',
    },
  },
};

/**
 * 旋转加载
 */
export const spin: Variants = {
  animate: {
    rotate: 360,
    transition: {
      duration: 1,
      repeat: Infinity,
      ease: 'linear',
    },
  },
};

// ============================================
// 错开动画（Stagger）
// ============================================

/**
 * 错开容器 - 标准速度
 */
export const staggerContainer: Variants = {
  initial: { opacity: 0 },
  animate: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.15,
    },
  },
  exit: {
    opacity: 0,
    transition: { staggerChildren: 0.05, staggerDirection: -1 },
  },
};

/**
 * 错开容器 - 快速
 */
export const staggerContainerFast: Variants = {
  initial: { opacity: 0 },
  animate: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.1,
    },
  },
  exit: {
    opacity: 0,
    transition: { staggerChildren: 0.03, staggerDirection: -1 },
  },
};

/**
 * 错开容器 - 慢速
 */
export const staggerContainerSlow: Variants = {
  initial: { opacity: 0 },
  animate: {
    opacity: 1,
    transition: {
      staggerChildren: 0.12,
      delayChildren: 0.2,
    },
  },
  exit: {
    opacity: 0,
    transition: { staggerChildren: 0.08, staggerDirection: -1 },
  },
};

/**
 * 错开子项 - 标准
 */
export const staggerItem: Variants = {
  initial: { opacity: 0, y: 20, scale: 0.96 },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: transitions.spring,
  },
  exit: {
    opacity: 0,
    y: 10,
    scale: 0.96,
    transition: transitions.fast,
  },
};

/**
 * 错开子项 - 仅淡入
 */
export const staggerItemFade: Variants = {
  initial: { opacity: 0 },
  animate: {
    opacity: 1,
    transition: transitions.normal,
  },
  exit: {
    opacity: 0,
    transition: transitions.fast,
  },
};

/**
 * 错开子项 - 滑入
 */
export const staggerItemSlide: Variants = {
  initial: { opacity: 0, x: -20 },
  animate: {
    opacity: 1,
    x: 0,
    transition: transitions.springGentle,
  },
  exit: {
    opacity: 0,
    x: 20,
    transition: transitions.fast,
  },
};

// ============================================
// 页面过渡
// ============================================

/**
 * 页面滑入（从右）
 * 用于前进导航
 */
export const pageSlideInRight: Variants = {
  initial: { x: '100%', opacity: 0 },
  animate: {
    x: 0,
    opacity: 1,
    transition: transitions.springGentle,
  },
  exit: {
    x: '-30%',
    opacity: 0,
    transition: transitions.normal,
  },
};

/**
 * 页面滑入（从左）
 * 用于返回导航
 */
export const pageSlideInLeft: Variants = {
  initial: { x: '-100%', opacity: 0 },
  animate: {
    x: 0,
    opacity: 1,
    transition: transitions.springGentle,
  },
  exit: {
    x: '30%',
    opacity: 0,
    transition: transitions.normal,
  },
};

/**
 * 页面淡入淡出
 * 用于标签切换、同级导航
 */
export const pageFade: Variants = {
  initial: { opacity: 0 },
  animate: {
    opacity: 1,
    transition: transitions.normal,
  },
  exit: {
    opacity: 0,
    transition: transitions.fast,
  },
};

// ============================================
// 特殊效果
// ============================================

/**
 * 3D 翻转文字
 * 用于状态切换、文字轮播
 */
export const flipText: Variants = {
  initial: { rotateX: -90, opacity: 0 },
  animate: {
    rotateX: 0,
    opacity: 1,
    transition: { duration: 0.15 },
  },
  exit: {
    rotateX: 90,
    opacity: 0,
    transition: { duration: 0.15 },
  },
};

/**
 * 弹性拉伸效果
 * 用于下拉刷新、过度滚动
 */
export const elasticStretch = {
  type: 'spring',
  stiffness: 200,
  damping: 25,
};

// ============================================
// Hooks
// ============================================

/**
 * 使用无障碍动画
 * 自动检测 prefers-reduced-motion 并返回适配的过渡
 */
export function useAccessibleTransition(
  preferredTransition: Transition = transitions.normal
): Transition {
  const shouldReduceMotion = useReducedMotion();

  return useMemo(() => {
    if (shouldReduceMotion) {
      return { duration: 0 };
    }
    return preferredTransition;
  }, [shouldReduceMotion, preferredTransition]);
}

/**
 * 使用无障碍变体
 * 自动为所有变体添加无障碍支持
 */
export function useAccessibleVariants(variants: Variants): Variants {
  const shouldReduceMotion = useReducedMotion();

  return useMemo(() => {
    if (!shouldReduceMotion) return variants;

    // 为 reduced motion 创建简化版本
    const reducedVariants: Variants = {};

    Object.keys(variants).forEach((key) => {
      const variant = variants[key];
      if (typeof variant === 'object' && variant !== null) {
        // 保留 opacity 变化，移除 transform
        reducedVariants[key] = {
          opacity: variant.opacity,
          transition: { duration: 0 },
        };
      }
    });

    return reducedVariants;
  }, [variants, shouldReduceMotion]);
}

// ============================================
// 工具函数
// ============================================

/**
 * 创建自定义弹簧配置
 */
export function createSpring(
  stiffness: number,
  damping: number,
  mass?: number
): Transition {
  return {
    type: 'spring',
    stiffness,
    damping,
    ...(mass && { mass }),
  };
}

/**
 * 创建错开配置
 */
export function createStagger(
  staggerChildren: number = 0.08,
  delayChildren: number = 0.15
): Transition {
  return {
    staggerChildren,
    delayChildren,
  };
}

/**
 * 合并变体
 * 用于组合多个动画效果
 */
export function mergeVariants(...variants: Variants[]): Variants {
  return variants.reduce((acc, variant) => {
    Object.keys(variant).forEach((key) => {
      if (acc[key] && typeof acc[key] === 'object' && typeof variant[key] === 'object') {
        acc[key] = { ...acc[key], ...variant[key] };
      } else {
        acc[key] = variant[key];
      }
    });
    return acc;
  }, {} as Variants);
}

// ============================================
// 性能优化工具
// ============================================

/**
 * 获取 GPU 加速样式
 * 用于需要流畅动画的元素
 */
export const gpuAcceleratedStyles = {
  willChange: 'transform',
  transform: 'translateZ(0)',
  backfaceVisibility: 'hidden' as const,
};

/**
 * 安全的动画属性列表
 * 这些属性不会触发重排
 */
export const safeAnimationProperties = [
  'transform',
  'opacity',
  'filter',
  'clip-path',
] as const;

/**
 * 避免动画的属性（会导致重排）
 */
export const avoidAnimationProperties = [
  'width',
  'height',
  'top',
  'left',
  'right',
  'bottom',
  'margin',
  'padding',
  'border-width',
] as const;

// ============================================
// 导出完整动画系统
// ============================================

export const animations = {
  // 基础
  fadeIn,
  fadeScale,
  scaleIn,
  slideUp,
  slideDown,
  slideLeft,
  slideRight,

  // 模态框
  modalBackdrop,
  modalContent,
  modalContentBouncy,
  sheetContent,

  // 微交互
  tapScale,
  buttonPress,
  cardHover,
  listItemHover,

  // 加载
  pulse,
  shimmer,
  bounce,
  spin,

  // 错开
  staggerContainer,
  staggerContainerFast,
  staggerContainerSlow,
  staggerItem,
  staggerItemFade,
  staggerItemSlide,

  // 页面
  pageSlideInRight,
  pageSlideInLeft,
  pageFade,

  // 特殊
  flipText,
} as const;

// 默认导出
export default animations;
