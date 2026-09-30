/**
 * Data Contracts Re-exports for Frontend
 *
 * This file re-exports the shared data contracts for the frontend.
 * The actual contracts are defined in: shared/contracts/
 */

// Re-export all types and schemas from shared contracts
export type {
  LoadAnchor,
  LoadAnchors,
  BasicInfo,
  Preferences,
  Physiological,
  Psychological,
  UserProfile,
  UIHint,
  ExerciseAction,
  WorkoutSession,
  BiometricMetric,
  AgentInteraction,
  // #88 分册1：cardType 两级体系（单一真源 card-types.ts）
  CardType,
  CardTypeValue,
  CardMajorType,
  ExerciseFineType,
  ExerciseActionType
} from '../../shared/contracts/index';

// Re-export schemas
export {
  LoadAnchorSchema,
  LoadAnchorsSchema,
  BasicInfoSchema,
  PreferencesSchema,
  PhysiologicalSchema,
  PsychologicalSchema,
  UserProfileSchema,
  UIHintSchema,
  ExerciseActionSchema,
  WorkoutSessionSchema,
  BiometricMetricSchema,
  AgentInteractionSchema,
  // #88 分册1：cardType 两级体系（单一真源 card-types.ts）
  CardTypeSchema,
  cardTypeForExerciseType,
  normalizeCardType,
  normalizeExerciseType,
  normalizeExerciseActionType
} from '../../shared/contracts/index';
