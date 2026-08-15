/**
 * ProfileContainer test suite
 *
 * Tests for the ProfileContainer component using React Testing Library
 *
 * @version 2.0.0
 * @updated 2026-02-10 - Updated for hook-based implementation
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { ProfileContainer } from '../profile/ProfileContainer';
import type { ProfileStatic, ProfileDynamic } from 'shared/contracts';

// Mock the hooks module
jest.mock('@/v2/hooks', () => ({
  useProfileV2: jest.fn(),
}));

const mockUseProfileV2 = require('@/v2/hooks').useProfileV2;

// Helper to create mock profile data
const createMockProfileStatic = (): ProfileStatic => ({
  age: 30,
  weight: 75,
  height: 180,
  neuro_type: 'type_2a',
  risk_preference: 'moderate',
  accountability: 'high',
});

const createMockProfileDynamic = (): ProfileDynamic => ({
  load_anchors: {
    bench_press: {
      best_weight: 80,
      best_reps: 8,
      est_1rm: 100,
      last_updated: Date.now(),
    },
  },
  active_limitations: [],
});

describe('ProfileContainer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Data fetching', () => {
    it('should fetch and render profile data on mount', async () => {
      const mockStatic = createMockProfileStatic();
      const mockDynamic = createMockProfileDynamic();

      mockUseProfileV2.mockReturnValue({
        profile: { user_id: 'user-123' } as any,
        profileStatic: mockStatic,
        profileDynamic: mockDynamic,
        historySummary: null,
        loading: false,
        error: null,
        refetch: jest.fn().mockResolvedValue(undefined),
        updateStatic: jest.fn().mockResolvedValue(undefined),
        updateDynamic: jest.fn().mockResolvedValue(undefined),
      });

      const renderProfileStatic = jest.fn().mockReturnValue(<div>Static Profile</div>);

      render(
        <ProfileContainer
          userId="user-123"
          renderProfileStatic={renderProfileStatic}
        />
      );

      // Wait for data to load
      await waitFor(() => {
        expect(renderProfileStatic).toHaveBeenCalled();
      });

      // Verify the data was passed correctly
      const callArgs = renderProfileStatic.mock.calls[0];
      expect(callArgs[0]).toEqual(mockStatic);
      expect(callArgs[1]).toHaveProperty('onUpdateStatic');
      expect(callArgs[1]).toHaveProperty('onUpdateDynamic');
      expect(callArgs[1]).toHaveProperty('refetch');
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

      const renderProfileStatic = jest.fn().mockReturnValue(<div>Static Profile</div>);
      const renderLoading = jest.fn().mockReturnValue(<div>Loading...</div>);

      render(
        <ProfileContainer
          userId="user-123"
          renderProfileStatic={renderProfileStatic}
          renderLoading={renderLoading}
        />
      );

      expect(renderLoading).toHaveBeenCalled();
      expect(renderProfileStatic).not.toHaveBeenCalled();
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

      const renderProfileStatic = jest.fn().mockReturnValue(<div>Static Profile</div>);
      const renderError = jest.fn().mockReturnValue(<div>Error occurred</div>);

      render(
        <ProfileContainer
          userId="user-123"
          renderProfileStatic={renderProfileStatic}
          renderError={renderError}
        />
      );

      expect(renderError).toHaveBeenCalledWith(error);
      expect(renderProfileStatic).not.toHaveBeenCalled();
    });

    it('should handle missing profile data gracefully', async () => {
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

      const renderProfileStatic = jest.fn().mockReturnValue(<div>Static Profile</div>);
      const renderEmpty = jest.fn().mockReturnValue(<div>Empty</div>);

      render(
        <ProfileContainer
          userId="user-123"
          renderProfileStatic={renderProfileStatic}
          renderEmpty={renderEmpty}
        />
      );

      expect(renderEmpty).toHaveBeenCalled();
      expect(renderProfileStatic).not.toHaveBeenCalled();
    });

    it('should render both static and dynamic data when provided', async () => {
      const mockStatic = createMockProfileStatic();
      const mockDynamic = createMockProfileDynamic();

      mockUseProfileV2.mockReturnValue({
        profile: { user_id: 'user-123' } as any,
        profileStatic: mockStatic,
        profileDynamic: mockDynamic,
        historySummary: null,
        loading: false,
        error: null,
        refetch: jest.fn().mockResolvedValue(undefined),
        updateStatic: jest.fn().mockResolvedValue(undefined),
        updateDynamic: jest.fn().mockResolvedValue(undefined),
      });

      const renderProfileStatic = jest.fn().mockReturnValue(<div>Static Profile</div>);
      const renderProfileDynamic = jest.fn().mockReturnValue(<div>Dynamic Profile</div>);

      render(
        <ProfileContainer
          userId="user-123"
          renderProfileStatic={renderProfileStatic}
          renderProfileDynamic={renderProfileDynamic}
        />
      );

      await waitFor(() => {
        expect(renderProfileStatic).toHaveBeenCalled();
        expect(renderProfileDynamic).toHaveBeenCalled();
      });

      // Verify dynamic data was passed
      const dynamicCallArgs = renderProfileDynamic.mock.calls[0];
      expect(dynamicCallArgs[0]).toEqual(mockDynamic);
    });
  });

  describe('Actions', () => {
    it('should call onUpdateStatic with updates', async () => {
      const mockStatic = createMockProfileStatic();
      const mockUpdateStatic = jest.fn().mockResolvedValue(undefined);

      mockUseProfileV2.mockReturnValue({
        profile: { user_id: 'user-123' } as any,
        profileStatic: mockStatic,
        profileDynamic: null,
        historySummary: null,
        loading: false,
        error: null,
        refetch: jest.fn().mockResolvedValue(undefined),
        updateStatic: mockUpdateStatic,
        updateDynamic: jest.fn().mockResolvedValue(undefined),
      });

      let capturedActions: any;

      const renderProfileStatic = jest.fn().mockImplementation((data, actions) => {
        capturedActions = actions;
        return <div>Static Profile</div>;
      });

      render(
        <ProfileContainer
          userId="user-123"
          renderProfileStatic={renderProfileStatic}
        />
      );

      await waitFor(() => {
        expect(capturedActions).toBeDefined();
      });

      // Trigger update
      const updates = { age: 31 };
      await capturedActions.onUpdateStatic(updates);

      // Verify the hook was called
      expect(mockUpdateStatic).toHaveBeenCalledWith(updates);
    });

    it('should call onUpdateDynamic with updates', async () => {
      const mockDynamic = createMockProfileDynamic();
      const mockUpdateDynamic = jest.fn().mockResolvedValue(undefined);

      mockUseProfileV2.mockReturnValue({
        profile: { user_id: 'user-123' } as any,
        profileStatic: null,
        profileDynamic: mockDynamic,
        historySummary: null,
        loading: false,
        error: null,
        refetch: jest.fn().mockResolvedValue(undefined),
        updateStatic: jest.fn().mockResolvedValue(undefined),
        updateDynamic: mockUpdateDynamic,
      });

      let capturedActions: any;

      const renderProfileStatic = jest.fn().mockImplementation((data, actions) => {
        capturedActions = actions;
        return <div>Static Profile</div>;
      });

      render(
        <ProfileContainer
          userId="user-123"
          renderProfileStatic={renderProfileStatic}
        />
      );

      await waitFor(() => {
        expect(capturedActions).toBeDefined();
      });

      // Trigger update
      const updates = { load_anchors: {} };
      await capturedActions.onUpdateDynamic(updates);

      // Verify the hook was called
      expect(mockUpdateDynamic).toHaveBeenCalledWith(updates);
    });

    it('should refetch data when refetch is called', async () => {
      const mockStatic = createMockProfileStatic();
      const mockRefetch = jest.fn().mockResolvedValue(undefined);

      mockUseProfileV2.mockReturnValue({
        profile: { user_id: 'user-123' } as any,
        profileStatic: mockStatic,
        profileDynamic: null,
        historySummary: null,
        loading: false,
        error: null,
        refetch: mockRefetch,
        updateStatic: jest.fn().mockResolvedValue(undefined),
        updateDynamic: jest.fn().mockResolvedValue(undefined),
      });

      let capturedActions: any;

      const renderProfileStatic = jest.fn().mockImplementation((data, actions) => {
        capturedActions = actions;
        return <div>Static Profile</div>;
      });

      render(
        <ProfileContainer
          userId="user-123"
          renderProfileStatic={renderProfileStatic}
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
      const mockStatic = createMockProfileStatic();

      mockUseProfileV2.mockReturnValue({
        profile: { user_id: 'user-123' } as any,
        profileStatic: mockStatic,
        profileDynamic: null,
        historySummary: null,
        loading: true,
        error: null,
        refetch: jest.fn().mockResolvedValue(undefined),
        updateStatic: jest.fn().mockResolvedValue(undefined),
        updateDynamic: jest.fn().mockResolvedValue(undefined),
      });

      let capturedActions: any;

      const renderProfileStatic = jest.fn().mockImplementation((data, actions) => {
        capturedActions = actions;
        return <div>Static Profile</div>;
      });

      render(
        <ProfileContainer
          userId="user-123"
          renderProfileStatic={renderProfileStatic}
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
      const error = new Error('Update failed');

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

      const renderProfileStatic = jest.fn().mockReturnValue(<div>Static Profile</div>);
      const renderError = jest.fn().mockReturnValue(<div>Error occurred</div>);

      render(
        <ProfileContainer
          userId="user-123"
          renderProfileStatic={renderProfileStatic}
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
        <ProfileContainer
          userId="user-123"
          renderProfileStatic={() => <div>Static</div>}
        />
      );

      expect(screen.getByText(/加载用户画像中/)).toBeInTheDocument();
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
        <ProfileContainer
          userId="user-123"
          renderProfileStatic={() => <div>Static</div>}
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
        <ProfileContainer
          userId="user-123"
          renderProfileStatic={() => <div>Static</div>}
        />
      );

      expect(screen.getByText(/暂无用户画像/)).toBeInTheDocument();
    });
  });
});
