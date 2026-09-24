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

// --- AI Suggestion Cache（动作建议缓存） ---

/**
 * 缓存条目 = 后端 ExerciseSuggestion（shared/contracts 契约形状，零转换）。
 * 键 = `${normalized_type}:${name}`，不含 RPE —— 换 RPE 由前端
 * deriveSuggestion 确定性导出（离线全档可用）。
 */
export type SuggestionCacheEntry = {
  exercise_name: string;
  exercise_type: string;
  baseline_rpe: number;
  values: Record<string, number>;
  profile: {
    data_basis: string;
    est_1rm?: number;
    anchor_confidence?: number;
    modifiers?: Record<string, number>;
  } & Record<string, unknown>;
  adjustment?: {
    exercise_name: string;
    actions: Array<{ field: string; mode: string; value: number }>;
    reason: string;
    safety_note?: string;
  };
  source: 'formula' | 'hybrid';
  generated_at: number;
  context_fingerprint: string;
};

export interface SuggestionCacheMeta {
  version: number;
  lastSyncTime: number;
  /** 服务端 context_fingerprint（goal/伤病/锚点变化即失效） */
  contextFingerprint?: string;
  /** 生成时的训练目标（本地 derive 的 reps 区间用） */
  goal?: string;
  count: number;
  /** 训练结束/登录后被标脏；在线时后台刷新，离线仍可读 */
  stale?: boolean;
}

export type SuggestionCache = {
  entries: Record<string, SuggestionCacheEntry>;
  meta: SuggestionCacheMeta;
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
  dayPlan: "starfit_day_plan:", // + yyyy-mm-dd（按天存储的训练计划）
  exerciseLibrary: "starfit_exercise_library",
  exerciseLibraryMeta: "starfit_exercise_library_meta",
  suggestionCache: "starfit_suggestion_cache",
  // Login and Authentication
  userId: "starfit_user_id",
  serverUrl: "starfit_server_url",
  serverHistory: "starfit_server_history",
  // Chat Thread Management
  chatThreadList: (sessionId: string) => `chat_thread_list:${sessionId}`,
  chatMessages: (threadId: string) => `chat_messages:${threadId}`
};
