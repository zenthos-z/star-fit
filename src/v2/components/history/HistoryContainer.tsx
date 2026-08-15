/**
 * HistoryContainer - Container component for history summary
 *
 * Implements the render props pattern for history summary data.
 * Uses the useProfileV2 hook from the data binding layer.
 *
 * @version 2.0.0
 * @updated 2026-02-10 - Refactored to use useProfileV2 hook
 */

import React, { useMemo } from 'react';
import type {
  HistorySummary,
} from 'shared/contracts';
import { useProfileV2 } from '../../hooks';

// ============================================================================
// Types
// ============================================================================

interface HistoryContainerProps {
  /** User ID to fetch history for */
  userId: string;
  /** Render function for history data */
  renderHistory: (
    data: HistorySummary,
    actions: HistoryActions
  ) => React.ReactNode;
  /** Optional loading renderer */
  renderLoading?: () => React.ReactNode;
  /** Optional error renderer */
  renderError?: (error: Error) => React.ReactNode;
  /** Optional empty state renderer */
  renderEmpty?: () => React.ReactNode;
}

export interface HistoryActions {
  /** Refetch history data */
  refetch: () => Promise<void>;
  /** Whether data is being fetched */
  isLoading: boolean;
  /** Error from last operation */
  error: Error | null;
}

// ============================================================================
// Container Component
// ============================================================================

/**
 * HistoryContainer
 *
 * Container component that fetches and manages history summary data.
 * Uses render props pattern for maximum UI flexibility.
 * Delegates data management to useProfileV2 hook.
 *
 * @example
 * ```tsx
 * <HistoryContainer
 *   userId="user-123"
 *   renderHistory={(data, actions) => (
 *     <HistorySummaryView data={data} onRefresh={actions.refetch} />
 *   )}
 * />
 * ```
 */
export function HistoryContainer(props: HistoryContainerProps): JSX.Element {
  const {
    userId,
    renderHistory,
    renderLoading,
    renderError,
    renderEmpty,
  } = props;

  // Use the data binding layer hook
  const {
    historySummary,
    loading,
    error,
    refetch,
  } = useProfileV2(userId);

  // Memoize actions object to prevent unnecessary re-renders
  const actions: HistoryActions = useMemo(
    () => ({
      refetch,
      isLoading: loading,
      error,
    }),
    [refetch, loading, error]
  );

  // Render loading state
  if (loading) {
    return <>{renderLoading?.() ?? <DefaultLoadingRenderer />}</>;
  }

  // Render error state
  if (error) {
    return <>{renderError?.(error) ?? <DefaultErrorRenderer error={error} />}</>;
  }

  // Render empty state
  if (!historySummary || Object.keys(historySummary).length === 0) {
    return <>{renderEmpty?.() ?? <DefaultEmptyRenderer />}</>;
  }

  // Render content
  return <>{renderHistory(historySummary, actions)}</>;
}

// ============================================================================
// Default Renderers
// ============================================================================

function DefaultLoadingRenderer(): JSX.Element {
  return (
    <div className="flex items-center justify-center p-8">
      <div className="text-center">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent text-star-primary" />
        <p className="mt-4 text-sm text-gray-500">加载历史记录中...</p>
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
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-400">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        </div>
        <h3 className="mt-4 text-lg font-semibold text-gray-900">暂无历史记录</h3>
        <p className="mt-2 text-sm text-gray-500">开始训练后，这里将显示您的训练历史摘要</p>
      </div>
    </div>
  );
}
