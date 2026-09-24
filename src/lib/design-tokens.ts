/**
 * Starfit Design Tokens
 * 设计令牌系统 - 单一事实源
 *
 * 规范原则：
 * 1. 所有视觉数值必须从此文件导出，禁止硬编码
 * 2. 令牌层级: Primitive -> Semantic -> Component
 * 3. 支持 TypeScript 类型推断和自动补全
 */

import { Transition, Variants } from 'framer-motion';

// ============================================
// Layer 1: Primitive Tokens (原始值)
// ============================================

export const primitives = {
  // 颜色基础
  color: {
    // 主色调 - 深蓝科技系
    primary: {
      50: '#EEF4FF',
      100: '#D9E6FF',
      200: '#BCD4FF',
      300: '#8EB8FF',
      400: '#5994FF',
      500: '#3B82F6', // 核心蓝
      600: '#2563EB',
      700: '#1D4ED8',
      800: '#1E40AF',
      900: '#1E3A8A',
      950: '#172554',
    },
    // 强调色 - 活力黄绿
    accent: {
      50: '#FCFEE8',
      100: '#F9FECB',
      200: '#F4FE9C',
      300: '#EBFA60',
      400: '#D9F02A',
      500: '#BCEF08', // 核心黄绿
      600: '#94C600',
      700: '#6F9606',
      800: '#58770B',
      900: '#4A640D',
      950: '#263801',
    },
    // 中性灰阶
    neutral: {
      0: '#FFFFFF',
      50: '#F8FAFC',
      100: '#F1F5F9',
      200: '#E2E8F0',
      300: '#CBD5E1',
      400: '#94A3B8',
      500: '#64748B',
      600: '#475569',
      700: '#334155',
      800: '#1E293B',
      900: '#0F172A',
      950: '#020617',
    },
    // 功能色
    functional: {
      success: '#10B981',
      warning: '#F59E0B',
      error: '#EF4444',
      info: '#3B82F6',
    },
  },

  // 间距基础 (基于 4px 网格)
  space: {
    0: '0',
    0.5: '2px',
    1: '4px',
    1.5: '6px',
    2: '8px',
    2.5: '10px',
    3: '12px',
    3.5: '14px',
    4: '16px',
    5: '20px',
    6: '24px',
    7: '28px',
    8: '32px',
    9: '36px',
    10: '40px',
    11: '44px',
    12: '48px',
    14: '56px',
    16: '64px',
    20: '80px',
    24: '96px',
    28: '112px',
    32: '128px',
  },

  // 圆角基础
  radius: {
    none: '0',
    xs: '4px',
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '24px',
    '2xl': '32px',
    '3xl': '40px',
    full: '9999px',
  },

  // 字体基础
  font: {
    family: {
      sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      mono: '"SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas, "Courier New", monospace',
    },
    size: {
      xs: '12px',
      sm: '14px',
      base: '16px',
      lg: '18px',
      xl: '20px',
      '2xl': '24px',
      '3xl': '30px',
      '4xl': '36px',
      '5xl': '48px',
    },
    weight: {
      normal: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
    },
    lineHeight: {
      tight: 1.25,
      normal: 1.5,
      relaxed: 1.75,
    },
  },

  // 阴影基础
  shadow: {
    none: 'none',
    xs: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
    sm: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1)',
    md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
    lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
    xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
    '2xl': '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
    inner: 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.05)',
    // 特殊发光阴影
    glow: {
      primary: '0 0 20px rgba(59, 130, 246, 0.4)',
      accent: '0 0 20px rgba(188, 239, 8, 0.4)',
      error: '0 0 20px rgba(239, 68, 68, 0.4)',
    },
  },

  // 动画时长基础 (ms)
  duration: {
    instant: 0,
    fast: 150,
    normal: 200,
    slow: 300,
    slower: 500,
    slowest: 800,
  },

  // 缓动函数
  easing: {
    linear: [0, 0, 1, 1] as const,
    ease: [0.25, 0.1, 0.25, 1] as const,
    easeIn: [0.42, 0, 1, 1] as const,
    easeOut: [0, 0, 0.58, 1] as const,
    easeInOut: [0.4, 0, 0.2, 1] as const,
    // 弹簧模拟
    spring: { type: 'spring' as const, stiffness: 300, damping: 25 },
    springGentle: { type: 'spring' as const, stiffness: 200, damping: 20 },
    springBouncy: { type: 'spring' as const, stiffness: 400, damping: 15 },
    springStiff: { type: 'spring' as const, stiffness: 500, damping: 30 },
  },

  // Z-Index 层级
  zIndex: {
    hide: -1,
    base: 0,
    docked: 10,
    dropdown: 1000,
    sticky: 1100,
    banner: 1200,
    overlay: 1300,
    modal: 1400,
    popover: 1500,
    skipLink: 1600,
    toast: 1700,
    tooltip: 1800,
  },
} as const;

// ============================================
// Layer 2: Semantic Tokens (语义化令牌)
// ============================================

export const semantic = {
  // 背景色语义
  background: {
    primary: primitives.color.neutral[0],
    secondary: primitives.color.neutral[50],
    tertiary: primitives.color.neutral[100],
    dark: primitives.color.neutral[900],
    darkElevated: primitives.color.neutral[800],
    overlay: 'rgba(0, 0, 0, 0.5)',
    scrim: 'rgba(0, 0, 0, 0.75)',
  },

  // 文字色语义
  text: {
    primary: primitives.color.neutral[900],
    secondary: primitives.color.neutral[600],
    tertiary: primitives.color.neutral[400],
    inverse: primitives.color.neutral[0],
    accent: primitives.color.accent[500],
    brand: primitives.color.primary[500],
  },

  // 边框语义
  border: {
    light: primitives.color.neutral[200],
    medium: primitives.color.neutral[300],
    strong: primitives.color.neutral[400],
    focus: primitives.color.primary[500],
  },

  // 按钮语义
  button: {
    primary: {
      bg: primitives.color.neutral[900],
      text: primitives.color.neutral[0],
      hover: primitives.color.neutral[800],
      active: primitives.color.neutral[700],
    },
    secondary: {
      bg: primitives.color.neutral[100],
      text: primitives.color.neutral[900],
      hover: primitives.color.neutral[200],
      active: primitives.color.neutral[300],
    },
    accent: {
      bg: primitives.color.accent[500],
      text: primitives.color.neutral[900],
      hover: primitives.color.accent[400],
      active: primitives.color.accent[600],
    },
    ghost: {
      bg: 'transparent',
      text: primitives.color.neutral[600],
      hover: primitives.color.neutral[100],
      active: primitives.color.neutral[200],
    },
  },

  // 卡片语义
  card: {
    bg: primitives.color.neutral[0],
    border: primitives.color.neutral[200],
    shadow: primitives.shadow.md,
    shadowHover: primitives.shadow.lg,
  },

  // 输入框语义
  input: {
    bg: primitives.color.neutral[0],
    border: primitives.color.neutral[300],
    borderFocus: primitives.color.primary[500],
    placeholder: primitives.color.neutral[400],
  },

  // 反馈色语义
  feedback: {
    success: primitives.color.functional.success,
    warning: primitives.color.functional.warning,
    error: primitives.color.functional.error,
    info: primitives.color.functional.info,
  },
} as const;

// ============================================
// Layer 3: Animation Tokens (动画令牌)
// ============================================

export const animation = {
  // 基础过渡
  transition: {
    instant: { duration: 0 },
    fast: { duration: 0.15, ease: primitives.easing.easeOut },
    normal: { duration: 0.2, ease: primitives.easing.easeOut },
    slow: { duration: 0.3, ease: primitives.easing.easeInOut },
    slower: { duration: 0.5, ease: primitives.easing.easeInOut },
    spring: primitives.easing.spring,
    springGentle: primitives.easing.springGentle,
    springBouncy: primitives.easing.springBouncy,
  } as Record<string, Transition>,

  // 微交互缩放值
  scale: {
    tap: 0.92,
    hover: 1.08,
    press: 0.96,
    subtle: 0.98,
  },

  // 位移值
  distance: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 40,
  },

  // 透明度
  opacity: {
    hidden: 0,
    subtle: 0.3,
    muted: 0.5,
    visible: 1,
  },

  // 错开动画
  stagger: {
    fast: 0.03,
    normal: 0.05,
    slow: 0.08,
    slower: 0.12,
  },

  // 性能优化
  performance: {
    // 触发 GPU 加速的属性
    gpuAccelerated: ['transform', 'opacity'] as const,
    // 适合 will-change 的属性
    willChangeCompatible: ['transform', 'opacity'] as const,
    // 避免动画的属性（导致重排）
    avoidAnimating: [
      'width',
      'height',
      'top',
      'left',
      'right',
      'bottom',
      'margin',
      'padding',
    ] as const,
  },
} as const;

// ============================================
// Layer 4: Component Tokens (组件令牌)
// ============================================

export const component = {
  // 按钮
  button: {
    minHeight: '48px',
    minHeightTouch: '64px',
    borderRadius: primitives.radius.lg,
    padding: `${primitives.space[3]} ${primitives.space[5]}`,
    fontSize: primitives.font.size.base,
    fontWeight: primitives.font.weight.medium,
  },

  // 卡片
  card: {
    borderRadius: {
      sm: primitives.radius.lg,
      md: primitives.radius.xl,
      lg: primitives.radius['2xl'],
      xl: primitives.radius['3xl'],
    },
    padding: {
      sm: primitives.space[4],
      md: primitives.space[5],
      lg: primitives.space[6],
    },
  },

  // 模态框
  modal: {
    borderRadius: primitives.radius['3xl'],
    padding: primitives.space[6],
    maxWidth: {
      sm: '360px',
      md: '480px',
      lg: '640px',
    },
  },

  // 输入框
  input: {
    height: '48px',
    borderRadius: primitives.radius.lg,
    padding: `0 ${primitives.space[4]}`,
  },

  // 列表
  list: {
    itemHeight: '56px',
    itemPadding: `${primitives.space[3]} ${primitives.space[4]}`,
    dividerColor: primitives.color.neutral[100],
  },

  // 间距系统
  spacing: {
    section: primitives.space[6],
    element: primitives.space[4],
    tight: primitives.space[2],
  },
} as const;

// ============================================
// 无障碍支持
// ============================================

export const accessibility = {
  // 动画减少偏好设置
  reducedMotion: {
    // 检测媒体查询
    mediaQuery: '(prefers-reduced-motion: reduce)',
    // 替代动画（立即完成或极短）
    alternativeTransition: { duration: 0.01 },
    // 完全禁用动画
    disabledTransition: { duration: 0 },
  },
  // 焦点环
  focusRing: {
    width: '2px',
    offset: '2px',
    color: primitives.color.primary[500],
    style: 'solid',
  },
  // 最小触摸目标
  touchTarget: {
    minSize: '44px',
    recommendedSize: '48px',
  },
} as const;

// ============================================
// 导出类型定义
// ============================================

export type DesignTokens = typeof primitives & typeof semantic & typeof animation & typeof component;
export type PrimitiveTokens = typeof primitives;
export type SemanticTokens = typeof semantic;
export type AnimationTokens = typeof animation;
export type ComponentTokens = typeof component;
