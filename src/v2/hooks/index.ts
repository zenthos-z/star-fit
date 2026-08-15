/**
 * V2 Hooks - Data Binding Layer
 *
 * This module exports all V2 React hooks for data management.
 * All hooks follow the Starfit MAS development conventions:
 * - Type-safe contracts from shared/contracts
 * - WebSocket integration for real-time updates
 * - Data caching to avoid unnecessary refetches
 * - Comprehensive error handling
 *
 * @version 2.0.0
 */

// Profile management hooks
export {
  useProfileV2,
  type UseProfileV2Result
} from './useProfileV2';

// Load anchors management hooks
export {
  useLoadAnchors,
  type UseLoadAnchorsResult
} from './useLoadAnchors';

// Exercise library hooks
export {
  useExercises,
  type UseExercisesResult
} from './useExercises';

// Re-export existing hooks for backward compatibility
export { useAICoach } from './useAICoach';
export type { ChatMessage } from './useAICoach';
export { useAttachments } from './useAttachments';
export { useGeolocation } from './useGeolocation';
export { useLongPress } from './useLongPress';
