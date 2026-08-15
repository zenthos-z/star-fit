import { z } from 'zod';

/**
 * Starfit Data Protocol V2 - Core Pillars
 * Based on DATA_PROTOCOL_STANDARD.md
 * 
 * Compliance Checklist:
 * - Lenient Reading: Zod schemas are non-strict by default.
 * - Time Format: ISO 8601 (UTC) via .datetime().
 * - Enum Safety: 'UNKNOWN' as fallback.
 */

// 1. BiometricMetric - Physiological data
export const BiometricMetricSchema = z.object({
  protocol_version: z.literal('2.0.0').default('2.0.0'),
  type: z.enum(['UNKNOWN', 'HR', 'HRV', 'SpO2', 'VO2MAX', 'WEIGHT', 'BODYFAT']).default('UNKNOWN'),
  value: z.number(),
  unit: z.string(),
  timestamp: z.string().datetime(), // ISO 8601 UTC
  features: z.record(z.string(), z.any()).optional(), // Extracted features from Web Worker
  metadata: z.record(z.string(), z.any()).optional(), // Metadata Slot (extensions)
});

export type BiometricMetric = z.infer<typeof BiometricMetricSchema>;

export const CardTypeSchema = z.enum([
  'UNKNOWN',
  'resistance_standard',
  'cardio_running',
  'hiit_timer',
  'isometric_static',
  'running_gps'
]).default('UNKNOWN');

export type CardType = z.infer<typeof CardTypeSchema>;

// 2. ExerciseAction - Single exercise set or action
// Addressing: fit://library/exercise/{eid}
export const ExerciseActionSchema = z.object({
  protocol_version: z.literal('2.0.0').default('2.0.0'),
  id: z.string().uuid(),
  exerciseId: z.string(), // fit://library/exercise/{eid}
  // Unified lowercase type system matching backend exercise_type (9 types)
  type: z.enum([
    'UNKNOWN',
    'resistance',
    'cardio',
    'bodyweight',
    'isometric',
    'assisted',
    'unilateral',
    'heavy_weight',
    'rep_training',
    'outdoor',
    'flexibility'
  ]).default('UNKNOWN'),
  sets: z.array(z.object({
    index: z.number(),
    reps: z.number().optional(),
    weight: z.number().optional(),
    duration: z.number().optional(), // seconds
    distance: z.number().optional(), // meters
    rpe: z.number().min(0).max(10).optional(),
    status: z.enum(['UNKNOWN', 'PLANNED', 'COMPLETED', 'SKIPPED']).default('UNKNOWN'),
    timestamp: z.string().datetime().optional(),
    restEndTime: z.number().optional(), // 每个组独立的休息结束时间戳
  })),
  uiHint: z.object({
    cardType: CardTypeSchema.optional(),
    pluginId: z.string().optional(),
  }).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type ExerciseAction = z.infer<typeof ExerciseActionSchema>;

// 3. WorkoutSession - The complete workout fact (L2)
// Addressing: fit://session/{sid}/workout/current
export const WorkoutSessionSchema = z.object({
  protocol_version: z.literal('2.0.0').default('2.0.0'),
  id: z.string().uuid(),
  userId: z.string(),
  status: z.enum(['UNKNOWN', 'DRAFT', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).default('UNKNOWN'),
  startTime: z.string().datetime(),
  endTime: z.string().datetime().optional(),
  exercises: z.array(ExerciseActionSchema),
  environment: z.enum(['UNKNOWN', 'INDOOR', 'OUTDOOR', 'HOME', 'GYM']).default('UNKNOWN'),
  version: z.number().default(1),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type WorkoutSession = z.infer<typeof WorkoutSessionSchema>;

// 4. UserProfile - Physiological tags and profile
// Addressing: fit://user/{uid}/profile/physiological
// Tag Format: namespace:category:key=value (e.g. fit:cardio:max_hr=185)
export const UserProfileSchema = z.object({
  protocol_version: z.literal('2.0.0').default('2.0.0'),
  userId: z.string(),
  tags: z.array(z.string()), // Standard format: namespace:category:key=value
  fitnessLevel: z.enum(['UNKNOWN', 'BEGINNER', 'INTERMEDIATE', 'ADVANCED']).default('UNKNOWN'),
  biometrics: z.record(z.string(), BiometricMetricSchema).optional(),
  lastWorkoutTime: z.string().datetime().optional(),
  version: z.number().default(1),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type UserProfile = z.infer<typeof UserProfileSchema>;

// 5. UIHint - Metadata-driven UI instructions
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
  actionUri: z.string().optional(), // fit://...
});

export type UIHint = z.infer<typeof UIHintSchema>;

// MAS Interaction Schema (L3: Fluid Context)
// Based on Content Object standard (4.2 Multi-modal)
export const AgentInteractionSchema = z.object({
  protocol_version: z.literal('2.0.0').default('2.0.0'),
  traceId: z.string().uuid(), // OTel Tracing
  agentId: z.string(),
  timestamp: z.string().datetime(),
  content: z.array(z.object({
    type: z.enum(['UNKNOWN', 'text', 'image', 'uri', 'uiHint']).default('UNKNOWN'),
    text: z.string().optional(),
    uri: z.string().optional(), // fit://...
    uiHint: UIHintSchema.optional(),
  })),
  role: z.enum(['UNKNOWN', 'assistant', 'user', 'system']).default('UNKNOWN'),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type AgentInteraction = z.infer<typeof AgentInteractionSchema>;

/**
 * MAS-RPC Protocol Envelopes (JSON-RPC 2.0 style)
 */
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

/**
 * MAS-Event Protocol Envelope (CloudEvents 1.0 style)
 */
export const MASEventSchema = z.object({
  specversion: z.literal('1.0').default('1.0'),
  type: z.string(),
  source: z.string(),
  id: z.string().uuid(),
  time: z.string().datetime(),
  datacontenttype: z.literal('application/json').default('application/json'),
  traceparent: z.string().optional(), // OTel Tracing
  data: z.any(),
  extensions: z.record(z.string(), z.any()).optional(), // Metadata Slot
});

/**
 * LoadAnchor - 负荷锚点类型定义
 * Based on MAS 数据契约规范
 */

// 心率锚点
export const HeartRateAnchorSchema = z.object({
  zone_2_threshold: z.number().optional(),
  zone_3_threshold: z.number().optional(),
  resting_hr: z.number().optional(),
  max_hr: z.number().optional(),
});

// 推荐配置
export const RecommendationsSchema = z.object({
  targetRpe: z.number().min(0).max(10).optional(),
  targetDurationSec: z.number().optional(),
  targetDistanceMeters: z.number().optional(),
  targetHeartRateZone: z.string().optional(),
  source: z.enum(['UNKNOWN', 'mas', 'user', 'hybrid']).default('UNKNOWN'),
});

// 抗阻锚点
export const ResistanceAnchorSchema = z.object({
  best_weight: z.number(),
  best_reps: z.number(),
  est_1rm: z.number(),
});

// 自重锚点
export const BodyweightAnchorSchema = z.object({
  best_reps: z.number(),
  progression_level: z.number().min(1).max(10),
});

// 辅助锚点
export const AssistedAnchorSchema = z.object({
  best_weight: z.number(),
  best_reps: z.number(),
});

// 等长锚点
export const IsometricAnchorSchema = z.object({
  best_duration: z.number(),
  best_weight: z.number(),
});

// 有氧锚点
export const CardioAnchorSchema = z.object({
  best_duration: z.number(),
  best_distance: z.number(),
  best_pace: z.number(),
});

// 单个运动锚点
export const LoadAnchorSchema = z.object({
  resistance: ResistanceAnchorSchema.optional(),
  bodyweight: BodyweightAnchorSchema.optional(),
  assisted: AssistedAnchorSchema.optional(),
  isometric: IsometricAnchorSchema.optional(),
  cardio: CardioAnchorSchema.optional(),
  outdoor: CardioAnchorSchema.optional(),
  heart_rate: HeartRateAnchorSchema.optional(),
  recommendations: RecommendationsSchema.optional(),
  last_updated: z.number(),
});

// 锚点集合
export const LoadAnchorsSchema = z.record(z.string(), LoadAnchorSchema);

// TypeScript 类型导出
export type HeartRateAnchor = z.infer<typeof HeartRateAnchorSchema>;
export type Recommendations = z.infer<typeof RecommendationsSchema>;
export type ResistanceAnchor = z.infer<typeof ResistanceAnchorSchema>;
export type BodyweightAnchor = z.infer<typeof BodyweightAnchorSchema>;
export type AssistedAnchor = z.infer<typeof AssistedAnchorSchema>;
export type IsometricAnchor = z.infer<typeof IsometricAnchorSchema>;
export type CardioAnchor = z.infer<typeof CardioAnchorSchema>;
export type LoadAnchor = z.infer<typeof LoadAnchorSchema>;
export type LoadAnchors = z.infer<typeof LoadAnchorsSchema>;

