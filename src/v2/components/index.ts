/**
 * V2 Components barrel export
 *
 * Central export point for all V2 components organized by domain.
 *
 * @version 2.0.0
 */

// Profile Components
export {
  ProfileContainer,
  LimitationContainer,
  BasicInfoForm,
  LoadAnchorsForm,
  LoadAnchorsEditor,
  AnchorCard,
  AnchorTypeForm,
  LimitationsManager,
  LimitationCard,
  AddLimitationForm,
} from './profile/index.js';
export type {
  ProfileActions,
  // ProfileContainerProps / LimitationContainerProps / LimitationActions are
  // NOT exported from their source modules — skip barrel re-export (TS2724).
} from './profile/index.js';

// History Components
export { HistoryContainer } from './history/index.js';
export type {
  HistoryActions,
  // HistoryContainerProps is NOT exported from HistoryContainer.tsx (local interface).
} from './history/index.js';

// Execution Components
export { ExerciseRenderer } from './execution/ExerciseRenderer.js';
export { default as SettlementV2 } from './settlement/SettlementV2.js';
