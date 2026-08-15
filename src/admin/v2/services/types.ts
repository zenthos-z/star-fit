// Common types for Admin V2

export interface Exercise {
  id: string;
  name: string;
  targets: string; // JSON stringified ExerciseTargets ✅
  exercise_type: string;
  content_html: string;
  assets_json: string;
  tags_json?: string;
  equipment_required: string; // JSON
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  updated_at?: number;

  /** @deprecated Use targets instead */
  body_category?: string;
  /** @deprecated Use targets instead */
  muscle_groups?: string;
}

export interface User {
  id: string;
  username?: string | null;
  short_id?: string | null;
  session_count: number;
  device_id: string;
  created_at: number;
  last_active_at?: number;
  display_name?: string;
}

export interface SystemStatus {
  api: {
    status: 'ok' | 'error';
    latency: number;
  };
  ai: {
    status: 'connected' | 'disconnected';
    provider: string;
    latency: number;
  };
  storage: {
    used: number;
    total: number; // Simulated
    percent: number;
  };
}

export interface VideoTask {
  id: string;
  exercise_name: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  created_at: number;
}

// Strict App Exercise Types from ExerciseCardV2
export type AppExerciseType =
  | 'resistance'
  | 'bodyweight'
  | 'assisted'
  | 'isometric'
  | 'cardio'
  | 'outdoor'
  | 'unknown';

export const getExerciseType = (ex: any): AppExerciseType => {
  const rawType = ex.type?.toLowerCase();

  if (['resistance', 'strength'].includes(rawType)) return 'resistance';
  if (rawType === 'bodyweight') return 'bodyweight';
  if (rawType === 'assisted') return 'assisted';
  if (rawType === 'isometric') return 'isometric';
  if (['cardio', 'hiit'].includes(rawType)) return 'cardio';
  if (['outdoor', 'run', 'cycling'].includes(rawType)) return 'outdoor';

  // Heuristic fallbacks based on name if type is missing or unknown
  const name = ex.name?.toLowerCase() || '';
  if (name.includes('run') || name.includes('walk') || name.includes('cycle')) return 'outdoor';
  if (name.includes('plank')) return 'isometric';

  return 'unknown';
};
