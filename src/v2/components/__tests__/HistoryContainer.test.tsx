/**
 * HistoryContainer test suite
 *
 * Tests for the HistoryContainer component using React Testing Library
 *
 * @version 2.0.0
 * @updated 2026-02-10 - Updated for hook-based implementation
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { HistoryContainer } from '../history/HistoryContainer';
import type { HistorySummary } from 'shared/contracts';

// Mock the hooks module
jest.mock('@/v2/hooks', () => ({
  useProfileV2: jest.fn(),
}));

const mockUseProfileV2 = require('@/v2/hooks').useProfileV2;

// Helper to create mock history data
const createMockHistorySummary = (): HistorySummary => ({
  last_pattern: {
    sequence: 'A',
    date: new Date().toISOString(),
    exercises: ['bench_press', 'squat', 'deadlift'],
  },
  trends: {
    rpe_trend: 'stable',
    volume_trend: 'increasing',
    recent_avg_rpe: 7.5,
    fatigue_level: 30,
  },
  recent_summary: 'Training has been consistent with good progress on compound lifts.',
  week_number: 42,
  key_metrics: {
    total_sessions: 25,
    personal_records: 5,
    injury_count: 1,
  },
});

describe('HistoryContainer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Data fetching', () => {
    it('should fetch and render history data on mount', async () => {
      const mockHistory = createMockHistorySummary();

      mockUseProfileV2.mockReturnValue({
        profile: null,
        profileStatic: null,
        profileDynamic: null,
        historySummary: mockHistory,
        loading: false,
        error: null,
        refetch: jest.fn().mockResolvedValue(undefined),
        updateStatic: jest.fn().mockResolvedValue(undefined),
        updateDynamic: jest.fn().mockResolvedValue(undefined),
      });

      const renderHistory = jest.fn().mockReturnValue(<div>History Summary</div>);

      render(
        <HistoryContainer
          userId="user-123"
          renderHistory={renderHistory}
        />
      );

      // Wait for data to load
      await waitFor(() => {
        expect(renderHistory).toHaveBeenCalled();
      });

      // Verify the data was passed correctly
      const callArgs = renderHistory.mock.calls[0];
      expect(callArgs[0]).toEqual(mockHistory);
      expect(callArgs[1]).toHaveProperty('refetch');
      expect(callArgs[1]).toHaveProperty('isLoading');
      expect(callArgs[1]).toHaveProperty('error');
    });

    it('should show loading state while fetching', async () => {
      mockUseProfileV2.mockReturnValue({
        profile: null,
        profileStatic: null,
        profileDynamic: null,
        historySummary: null,
        loading: true,
        error: null,
        refetch: jest.fn().mockResolvedValue(undefined),
        updateStatic: jest.fn().mockResolvedValue(undefined),
        updateDynamic: jest.fn().mockResolvedValue(undefined),
      });

      const renderHistory = jest.fn().mockReturnValue(<div>History Summary</div>);
      const renderLoading = jest.fn().mockReturnValue(<div>Loading...</div>);

      render(
        <HistoryContainer
          userId="user-123"
          renderHistory={renderHistory}
          renderLoading={renderLoading}
        />
      );

      expect(renderLoading).toHaveBeenCalled();
      expect(renderHistory).not.toHaveBeenCalled();
    });

    it('should show error state on fetch failure', async () => {
      const error = new Error('Network error');

      mockUseProfileV2.mockReturnValue({
        profile: null,
        profileStatic: null,
        profileDynamic: null,
        historySummary: null,
        loading: false,
        error,
        refetch: jest.fn().mockResolvedValue(undefined),
        updateStatic: jest.fn().mockResolvedValue(undefined),
        updateDynamic: jest.fn().mockResolvedValue(undefined),
      });

      const renderHistory = jest.fn().mockReturnValue(<div>History Summary</div>);
      const renderError = jest.fn().mockReturnValue(<div>Error occurred</div>);

      render(
        <HistoryContainer
          userId="user-123"
          renderHistory={renderHistory}
          renderError={renderError}
        />
      );

      expect(renderError).toHaveBeenCalledWith(error);
      expect(renderHistory).not.toHaveBeenCalled();
    });

    it('should handle missing history data gracefully', async () => {
      mockUseProfileV2.mockReturnValue({
        profile: null,
        profileStatic: null,
        profileDynamic: null,
        historySummary: {},
        loading: false,
        error: null,
        refetch: jest.fn().mockResolvedValue(undefined),
        updateStatic: jest.fn().mockResolvedValue(undefined),
        updateDynamic: jest.fn().mockResolvedValue(undefined),
      });

      const renderHistory = jest.fn().mockReturnValue(<div>History Summary</div>);
      const renderEmpty = jest.fn().mockReturnValue(<div>Empty</div>);

      render(
        <HistoryContainer
          userId="user-123"
          renderHistory={renderHistory}
          renderEmpty={renderEmpty}
        />
      );

      expect(renderEmpty).toHaveBeenCalled();
      expect(renderHistory).not.toHaveBeenCalled();
    });

    it('should handle null historySummary field', async () => {
      mockUseProfileV2.mockReturnValue({
        profile: null,
        profileStatic: null,
        profileDynamic: null,
        historySummary: null,
        loading: false,
        error: null,
        refetch: jest.fn().mockResolvedValue(undefined),
        updateStatic: jest.fn().mockResolvedValue(undefined),
        updateDynamic: jest.fn().mockResolvedValue(undefined),
      });

      const renderHistory = jest.fn().mockReturnValue(<div>History Summary</div>);
      const renderEmpty = jest.fn().mockReturnValue(<div>Empty</div>);

      render(
        <HistoryContainer
          userId="user-123"
          renderHistory={renderHistory}
          renderEmpty={renderEmpty}
        />
      );

      expect(renderEmpty).toHaveBeenCalled();
      expect(renderHistory).not.toHaveBeenCalled();
    });
  });

  describe('Actions', () => {
    it('should provide refetch action', async () => {
      const mockHistory = createMockHistorySummary();
      const mockRefetch = jest.fn().mockResolvedValue(undefined);

      mockUseProfileV2.mockReturnValue({
        profile: null,
        profileStatic: null,
        profileDynamic: null,
        historySummary: mockHistory,
        loading: false,
        error: null,
        refetch: mockRefetch,
        updateStatic: jest.fn().mockResolvedValue(undefined),
        updateDynamic: jest.fn().mockResolvedValue(undefined),
      });

      let capturedActions: any;

      const renderHistory = jest.fn().mockImplementation((data, actions) => {
        capturedActions = actions;
        return <div>History Summary</div>;
      });

      render(
        <HistoryContainer
          userId="user-123"
          renderHistory={renderHistory}
        />
      );

      await waitFor(() => {
        expect(capturedActions).toBeDefined();
      });

      // Verify refetch action exists
      expect(typeof capturedActions.refetch).toBe('function');

      // Trigger refetch
      await capturedActions.refetch();

      // Verify the hook was called
      expect(mockRefetch).toHaveBeenCalled();
    });

    it('should update isLoading state during refetch', async () => {
      const mockHistory = createMockHistorySummary();

      mockUseProfileV2.mockReturnValue({
        profile: null,
        profileStatic: null,
        profileDynamic: null,
        historySummary: mockHistory,
        loading: true,
        error: null,
        refetch: jest.fn().mockResolvedValue(undefined),
        updateStatic: jest.fn().mockResolvedValue(undefined),
        updateDynamic: jest.fn().mockResolvedValue(undefined),
      });

      let capturedActions: any;

      const renderHistory = jest.fn().mockImplementation((data, actions) => {
        capturedActions = actions;
        return <div>History Summary</div>;
      });

      render(
        <HistoryContainer
          userId="user-123"
          renderHistory={renderHistory}
        />
      );

      await waitFor(() => {
        expect(capturedActions).toBeDefined();
      });

      // Check loading state
      expect(capturedActions.isLoading).toBe(true);
    });
  });

  describe('Error handling', () => {
    it('should propagate error state from hook', async () => {
      const error = new Error('Network error');

      mockUseProfileV2.mockReturnValue({
        profile: null,
        profileStatic: null,
        profileDynamic: null,
        historySummary: null,
        loading: false,
        error,
        refetch: jest.fn().mockResolvedValue(undefined),
        updateStatic: jest.fn().mockResolvedValue(undefined),
        updateDynamic: jest.fn().mockResolvedValue(undefined),
      });

      const renderHistory = jest.fn().mockReturnValue(<div>History Summary</div>);
      const renderError = jest.fn().mockReturnValue(<div>Error occurred</div>);

      render(
        <HistoryContainer
          userId="user-123"
          renderHistory={renderHistory}
          renderError={renderError}
        />
      );

      expect(renderError).toHaveBeenCalledWith(error);
    });
  });

  describe('Default renderers', () => {
    it('should use default loading renderer when none provided', () => {
      mockUseProfileV2.mockReturnValue({
        profile: null,
        profileStatic: null,
        profileDynamic: null,
        historySummary: null,
        loading: true,
        error: null,
        refetch: jest.fn().mockResolvedValue(undefined),
        updateStatic: jest.fn().mockResolvedValue(undefined),
        updateDynamic: jest.fn().mockResolvedValue(undefined),
      });

      render(
        <HistoryContainer
          userId="user-123"
          renderHistory={() => <div>History</div>}
        />
      );

      expect(screen.getByText(/加载历史记录中/)).toBeInTheDocument();
    });

    it('should use default error renderer when none provided', () => {
      const error = new Error('Test error');

      mockUseProfileV2.mockReturnValue({
        profile: null,
        profileStatic: null,
        profileDynamic: null,
        historySummary: null,
        loading: false,
        error,
        refetch: jest.fn().mockResolvedValue(undefined),
        updateStatic: jest.fn().mockResolvedValue(undefined),
        updateDynamic: jest.fn().mockResolvedValue(undefined),
      });

      render(
        <HistoryContainer
          userId="user-123"
          renderHistory={() => <div>History</div>}
        />
      );

      expect(screen.getByText(/加载失败/)).toBeInTheDocument();
      expect(screen.getByText(/Test error/)).toBeInTheDocument();
    });

    it('should use default empty renderer when none provided', () => {
      mockUseProfileV2.mockReturnValue({
        profile: null,
        profileStatic: null,
        profileDynamic: null,
        historySummary: null,
        loading: false,
        error: null,
        refetch: jest.fn().mockResolvedValue(undefined),
        updateStatic: jest.fn().mockResolvedValue(undefined),
        updateDynamic: jest.fn().mockResolvedValue(undefined),
      });

      render(
        <HistoryContainer
          userId="user-123"
          renderHistory={() => <div>History</div>}
        />
      );

      expect(screen.getByText(/暂无历史记录/)).toBeInTheDocument();
    });
  });
});
