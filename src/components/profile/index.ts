/**
 * Profile components barrel export
 */

// Container Components
export { ProfileContainer } from './ProfileContainer';
export { LimitationContainer } from './LimitationContainer';
export type { ProfileActions } from './ProfileContainer';
// ProfileContainerProps / LimitationContainerProps are local interfaces NOT exported
// from their respective modules — barrel re-export raises TS2724.

// Form Components
export { BasicInfoForm } from './BasicInfoForm';
export { LoadAnchorsForm } from './LoadAnchorsForm';

// Load Anchor Editor Components
export { AnchorCard } from './AnchorCard';
export { AnchorTypeForm } from './AnchorTypeForm';
