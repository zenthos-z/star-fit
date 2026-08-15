/**
 * Starfit Data Contracts - Single Source of Truth
 *
 * This file contains all core data contracts shared between frontend and backend.
 * All type definitions MUST be imported from this file, not defined locally.
 *
 * Core Principles:
 * 1. Single Source of Truth - All data types defined here once
 * 2. Zod Schema Validation - All schemas have runtime validation
 * 3. TypeScript Type Export - Types are inferred from Zod schemas
 * 4. Consistent Structure - last_updated at top level for LoadAnchor
 *
 * @version 2.0.0
 */

import { z } from 'zod';

// Re-export validation utilities
export {
  validateOrThrow,
  validateWithLogging,
  validateBatch,
  parseJSONSafe,
  parseAndValidate,
  ValidationError,
  JSONParseError,
  isValid,
  createValidationError
} from './validation.js';

// ============================================================================
// LoadAnchor Schemas (负荷锚点)
// ============================================================================

/**
 * Heart Rate Anchor Schema
 * Stores heart rate zone thresholds and baseline values
 */
export const HeartRateAnchorSchema = z.object({
  zone_2_threshold: z.number().optional(),
  zone_3_threshold: z.number().optional(),
  resting_hr: z.number().optional(),
  max_hr: z.number().optional(),
});

export type HeartRateAnchor = z.infer<typeof HeartRateAnchorSchema>;

/**
 * Recommendations Schema
 * Training recommendations based on load anchor data
 */
export const RecommendationsSchema = z.object({
  targetRpe: z.number().min(0).max(10).optional(),
  targetDurationSec: z.number().optional(),
  targetDistanceMeters: z.number().optional(),
  targetHeartRateZone: z.string().optional(),
  source: z.enum(['UNKNOWN', 'mas', 'user', 'hybrid']).default('UNKNOWN'),
});

export type Recommendations = z.infer<typeof RecommendationsSchema>;

/**
 * Resistance Anchor Schema
 * Records strength training personal records
 */
export const ResistanceAnchorSchema = z.object({
  best_weight: z.number(),
  best_reps: z.number(),
  est_1rm: z.number(),
});

export type ResistanceAnchor = z.infer<typeof ResistanceAnchorSchema>;

/**
 * Bodyweight Anchor Schema
 * Records calisthenics personal records
 */
export const BodyweightAnchorSchema = z.object({
  best_reps: z.number(),
  progression_level: z.number().min(1).max(10),
});

export type BodyweightAnchor = z.infer<typeof BodyweightAnchorSchema>;

/**
 * Assisted Anchor Schema
 * Records assisted exercise personal records
 */
export const AssistedAnchorSchema = z.object({
  best_weight: z.number(),
  best_reps: z.number(),
});

export type AssistedAnchor = z.infer<typeof AssistedAnchorSchema>;

/**
 * Isometric Anchor Schema
 * Records static hold personal records
 */
export const IsometricAnchorSchema = z.object({
  best_duration: z.number(),
  best_weight: z.number(),
});

export type IsometricAnchor = z.infer<typeof IsometricAnchorSchema>;

/**
 * Cardio Anchor Schema
 * Records cardio personal records
 */
export const CardioAnchorSchema = z.object({
  best_duration: z.number(),
  best_distance: z.number(),
  best_pace: z.number(),
});

export type CardioAnchor = z.infer<typeof CardioAnchorSchema>;

/**
 * Load Anchor Schema (Flat Format v3.0)
 * Core contract for personal records across all exercise types
 *
 * **UNIFIED FLAT FORMAT** - All exercise types use the same flat structure
 * - No nested sub-objects
 * - No legacy format compatibility
 * - Different exercise types only use relevant fields
 * - Validation based on exercise_type checks required fields
 *
 * @version 3.0.0
 * @updated 2026-02-06 - Removed all legacy format compatibility
 */
export const LoadAnchorSchema = z.object({
  // Strength training fields
  best_weight: z.number().optional(),
  best_reps: z.number().optional(),
  est_1rm: z.number().optional(),

  // Bodyweight training fields
  progression_level: z.number().optional(),

  // Isometric hold fields
  best_duration: z.number().optional(),

  // Cardio fields
  best_distance: z.number().optional(),
  best_pace: z.number().optional(),

  // Heart rate fields
  max_hr: z.number().optional(),
  resting_hr: z.number().optional(),
  zone_2_threshold: z.number().optional(),

  // Timestamp (required)
  last_updated: z.number(),
});

export type LoadAnchor = z.infer<typeof LoadAnchorSchema>;

/**
 * Exercise type to required fields mapping
 */
export const EXERCISE_TYPE_FIELDS = {
  resistance: ['best_weight', 'best_reps'] as const,
  unilateral: ['best_weight', 'best_reps'] as const,
  heavy_weight: ['best_weight', 'best_reps'] as const,
  rep_training: ['best_reps'] as const,
  bodyweight: ['best_reps'] as const,
  assisted: ['best_weight', 'best_reps'] as const,
  isometric: ['best_duration'] as const,
  cardio: ['best_pace'] as const,
  outdoor: ['best_pace'] as const,
  flexibility: [] as const,
} as const;

/**
 * Validate anchor for a specific exercise type
 * @param anchor The load anchor to validate
 * @param exerciseType The exercise type to validate against
 * @returns Validation result with errors if any
 */
export function validateAnchorForExerciseType(
  anchor: LoadAnchor,
  exerciseType: string
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  switch (exerciseType) {
    case 'resistance':
    case 'unilateral':
    case 'heavy_weight':
      if (!anchor.best_weight || !anchor.best_reps) {
        errors.push(`${exerciseType} 类型需要 best_weight 和 best_reps`);
      }
      break;
    case 'bodyweight':
      if (!anchor.best_reps) {
        errors.push('bodyweight 类型需要 best_reps');
      }
      break;
    case 'assisted':
      if (!anchor.best_weight || !anchor.best_reps) {
        errors.push('assisted 类型需要 best_weight 和 best_reps');
      }
      break;
    case 'isometric':
      if (!anchor.best_duration) {
        errors.push('isometric 类型需要 best_duration');
      }
      break;
    case 'cardio':
    case 'outdoor':
      if (!anchor.best_pace) {
        errors.push(`${exerciseType} 类型需要 best_pace`);
      }
      break;
    case 'flexibility':
      // Flexibility doesn't require anchors
      break;
    default:
      errors.push(`未知的运动类型: ${exerciseType}`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Load Anchors Collection Schema
 * Maps exercise names to their load anchors
 */
export const LoadAnchorsSchema = z.record(z.string(), LoadAnchorSchema);

export type LoadAnchors = z.infer<typeof LoadAnchorsSchema>;

// ============================================================================
// Three-State Model Utility Functions
// ============================================================================

/**
 * Check if an active limitation has expired
 * @param limitation - The active limitation to check
 * @returns True if the limitation has expired
 */
export function isLimitationExpired(limitation: ActiveLimitation): boolean {
  return new Date(limitation.expire_at) < new Date();
}

/**
 * Filter out expired active limitations
 * @param limitations - Array of active limitations
 * @returns Array of non-expired limitations
 */
export function filterExpiredLimitations(limitations: ActiveLimitation[]): ActiveLimitation[] {
  return limitations.filter(l => !isLimitationExpired(l));
}

/**
 * Calculate expiration time based on severity
 * @param severity - Severity level (1-10)
 * @returns ISO 8601 UTC timestamp
 */
export function calculateExpirationTime(severity: number): string {
  const now = new Date();
  // Severity-based expiration: severity=4 → 3 days, severity=7 → 7 days
  const daysToAdd = Math.ceil(severity * 0.8); // Approximately 1 day per severity level
  now.setDate(now.getDate() + daysToAdd);
  return now.toISOString();
}

/**
 * Create a new active limitation with automatic expiration calculation
 * @param part - Body part
 * @param severity - Severity level (1-10)
 * @param note - Description (optional)
 * @returns New active limitation
 */
export function createActiveLimitation(
  part: string,
  severity: number,
  note?: string
): ActiveLimitation {
  const now = new Date().toISOString();
  return {
    part,
    severity,
    expire_at: calculateExpirationTime(severity),
    logged_at: now,
    auto_heal: true,
  };
}

/**
 * Validate three-state model consistency
 * @param profile - Complete user profile v2
 * @returns Validation result
 */
export function validateThreeStateModel(
  profile: UserProfileV2
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check protocol version
  if (profile.protocol_version !== '2.0.0') {
    errors.push(`Invalid protocol version: ${profile.protocol_version}`);
  }

  // Check for expired active limitations (if profile_dynamic exists)
  if (profile.profile_dynamic?.active_limitations) {
    const expiredCount = profile.profile_dynamic.active_limitations.filter(l =>
      isLimitationExpired(l)
    ).length;
    if (expiredCount > 0) {
      errors.push(`Found ${expiredCount} expired active limitations that should be cleaned up`);
    }
  }

  // Validate timestamps are ISO 8601
  const timestamps = [
    profile.created_at,
    profile.updated_at,
    ...(profile.profile_dynamic?.active_limitations?.flatMap(l => [l.logged_at, l.expire_at]) || []),
  ];

  for (const ts of timestamps) {
    if (isNaN(Date.parse(ts))) {
      errors.push(`Invalid ISO 8601 timestamp: ${ts}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ============================================================================
// UserProfile Schemas
// ============================================================================

/**
 * Basic Info Schema
 * User's physical characteristics
 *
 * Note: Using z.coerce.number() for numeric fields to accept string input from forms
 * (e.g., HTML form inputs always send strings, even with type="number")
 */
export const BasicInfoSchema = z.object({
  age: z.coerce.number().optional(),
  weight: z.coerce.number().optional(), // kg
  height: z.coerce.number().optional(), // cm
  body_fat: z.coerce.number().optional(), // percentage
  training_age: z.coerce.number().optional(), // months
  gender: z.enum(['male', 'female', 'other']).optional(), // 性别
});

export type BasicInfo = z.infer<typeof BasicInfoSchema>;

/**
 * Preferences Schema
 * User's training preferences
 */
export const PreferencesSchema = z.object({
  method: z.array(z.string()).optional(), // ['hypertrophy', 'strength']
  avoided: z.array(z.string()).optional(), // ['injury', 'equipment']
  time_constraint: z.number().optional(), // minutes per session
  equipment: z.array(z.string()).optional(), // available equipment
  goal: z.enum(['muscle_gain', 'fat_loss', 'strength', 'health', 'general_fitness']).optional(), // 训练目标
});

export type Preferences = z.infer<typeof PreferencesSchema>;

/**
 * Physiological Schema
 * User's physiological state
 */
export const PhysiologicalSchema = z.object({
  sleep_hours: z.number().optional(),
  stress_level: z.enum(['low', 'medium', 'high']).optional(),
  cycle_focus: z.enum(['follicular', 'ovulation', 'luteal', 'menstrual']).optional(),
});

export type Physiological = z.infer<typeof PhysiologicalSchema>;

/**
 * Psychological Schema
 * User's psychological profile
 */
export const PsychologicalSchema = z.object({
  neurotype: z.string().optional(),
  accountability: z.enum(['low', 'medium', 'high']).optional(),
  risk_preference: z.enum(['conservative', 'moderate', 'aggressive']).optional(),
});

export type Psychological = z.infer<typeof PsychologicalSchema>;

/**
 * PsychoOS Schema
 * User's neuromuscular operating system profile
 */
export const PsychoOSSchema = z.object({
  neurotype: z.enum(['UNKNOWN', 'type_1', 'type_2a', 'type_2b', 'type_3']).optional(),
  accountability: z.enum(['UNKNOWN', 'low', 'medium', 'high']).optional(),
  riskPreference: z.enum(['UNKNOWN', 'conservative', 'moderate', 'aggressive']).optional(),
});

export type PsychoOS = z.infer<typeof PsychoOSSchema>;

/**
 * HR Baseline Schema
 * Heart rate baseline measurements for recovery tracking
 */
export const HRBaselineSchema = z.object({
  resting_hr: z.number().optional(),
  hrv: z.number().optional(),
  last_measured: z.string().datetime().optional(),
});

export type HRBaseline = z.infer<typeof HRBaselineSchema>;

/**
 * Protocol Status Schema
 * Core protocol status tracking
 */
export const ProtocolStatusSchema = z.object({
  lastCoreCheck: z.string().datetime().optional(),
  hrFuseCount: z.number().optional(),
  weakSideAligned: z.boolean().optional(),
});

export type ProtocolStatus = z.infer<typeof ProtocolStatusSchema>;

/**
 * User Profile Schema
 * Complete user profile with all attributes
 *
 * @deprecated 使用 ProfileStaticSchema 替代。
 */
export const UserProfileSchema = z.object({
  user_id: z.string(),
  tags: z.array(z.string()).default([]),
  fitness_level: z.enum(['beginner', 'intermediate', 'advanced']).default('beginner'),
  basic_info: BasicInfoSchema.optional().default({}),
  preferences: PreferencesSchema.optional().default({}),
  physiological: PhysiologicalSchema.optional().default({}),
  psychological: PsychologicalSchema.optional().default({}),
  load_anchors: LoadAnchorsSchema.optional().default({}),
  red_flags: z.array(z.string()).default([]),
  training_strategy: z.string().optional().nullable(),
  psycho_os: PsychoOSSchema.optional().default({}),
  updated_at: z.number().default(() => Date.now()),
});

export type UserProfile = z.infer<typeof UserProfileSchema>;

// ============================================================================
// Three-State Model Schemas (Core-Flex Architecture)
// ============================================================================

/**
 * Permanent Injury Schema
 * Records permanent physical limitations that don't auto-heal
 */
export const PermanentInjurySchema = z.object({
  part: z.string(), // Body part (e.g., "left_shoulder", "lower_back")
  note: z.string(), // Description of the injury
  diagnosed_at: z.string().datetime().optional(), // ISO 8601 UTC
});

export type PermanentInjury = z.infer<typeof PermanentInjurySchema>;

/**
 * Profile Static Schema
 * Stores long-term biological and psychological characteristics
 * Update frequency: 6 months to 1 year
 *
 * Note: Using z.coerce.number() for numeric fields to accept string input from forms
 */
export const ProfileStaticSchema = z.object({
  // Biological characteristics
  age: z.coerce.number().optional(),
  weight: z.coerce.number().optional(), // kg
  height: z.coerce.number().optional(), // cm
  body_fat_percentage: z.coerce.number().optional(),

  // Neuro-psychological characteristics
  neuro_type: z.enum(['UNKNOWN', 'type_1', 'type_2a', 'type_2b', 'type_3']).optional(),
  risk_preference: z.enum(['UNKNOWN', 'conservative', 'moderate', 'aggressive']).optional(),
  accountability: z.enum(['UNKNOWN', 'low', 'medium', 'high']).optional(),

  // Permanent limitations
  permanent_injuries: z.array(PermanentInjurySchema).optional(),

  // Fitness level classification
  fitness_level: z.enum(['UNKNOWN', 'beginner', 'intermediate', 'advanced']).optional(),

  // User tags and classifications
  tags: z.array(z.string()).optional(),

  // Health red flags (injuries, conditions, etc.)
  red_flags: z.array(z.string()).optional(),

  // Nested schemas for extended profile data
  basic_info: BasicInfoSchema.optional(),
  preferences: PreferencesSchema.optional(),
  physiological: PhysiologicalSchema.optional(),
  psychological: PsychologicalSchema.optional(),

  // Neuromuscular operating system profile
  psycho_os: PsychoOSSchema.optional(),

  // Training strategy (free text format, similar to AI system prompt)
  training_strategy: z.string().optional().nullable(),
});

export type ProfileStatic = z.infer<typeof ProfileStaticSchema>;

/**
 * Active Limitation Schema
 * Self-healing injury windows that auto-expire
 */
export const ActiveLimitationSchema = z.object({
  part: z.string(), // Body part
  severity: z.number().min(1).max(10), // 1-10 severity scale
  expire_at: z.string().datetime(), // ISO 8601 UTC - auto-heal timestamp
  logged_at: z.string().datetime(), // ISO 8601 UTC - when logged
  auto_heal: z.boolean().default(true), // Whether to auto-expire
});

export type ActiveLimitation = z.infer<typeof ActiveLimitationSchema>;

/**
 * Recovery State Schema
 * Monitors fatigue and recovery status
 */
export const RecoveryStateSchema = z.object({
  total_score: z.number().min(0).max(100), // 0-100 recovery score
  cns_fusing: z.boolean().default(false), // CNS fatigue indicator
  last_assessed: z.string().datetime(), // ISO 8601 UTC
  acute_load: z.number().optional(), // Acute training load
  chronic_load: z.number().optional(), // Chronic training load
});

export type RecoveryState = z.infer<typeof RecoveryStateSchema>;

/**
 * Profile Dynamic Schema
 * Stores high-frequency changing states
 * Update frequency: After each training session
 */
export const ProfileDynamicSchema = z.object({
  // Load anchors: Current capability mapping per exercise
  load_anchors: LoadAnchorsSchema.optional(),

  // Short-term limitations: Self-healing injury windows
  active_limitations: z.array(ActiveLimitationSchema).optional(),

  // Recovery state: Fatigue monitoring (nullable for new users)
  recovery_state: RecoveryStateSchema.nullish(),

  // Heart rate baseline for recovery tracking
  hr_baseline: HRBaselineSchema.optional(),

  // Protocol status tracking
  protocol_status: ProtocolStatusSchema.optional(),
});

export type ProfileDynamic = z.infer<typeof ProfileDynamicSchema>;

/**
 * Last Pattern Schema
 * Records the most recent training pattern
 */
export const LastPatternSchema = z.object({
  sequence: z.enum(['UNKNOWN', 'A', 'B', 'C']).default('UNKNOWN'),
  date: z.string().datetime(), // ISO 8601 UTC
  exercises: z.array(z.string()), // Exercise ID list
});

export type LastPattern = z.infer<typeof LastPatternSchema>;

/**
 * Trends Schema
 * Tracks training trends over time
 */
export const TrendsSchema = z.object({
  rpe_trend: z.enum(['UNKNOWN', 'rising', 'stable', 'falling']).default('UNKNOWN'),
  volume_trend: z.enum(['UNKNOWN', 'increasing', 'stable', 'decreasing']).default('UNKNOWN'),
  recent_avg_rpe: z.number().optional(),
  fatigue_level: z.number().optional(),
});

export type Trends = z.infer<typeof TrendsSchema>;

/**
 * Key Metrics Schema
 * Summary of important training metrics
 */
export const KeyMetricsSchema = z.object({
  total_sessions: z.number().default(0),
  personal_records: z.number().default(0),
  injury_count: z.number().default(0),
});

export type KeyMetrics = z.infer<typeof KeyMetricsSchema>;

/**
 * History Summary Schema
 * Compressed historical data to reduce AI token consumption
 * Update frequency: Weekly
 * Compression ratio: ~98.6% (from ~365,000 to ~5,200 tokens/year)
 */
export const HistorySummarySchema = z.object({
  // Last training sequence
  last_pattern: LastPatternSchema.optional(),

  // Trend analysis
  trends: TrendsSchema.optional(),

  // Compressed summary (50-100 words)
  recent_summary: z.string().optional(),

  // Week number for tracking
  week_number: z.number().optional(),

  // Key metrics (optional for backward compatibility)
  key_metrics: KeyMetricsSchema.optional(),
});

export type HistorySummary = z.infer<typeof HistorySummarySchema>;

/**
 * User Profile V2 Schema
 * Complete user profile with three-state model and protocol version 2.0.0
 * This is the new unified profile contract for the Core-Flex architecture
 */
export const UserProfileV2Schema = z.object({
  protocol_version: z.literal('2.0.0').default('2.0.0'),

  // Core layer fields (relational columns)
  user_id: z.string().uuid(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime().default(() => new Date().toISOString()),

  // Flex layer fields (JSONB containers)
  // NOTE: All profile fields are now within these sub-objects
  // - tags, fitness_level, red_flags, training_strategy are in profile_static
  // - load_anchors, active_limitations are in profile_dynamic
  profile_static: ProfileStaticSchema.optional(),
  profile_dynamic: ProfileDynamicSchema.optional(),
  history_summary: HistorySummarySchema.optional(),
});

export type UserProfileV2 = z.infer<typeof UserProfileV2Schema>;

// ============================================================================
// Re-export Legacy Protocol Types
// ============================================================================

// BiometricMetric
export const BiometricMetricSchema = z.object({
  protocol_version: z.literal('2.0.0').default('2.0.0'),
  type: z.enum(['unknown', 'hr', 'hrv', 'spo2', 'vo2max', 'weight', 'bodyfat']).default('unknown'),
  value: z.number(),
  unit: z.string(),
  timestamp: z.string().datetime(),
  features: z.record(z.string(), z.any()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type BiometricMetric = z.infer<typeof BiometricMetricSchema>;

// CardType
export const CardTypeSchema = z.enum([
  'UNKNOWN',
  'resistance_standard',
  'cardio_running',
  'hiit_timer',
  'isometric_static',
  'running_gps'
]).default('UNKNOWN');

export type CardType = z.infer<typeof CardTypeSchema>;

// ExerciseAction
export const ExerciseActionSchema = z.object({
  protocol_version: z.literal('2.0.0').default('2.0.0'),
  id: z.string().uuid(),
  exerciseId: z.string(), // NanoID format (references Exercise.id)
  type: z.enum(['unknown', 'strength', 'cardio', 'hiit', 'stretch']).default('unknown'),
  sets: z.array(z.object({
    index: z.number(),
    reps: z.number().optional(),
    weight: z.number().optional(),
    duration: z.number().optional(),
    distance: z.number().optional(),
    rpe: z.number().min(0).max(10).optional(),
    status: z.enum(['unknown', 'planned', 'completed', 'skipped']).default('unknown'),
    timestamp: z.string().datetime().optional(),
    restEndTime: z.number().optional(),
  })),
  uiHint: z.object({
    cardType: CardTypeSchema.optional(),
    pluginId: z.string().optional(),
  }).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type ExerciseAction = z.infer<typeof ExerciseActionSchema>;

// WorkoutSession
export const WorkoutSessionSchema = z.object({
  protocol_version: z.literal('2.0.0').default('2.0.0'),
  id: z.string().uuid(),
  userId: z.string(),
  status: z.enum(['unknown', 'draft', 'in_progress', 'completed', 'cancelled']).default('unknown'),
  startTime: z.string().datetime(),
  endTime: z.string().datetime().optional(),
  exercises: z.array(ExerciseActionSchema),
  environment: z.enum(['unknown', 'indoor', 'outdoor', 'home', 'gym']).default('unknown'),
  version: z.number().default(1),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type WorkoutSession = z.infer<typeof WorkoutSessionSchema>;

// UIHint
export const UIHintSchema = z.object({
  protocol_version: z.literal('2.0.0').default('2.0.0'),
  type: z.enum([
    'unknown',
    'plan_card',
    'summary_card',
    'survey_card',
    'deviation_card',
    'instruction_card',
    'strategy_confirm',
    'skeleton',
    'audit_complete',
    'survey_success',
  ]).default('unknown'),
  pluginId: z.string().optional(),
  priority: z.number().default(0),
  data: z.record(z.string(), z.any()).optional(),
  actionUri: z.string().optional(),
});

export type UIHint = z.infer<typeof UIHintSchema>;

// AgentInteraction
export const AgentInteractionSchema = z.object({
  protocol_version: z.literal('2.0.0').default('2.0.0'),
  traceId: z.string().uuid(),
  agentId: z.string(),
  timestamp: z.string().datetime(),
  content: z.array(z.object({
    type: z.enum(['unknown', 'text', 'image', 'uri', 'uiHint']).default('unknown'),
    text: z.string().optional(),
    uri: z.string().optional(),
    uiHint: UIHintSchema.optional(),
  })),
  role: z.enum(['unknown', 'assistant', 'user', 'system']).default('unknown'),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type AgentInteraction = z.infer<typeof AgentInteractionSchema>;

// MASRPC Request/Response
export const MASRPCRequestSchema = z.object({
  jsonrpc: z.literal('2.0').default('2.0'),
  method: z.string(),
  params: z.any(),
  id: z.union([z.string(), z.number()]).optional(),
});

export const MASRPCResponseSchema = z.object({
  jsonrpc: z.literal('2.0').default('2.0'),
  result: z.any().optional(),
  error: z.object({
    code: z.number(),
    message: z.string(),
    data: z.any().optional(),
  }).optional(),
  id: z.union([z.string(), z.number()]).nullable(),
});

// MASEvent
export const MASEventSchema = z.object({
  specversion: z.literal('1.0').default('1.0'),
  type: z.string(),
  source: z.string(),
  id: z.string().uuid(),
  time: z.string().datetime(),
  datacontenttype: z.literal('application/json').default('application/json'),
  traceparent: z.string().optional(),
  data: z.any(),
  extensions: z.record(z.string(), z.any()).optional(),
});

// ============================================================================
// Legacy Types (for backward compatibility)
// ============================================================================

/**
 * @deprecated Use LoadAnchor instead
 */
export interface LoadAnchorLegacy {
  '1rm'?: number;
  current?: number;
  last_updated?: number;
}

/**
 * @deprecated Use LoadAnchors instead
 */
export interface LoadAnchorsLegacy {
  [exerciseId: string]: LoadAnchorLegacy;
}

// ============================================================================
// User Friendly ID Schemas (New)
// ============================================================================

/**
 * Username Update Schema
 * Validates username format:
 * - 2-20 characters
 * - Letters, numbers, underscores, and Chinese characters allowed
 * - Can be null to clear the username
 */
export const UsernameUpdateSchema = z.object({
  username: z.string()
    .min(2, '用户名至少2个字符')
    .max(20, '用户名最多20个字符')
    .regex(/^[a-zA-Z0-9_\u4e00-\u9fa5]*$/, '只能包含字母、数字、下划线和中文')
    .nullable(),
});

export type UsernameUpdate = z.infer<typeof UsernameUpdateSchema>;

/**
 * User List Item Schema
 * Represents a user in the admin user list
 */
export const UserListItemSchema = z.object({
  id: z.string().uuid(),
  username: z.string().optional().nullable(),
  short_id: z.string().regex(/^U_[A-Z0-9]{6}$/).optional().nullable(),
  device_id: z.string().nullable(),
  session_count: z.number().default(0),
  created_at: z.coerce.date(),
  display_name: z.string().optional(),
});

export type UserListItem = z.infer<typeof UserListItemSchema>;

/**
 * User Lookup Response Schema
 * Response for finding user by username or short_id
 */
export const UserLookupResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    id: z.string(),
    username: z.string().nullable(),
    short_id: z.string().nullable(),
    created_at: z.coerce.date(),
    session_count: z.number(),
    display_name: z.string(),
  }).optional(),
  error: z.string().optional(),
});

export type UserLookupResponse = z.infer<typeof UserLookupResponseSchema>;

/**
 * Username Update Response Schema
 */
export const UsernameUpdateResponseSchema = z.object({
  success: z.boolean(),
  message: z.string().optional(),
  data: z.object({
    username: z.string().nullable(),
  }).optional(),
  error: z.string().optional(),
});

export type UsernameUpdateResponse = z.infer<typeof UsernameUpdateResponseSchema>;

// ============================================================================
// Exercise Embedding Schemas (New for Vector Search Management)
// ============================================================================

/**
 * Embedding Status Enum
 * Represents the vectorization state of an exercise
 */
export const EmbeddingStatusSchema = z.enum([
  'not_vectorized',
  'partial',
  'outdated',
  'current',
]);

export type EmbeddingStatus = z.infer<typeof EmbeddingStatusSchema>;

/**
 * Exercise Embedding Info Schema
 * Information about an exercise's embedding status
 */
export const ExerciseEmbeddingInfoSchema = z.object({
  exerciseId: z.string(),
  name: z.string(),
  status: EmbeddingStatusSchema,
  embeddingUpdatedAt: z.string().datetime().nullable(),
  contentUpdatedAt: z.string().datetime(),
});

export type ExerciseEmbeddingInfo = z.infer<typeof ExerciseEmbeddingInfoSchema>;

/**
 * Embedding Stats Schema
 * Statistics about exercise embeddings
 */
export const EmbeddingStatsSchema = z.object({
  total: z.number().catch(0),
  notVectorized: z.number().catch(0),
  partial: z.number().catch(0),
  outdated: z.number().catch(0),
  current: z.number().catch(0),
  lastVectorizedAt: z.string().datetime().nullable().catch(null),
});

export type EmbeddingStats = z.infer<typeof EmbeddingStatsSchema>;

/**
 * Batch Vectorize Request Schema
 */
export const BatchVectorizeRequestSchema = z.object({
  exerciseIds: z.array(z.string()),
  forceRegenerate: z.boolean().default(false),
});

export type BatchVectorizeRequest = z.infer<typeof BatchVectorizeRequestSchema>;

/**
 * Batch Vectorize Response Schema
 */
export const BatchVectorizeResponseSchema = z.object({
  success: z.boolean().catch(false),
  total: z.number().catch(0),
  succeeded: z.number().catch(0),
  failed: z.number().catch(0),
  results: z.array(z.object({
    exerciseId: z.string().catch(''),
    success: z.boolean().catch(false),
    error: z.string().optional().catch(undefined),
  })).catch([]),
  durationMs: z.number().catch(0),
});

export type BatchVectorizeResponse = z.infer<typeof BatchVectorizeResponseSchema>;

/**
 * Embedding Config Schema
 * Configuration for embedding model
 */
export const EmbeddingConfigSchema = z.object({
  provider: z.enum(['openai', 'gemini']).catch('openai'),
  model: z.string().catch('text-embedding-3-small'),
  baseURL: z.string().optional().catch(undefined),
  hasApiKey: z.boolean().catch(false),
});

export type EmbeddingConfig = z.infer<typeof EmbeddingConfigSchema>;

// ============================================================================
// Exercise Schemas (New for Exercise Library Management)
// ============================================================================

/**
 * Muscle Target Options - Complete muscle partition list
 */
export type MuscleTarget =
  | '上胸' | '中下胸'
  | '前束' | '中束' | '后束'
  | '二头' | '三头' | '小臂'
  | '背部' | '下背' | '斜方肌'
  | '腹肌' | '侧腹'
  | '股四' | '腘绳' | '小腿'
  | '上臀部' | '下臀部';

/**
 * Exercise Targets Schema
 * Defines primary and secondary target muscles
 */
export const ExerciseTargetsSchema = z.object({
  primary: z.array(z.string()),
  secondary: z.array(z.string()).optional(),
});

export type ExerciseTargets = z.infer<typeof ExerciseTargetsSchema>;

/**
 * Exercise Attributes Schema
 * Contains all exercise attributes stored in the attributes JSONB field
 */
export const ExerciseAttributesSchema = z.object({
  targets: ExerciseTargetsSchema,
  equipment_required: z.array(z.string()),
  impact_level: z.record(z.string(), z.number()).optional(),
  pattern: z.enum(['push', 'pull', 'squat', 'hinge', 'lunge', 'rotation']).optional(),
  movement_plane: z.enum(['sagittal', 'frontal', 'transverse']).optional(),
  stabilizers: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
});

export type ExerciseAttributes = z.infer<typeof ExerciseAttributesSchema>;

/**
 * Exercise Type Enum
 */
export const ExerciseTypeEnum = z.enum([
  'resistance',
  'unilateral',
  'bodyweight',
  'assisted',
  'isometric',
  'cardio',
  'flexibility',
  'heavy_weight',
  'rep_training',
  'outdoor',
]);

export type ExerciseType = z.infer<typeof ExerciseTypeEnum>;

/**
 * Exercise Type Values - Unified constant for exercise types
 * Used across the codebase to ensure consistency
 */
export const EXERCISE_TYPE_VALUES = [
  'resistance',    // 抗阻力训练
  'unilateral',    // 单侧训练
  'bodyweight',    // 自重训练
  'assisted',      // 辅助训练
  'isometric',     // 等长收缩
  'cardio',        // 有氧训练
  'flexibility',   // 柔韧性训练
  'heavy_weight',  // 大重量训练
  'rep_training',  // 次数训练
  'outdoor'        // 户外运动
] as const;

/**
 * Difficulty Level Enum
 */
export const DifficultyLevelEnum = z.enum([
  'beginner',
  'intermediate',
  'advanced',
]);

export type DifficultyLevel = z.infer<typeof DifficultyLevelEnum>;

/**
 * Modified By Enum
 */
export const ModifiedByEnum = z.enum([
  'admin',
  'system',
  'mas',
  'user',
]);

export type ModifiedBy = z.infer<typeof ModifiedByEnum>;

/**
 * Exercise Schema
 * Core contract for exercise library data
 */
export const ExerciseSchema = z.object({
  id: z.string().min(12).max(24), // NanoID format (14 chars by default, 12-24 allowed)
  name: z.string(),
  exercise_type: ExerciseTypeEnum,
  attributes: ExerciseAttributesSchema,
  difficulty: DifficultyLevelEnum,
  content_html: z.string().optional(),
  tutorials: z.record(z.string(), z.any()).optional(),
  tags_json: z.any().optional(),
  assets_json: z.any().optional(),
  modified_by: ModifiedByEnum.optional(),
  modified_at: z.any().optional(),
  created_at: z.any().optional(),
  updated_at: z.any().optional(),
});

export type Exercise = z.infer<typeof ExerciseSchema>;

/**
 * Exercise With Extracted Attributes
 * Same as Exercise but with targets and equipment_required at top level
 * for backward compatibility with frontend code
 */
export type ExerciseWithExtractedAttributes = Exercise & {
  targets: string; // JSON stringified ExerciseTargets
  equipment_required: string; // JSON stringified string[]
};

// ============================================================================
// MAS Context Types
// ============================================================================

/**
 * Plan Generation Context
 * Used to pass calculation rationale between planGenerationNode and responderNode
 */
export interface PlanContext {
  /** Summary of the plan */
  summary: string;
  /** Calculation method used */
  method: string;
  /** Key factors considered */
  keyFactors: string[];
  /** Tools/functions used */
  toolsUsed?: string[];
  /** User level explanation */
  levelExplanation?: string;
  /** Training phase explanation */
  phaseExplanation?: string;
}

// ============================================================================
// Agent Service Contracts (v3 — Deep Agents kernel port seam)
// ============================================================================
// P010 signature-frozen seam: the MAS→Deep Agents kernel replacement absorbs
// 100% of its contract drift inside the AgentService.chat seam. Consumers
// depend only on `chat(req): AsyncIterable<AgentEvent>`; the signature is
// frozen verbatim and must not change shape.
// P001 shared-zod-truth: AgentEvent / UiHintCard / ChatRequest / AgentError /
// AgentErrorCode are exported from this single source of truth so the three
// workspaces (shared / backend / frontend) close TS2307 via workspace paths.
//
// 修订③ (v3 architecture amendment): AgentService keeps ONLY `chat`. The v2
// multi-method surface (separate plan / diagnose entrypoints) and their dedicated
// request types are removed. Distinct goals (plan / diagnose / ...) are reached
// by the LLM activating the matching skill inside the single agent loop
// (system-prompt driven), NOT by separate methods. `scenario` is an assembly-time config field
// on ChatRequest (修订①: decides loaded skill set / systemPrompt / responseFormat),
// NOT a runtime route and NOT a method.

/**
 * AgentScenario — kept on `ChatRequest` for the P010 frozen seam but NO LONGER
 * used by the generic DeepAgent (which mounts all skills + tools on ONE agent
 * and lets the loop pick by intent). Accepted in transit; ignored at assembly.
 * `tutorial` was removed — exercise tutorials are a fixed-workflow WS bypass,
 * not an agent mode.
 */
export const AgentScenarioSchema = z.enum([
  'chat',
  'plan',
  'workout_complete',
  'update_profile',
]);
export type AgentScenario = z.infer<typeof AgentScenarioSchema>;

/**
 * UUID — string-typed identity carried in transit; format validated at the
 * boundary. Kept as a named alias so request shapes read intentionally.
 */
export const UUIDSchema = z.string().uuid();
export type UUID = z.infer<typeof UUIDSchema>;

/**
 * ChatMetadata — opaque per-request metadata bag (trace context, client info,
 * feature flags). Treated as unknown by consumers; forward-compatible.
 */
export const ChatMetadataSchema = z.record(z.string(), z.unknown());
export type ChatMetadata = z.infer<typeof ChatMetadataSchema>;

/**
 * ChatRequest — the single request shape crossing the AgentService.chat seam.
 * `scenario` is an assembly-time config field (修订①③), not a separate method
 * and not a runtime route.
 */
export const ChatRequestSchema = z.object({
  userId: UUIDSchema,
  message: z.string(),
  scenario: AgentScenarioSchema.optional(),
  metadata: ChatMetadataSchema.optional(),
  threadId: z.string().optional(),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

/**
 * UiHintCard — structured card payload carried by 'uiHint' AgentEvents.
 * Forward-compatible v3 card (the HC-1 uiHint skill + validation loop in M5b
 * and the frontend AgentClient in M8FE consume this). Field names deliberately
 * echo the legacy UIHint for migration continuity without coupling to MAS.
 */
export const UiHintCardSchema = z.object({
  type: z.enum([
    'plan',
    'summary',
    'survey',
    'instruction',
    'deviation',
    'unknown',
  ]).default('unknown'),
  title: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  actionUri: z.string().optional(),
  priority: z.number().default(0),
});
export type UiHintCard = z.infer<typeof UiHintCardSchema>;

/**
 * AgentErrorCode — terminal failure categories surfaced across the seam.
 */
export const AgentErrorCodeSchema = z.enum([
  'MODEL_ERROR',
  'VALIDATION_ERROR',
  'UPSTREAM_TIMEOUT',
  'INTERNAL',
]);
export type AgentErrorCode = z.infer<typeof AgentErrorCodeSchema>;

/**
 * AgentError — structured error payload carried by 'error' AgentEvents.
 */
export const AgentErrorSchema = z.object({
  code: AgentErrorCodeSchema,
  message: z.string(),
});
export type AgentError = z.infer<typeof AgentErrorSchema>;

/**
 * AgentEvent — the single streaming element yielded by AgentService.chat.
 * The `type` union literal is frozen verbatim: 'token' | 'uiHint' | 'done' | 'error'.
 */
export const AgentEventSchema = z.object({
  type: z.enum(['token', 'uiHint', 'done', 'error']),
  text: z.string().optional(),
  card: UiHintCardSchema.optional(),
  error: AgentErrorSchema.optional(),
});
export type AgentEvent = z.infer<typeof AgentEventSchema>;

// ============================================================================
// Logging Contracts
// ============================================================================

export {
  // Schemas
  MASLogTagSchema,
  ServiceLogTagSchema,
  AgentLogTagSchema,
  InfrastructureLogTagSchema,

  // Types
  type MASLogTag,
  type ServiceLogTag,
  type AgentLogTag,
  type InfrastructureLogTag,
  type LogTagCategory,

  // Constants
  ALL_MAS_TAGS,
  LOG_TAG_CATEGORY,

  // Functions
  formatLogTag,
  parseLogTag,
} from './logging/index.js';
