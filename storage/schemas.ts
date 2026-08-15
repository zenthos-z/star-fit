export type WorkoutDraft = {
  id: string;
  date: string;
  items: any[];
  lastUpdatedAt: number;
};

export type SessionLite = {
  id: string;
  startTime: number;
  endTime?: number;
  status?: 'idle' | 'active' | 'paused' | 'finished';
  exercises: any[];
  meta?: Record<string, any>;
};

export type UserPrefs = {
  theme?: string;
  unit?: string;
  lang?: string;
  templateKey?: string;
};

export type TutorialCache = {
  key: string;
  markdown: string;
  source: string;
  cachedAt: number;
  expiresAt: number;
};

export interface ExerciseLibraryMeta {
  version: number;
  lastSyncTime: number;
  hash: string;
  count: number;
}

export interface Exercise {
  id: string;
  name: string;
  exercise_type: 'resistance' | 'unilateral' | 'bodyweight' | 'assisted' | 'isometric' | 'cardio' | 'flexibility';
  targets: {
    primary: string[];
    secondary?: string[];
  };
  equipment_required?: string[];
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  content_html?: string;
  assets_json?: string;
  tags_json?: string;
  modified_at?: number;
  updated_at?: number;
  // Legacy fields - for compatibility
  body_category?: string;
  muscle_groups?: {
    primary?: string[];
    secondary?: string[];
    stabilizers?: string[];
  };
}

export type ExerciseLibraryCache = {
  exercises: Exercise[];
  meta: ExerciseLibraryMeta;
};

// Login and Authentication Types
export type ServerHistoryEntry = {
  url: string;
  lastConnected: number;
  successCount: number;
  latency?: number;
};

export type LoginCredentials = {
  userId: string;
  serverUrl: string;
  lastLogin: number;
};

export const Keys = {
  draft: (date: string) => `workout_draft:${date}`,
  prefs: (profileId: string) => `prefs:${profileId || "anon"}`,
  tutorial: (name: string, lang: string) => `tutorial:${name}:${lang}`,
  history: "starfit_history",
  aiConfig: "starfit_ai_config",
  deviceId: "starfit_device_id",
  historyForDevice: (deviceId: string) => `starfit_history:${deviceId}`,
  sessionActive: "starfit_session_active",
  chatDraft: (sessionId: string) => `chat_draft:${sessionId}`,
  pendingSummary: "starfit_pending_summary",
  nextPlan: "starfit_next_plan",
  exerciseLibrary: "starfit_exercise_library",
  exerciseLibraryMeta: "starfit_exercise_library_meta",
  // Login and Authentication
  userId: "starfit_user_id",
  serverUrl: "starfit_server_url",
  serverHistory: "starfit_server_history",
  // Chat Thread Management
  chatThreadList: (sessionId: string) => `chat_thread_list:${sessionId}`,
  chatMessages: (threadId: string) => `chat_messages:${threadId}`
};
