/**
 * MAS UI Hint Schemas - Unified Schema Definitions
 *
 * This file defines the canonical Zod schemas for all UIHint types.
 * These schemas enforce strict type safety for the Structured Output of LLMs.
 *
 * Version: 1.0.0
 * Created: 2026-01-26
 */

import { z } from 'zod';

// ============================================================================
// Exercise Type Enum
// ============================================================================

/**
 * Exercise Type Enum for plan_card validation.
 * Matches the 10 types defined in shared/contracts EXERCISE_TYPE_VALUES.
 */
export const ExerciseTypeEnum = z.enum([
  'resistance',
  'bodyweight',
  'isometric',
  'cardio',
  'outdoor',
  'unilateral',
  'assisted',
  'flexibility',
  'heavy_weight',
  'rep_training',
]);

export type ExerciseType = z.infer<typeof ExerciseTypeEnum>;

// ============================================================================
// Base Schemas
// ============================================================================

/**
 * JSON Patch Operation Schema (RFC 6902 subset)
 * Matches BatchOpsService.PatchOp format
 */
export const JsonPatchOpSchema = z.object({
  op: z.enum(['replace', 'add', 'remove']),
  path: z.string(),
  value: z.any().optional(),
  idempotencyKey: z.string().optional(),
});

export type JsonPatchOp = z.infer<typeof JsonPatchOpSchema>;

// ============================================================================
// SURVEY_CARD Schemas
// ============================================================================

/**
 * Survey Question Option Schema
 * Used for multiple-choice questions
 */
export const SurveyQuestionOptionSchema = z.object({
  label: z.string().min(1, 'Option label cannot be empty'),
  value: z.string().min(1, 'Option value cannot be empty'),
});

export type SurveyQuestionOption = z.infer<typeof SurveyQuestionOptionSchema>;

/**
 * Survey Question Schema
 *
 * IMPORTANT: questions must be an array of objects, NOT strings!
 * This is a common error where LLM returns strings instead of objects.
 */
export const SurveyQuestionSchema = z.object({
  id: z.string().min(1, 'Question ID cannot be empty'),
  question: z.string().min(1, 'Question text cannot be empty'),
  required: z.boolean().default(false),
  placeholder: z.string().optional(),
  options: z.array(SurveyQuestionOptionSchema).optional(),
  inputType: z.enum(['text', 'number']).optional(),
});

export type SurveyQuestion = z.infer<typeof SurveyQuestionSchema>;

/**
 * Survey Card Data Schema
 */
export const SurveyCardDataSchema = z.object({
  sessionId: z.string().optional(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  message: z.string().optional(),
  questions: z.array(SurveyQuestionSchema).min(1, 'At least one question is required'),
});

export type SurveyCardData = z.infer<typeof SurveyCardDataSchema>;

// ============================================================================
// PLAN_CARD Schemas
// ============================================================================

/**
 * Exercise Plan Schema
 * Represents a single exercise in a training plan.
 *
 * IMPORTANT: Field requirements depend on `exercise_type`:
 * - isometric: duration > 0 required, reps should be 1
 * - cardio: duration > 0 required
 * - outdoor: distance > 0 required
 * - resistance/unilateral/heavy_weight/assisted: weight > 0 required
 * - bodyweight/rep_training/flexibility: no required fields
 */
export const ExercisePlanSchema = z.object({
  exerciseId: z.string().min(1, 'Exercise ID cannot be empty'),
  name: z.string().min(1, 'Exercise name cannot be empty'),
  exercise_type: ExerciseTypeEnum,
  sets: z.number().int().positive('Sets must be a positive integer'),
  reps: z.number().int().positive('Reps must be a positive integer'),
  weight: z.number().min(0, 'Weight cannot be negative').default(0),
  duration: z.number().int().positive().optional(),
  distance: z.number().min(0).optional(),
}).superRefine((data, ctx) => {
  const { exercise_type, reps, weight, duration, distance } = data;

  // isometric: duration > 0 required, reps should be 1
  if (exercise_type === 'isometric') {
    if (!duration || duration <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `isometric 类型必需 duration > 0 (当前: ${duration ?? 'undefined'})`,
        path: ['duration'],
      });
    }
    if (reps !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `isometric 类型的 reps 应为 1 (当前: ${reps})。静力训练按时间计量，非次数。`,
        path: ['reps'],
      });
    }
  }

  // cardio: duration > 0 required
  if (exercise_type === 'cardio') {
    if (!duration || duration <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `cardio 类型必需 duration > 0 (当前: ${duration ?? 'undefined'})`,
        path: ['duration'],
      });
    }
  }

  // outdoor: distance > 0 required
  if (exercise_type === 'outdoor') {
    if (!distance || distance <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `outdoor 类型必需 distance > 0 (当前: ${distance ?? 'undefined'})`,
        path: ['distance'],
      });
    }
  }

  // resistance/unilateral/heavy_weight/assisted: weight > 0 required
  if (['resistance', 'unilateral', 'heavy_weight', 'assisted'].includes(exercise_type)) {
    if (!weight || weight <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${exercise_type} 类型必需 weight > 0 (当前: ${weight ?? 'undefined'})`,
        path: ['weight'],
      });
    }
  }

  // bodyweight/rep_training/flexibility: no required fields, weight defaults to 0
});

export type ExercisePlan = z.infer<typeof ExercisePlanSchema>;

/**
 * Plan Card Data Schema
 *
 * IMPORTANT: data must be an array, NOT an object!
 * LLM sometimes returns { "0": {...}, "1": {...} } instead of [{...}, {...}]
 */
export const PlanCardDataSchema = z.array(ExercisePlanSchema).min(1, 'At least one exercise is required');

export type PlanCardData = z.infer<typeof PlanCardDataSchema>;

/**
 * Plan Diff Schema (optional metadata for plan changes)
 */
export const PlanDiffSchema = z.object({
  added: z.array(z.string()).default([]),
  modified: z.array(z.string()).default([]),
  removed: z.array(z.string()).default([]),
});

export type PlanDiff = z.infer<typeof PlanDiffSchema>;

// ============================================================================
// SUMMARY_CARD Schemas
// ============================================================================

/**
 * Summary Card Data Schema
 * Used for workout summaries and post-workout analysis
 */
export const SummaryCardDataSchema = z.object({
  title: z.string().optional(),
  summary: z.string().min(1, 'Summary text cannot be empty'),
  highlights: z.array(z.string()).default([]),
  metrics: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
});

export type SummaryCardData = z.infer<typeof SummaryCardDataSchema>;

// ============================================================================
// DEVIATION_CARD Schemas
// ============================================================================

/**
 * Deviation Card Data Schema
 * Used when training plan needs adjustment confirmation
 */
export const DeviationCardDataSchema = z.object({
  reason: z.string().min(1, 'Deviation reason cannot be empty'),
  suggestion: z.string().optional(),
});

export type DeviationCardData = z.infer<typeof DeviationCardDataSchema>;

// ============================================================================
// AUDIT_COMPLETE Schemas
// ============================================================================

/**
 * Profile Update Item Schema
 * Represents a single field that was updated in the user profile
 */
export const ProfileUpdateItemSchema = z.object({
  field: z.enum(['loadAnchors', 'physiological', 'preferences', 'basicInfo']),
  label: z.string(),
  count: z.number().int().min(0).default(0),
  details: z.array(z.string()).optional(),
});

export type ProfileUpdateItem = z.infer<typeof ProfileUpdateItemSchema>;

/**
 * Audit Complete Data Schema
 * Shown when training audit is complete and user profile has been updated
 */
export const AuditCompleteDataSchema = z.object({
  title: z.string().optional(),
  message: z.string().min(1, 'Message cannot be empty'),
  actionLabel: z.string().default('查看详情'),
  requiresConfirmation: z.boolean().default(true),
  updates: z.array(ProfileUpdateItemSchema).min(0).default([]),
  sessionId: z.string().optional(),
  auditContent: z.string().optional(),  // Full audit report in Markdown format
});

export type AuditCompleteData = z.infer<typeof AuditCompleteDataSchema>;

// ============================================================================
// UI Hint Discriminated Union Schema
// ============================================================================

/**
 * UI Hint Type Enum
 */
export const UIHintTypeEnum = z.enum([
  'survey_card',
  'plan_card',
  'summary_card',
  'deviation_card',
  'audit_complete',
  'strategy_confirm',
]);

export type UIHintType = z.infer<typeof UIHintTypeEnum>;

/**
 * Unified UIHint Schema (Discriminated Union)
 *
 * Uses Zod's discriminatedUnion for type-safe narrowing based on the 'type' field.
 * This ensures that the data structure matches the expected type.
 */
export const UIHintSchema = z.discriminatedUnion('type', [
  // survey_card
  z.object({
    type: z.literal('survey_card'),
    data: SurveyCardDataSchema,
  }),
  // plan_card
  z.object({
    type: z.literal('plan_card'),
    data: PlanCardDataSchema,
    diff: PlanDiffSchema.optional(),
  }),
  // summary_card
  z.object({
    type: z.literal('summary_card'),
    data: SummaryCardDataSchema,
  }),
  // deviation_card
  z.object({
    type: z.literal('deviation_card'),
    data: DeviationCardDataSchema,
  }),
  // audit_complete
  z.object({
    type: z.literal('audit_complete'),
    data: AuditCompleteDataSchema,
  }),
  // strategy_confirm
  z.object({
    type: z.literal('strategy_confirm'),
    data: z.object({
      title: z.string().optional(),
      message: z.string().optional(),
      actionLabel: z.string().optional(),
      preview: z.string().min(1, 'Preview content cannot be empty'),
      fullContent: z.string().min(1, 'Full strategy content cannot be empty'),
      updatedAt: z.string().datetime().optional(),
    }),
  }),
]);

export type UIHint = z.infer<typeof UIHintSchema>;

// ============================================================================
// Architect Output Schema (Complete)
// ============================================================================

/**
 * Complete Architect Output Schema
 * This is the top-level schema for Structured Output from the Architect/Planner node
 */
export const ArchitectOutputSchema = z.object({
  ops: z.array(JsonPatchOpSchema).default([]),
  uiHint: UIHintSchema.optional(),
});

export type ArchitectOutput = z.infer<typeof ArchitectOutputSchema>;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Validates if a value is a valid UIHint
 */
export function isValidUIHint(value: unknown): value is UIHint {
  const result = UIHintSchema.safeParse(value);
  return result.success;
}

/**
 * Safely parses a UIHint with detailed error logging
 */
export function parseUIHint(value: unknown): {
  success: boolean;
  data?: UIHint;
  error?: z.ZodError;
} {
  const result = UIHintSchema.safeParse(value);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

/**
 * Gets a fallback UIHint for a given type
 * Used when validation fails or LLM returns invalid format
 */
export function getFallbackUIHint(type: UIHintType): UIHint {
  const fallbacks: Record<UIHintType, UIHint> = {
    survey_card: {
      type: 'survey_card',
      data: {
        title: '训练反馈',
        questions: [
          {
            id: 'default',
            question: '今天的训练感觉如何？',
            required: false,
          },
        ],
      },
    },
    plan_card: {
      type: 'plan_card',
      data: [],
    },
    summary_card: {
      type: 'summary_card',
      data: {
        summary: '训练已完成',
        highlights: [],
        metrics: {},
      },
    },
    deviation_card: {
      type: 'deviation_card',
      data: { reason: '建议调整训练计划' },
    },
    audit_complete: {
      type: 'audit_complete',
      data: {
        title: '审计完成',
        message: '您的训练数据已分析完成',
        actionLabel: '继续',
        requiresConfirmation: true,
        updates: []
      },
    },
    strategy_confirm: {
      type: 'strategy_confirm',
      data: {
        title: '训练策略更新',
        message: 'AI 已为您生成新的训练策略',
        actionLabel: '查看策略',
        preview: '基于您的目标和当前水平，我们为您定制了新的训练计划...',
        fullContent: '# 训练策略\n\n基于您的目标和当前水平，我们为您定制了新的训练计划。',
        updatedAt: new Date().toISOString(),
      },
    },
  };

  return fallbacks[type];
}

/**
 * Improved fallback survey for workout_complete scenario
 * More targeted questions instead of generic "how was your workout?"
 */
export function getWorkoutCompleteFallbackSurvey(): UIHint {
  return {
    type: 'survey_card',
    data: {
      title: '训练反馈',
      message: '请帮助我们了解您的训练情况',
      questions: [
        {
          id: 'fatigue_level',
          question: '今天的训练感觉有多累？（1-10分）',
          required: false,
          inputType: 'number',
          placeholder: '请输入 1-10 的分数'
        },
        {
          id: 'sleep_quality',
          question: '昨晚睡眠质量如何？',
          required: false,
          options: [
            { label: '很好', value: 'excellent' },
            { label: '一般', value: 'average' },
            { label: '较差', value: 'poor' }
          ]
        },
        {
          id: 'additional_notes',
          question: '有什么想要补充的吗？',
          required: false,
          placeholder: '如：疼痛部位、发力感受等'
        }
      ]
    }
  };
}
