/**
 * @deprecated 请使用 @/v2/lib/animations/index.ts
 * 此文件保留用于向后兼容，将在 v2.1 后移除
 */

import { Transition, Variants } from 'framer-motion';

// ============= Transitions =============
export const transitions = {
  fast: { duration: 0.15, ease: 'easeOut' as const },
  normal: { duration: 0.2, ease: 'easeOut' as const },
  slow: { duration: 0.3, ease: 'easeInOut' as const },
  spring: { type: 'spring' as const, stiffness: 300, damping: 25 },
  gentleSpring: { type: 'spring' as const, stiffness: 200, damping: 20 },
} as const;

// ============= Basic Animations =============
export const fadeIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0, transition: transitions.fast },
};

export const fadeScale = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.95, transition: transitions.fast },
};

export const scaleIn = {
  initial: { opacity: 0, scale: 0.8 },
  animate: { opacity: 1, scale: 1, transition: transitions.spring },
  exit: { opacity: 0, scale: 0.8, transition: transitions.fast },
};

// ============= Slide Animations =============
export const slideUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0, transition: transitions.normal },
  exit: { opacity: 0, y: 20, transition: transitions.fast },
};

export const slideDown = {
  initial: { opacity: 0, y: -20 },
  animate: { opacity: 1, y: 0, transition: transitions.normal },
  exit: { opacity: 0, y: -20, transition: transitions.fast },
};

// ============= Modal Animations =============
export const modalBackdrop = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.25 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

export const modalContent = {
  initial: { opacity: 0, scale: 0.92, y: 20 },
  animate: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      type: 'spring' as const,
      stiffness: 300,
      damping: 25,
      mass: 0.8
    }
  },
  exit: {
    opacity: 0,
    scale: 0.92,
    y: 20,
    transition: { duration: 0.15, ease: 'easeIn' as const }
  },
};

export const sheetContent = {
  initial: { y: '100%' },
  animate: { y: 0, transition: transitions.gentleSpring },
  exit: { y: '100%', transition: transitions.fast },
};

// ============= Micro-Interactions =============
export const tapScale = {
  whileTap: { scale: 0.92 },
  transition: transitions.fast,
};

export const buttonPress = {
  whileHover: { scale: 1.08, transition: { duration: 0.15 } },
  whileTap: { scale: 0.92 },
  transition: transitions.fast,
};

export const cardHover = {
  whileHover: { y: -6, boxShadow: "0 8px 20px -4px rgba(0, 0, 0, 0.12)", transition: transitions.normal },
  whileTap: { scale: 0.96 },
};

// ============= Loading States =============
export const pulse: Variants = {
  initial: { opacity: 0.6 },
  animate: {
    opacity: [0.6, 1, 0.6],
    transition: { duration: 1.5, repeat: Infinity }
  },
};

// ============= Stagger =============
export const staggerContainer = {
  variants: {
    initial: { opacity: 0 },
    animate: {
      opacity: 1,
      transition: {
        staggerChildren: 0.08,
        delayChildren: 0.15,
      },
    },
  },
};

export const staggerItem = {
  initial: { opacity: 0, y: 20, scale: 0.96 },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      type: 'spring' as const,
      stiffness: 300,
      damping: 24
    }
  },
};

export const staggerContainerFast = {
  variants: {
    initial: { opacity: 0 },
    animate: {
      opacity: 1,
      transition: {
        staggerChildren: 0.05,
        delayChildren: 0.1,
      },
    },
  },
};
