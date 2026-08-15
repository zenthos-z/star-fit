import { z } from 'zod';

/**
 * Starfit Data Protocol V2 - Core Pillars
 * Based on DATA_PROTOCOL_STANDARD.md
 */

// 1. BiometricMetric - Physiological data
export const BiometricMetricSchema = z.object({
  type: z.enum(['hr', 'hrv', 'spo2', 'vo2max', 'weight', 'bodyfat', 'unknown']).default('unknown'),
  value: z.number(),
  unit: z.string(),
  timestamp: z.string().datetime(), // ISO 8601 UTC
  metadata: z.record(z.string(), z.any()).optional(),
});

export type BiometricMetric = z.infer<typeof BiometricMetricSchema>;

// 2. ExerciseAction - Single exercise set or action
export const ExerciseActionSchema = z.object({
  id: z.string().uuid(),
  exerciseId: z.string(), // fit://library/exercise/{eid}
  type: z.enum(['strength', 'cardio', 'hiit', 'stretch', 'unknown']).default('unknown'),
  sets: z.array(z.object({
    index: z.number(),
    reps: z.number().optional(),
    weight: z.number().optional(),
    duration: z.number().optional(), // seconds
    distance: z.number().optional(), // meters
    rpe: z.number().min(0).max(10).optional(),
    status: z.enum(['planned', 'completed', 'skipped']).default('planned'),
    timestamp: z.string().datetime().optional(),
  })),
  uiHint: z.object({
    cardType: z.string().optional(),
    pluginId: z.string().optional(),
  }).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type ExerciseAction = z.infer<typeof ExerciseActionSchema>;

// 3. WorkoutSession - The complete workout fact (L2)
export const WorkoutSessionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string(),
  status: z.enum(['draft', 'in_progress', 'completed', 'cancelled']).default('draft'),
  startTime: z.string().datetime(),
  endTime: z.string().datetime().optional(),
  exercises: z.array(ExerciseActionSchema),
  environment: z.enum(['indoor', 'outdoor', 'home', 'gym', 'unknown']).default('unknown'),
  version: z.number().default(1),
  metadata: z.record(z.string(), z.any()).optional(),
});

export type WorkoutSession = z.infer<typeof WorkoutSessionSchema>;

// 4. UserProfile - Physiological tags and profile
export const UserProfileSchema = z.object({
  userId: z.string(),
  tags: z.array(z.string()), // namespace:category:key=value
  fitnessLevel: z.enum(['beginner', 'intermediate', 'advanced', 'unknown']).default('unknown'),
  biometrics: z.record(z.string(), BiometricMetricSchema).optional(),
  lastWorkoutTime: z.string().datetime().optional(),
  version: z.number().default(1),
});

export type UserProfile = z.infer<typeof UserProfileSchema>;

// 5. UIHint - Metadata-driven UI instructions
export const UIHintSchema = z.object({
  type: z.enum([
    'plan_card',
    'summary_card',
    'survey_card',
    'deviation_card',
    'instruction_card',
    'skeleton',
    'audit_complete',
    'survey_success',
    'unknown'
  ]).default('unknown'),
  pluginId: z.string().optional(),
  priority: z.number().default(0),
  data: z.record(z.string(), z.any()).optional(),
  actionUri: z.string().optional(), // fit://...
});

export type UIHint = z.infer<typeof UIHintSchema>;

// MAS Interaction Schema (L3: Fluid Context)
export const AgentInteractionSchema = z.object({
  traceId: z.string().uuid(),
  agentId: z.string(),
  timestamp: z.string().datetime(),
  content: z.array(z.object({
    type: z.enum(['text', 'image', 'uri', 'uiHint']),
    text: z.string().optional(),
    uri: z.string().optional(),
    uiHint: UIHintSchema.optional(),
  })),
  role: z.enum(['assistant', 'user', 'system']).default('assistant'),
});

export type AgentInteraction = z.infer<typeof AgentInteractionSchema>;
