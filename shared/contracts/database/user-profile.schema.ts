/**
 * User Profile Database Schemas
 *
 * These schemas define the structure of user profile data as stored in PostgreSQL.
 * All field names use snake_case to match PostgreSQL conventions.
 *
 * These schemas are used for:
 * - Validating data read from database
 * - Preparing data for database storage
 */

import { z } from 'zod';

/**
 * Basic Info Database Schema
 *
 * User's physical characteristics as stored in database
 */
export const BasicInfoDatabaseSchema = z.object({
  age: z.number().optional(),
  weight: z.number().optional(), // kg
  height: z.number().optional(), // cm
  body_fat: z.number().optional(), // percentage
  training_age: z.number().optional(), // months
  gender: z.enum(['male', 'female', 'other']).optional(),
});

export type BasicInfoDatabase = z.infer<typeof BasicInfoDatabaseSchema>;

/**
 * Preferences Database Schema
 *
 * User's training preferences as stored in database
 */
export const PreferencesDatabaseSchema = z.object({
  method: z.array(z.string()).optional(), // ['hypertrophy', 'strength']
  avoided: z.array(z.string()).optional(), // ['injury', 'equipment']
  time_constraint: z.number().optional(), // minutes per session
  equipment: z.array(z.string()).optional(), // available equipment
  goal: z.enum(['muscle_gain', 'fat_loss', 'strength', 'health', 'general_fitness']).optional(),
});

export type PreferencesDatabase = z.infer<typeof PreferencesDatabaseSchema>;

/**
 * Physiological Database Schema
 *
 * User's physiological state as stored in database
 */
export const PhysiologicalDatabaseSchema = z.object({
  sleep_hours: z.number().optional(),
  stress_level: z.enum(['low', 'medium', 'high']).optional(),
  cycle_focus: z.enum(['follicular', 'ovulation', 'luteal', 'menstrual']).optional(),
});

export type PhysiologicalDatabase = z.infer<typeof PhysiologicalDatabaseSchema>;

/**
 * Psychological Database Schema
 *
 * User's psychological profile as stored in database
 */
export const PsychologicalDatabaseSchema = z.object({
  risk_preference: z.enum(['UNKNOWN', 'conservative', 'moderate', 'aggressive']).optional(),
  accountability: z.enum(['UNKNOWN', 'low', 'medium', 'high']).optional(),
});

export type PsychologicalDatabase = z.infer<typeof PsychologicalDatabaseSchema>;

/**
 * Profile Static Database Schema
 *
 * Corresponds to the users.profile_static JSONB column.
 * Contains static user information that doesn't change frequently.
 */
export const ProfileStaticDatabaseSchema = z.object({
  // Biological characteristics
  age: z.number().optional(),
  weight: z.number().optional(), // kg
  height: z.number().optional(), // cm
  body_fat_percentage: z.number().optional(),

  // Neuro-psychological characteristics
  neuro_type: z.enum(['UNKNOWN', 'type_1', 'type_2a', 'type_2b', 'type_3']).optional(),
  risk_preference: z.enum(['UNKNOWN', 'conservative', 'moderate', 'aggressive']).optional(),
  accountability: z.enum(['UNKNOWN', 'low', 'medium', 'high']).optional(),

  // Permanent limitations
  permanent_injuries: z.array(z.object({
    part: z.string(),
    description: z.string().optional(),
    severity: z.number().min(1).max(10).optional(),
  })).optional(),

  // Fitness level classification
  fitness_level: z.enum(['UNKNOWN', 'beginner', 'intermediate', 'advanced']).optional(),

  // User tags and classifications
  tags: z.array(z.string()).optional(),

  // Health red flags (injuries, conditions, etc.)
  red_flags: z.array(z.string()).optional(),

  // Nested schemas for extended profile data
  basic_info: BasicInfoDatabaseSchema.optional(),
  preferences: PreferencesDatabaseSchema.optional(),
  physiological: PhysiologicalDatabaseSchema.optional(),
  psychological: PsychologicalDatabaseSchema.optional(),

  // Training strategy (free text format, similar to AI system prompt)
  training_strategy: z.string().optional().nullable(),
});

export type ProfileStaticDatabase = z.infer<typeof ProfileStaticDatabaseSchema>;

/**
 * Profile Dynamic Database Schema
 *
 * Corresponds to the users.profile_dynamic JSONB column.
 * Contains dynamic user information that changes frequently.
 */
export const ProfileDynamicDatabaseSchema = z.object({
  // Load anchors: Current capability mapping per exercise
  load_anchors: z.record(z.string(), z.object({
    exercise_id: z.string(),
    load: z.object({
      resistance: z.number().optional(),
      bodyweight: z.object({
        scaling: z.number().optional(),
        additional: z.number().optional(),
      }).optional(),
      assisted: z.object({
        weight: z.number().optional(),
      }).optional(),
      isometric: z.object({
        duration: z.number().optional(),
      }).optional(),
      cardio: z.object({
        duration: z.number().optional(),
        distance: z.number().optional(),
      }).optional(),
    }),
    confidence: z.number().min(0).max(1),
    last_updated: z.string().datetime().optional(),
  })).optional(),

  // Short-term limitations: Self-healing injury windows
  active_limitations: z.array(z.object({
    part: z.string(), // Body part
    severity: z.number().min(1).max(10), // 1-10 severity scale
    expire_at: z.string().datetime(), // ISO 8601 UTC - auto-heal timestamp
    logged_at: z.string().datetime(), // ISO 8601 UTC - when logged
    auto_heal: z.boolean().default(true), // Whether to auto-expire
  })).optional(),

  // Recovery state: Fatigue monitoring (nullable for new users)
  recovery_state: z.object({
    fatigue_level: z.enum(['UNKNOWN', 'very_low', 'low', 'moderate', 'high', 'very_high']).optional(),
    last_workout_date: z.string().datetime().optional(),
    recommended_rest_days: z.number().int().min(0).optional(),
  }).nullish(),

  // Heart rate baseline for recovery tracking
  hr_baseline: z.object({
    resting_hr: z.number().int().positive().optional(),
    hrv: z.number().optional(),
    last_measured: z.string().datetime().optional(),
  }).optional(),

  // Protocol status tracking
  protocol_status: z.object({
    current_phase: z.string().optional(),
    days_in_phase: z.number().int().min(0).optional(),
    last_phase_change: z.string().datetime().optional(),
  }).optional(),
});

export type ProfileDynamicDatabase = z.infer<typeof ProfileDynamicDatabaseSchema>;
