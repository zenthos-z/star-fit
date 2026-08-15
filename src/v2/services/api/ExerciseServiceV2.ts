/**
 * ExerciseServiceV2 - Exercise Library API Client Service
 *
 * Provides type-safe API calls for exercise library operations.
 * All types are imported from shared/contracts where available.
 * Uses parseJSONSafe for all JSON parsing (no bare JSON.parse).
 *
 * @version 2.0.0
 */

import { parseJSONSafe } from 'shared/contracts';

// Re-export API_BASE and helper functions from the existing service
import { API_BASE, getHeaders } from '../../../services/geminiService';

// ============================================================================
// Type Definitions (from backend Exercise types)
// ============================================================================

/**
 * Muscle target options - Complete muscle partition list
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
 * Exercise target structure
 */
export interface ExerciseTargets {
  primary: MuscleTarget[];      // Primary targets (at least 1)
  secondary?: MuscleTarget[];   // Secondary targets (optional)
}

/**
 * Exercise type enumeration
 */
export type ExerciseType =
  | 'resistance'
  | 'unilateral'
  | 'bodyweight'
  | 'assisted'
  | 'isometric'
  | 'cardio'
  | 'flexibility'
  | 'heavy_weight'
  | 'rep_training'
  | 'outdoor';

/**
 * Difficulty level
 */
export type Difficulty = 'beginner' | 'intermediate' | 'advanced';

/**
 * Modifier type (who made the change)
 */
export type Modifier = 'admin' | 'system' | 'mas';

/**
 * Exercise data structure (matches backend Exercise interface)
 */
export interface Exercise {
  id: string;
  name: string;
  exercise_type: ExerciseType;
  targets: string; // JSON stringified ExerciseTargets
  equipment_required: string; // JSON stringified string[]
  difficulty: Difficulty;
  content_html?: string;
  assets_json?: string; // { cover, video }
  tags_json?: string;
  modified_by: Modifier;
  modified_at: number;
  updated_at?: number;
  protocol_version?: string;
  version?: number;
  metadata_json?: string;
}

/**
 * Parsed exercise with JSON fields already parsed
 */
export interface ParsedExercise extends Omit<Exercise, 'targets' | 'equipment_required' | 'assets_json' | 'tags_json' | 'metadata_json'> {
  targets: ExerciseTargets;
  equipment_required: string[];
  assets?: { cover?: string; video?: string };
  tags?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Exercise update payload (for admin operations)
 */
export interface ExerciseUpdate {
  exerciseId: string;
  data: Partial<Omit<Exercise, 'id' | 'updated_at'>>;
  modifiedBy: Modifier;
  changeReason?: string;
}

// ============================================================================
// Error Types
// ============================================================================

export class ExerciseServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly endpoint?: string
  ) {
    super(message);
    this.name = 'ExerciseServiceError';
  }
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Build the full API URL for exercise endpoints
 */
function buildUrl(path: string): string {
  return `${API_BASE}${path}`;
}

/**
 * Handle API response with proper error handling
 */
async function handleResponse<T>(
  response: Response,
  context: string
): Promise<T> {
  if (!response.ok) {
    const errorMessage = `ExerciseService ${context} failed: ${response.status} ${response.statusText}`;
    throw new ExerciseServiceError(errorMessage, response.status, context);
  }

  const text = await response.text();
  if (!text) {
    throw new ExerciseServiceError(`${context}: Empty response`, response.status, context);
  }

  const data = parseJSONSafe<T>(text, `${context} response`);
  if (!data) {
    throw new ExerciseServiceError(`${context}: Failed to parse response`, response.status, context);
  }

  return data;
}

/**
 * Parse exercise JSON fields safely
 */
function parseExercise(exercise: Exercise): ParsedExercise {
  return {
    ...exercise,
    targets: parseJSONSafe<ExerciseTargets>(exercise.targets, 'exercise.targets') || { primary: [] },
    equipment_required: parseJSONSafe<string[]>(exercise.equipment_required, 'exercise.equipment_required') || [],
    assets: parseJSONSafe<{ cover?: string; video?: string }>(exercise.assets_json, 'exercise.assets_json'),
    tags: parseJSONSafe<string[]>(exercise.tags_json, 'exercise.tags_json'),
    metadata: parseJSONSafe<Record<string, unknown>>(exercise.metadata_json, 'exercise.metadata_json')
  };
}

/**
 * Parse multiple exercises
 */
function parseExercises(exercises: Exercise[]): ParsedExercise[] {
  return exercises.map(parseExercise);
}

// ============================================================================
// Service Implementation
// ============================================================================

/**
 * ExerciseServiceV2 Interface
 *
 * All methods return validated data for exercise library operations.
 */
export interface ExerciseServiceV2 {
  getAllExercises(): Promise<ParsedExercise[]>;
  getExerciseById(id: string): Promise<ParsedExercise | null>;
  getExerciseByName(name: string): Promise<ParsedExercise | null>;
  getExercisesByTarget(target: MuscleTarget): Promise<ParsedExercise[]>;
  getExercisesByDifficulty(difficulty: Difficulty): Promise<ParsedExercise[]>;
  getExercisesByEquipment(equipment: string): Promise<ParsedExercise[]>;
  createExercise(exercise: Omit<Exercise, 'id' | 'modified_at' | 'updated_at'>): Promise<ParsedExercise>;
  updateExercise(update: ExerciseUpdate): Promise<ParsedExercise>;
  deleteExercise(id: string): Promise<void>;
  getExerciseStats(): Promise<{ total: number; byType: Record<string, number>; byDifficulty: Record<string, number> }>;
}

/**
 * ExerciseServiceV2 Implementation
 */
class ExerciseServiceV2Impl implements ExerciseServiceV2 {
  /**
   * Get all exercises
   * @returns List of parsed exercises
   */
  async getAllExercises(): Promise<ParsedExercise[]> {
    const url = buildUrl('/exercises');
    const response = await fetch(url, {
      method: 'GET',
      headers: getHeaders({}, false)
    });

    const data = await handleResponse<Exercise[]>(response, 'getAllExercises');
    return parseExercises(data);
  }

  /**
   * Get a single exercise by ID
   * @param id - Exercise ID
   * @returns Parsed exercise or null if not found
   */
  async getExerciseById(id: string): Promise<ParsedExercise | null> {
    const url = buildUrl(`/exercises/${encodeURIComponent(id)}`);
    const response = await fetch(url, {
      method: 'GET',
      headers: getHeaders({}, false)
    });

    if (response.status === 404) {
      return null;
    }

    const data = await handleResponse<Exercise>(response, 'getExerciseById');
    return parseExercise(data);
  }

  /**
   * Get a single exercise by name
   * @param name - Exercise name
   * @returns Parsed exercise or null if not found
   */
  async getExerciseByName(name: string): Promise<ParsedExercise | null> {
    const url = buildUrl(`/exercises/by-name/${encodeURIComponent(name)}`);
    const response = await fetch(url, {
      method: 'GET',
      headers: getHeaders({}, false)
    });

    if (response.status === 404) {
      return null;
    }

    const data = await handleResponse<Exercise>(response, 'getExerciseByName');
    return parseExercise(data);
  }

  /**
   * Get exercises by target muscle
   * @param target - Muscle target
   * @returns List of exercises targeting the muscle
   */
  async getExercisesByTarget(target: MuscleTarget): Promise<ParsedExercise[]> {
    const url = buildUrl(`/exercises/target/${encodeURIComponent(target)}`);
    const response = await fetch(url, {
      method: 'GET',
      headers: getHeaders({}, false)
    });

    const data = await handleResponse<Exercise[]>(response, 'getExercisesByTarget');
    return parseExercises(data);
  }

  /**
   * Get exercises by difficulty level
   * @param difficulty - Difficulty level
   * @returns List of exercises with the difficulty
   */
  async getExercisesByDifficulty(difficulty: Difficulty): Promise<ParsedExercise[]> {
    const url = buildUrl(`/exercises/difficulty/${encodeURIComponent(difficulty)}`);
    const response = await fetch(url, {
      method: 'GET',
      headers: getHeaders({}, false)
    });

    const data = await handleResponse<Exercise[]>(response, 'getExercisesByDifficulty');
    return parseExercises(data);
  }

  /**
   * Get exercises by equipment requirement
   * @param equipment - Equipment name
   * @returns List of exercises requiring the equipment
   */
  async getExercisesByEquipment(equipment: string): Promise<ParsedExercise[]> {
    const url = buildUrl('/exercises/by-equipment');
    const response = await fetch(url, {
      method: 'GET',
      headers: getHeaders({}, false),
      body: JSON.stringify({ equipment })
    });

    const data = await handleResponse<Exercise[]>(response, 'getExercisesByEquipment');
    return parseExercises(data);
  }

  /**
   * Create a new exercise (admin only)
   * @param exercise - Exercise data (without id, timestamps)
   * @returns Created exercise
   */
  async createExercise(exercise: Omit<Exercise, 'id' | 'modified_at' | 'updated_at'>): Promise<ParsedExercise> {
    const url = buildUrl('/exercises');
    const response = await fetch(url, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(exercise)
    });

    const data = await handleResponse<Exercise>(response, 'createExercise');
    return parseExercise(data);
  }

  /**
   * Update an existing exercise (admin only)
   * @param update - Exercise update payload
   * @returns Updated exercise
   */
  async updateExercise(update: ExerciseUpdate): Promise<ParsedExercise> {
    const url = buildUrl(`/exercises/${encodeURIComponent(update.exerciseId)}`);
    const response = await fetch(url, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({
        ...update.data,
        modified_by: update.modifiedBy,
        change_reason: update.changeReason
      })
    });

    const data = await handleResponse<Exercise>(response, 'updateExercise');
    return parseExercise(data);
  }

  /**
   * Delete an exercise (admin only)
   * @param id - Exercise ID to delete
   */
  async deleteExercise(id: string): Promise<void> {
    const url = buildUrl(`/exercises/${encodeURIComponent(id)}`);
    const response = await fetch(url, {
      method: 'DELETE',
      headers: getHeaders({}, false)
    });

    if (!response.ok) {
      throw new ExerciseServiceError(
        `deleteExercise failed: ${response.status} ${response.statusText}`,
        response.status,
        'deleteExercise'
      );
    }
  }

  /**
   * Get exercise statistics
   * @returns Exercise statistics
   */
  async getExerciseStats(): Promise<{
    total: number;
    byType: Record<string, number>;
    byDifficulty: Record<string, number>;
  }> {
    const url = buildUrl('/exercises/stats');
    const response = await fetch(url, {
      method: 'GET',
      headers: getHeaders({}, false)
    });

    return await handleResponse<{
      total: number;
      byType: Record<string, number>;
      byDifficulty: Record<string, number>;
    }>(response, 'getExerciseStats');
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Singleton instance of ExerciseServiceV2
 */
export const ExerciseService = new ExerciseServiceV2Impl();
// TS2484: interface ExerciseServiceV2 is defined in this same file and
// re-exported via services/api/index.ts — no extra export type needed here.
