/**
 * ProfileContainer - Container component for user profile data
 *
 * Implements the render props pattern for flexible UI implementation.
 * Uses the useProfileV2 hook from the data binding layer.
 *
 * @version 2.0.0
 * @updated 2026-02-10 - Refactored to use useProfileV2 hook
 */

import React, { useMemo } from 'react';
import type {
  ProfileStatic,
  ProfileDynamic,
} from 'shared/contracts';
import { useProfileV2 } from '../../hooks';

// ============================================================================
// Types
// ============================================================================

interface ProfileContainerProps {
  /** User ID to fetch profile for */
  userId: string;
  /** Render function for static profile data */
  renderProfileStatic: (
    data: ProfileStatic,
    actions: ProfileActions
  ) => React.ReactNode;
  /** Optional render function for dynamic profile data */
  renderProfileDynamic?: (
    data: ProfileDynamic,
    actions: ProfileActions
  ) => React.ReactNode;
  /** Optional loading renderer */
  renderLoading?: () => React.ReactNode;
  /** Optional error renderer */
  renderError?: (error: Error) => React.ReactNode;
  /** Optional empty state renderer */
  renderEmpty?: () => React.ReactNode;
}

export interface ProfileActions {
  /** Update static profile data */
  onUpdateStatic: (updates: Partial<ProfileStatic>) => Promise<void>;
  /** Update dynamic profile data */
  onUpdateDynamic: (updates: Partial<ProfileDynamic>) => Promise<void>;
  /** Whether an action is in progress */
  isLoading: boolean;
  /** Error from last action */
  error: Error | null;
  /** Refetch profile data */
  refetch: () => Promise<void>;
}

// ============================================================================
// Container Component
// ============================================================================

/**
 * ProfileContainer
 *
 * Container component that fetches and manages user profile data.
 * Uses render props pattern for maximum UI flexibility.
 * Delegates data management to useProfileV2 hook.
 *
 * @example
 * ```tsx
 * <ProfileContainer
 *   userId="user-123"
 *   renderProfileStatic={(data, actions) => (
 *     <ProfileStaticForm data={data} onUpdate={actions.onUpdateStatic} />
 *   )}
 *   renderLoading={() => <Spinner />}
 *   renderError={(error) => <ErrorMessage error={error} />}
 * />
 * ```
 */
export function ProfileContainer(props: ProfileContainerProps): JSX.Element {
  const {
    userId,
    renderProfileStatic,
    renderProfileDynamic,
    renderLoading,
    renderError,
    renderEmpty,
  } = props;

  // Use the data binding layer hook
  const {
    profile,
    profileStatic,
    profileDynamic,
    loading,
    error,
    refetch,
    updateStatic,
    updateDynamic,
  } = useProfileV2(userId);

  // Memoize actions object to prevent unnecessary re-renders
  const actions: ProfileActions = useMemo(
    () => ({
      onUpdateStatic: updateStatic,
      onUpdateDynamic: updateDynamic,
      isLoading: loading,
      error,
      refetch,
    }),
    [updateStatic, updateDynamic, loading, error, refetch]
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
  if (!profileStatic && !renderEmpty) {
    return <>{renderEmpty?.() ?? <DefaultEmptyRenderer />}</>;
  }

  // Render content
  return (
    <>
      {renderProfileStatic && renderProfileStatic(profileStatic ?? {}, actions)}
      {renderProfileDynamic && profileDynamic && renderProfileDynamic(profileDynamic, actions)}
    </>
  );
}

// ============================================================================
// Default Renderers
// ============================================================================

function DefaultLoadingRenderer(): JSX.Element {
  return (
    <div className="flex items-center justify-center p-8">
      <div className="text-center">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent text-star-primary" />
        <p className="mt-4 text-sm text-gray-500">加载用户画像中...</p>
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
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        </div>
        <h3 className="mt-4 text-lg font-semibold text-gray-900">暂无用户画像</h3>
        <p className="mt-2 text-sm text-gray-500">请先完善您的基础信息</p>
      </div>
    </div>
  );
}
