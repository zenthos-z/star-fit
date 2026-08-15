/**
 * Shared Type Definitions
 * 
 * Centralized location for enums and types shared across the backend application.
 * This avoids circular dependencies and ensures type consistency.
 */

// ============================================================================
// Fitness Levels
// ============================================================================

export const FitnessLevel = {
  BEGINNER: 'beginner',
  INTERMEDIATE: 'intermediate',
  ADVANCED: 'advanced',
  UNKNOWN: 'unknown'
} as const;

export type FitnessLevelType = typeof FitnessLevel[keyof typeof FitnessLevel];

// ============================================================================
// Agent Scenarios
// ============================================================================

export const AgentScenario = {
  CHAT: 'chat',
  PLAN: 'plan',
  SUMMARY: 'summary',
  TUTORIAL: 'tutorial',
  WORKOUT_COMPLETE: 'workout_complete',
  UPDATE_PROFILE: 'update_profile',
  UNKNOWN: 'UNKNOWN'
} as const;

export type AgentScenarioType = typeof AgentScenario[keyof typeof AgentScenario];

// ============================================================================
// UI Hint Types
// ============================================================================

export const UIHintType = {
  PLAN_CARD: 'PLAN_CARD',
  SUMMARY_CARD: 'SUMMARY_CARD',
  SURVEY_CARD: 'SURVEY_CARD',
  DEVIATION_CARD: 'DEVIATION_CARD',
  INSTRUCTION_CARD: 'INSTRUCTION_CARD',
  STRATEGY_CONFIRM: 'STRATEGY_CONFIRM',
  SKELETON: 'SKELETON',
  UNKNOWN: 'UNKNOWN'
} as const;

export type UIHintTypeType = typeof UIHintType[keyof typeof UIHintType];
