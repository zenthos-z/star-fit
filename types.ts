export interface ExerciseSet {
  id: string;
  reps?: number;
  weight?: number;
  duration?: number; // in seconds (Actual recorded duration)
  distance?: number; // in meters (Actual recorded distance)
  targetDuration?: number; // [NEW] Target duration in seconds
  targetDistance?: number; // [NEW] Target distance in meters
  // [NEW] Flexible Intensity Parameters (for Cardio, Rowing, etc.)
  intensityParams?: {
    incline?: number;     // For Treadmill
    pace?: string;        // For Running/Rowing
    resistanceLevel?: number; // For Bike/Elliptical
    rpm?: number;         // For Bike
    strokeRate?: number;  // For Rowing
    power?: number;       // For Bike (Watts)
  };
  /**
   * @deprecated Use `status` instead. Kept for backward compatibility.
   * Will be removed in v3.0.
   */
  completed?: boolean;
  /**
   * Status of the set following protocol.ts ExerciseAction.sets specification.
   * This is the authoritative field for set status.
   */
  status?: 'UNKNOWN' | 'PLANNED' | 'ACTIVE' | 'COMPLETED' | 'SKIPPED';
  rpe?: number; // Actual RPE logged
  restEndTime?: number; // 休息结束时间戳（每个组独立）
}

export type ExerciseType = 'resistance' | 'cardio' | 'bodyweight' | 'isometric' | 'assisted' | 'unilateral' | 'weight_only' | 'reps_only' | 'outdoor';

/**
 * Standard metadata fields for exercise cards.
 * These fields should be used consistently across all exercise types.
 */
export interface StandardExerciseMetadata {
  // Cardio modes
  cardioMode?: 'TIME_COUNTDOWN' | 'DISTANCE_TARGET' | 'FREE_RUN';
  cardioSubtype?: string;

  // Target parameters (standardized naming)
  targetDurationSec?: number;   // Target duration in seconds
  targetDistanceMeters?: number; // Target distance in meters
  targetHeartRateZone?: string;  // Target heart rate zone (e.g., "2", "3")

  // Display settings
  name?: string;                 // Display name for the exercise
  targetRpe?: number;            // Target RPE for the exercise
}

export interface Exercise {
  id: string;               // NanoID format (14 chars), primary identifier
  libraryId: string;        // @deprecated Use `id` instead. Kept for backward compatibility.
  name: string;
  notes?: string;
  sets: ExerciseSet[];
  type: ExerciseType;
  targetRpe?: number;
  unilateral?: boolean;
  referenceBodyweight?: number; // For bodyweight/assisted volume calc
  primaryMuscles?: string[]; // [NEW] For classification and visuals
  equipment?: string;        // [NEW] For equipment requirements
  bodyCategory?: string;     // [NEW] For backend syncing
  metadata?: Record<string, any>; // [NEW] Flexible Metadata (e.g., cardio settings)
  // [NEW] UI Metadata for flexible rendering
  uiHint?: {
    cardType?: 'standard' | 'minimal' | 'detailed' | 'chart' | string;
    themeColor?: string;
    showTutorialInline?: boolean;
    actionButtons?: Array<{ label: string; action: string }>;
  };
}

export interface Session {
  id: string;
  startTime: number; // Timestamp
  endTime?: number;
  pausedDuration: number;
  pauseStartTime?: number; // 记录暂停开始的时间戳
  status: 'idle' | 'active' | 'paused' | 'finished';
  exercises: Exercise[];
}

export interface PlanGenerationRequest {
  goal: string;
  durationMinutes: number;
  equipment: string;
}

export enum AppRoute {
  HOME = 'HOME',
  AI_OVERLAY = 'AI_OVERLAY',
  SETTLEMENT = 'SETTLEMENT',
  HISTORY = 'HISTORY',
  SETTINGS = 'SETTINGS',
}

// --- Agent System Types ---

// Expanded model IDs to support Image models
export type AiModelId = 
  | 'gemini-3-pro-preview' 
  | 'gemini-3-pro-image-preview'
  | 'gemini-3-flash-preview'
  | 'gpt-4o-mini'
  | 'gpt-4o';

export enum AiScenario {
  CHAT = 'chat',         // General Conversation
  PLAN = 'plan',         // Workout Generation
  CARD = 'card',         // Summary/Insight Generation (High Quality)
  CALC = 'calc',         // RPE/Classification (Fast/Background)
  IMAGE = 'image',       // Visual Generation
}

export interface AgentContext {
  // Layer 1: Split System Instructions per Scenario
  systemPrompts: Record<AiScenario, string>; 
  strategy: string;         // Layer 2: Personalized Strategy (Monthly update)
  historySummary: string;   // Layer 3: Compressed History (Last 3 sessions)
  userMemory: string;       // Layer 4: User Profile/Memory (AI managed)
}

export interface AiConfig {
  models: Record<AiScenario, AiModelId>; // Mapping scenarios to models
  context: AgentContext;                 // The 4-layer context
}