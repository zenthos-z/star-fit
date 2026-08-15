/**
 * LimitationContainer - Container component for active limitations
 *
 * Implements the render props pattern for managing active limitations.
 * Uses the useProfileV2 hook from the data binding layer.
 *
 * @version 2.0.0
 * @updated 2026-02-10 - Refactored to use useProfileV2 hook
 */

import React, { useCallback, useMemo } from 'react';
import type {
  ActiveLimitation,
  ProfileDynamic,
} from 'shared/contracts';
import { useProfileV2 } from '../../hooks';
import {
  createActiveLimitation,
  filterExpiredLimitations,
} from 'shared/contracts';

// ============================================================================
// Types
// ============================================================================

interface LimitationContainerProps {
  /** User ID to fetch limitations for */
  userId: string;
  /** Render function for limitations */
  renderLimitations: (
    limitations: ActiveLimitation[],
    actions: LimitationActions
  ) => React.ReactNode;
  /** Optional loading renderer */
  renderLoading?: () => React.ReactNode;
  /** Optional error renderer */
  renderError?: (error: Error) => React.ReactNode;
  /** Optional empty state renderer */
  renderEmpty?: () => React.ReactNode;
  /** Whether to auto-filter expired limitations (default: true) */
  autoFilterExpired?: boolean;
}

export interface LimitationActions {
  /** Add a new active limitation */
  addLimitation: (part: string, severity: number, note?: string) => Promise<void>;
  /** Remove an active limitation by body part */
  removeLimitation: (part: string) => Promise<void>;
  /** Remove a specific limitation object */
  removeLimitationById: (index: number) => Promise<void>;
  /** Whether an action is in progress */
  isLoading: boolean;
  /** Error from last action */
  error: Error | null;
  /** Refetch limitations */
  refetch: () => Promise<void>;
}

// ============================================================================
// Container Component
// ============================================================================

/**
 * LimitationContainer
 *
 * Container component that fetches and manages active limitations.
 * Uses render props pattern for maximum UI flexibility.
 * Delegates data management to useProfileV2 hook.
 *
 * @example
 * ```tsx
 * <LimitationContainer
 *   userId="user-123"
 *   renderLimitations={(limitations, actions) => (
 *     <LimitationList
 *       limitations={limitations}
 *       onAdd={actions.addLimitation}
 *       onRemove={actions.removeLimitation}
 *     />
 *   )}
 * />
 * ```
 */
export function LimitationContainer(props: LimitationContainerProps): JSX.Element {
  const {
    userId,
    renderLimitations,
    renderLoading,
    renderError,
    renderEmpty,
    autoFilterExpired = true,
  } = props;

  // Use the data binding layer hook
  const {
    profileDynamic,
    loading,
    error,
    refetch,
    updateDynamic,
  } = useProfileV2(userId);

  /**
   * Add a new active limitation
   */
  const addLimitation = useCallback(
    async (part: string, severity: number, note?: string): Promise<void> => {
      // Validate severity
      if (severity < 1 || severity > 10) {
        throw new Error('Severity must be between 1 and 10');
      }

      // Get current limitations
      const currentLimitations = profileDynamic?.active_limitations ?? [];

      // Create new limitation with auto-calculated expiration
      const newLimitation = createActiveLimitation(part, severity, note);

      // Add to current limitations
      const updatedLimitations = [...currentLimitations, newLimitation];

      // Update via hook
      await updateDynamic({ active_limitations: updatedLimitations });
    },
    [profileDynamic?.active_limitations, updateDynamic]
  );

  /**
   * Remove an active limitation by body part
   */
  const removeLimitation = useCallback(
    async (part: string): Promise<void> => {
      const currentLimitations = profileDynamic?.active_limitations ?? [];

      // Filter out the limitation
      const updatedLimitations = currentLimitations.filter((l) => l.part !== part);

      // Update via hook
      await updateDynamic({ active_limitations: updatedLimitations });
    },
    [profileDynamic?.active_limitations, updateDynamic]
  );

  /**
   * Remove a specific limitation by index
   */
  const removeLimitationById = useCallback(
    async (index: number): Promise<void> => {
      const currentLimitations = profileDynamic?.active_limitations ?? [];

      if (index < 0 || index >= currentLimitations.length) {
        throw new Error(`Invalid limitation index: ${index}`);
      }

      // Remove the limitation at index
      const updatedLimitations = currentLimitations.filter((_, i) => i !== index);

      // Update via hook
      await updateDynamic({ active_limitations: updatedLimitations });
    },
    [profileDynamic?.active_limitations, updateDynamic]
  );

  // Memoize actions object to prevent unnecessary re-renders
  const actions: LimitationActions = useMemo(
    () => ({
      addLimitation,
      removeLimitation,
      removeLimitationById,
      isLoading: loading,
      error,
      refetch,
    }),
    [addLimitation, removeLimitation, removeLimitationById, loading, error, refetch]
  );

  // Extract and filter limitations
  const rawLimitations = profileDynamic?.active_limitations ?? [];
  const filteredLimitations = autoFilterExpired
    ? filterExpiredLimitations(rawLimitations)
    : rawLimitations;

  // Render loading state
  if (loading) {
    return <>{renderLoading?.() ?? <DefaultLoadingRenderer />}</>;
  }

  // Render error state
  if (error) {
    return <>{renderError?.(error) ?? <DefaultErrorRenderer error={error} />}</>;
  }

  // Render empty state
  if (filteredLimitations.length === 0 && !renderEmpty) {
    return <>{renderEmpty?.() ?? <DefaultEmptyRenderer />}</>;
  }

  // Render content
  return <>{renderLimitations(filteredLimitations, actions)}</>;
}

// ============================================================================
// Default Renderers
// ============================================================================

function DefaultLoadingRenderer(): JSX.Element {
  return (
    <div className="flex items-center justify-center p-8">
      <div className="text-center">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent text-star-primary" />
        <p className="mt-4 text-sm text-gray-500">加载限制条件中...</p>
      </div>
    </div>
  );
}

function DefaultErrorRenderer({ error }: { error: Error }): JSX.Element {
  return (
    <div className="flex items-center justify-center p-8">
      <div className="text-center">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h3 className="mt-4 text-lg font-semibold text-gray-900">加载失败</h3>
        <p className="mt-2 text-sm text-gray-500">{error.message}</p>
      </div>
    </div>
  );
}

function DefaultEmptyRenderer(): JSX.Element {
  return (
    <div className="flex items-center justify-center p-8">
      <div className="text-center">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-600">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h3 className="mt-4 text-lg font-semibold text-gray-900">无活跃限制</h3>
        <p className="mt-2 text-sm text-gray-500">当前没有活跃的训练限制</p>
      </div>
    </div>
  );
}
