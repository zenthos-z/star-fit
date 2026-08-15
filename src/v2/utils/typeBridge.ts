import { Exercise, ExerciseSet, Session } from '../../../types';
import { ExerciseAction, WorkoutSession } from '../types/protocol';

// Unified lowercase type system - no conversion needed
// Protocol now uses the same types as ExerciseType
const convertExerciseType = (oldType: string): any => {
  // Direct pass-through since both use lowercase
  return oldType || 'UNKNOWN';
};

const convertActionType = (newType: string): any => {
  // Direct pass-through since both use lowercase
  const validTypes = ['resistance', 'cardio', 'bodyweight', 'isometric', 'assisted', 'unilateral', 'heavy_weight', 'rep_training', 'outdoor', 'flexibility'];
  if (validTypes.includes(newType)) {
    return newType;
  }
  // Fallback to metadata if available
  return 'resistance';
};

const convertSessionStatus = (status: string): 'UNKNOWN' | 'DRAFT' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' => {
  const statusMap: Record<string, 'UNKNOWN' | 'DRAFT' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'> = {
    'idle': 'DRAFT',
    'active': 'IN_PROGRESS',
    'paused': 'IN_PROGRESS',
    'finished': 'COMPLETED'
  };
  return statusMap[status] || 'UNKNOWN';
};

const convertWorkoutStatus = (status: string): 'idle' | 'active' | 'paused' | 'finished' => {
  const statusMap: Record<string, 'idle' | 'active' | 'paused' | 'finished'> = {
    'DRAFT': 'idle',
    'IN_PROGRESS': 'active',
    'COMPLETED': 'finished',
    'CANCELLED': 'idle'
  };
  return statusMap[status] || 'idle';
};

export const convertExerciseToAction = (exercise: Exercise): ExerciseAction => {
  return {
    protocol_version: '2.0.0',
    id: exercise.id,
    exerciseId: exercise.name.startsWith('fit://') 
      ? exercise.name 
      : `fit://library/exercise/${exercise.name}`,
    type: convertExerciseType(exercise.type),
    sets: exercise.sets.map((set, idx) => ({
      index: idx,
      reps: set.reps,
      weight: set.weight,
      duration: set.duration,
      distance: set.distance,
      rpe: set.rpe,
      status: set.completed ? 'COMPLETED' : 'PLANNED',
      timestamp: set.completed ? new Date().toISOString() : undefined,
      restEndTime: set.restEndTime
    })),
    uiHint: {
      cardType: exercise.uiHint?.cardType as any,
      pluginId: (exercise.uiHint as any)?.pluginId
    },
    metadata: {
      targetDuration: exercise.metadata?.targetDuration,
      targetDistance: exercise.metadata?.targetDistance,
      targetRpe: exercise.targetRpe,
      referenceBodyweight: exercise.referenceBodyweight,
      primaryMuscles: exercise.primaryMuscles,
      equipment: exercise.equipment,
      bodyCategory: exercise.bodyCategory,
      unilateral: exercise.unilateral,
      notes: exercise.notes,
      originalType: exercise.type,  // Dual insurance: preserve original type
      ...exercise.metadata
    }
  };
};

export const convertActionToExercise = (action: ExerciseAction): Exercise => {
  return {
    id: action.id,
    libraryId: action.id,
    name: action.exerciseId.replace('fit://library/exercise/', ''),
    notes: action.metadata?.notes as string,
    sets: action.sets.map(set => ({
      id: set.index.toString(),
      reps: set.reps,
      weight: set.weight,
      duration: set.duration,
      distance: set.distance,
      completed: set.status === 'COMPLETED',
      rpe: set.rpe,
      restEndTime: set.restEndTime
    })),
    type: action.metadata?.originalType || convertActionType(action.type),
    targetRpe: action.metadata?.targetRpe,
    referenceBodyweight: action.metadata?.referenceBodyweight,
    primaryMuscles: action.metadata?.primaryMuscles,
    equipment: action.metadata?.equipment,
    bodyCategory: action.metadata?.bodyCategory,
    unilateral: action.metadata?.unilateral,
    metadata: {
      ...action.metadata
    },
    uiHint: action.uiHint as any
  };
};

export const convertSessionToWorkoutSession = (session: Session): WorkoutSession => {
  return {
    protocol_version: '2.0.0',
    id: session.id,
    userId: typeof localStorage !== 'undefined' ? (localStorage.getItem('starfit_user_id') || 'unknown') : 'unknown',
    status: convertSessionStatus(session.status),
    startTime: new Date(session.startTime).toISOString(),
    endTime: session.endTime ? new Date(session.endTime).toISOString() : undefined,
    exercises: session.exercises.map(convertExerciseToAction),
    environment: 'UNKNOWN',
    version: 1,
    metadata: {
      pausedDuration: session.pausedDuration,
      pauseStartTime: session.pauseStartTime
    }
  };
};

export const convertWorkoutSessionToSession = (workoutSession: WorkoutSession): Session => {
  return {
    id: workoutSession.id,
    startTime: new Date(workoutSession.startTime).getTime(),
    endTime: workoutSession.endTime ? new Date(workoutSession.endTime).getTime() : undefined,
    pausedDuration: workoutSession.metadata?.pausedDuration || 0,
    pauseStartTime: workoutSession.metadata?.pauseStartTime,
    status: convertWorkoutStatus(workoutSession.status),
    exercises: workoutSession.exercises.map(convertActionToExercise)
  };
};

// ============================================================================
// UIHint Type Bridge (Backend-Frontend Conversion)
// ============================================================================

/**
 * Backend UIHint format (as sent by MAS)
 * This matches the Schema format defined in the backend
 */
export interface BackendUIHint {
  type: 'plan_card' | 'summary_card' | 'survey_card' | 'deviation_card';
  data: any;
  diff?: {
    added: string[];
    modified: string[];
    removed: string[];
  };
}

/**
 * Frontend UIHint format (as consumed by UI components)
 * Includes protocol_version for standardization
 */
export interface FrontendUIHint {
  protocol_version: '2.0.0';
  type: 'plan_card' | 'summary_card' | 'survey_card' | 'deviation_card' | 'unknown';
  pluginId?: string;
  priority?: number;
  data: any;
  actionUri?: string;
}

/**
 * Normalize a backend UIHint to frontend format
 *
 * This function:
 * 1. Adds protocol_version if missing
 * 2. Validates the structure
 * 3. Handles type-specific data transformations
 * 4. Returns a valid FrontendUIHint or throws error
 */
export function normalizeBackendUIHint(backendHint: unknown): FrontendUIHint {
  // Handle null/undefined
  if (!backendHint) {
    throw new Error('UIHint is null or undefined');
  }

  try {
    // Parse as BackendUIHint
    const backend = backendHint as BackendUIHint;

    // Validate required fields
    if (!backend.type) {
      throw new Error('UIHint missing required field: type');
    }

    // Validate type is one of the allowed values
    const allowedTypes = ['plan_card', 'summary_card', 'survey_card', 'deviation_card'];
    if (!allowedTypes.includes(backend.type)) {
      throw new Error(`Invalid UIHint type: ${backend.type}`);
    }

    // Build frontend format
    const frontend: FrontendUIHint = {
      protocol_version: '2.0.0',
      type: backend.type,
      data: backend.data,
      pluginId: (backend as any).pluginId,
      priority: (backend as any).priority || 0,
      actionUri: (backend as any).actionUri
    };

    // Type-specific data transformations
    if (backend.type === 'plan_card') {
      // Ensure data is an array
      if (!Array.isArray(backend.data)) {
        // Try to convert object to array
        if (typeof backend.data === 'object' && backend.data !== null) {
          frontend.data = Object.values(backend.data).filter(
            item => item && typeof item === 'object'
          );
        } else {
          frontend.data = [];
        }
      }

      // Add diff if present
      if (backend.diff) {
        frontend.data = { exercises: frontend.data, diff: backend.diff };
      }
    }

    if (backend.type === 'survey_card') {
      // Ensure questions is an array of objects
      if (backend.data?.questions) {
        const questions = backend.data.questions;

        // Handle string array (common error)
        if (Array.isArray(questions) && questions.length > 0 && typeof questions[0] === 'string') {
          console.warn('[TypeBridge] Converting string questions to object format');
          try {
            frontend.data.questions = questions.map((q, idx) => {
              try {
                return JSON.parse(q);
              } catch {
                return { id: `q${idx}`, question: q, required: false };
              }
            });
          } catch (e) {
            console.error('[TypeBridge] Failed to convert questions:', e);
            frontend.data.questions = [];
          }
        }
        // Ensure questions is an array
        else if (!Array.isArray(questions)) {
          console.warn('[TypeBridge] Questions is not an array, resetting');
          frontend.data.questions = [];
        }
      }
    }

    // Validate with Zod schema
    const { UIHintSchema } = require('../types/protocol');
    const validationResult = UIHintSchema.safeParse(frontend);

    if (validationResult.success) {
      return validationResult.data as FrontendUIHint;
    }

    // Validation failed, throw error
    throw new Error(`UIHint validation failed: ${formatZodError(validationResult.error)}`);
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(String(error));
  }
}

/**
 * Format Zod error for display
 */
function formatZodError(error: any): string {
  const flattened = error.flatten?.();
  if (!flattened) return 'Validation error';

  const parts: string[] = [];

  for (const [field, issues] of Object.entries(flattened.fieldErrors || {})) {
    const issueStr = Array.isArray(issues) ? issues.join('; ') : String(issues);
    parts.push(`${field}: ${issueStr}`);
  }

  const formErrors = flattened.formErrors || [];
  if (formErrors.length > 0) {
    parts.push(`form: ${formErrors.join('; ')}`);
  }

  return parts.length > 0 ? parts.join(' | ') : 'Validation error';
}

/**
 * @deprecated Use normalizeBackendUIHint which now throws errors on failure
 * Get a fallback UIHint for a given type
 */
export function getUIHintFallback(type: string): FrontendUIHint {
  const fallbacks: Record<string, FrontendUIHint> = {
    plan_card: {
      protocol_version: '2.0.0',
      type: 'plan_card',
      priority: 0,
      data: []
    },
    summary_card: {
      protocol_version: '2.0.0',
      type: 'summary_card',
      priority: 0,
      data: {
        title: '训练总结',
        summary: '训练已完成',
        highlights: [],
        metrics: {}
      }
    },
    survey_card: {
      protocol_version: '2.0.0',
      type: 'survey_card',
      priority: 0,
      data: {
        title: '训练反馈',
        questions: [
          {
            id: 'default',
            question: '今天的训练感觉如何？',
            required: false
          }
        ]
      }
    },
    deviation_card: {
      protocol_version: '2.0.0',
      type: 'deviation_card',
      priority: 0,
      data: {
        reason: '建议调整训练计划'
      }
    }
  };

  return fallbacks[type] || fallbacks.survey_card;
}

/**
 * @deprecated Use normalizeBackendUIHint which now throws errors on failure
 * Normalize UIHint with fallback
 *
 * @param backendHint - The backend UIHint to normalize
 * @param _fallbackType - Ignored, always throws on validation failure
 * @returns A valid FrontendUIHint
 * @throws Error if validation fails
 */
export function normalizeBackendUIHintWithFallback(
  backendHint: unknown,
  _fallbackType: 'plan_card' | 'summary_card' | 'survey_card' | 'deviation_card' = 'survey_card'
): FrontendUIHint {
  // This function is deprecated - use normalizeBackendUIHint directly
  return normalizeBackendUIHint(backendHint);
}

/**
 * Type guard to check if a value is a valid UIHint
 * Note: This now performs full validation and may throw errors
 */
export function isValidUIHint(value: unknown): value is FrontendUIHint {
  try {
    normalizeBackendUIHint(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract UIHint from API response
 * Handles various response formats
 * @throws Error if no valid UIHint is found or validation fails
 */
export function extractUIHintFromResponse(response: any): FrontendUIHint {
  if (!response) {
    throw new Error('Response is null or undefined');
  }

  // Direct uiHint field
  if (response.uiHint) {
    return normalizeBackendUIHint(response.uiHint);
  }

  // Nested in data
  if (response.data?.uiHint) {
    return normalizeBackendUIHint(response.data.uiHint);
  }

  // Response itself is the uiHint
  if (response.type && response.data) {
    return normalizeBackendUIHint(response);
  }

  throw new Error('No valid UIHint found in response');
}
