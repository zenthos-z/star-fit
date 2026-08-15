/**
 * Data Contracts Re-exports
 *
 * This file re-exports the shared data contracts for the backend.
 * The actual contracts are defined in: shared/contracts/index.ts
 *
 * @version 2.0.0 - Refactored to re-export from shared/contracts
 * @updated 2026-02-14 - Removed duplicate definitions
 */

// ============================================================================
// Re-export all types and schemas from shared/contracts
// ============================================================================

// LoadAnchor Schemas (负荷锚点)
export {
  HeartRateAnchorSchema,
  type HeartRateAnchor,
  RecommendationsSchema,
  type Recommendations,
  ResistanceAnchorSchema,
  type ResistanceAnchor,
  BodyweightAnchorSchema,
  type BodyweightAnchor,
  AssistedAnchorSchema,
  type AssistedAnchor,
  IsometricAnchorSchema,
  type IsometricAnchor,
  CardioAnchorSchema,
  type CardioAnchor,
  LoadAnchorSchema,
  type LoadAnchor,
  LoadAnchorsSchema,
  type LoadAnchors,
  EXERCISE_TYPE_FIELDS,
} from '../../../shared/contracts/index.js';

// UserProfile Schemas
export {
  BasicInfoSchema,
  type BasicInfo,
  PreferencesSchema,
  type Preferences,
  PhysiologicalSchema,
  type Physiological,
  PsychologicalSchema,
  type Psychological,
  UserProfileSchema,
  type UserProfile,
  PermanentInjurySchema,
  type PermanentInjury,
  ProfileStaticSchema,
  type ProfileStatic,
  ActiveLimitationSchema,
  type ActiveLimitation,
  RecoveryStateSchema,
  type RecoveryState,
  ProfileDynamicSchema,
  type ProfileDynamic,
  LastPatternSchema,
  type LastPattern,
  TrendsSchema,
  type Trends,
  KeyMetricsSchema,
  type KeyMetrics,
  HistorySummarySchema,
  type HistorySummary,
  UserProfileV2Schema,
  type UserProfileV2,
} from '../../../shared/contracts/index.js';

// Legacy Types
export {
  type LoadAnchorLegacy,
  type LoadAnchorsLegacy,
} from '../../../shared/contracts/index.js';

// Utility functions
export {
  validateAnchorForExerciseType,
} from '../../../shared/contracts/index.js';
