/**
 * Profile components barrel export
 */

// Container Components
export { ProfileContainer } from './ProfileContainer.js';
export { LimitationContainer } from './LimitationContainer.js';
export type { ProfileActions } from './ProfileContainer.js';
// ProfileContainerProps / LimitationContainerProps are local interfaces NOT exported
// from their respective modules — barrel re-export raises TS2724.

// Form Components
export { BasicInfoForm } from './BasicInfoForm.js';
export { LoadAnchorsForm } from './LoadAnchorsForm.js';

// Load Anchor Editor Components
export { LoadAnchorsEditor } from './LoadAnchorsEditor.js';
export { AnchorCard } from './AnchorCard.js';
export { AnchorTypeForm } from './AnchorTypeForm.js';

// Limitation Manager Components
export { LimitationsManager } from './LimitationsManager.js';
export { LimitationCard } from './LimitationCard.js';
export { AddLimitationForm } from './AddLimitationForm.js';
