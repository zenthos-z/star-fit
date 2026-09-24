import type { Transition } from 'framer-motion';

/**
 * 锁定屏统一动效规范（2026-09-15 拍板）：
 * 整个锁定屏（胶囊/信息区/按钮/状态切换）只用这一套参数，
 * 消灭此前三种入场节奏（滑入/淡入/上滑混用）与硬切状态的问题。
 *
 * - spring：欠阻尼 ζ≈0.65（stiffness 420 / damping 26 / mass 0.9），
 *   技能拍板的 Apple 手感参数，与 TimerCapsule 分裂菜单同族
 * - 按压反馈：统一 scale 0.97（跟手，松手过冲回弹）
 * - 入场编排：三段共用 fade+up 8px，delay 阶梯 0 / 0.08 / 0.16（视觉从上往下铺开）
 * - 状态切换：交叉溶解 0.2s（旧内容让位，新内容就位，无硬切无跳动）
 * - 进度环：唯一线性时长（计时语义不撒谎）
 */

export const LOCK_MOTION = {
  spring: { type: 'spring', stiffness: 420, damping: 26, mass: 0.9 } as const,
  pressScale: 0.97,
  // 入场：opacity + 轻微上移归位，三段按 stage 依次错峰
  enter: (stage: 0 | 1 | 2) => ({
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -8 },
    transition: { ...({ type: 'spring', stiffness: 420, damping: 26, mass: 0.9 } as Transition), delay: stage * 0.08 }
  }),
  // 状态内容切换（休息↔确认↔计时↔完成）：交叉溶解，同位不位移
  swap: {
    initial: { opacity: 0, scale: 0.98 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.98 },
    transition: { duration: 0.2, ease: 'easeOut' as const }
  }
} as const;
