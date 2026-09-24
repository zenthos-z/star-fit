/**
 * 动画系统类型定义
 * Starfit Motion System v2
 */

import { Variants, Transition, TargetAndTransition } from 'framer-motion';

// ============================================
// 基础动画类型
// ============================================

/** 动画变体键 */
export type VariantKey = 'initial' | 'animate' | 'exit' | 'hover' | 'tap' | 'focus';

/** 基础变体定义 */
export interface BaseVariants extends Variants {
  initial?: TargetAndTransition;
  animate?: TargetAndTransition;
  exit?: TargetAndTransition;
  hover?: TargetAndTransition;
  tap?: TargetAndTransition;
  focus?: TargetAndTransition;
}

// ============================================
// 过渡配置类型
// ============================================

/** 缓动函数类型 */
export type EasingType =
  | 'linear'
  | 'ease'
  | 'easeIn'
  | 'easeOut'
  | 'easeInOut'
  | 'circIn'
  | 'circOut'
  | 'circInOut'
  | 'backIn'
  | 'backOut'
  | 'backInOut'
  | 'anticipate';

/** 弹簧配置 */
export interface SpringConfig {
  type: 'spring';
  stiffness: number;
  damping: number;
  mass?: number;
  velocity?: number;
}

/** 缓动配置 */
export interface TweenConfig {
  type?: 'tween';
  duration: number;
  ease?: EasingType | number[];
  delay?: number;
}

/** 过渡配置联合类型 */
export type TransitionConfig = SpringConfig | TweenConfig | Transition;

// ============================================
// 组件动画类型
// ============================================

/** 按钮动画属性 */
export interface ButtonAnimation {
  whileHover?: { scale?: number; y?: number };
  whileTap?: { scale?: number };
  transition?: TransitionConfig;
}

/** 卡片动画属性 */
export interface CardAnimation {
  whileHover?: { y?: number; boxShadow?: string; scale?: number };
  whileTap?: { scale?: number };
  transition?: TransitionConfig;
}

/** 模态框动画属性 */
export interface ModalAnimation {
  initial?: { opacity?: number; scale?: number; y?: number };
  animate?: { opacity?: number; scale?: number; y?: number };
  exit?: { opacity?: number; scale?: number; y?: number };
  transition?: TransitionConfig;
}

/** 列表动画属性 */
export interface ListAnimation {
  container?: Variants;
  item?: Variants;
  staggerChildren?: number;
  delayChildren?: number;
}

/** 动画预设接口（向后兼容） */
export interface AnimationPreset {
  initial?: any;
  animate?: any;
  exit?: any;
  transition?: Transition;
  variants?: any;
  whileHover?: any;
  whileTap?: any;
}

/** 预设名称枚举（向后兼容） */
export type PresetName =
  | 'fadeIn'
  | 'fadeScale'
  | 'slideUp'
  | 'modalContent'
  | 'buttonPress'
  | 'cardHover'
  | 'tapScale';

// ============================================
// 页面过渡类型
// ============================================

/** 页面过渡方向 */
export type PageTransitionDirection = 'left' | 'right' | 'up' | 'down' | 'fade' | 'scale';

/** 页面过渡配置 */
export interface PageTransitionConfig {
  direction: PageTransitionDirection;
  duration?: number;
  ease?: EasingType;
}

// ============================================
// 手势类型
// ============================================

/** 拖拽方向 */
export type DragDirection = 'x' | 'y' | 'both';

/** 拖拽约束 */
export interface DragConstraints {
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
}

/** 拖拽弹性 */
export interface DragElastic {
  x?: number | boolean;
  y?: number | boolean;
}

// ============================================
// 性能类型
// ============================================

/** GPU 加速属性 */
export type GPUAcceleratedProperty = 'transform' | 'opacity' | 'filter' | 'clip-path';

/** 动画性能配置 */
export interface AnimationPerformanceConfig {
  /** 是否启用 GPU 加速 */
  gpuAcceleration?: boolean;
  /** will-change 属性列表 */
  willChange?: GPUAcceleratedProperty[];
  /** 是否使用 transform3d */
  useTransform3d?: boolean;
}

// ============================================
// 无障碍类型
// ============================================

/** 减少动画偏好 */
export interface ReducedMotionConfig {
  /** 是否完全禁用动画 */
  disableAnimation?: boolean;
  /** 替代动画时长（毫秒） */
  alternativeDuration?: number;
  /** 保留的动画属性 */
  preservedProperties?: ('opacity' | 'transform')[];
}

/** 焦点管理配置 */
export interface FocusManagementConfig {
  /** 是否自动聚焦 */
  autoFocus?: boolean;
  /** 焦点陷阱 */
  trapFocus?: boolean;
  /** 恢复焦点 */
  restoreFocus?: boolean;
}

// ============================================
// 动画系统配置
// ============================================

/** 完整动画系统配置 */
export interface AnimationSystemConfig {
  /** 默认过渡 */
  defaultTransition: TransitionConfig;
  /** 性能配置 */
  performance: AnimationPerformanceConfig;
  /** 无障碍配置 */
  accessibility: {
    reducedMotion: ReducedMotionConfig;
    focusManagement: FocusManagementConfig;
  };
  /** 组件默认动画 */
  components: {
    button: ButtonAnimation;
    card: CardAnimation;
    modal: ModalAnimation;
    list: ListAnimation;
  };
}

// ============================================
// 工具类型
// ============================================

/** 可动画属性值 */
export type AnimatableValue = string | number;

/** 关键帧 */
export interface Keyframes {
  times?: number[];
  ease?: EasingType | EasingType[];
  values: AnimatableValue[];
}

/** 动画状态 */
export type AnimationState = 'idle' | 'animating' | 'completed' | 'cancelled';

/** 动画事件处理器 */
export interface AnimationEventHandlers {
  onAnimationStart?: () => void;
  onAnimationComplete?: () => void;
  onAnimationCancel?: () => void;
}
