/**
 * History components barrel export
 */

export { HistoryContainer } from './HistoryContainer.js';
export type { HistoryActions } from './HistoryContainer.js';
// HistoryContainerProps is defined as a local interface in HistoryContainer.tsx,
// NOT exported — it's not a public type. The barrel re-export causes TS2724.
// Consumers that need the props type should import from the component directly.
