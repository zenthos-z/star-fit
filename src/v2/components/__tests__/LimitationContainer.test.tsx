/**
 * LimitationContainer test suite
 *
 * Tests for the LimitationContainer component using React Testing Library
 *
 * @version 2.0.0
 * @updated 2026-02-10 - Updated for hook-based implementation
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { LimitationContainer } from '../profile/LimitationContainer';
import type { ProfileDynamic, ActiveLimitation } from 'shared/contracts';
import { createActiveLimitation } from 'shared/contracts';

// Mock the hooks module
jest.mock('@/v2/hooks', () => ({
  useProfileV2: jest.fn(),
}));

const mockUseProfileV2 = require('@/v2/hooks').useProfileV2;

// Helper to create mock limitations
const createMockLimitations = (): ActiveLimitation[] => [
  createActiveLimitation('left_shoulder', 5, 'Rotator cuff strain'),
  createActiveLimitation('lower_back', 3, 'Minor discomfort'),
];

describe('LimitationContainer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Data fetching', () => {
    it('should fetch and render limitations on mount', async () => {
      const mockLimitations = createMockLimitations();

      mockUseProfileV2.mockReturnValue({
        profile: null,
        profileStatic: null,
        profileDynamic: {
          active_limitations: mockLimitations,
        } as ProfileDynamic,
        historySummary: null,
        loading: false,
        error: null,
        refetch: jest.fn().mockResolvedValue(undefined),
        updateStatic: jest.fn().mockResolvedValue(undefined),
        updateDynamic: jest.fn().mockResolvedValue(undefined),
      });

      const renderLimitations = jest.fn().mockReturnValue(<div>Limitations List</div>);

      render(
        <LimitationContainer
          userId="user-123"
          renderLimitations={renderLimitations}
        />
      );

      // Wait for data to load
      await waitFor(() => {
        expect(renderLimitations).toHaveBeenCalled();
      });

      // Verify the data was passed correctly
      const callArgs = renderLimitations.mock.calls[0];
      expect(callArgs[0]).toEqual(mockLimitations);
      expect(callArgs[1]).toHaveProperty('addLimitation');
      expect(callArgs[1]).toHaveProperty('removeLimitation');
      expect(callArgs[1]).toHaveProperty('removeLimitationById');
      expect(callArgs[1]).toHaveProperty('refetch');
    });

    it('should auto-filter expired limitations', async () => {
      const now = new Date();
      const expiredLimitation: ActiveLimitation = {
        part: 'right_knee',
        severity: 4,
        expire_at: new Date(now.getTime() - 100000).toISOString(), // Expired
        logged_at: new Date(now.getTime() - 1000000).toISOString(),
        auto_heal: true,
      };

      const validLimitation = createActiveLimitation('left_shoulder', 5);

      mockUseProfileV2.mockReturnValue({
        profile: null,
        profileStatic: null,
        profileDynamic: {
          active_limitations: [expiredLimitation, validLimitation],
        } as ProfileDynamic,
        historySummary: null,
        loading: false,
        error: null,
        refetch: jest.fn().mockResolvedValue(undefined),
        updateStatic: jest.fn().mockResolvedValue(undefined),
        updateDynamic: jest.fn().mockResolvedValue(undefined),
      });

      const renderLimitations = jest.fn().mockReturnValue(<div>Limitations List</div>);

      render(
        <LimitationContainer
          userId="user-123"
          renderLimitations={renderLimitations}
          autoFilterExpired={true}
        />
      );

      await waitFor(() => {
        expect(renderLimitations).toHaveBeenCalled();
      });

      const callArgs = renderLimitations.mock.calls[0];
      // Should only have the valid limitation
      expect(callArgs[0]).toHaveLength(1);
      expect(callArgs[0][0].part).toBe('left_shoulder');
    });

    it('should not filter expired limitations when autoFilterExpired is false', async () => {
      const now = new Date();
      const expiredLimitation: ActiveLimitation = {
        part: 'right_knee',
        severity: 4,
        expire_at: new Date(now.getTime() - 100000).toISOString(), // Expired
        logged_at: new Date(now.getTime() - 1000000).toISOString(),
        auto_heal: true,
      };

      const validLimitation = createActiveLimitation('left_shoulder', 5);

      mockUseProfileV2.mockReturnValue({
        profile: null,
        profileStatic: null,
        profileDynamic: {
          active_limitations: [expiredLimitation, validLimitation],
        } as ProfileDynamic,
        historySummary: null,
        loading: false,
        error: null,
        refetch: jest.fn().mockResolvedValue(undefined),
        updateStatic: jest.fn().mockResolvedValue(undefined),
        updateDynamic: jest.fn().mockResolvedValue(undefined),
      });

      const renderLimitations = jest.fn().mockReturnValue(<div>Limitations List</div>);

      render(
        <LimitationContainer
          userId="user-123"
          renderLimitations={renderLimitations}
          autoFilterExpired={false}
        />
      );

      await waitFor(() => {
        expect(renderLimitations).toHaveBeenCalled();
      });

      const callArgs = renderLimitations.mock.calls[0];
      // Should have both limitations
      expect(callArgs[0]).toHaveLength(2);
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

      const renderLimitations = jest.fn().mockReturnValue(<div>Limitations List</div>);
      const renderLoading = jest.fn().mockReturnValue(<div>Loading...</div>);

      render(
        <LimitationContainer
          userId="user-123"
          renderLimitations={renderLimitations}
          renderLoading={renderLoading}
        />
      );

      expect(renderLoading).toHaveBeenCalled();
      expect(renderLimitations).not.toHaveBeenCalled();
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

      const renderLimitations = jest.fn().mockReturnValue(<div>Limitations List</div>);
      const renderError = jest.fn().mockReturnValue(<div>Error occurred</div>);

      render(
        <LimitationContainer
          userId="user-123"
          renderLimitations={renderLimitations}
          renderError={renderError}
        />
      );

      expect(renderError).toHaveBeenCalledWith(error);
      expect(renderLimitations).not.toHaveBeenCalled();
    });

    it('should show empty state when no limitations', async () => {
      mockUseProfileV2.mockReturnValue({
        profile: null,
        profileStatic: null,
        profileDynamic: {
          active_limitations: [],
        } as ProfileDynamic,
        historySummary: null,
        loading: false,
        error: null,
        refetch: jest.fn().mockResolvedValue(undefined),
        updateStatic: jest.fn().mockResolvedValue(undefined),
        updateDynamic: jest.fn().mockResolvedValue(undefined),
      });

      const renderLimitations = jest.fn().mockReturnValue(<div>Limitations List</div>);
      const renderEmpty = jest.fn().mockReturnValue(<div>Empty</div>);

      render(
        <LimitationContainer
          userId="user-123"
          renderLimitations={renderLimitations}
          renderEmpty={renderEmpty}
        />
      );

      expect(renderEmpty).toHaveBeenCalled();
      expect(renderLimitations).not.toHaveBeenCalled();
    });
  });

  describe('Actions', () => {
    it('should add new limitation', async () => {
      const mockLimitations = createMockLimitations();
      const mockUpdateDynamic = jest.fn().mockResolvedValue(undefined);

      mockUseProfileV2.mockReturnValue({
        profile: null,
        profileStatic: null,
        profileDynamic: {
          active_limitations: mockLimitations,
        } as ProfileDynamic,
        historySummary: null,
        loading: false,
        error: null,
        refetch: jest.fn().mockResolvedValue(undefined),
        updateStatic: jest.fn().mockResolvedValue(undefined),
        updateDynamic: mockUpdateDynamic,
      });

      let capturedActions: any;

      const renderLimitations = jest.fn().mockImplementation((data, actions) => {
        capturedActions = actions;
        return <div>Limitations List</div>;
      });

      render(
        <LimitationContainer
          userId="user-123"
          renderLimitations={renderLimitations}
        />
      );

      await waitFor(() => {
        expect(capturedActions).toBeDefined();
      });

      // Add new limitation
      await capturedActions.addLimitation('right_knee', 6, 'Pain during squats');

      // Verify updateDynamic was called
      expect(mockUpdateDynamic).toHaveBeenCalledWith({
        active_limitations: expect.arrayContaining([
          expect.objectContaining({
            part: 'right_knee',
            severity: 6,
          }),
        ]),
      });
    });

    it('should validate severity range', async () => {
      const mockLimitations = createMockLimitations();

      mockUseProfileV2.mockReturnValue({
        profile: null,
        profileStatic: null,
        profileDynamic: {
          active_limitations: mockLimitations,
        } as ProfileDynamic,
        historySummary: null,
        loading: false,
        error: null,
        refetch: jest.fn().mockResolvedValue(undefined),
        updateStatic: jest.fn().mockResolvedValue(undefined),
        updateDynamic: jest.fn().mockResolvedValue(undefined),
      });

      let capturedActions: any;

      const renderLimitations = jest.fn().mockImplementation((data, actions) => {
        capturedActions = actions;
        return <div>Limitations List</div>;
      });

      render(
        <LimitationContainer
          userId="user-123"
          renderLimitations={renderLimitations}
        />
      );

      await waitFor(() => {
        expect(capturedActions).toBeDefined();
      });

      // Try to add limitation with invalid severity
      await expect(capturedActions.addLimitation('right_knee', 11)).rejects.toThrow('Severity must be between 1 and 10');
    });

    it('should remove limitation by body part', async () => {
      const mockLimitations = createMockLimitations();
      const mockUpdateDynamic = jest.fn().mockResolvedValue(undefined);

      mockUseProfileV2.mockReturnValue({
        profile: null,
        profileStatic: null,
        profileDynamic: {
          active_limitations: mockLimitations,
        } as ProfileDynamic,
        historySummary: null,
        loading: false,
        error: null,
        refetch: jest.fn().mockResolvedValue(undefined),
        updateStatic: jest.fn().mockResolvedValue(undefined),
        updateDynamic: mockUpdateDynamic,
      });

      let capturedActions: any;

      const renderLimitations = jest.fn().mockImplementation((data, actions) => {
        capturedActions = actions;
        return <div>Limitations List</div>;
      });

      render(
        <LimitationContainer
          userId="user-123"
          renderLimitations={renderLimitations}
        />
      );

      await waitFor(() => {
        expect(capturedActions).toBeDefined();
      });

      // Remove limitation
      await capturedActions.removeLimitation('left_shoulder');

      // Verify updateDynamic was called without the removed limitation
      expect(mockUpdateDynamic).toHaveBeenCalledWith({
        active_limitations: expect.not.arrayContaining([
          expect.objectContaining({
            part: 'left_shoulder',
          }),
        ]),
      });
    });

    it('should remove limitation by index', async () => {
      const mockLimitations = createMockLimitations();
      const mockUpdateDynamic = jest.fn().mockResolvedValue(undefined);

      mockUseProfileV2.mockReturnValue({
        profile: null,
        profileStatic: null,
        profileDynamic: {
          active_limitations: mockLimitations,
        } as ProfileDynamic,
        historySummary: null,
        loading: false,
        error: null,
        refetch: jest.fn().mockResolvedValue(undefined),
        updateStatic: jest.fn().mockResolvedValue(undefined),
        updateDynamic: mockUpdateDynamic,
      });

      let capturedActions: any;

      const renderLimitations = jest.fn().mockImplementation((data, actions) => {
        capturedActions = actions;
        return <div>Limitations List</div>;
      });

      render(
        <LimitationContainer
          userId="user-123"
          renderLimitations={renderLimitations}
        />
      );

      await waitFor(() => {
        expect(capturedActions).toBeDefined();
      });

      // Remove first limitation by index
      await capturedActions.removeLimitationById(0);

      // Verify updateDynamic was called
      expect(mockUpdateDynamic).toHaveBeenCalled();
    });

    it('should handle invalid index error', async () => {
      const mockLimitations = createMockLimitations();

      mockUseProfileV2.mockReturnValue({
        profile: null,
        profileStatic: null,
        profileDynamic: {
          active_limitations: mockLimitations,
        } as ProfileDynamic,
        historySummary: null,
        loading: false,
        error: null,
        refetch: jest.fn().mockResolvedValue(undefined),
        updateStatic: jest.fn().mockResolvedValue(undefined),
        updateDynamic: jest.fn().mockResolvedValue(undefined),
      });

      let capturedActions: any;

      const renderLimitations = jest.fn().mockImplementation((data, actions) => {
        capturedActions = actions;
        return <div>Limitations List</div>;
      });

      render(
        <LimitationContainer
          userId="user-123"
          renderLimitations={renderLimitations}
        />
      );

      await waitFor(() => {
        expect(capturedActions).toBeDefined();
      });

      // Try to remove with invalid index
      await expect(capturedActions.removeLimitationById(10)).rejects.toThrow('Invalid limitation index');
    });

    it('should refetch data when refetch is called', async () => {
      const mockLimitations = createMockLimitations();
      const mockRefetch = jest.fn().mockResolvedValue(undefined);

      mockUseProfileV2.mockReturnValue({
        profile: null,
        profileStatic: null,
        profileDynamic: {
          active_limitations: mockLimitations,
        } as ProfileDynamic,
        historySummary: null,
        loading: false,
        error: null,
        refetch: mockRefetch,
        updateStatic: jest.fn().mockResolvedValue(undefined),
        updateDynamic: jest.fn().mockResolvedValue(undefined),
      });

      let capturedActions: any;

      const renderLimitations = jest.fn().mockImplementation((data, actions) => {
        capturedActions = actions;
        return <div>Limitations List</div>;
      });

      render(
        <LimitationContainer
          userId="user-123"
          renderLimitations={renderLimitations}
        />
      );

      await waitFor(() => {
        expect(capturedActions).toBeDefined();
      });

      // Trigger refetch
      await capturedActions.refetch();

      // Verify the hook was called
      expect(mockRefetch).toHaveBeenCalled();
    });
  });

  describe('Loading states', () => {
    it('should set isLoading to true during mutation', async () => {
      const mockLimitations = createMockLimitations();

      mockUseProfileV2.mockReturnValue({
        profile: null,
        profileStatic: null,
        profileDynamic: {
          active_limitations: mockLimitations,
        } as ProfileDynamic,
        historySummary: null,
        loading: true,
        error: null,
        refetch: jest.fn().mockResolvedValue(undefined),
        updateStatic: jest.fn().mockResolvedValue(undefined),
        updateDynamic: jest.fn().mockResolvedValue(undefined),
      });

      let capturedActions: any;

      const renderLimitations = jest.fn().mockImplementation((data, actions) => {
        capturedActions = actions;
        return <div>Limitations List</div>;
      });

      render(
        <LimitationContainer
          userId="user-123"
          renderLimitations={renderLimitations}
        />
      );

      await waitFor(() => {
        expect(capturedActions).toBeDefined();
      });

      // Check loading state
      expect(capturedActions.isLoading).toBe(true);
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
        <LimitationContainer
          userId="user-123"
          renderLimitations={() => <div>Limitations</div>}
        />
      );

      expect(screen.getByText(/加载限制条件中/)).toBeInTheDocument();
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
        <LimitationContainer
          userId="user-123"
          renderLimitations={() => <div>Limitations</div>}
        />
      );

      expect(screen.getByText(/加载失败/)).toBeInTheDocument();
      expect(screen.getByText(/Test error/)).toBeInTheDocument();
    });

    it('should use default empty renderer when none provided', () => {
      mockUseProfileV2.mockReturnValue({
        profile: null,
        profileStatic: null,
        profileDynamic: {
          active_limitations: [],
        } as ProfileDynamic,
        historySummary: null,
        loading: false,
        error: null,
        refetch: jest.fn().mockResolvedValue(undefined),
        updateStatic: jest.fn().mockResolvedValue(undefined),
        updateDynamic: jest.fn().mockResolvedValue(undefined),
      });

      render(
        <LimitationContainer
          userId="user-123"
          renderLimitations={() => <div>Limitations</div>}
        />
      );

      expect(screen.getByText(/无活跃限制/)).toBeInTheDocument();
    });
  });
});
