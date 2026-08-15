import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
/**
 * LoadAnchorsEditor test suite
 *
 * Tests for the LoadAnchorsEditor component using React Testing Library
 *
 * @version 2.0.0
 * @updated 2026-02-10
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoadAnchorsEditor } from '../LoadAnchorsEditor';
import type { LoadAnchors, LoadAnchor } from 'shared/contracts';

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// Mock animations
vi.mock('../../lib/animations', () => ({
  slideUp: {},
  fadeScale: {},
  staggerContainer: {},
  staggerItem: {},
  modalBackdrop: {},
  modalContent: {},
}));

// Mock the useLoadAnchors hook
vi.mock('../../hooks', () => ({
  useLoadAnchors: vi.fn(),
}));

const mockUseLoadAnchors = require('../../hooks').useLoadAnchors;

// Helper to create mock load anchors
const createMockLoadAnchors = (): LoadAnchors => ({
  bench_press: {
    best_weight: 100,
    best_reps: 5,
    est_1rm: 115,
    last_updated: Date.now() - 3600000,
  },
  squat: {
    best_weight: 140,
    best_reps: 5,
    est_1rm: 160,
    last_updated: Date.now() - 86400000,
  },
  pull_up: {
    best_reps: 15,
    progression_level: 5,
    last_updated: Date.now() - 172800000,
  },
  running: {
    best_duration: 3600,
    best_distance: 10000,
    best_pace: 360,
    last_updated: Date.now() - 259200000,
  },
});

describe('LoadAnchorsEditor', () => {
  let defaultProps: any;
  let mockUpdateAnchor: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateAnchor = vi.fn().mockResolvedValue(undefined);

    mockUseLoadAnchors.mockReturnValue({
      anchors: createMockLoadAnchors(),
      loading: false,
      error: null,
      updateAnchor: mockUpdateAnchor,
      refetch: vi.fn().mockResolvedValue(undefined),
      getAnchor: vi.fn((id: string) => createMockLoadAnchors()[id as keyof LoadAnchors]),
      deleteAnchor: vi.fn().mockResolvedValue(undefined),
    });

    defaultProps = {
      userId: 'test-user-123',
    };
  });

  describe('Loading state', () => {
    it('should show loading spinner while loading', () => {
      mockUseLoadAnchors.mockReturnValue({
        anchors: undefined,
        loading: true,
        error: null,
        updateAnchor: mockUpdateAnchor,
        refetch: vi.fn(),
        getAnchor: vi.fn(),
        deleteAnchor: vi.fn(),
      });

      render(<LoadAnchorsEditor {...defaultProps} />);

      const spinner = document.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
    });

    it('should show spinner with correct styling', () => {
      mockUseLoadAnchors.mockReturnValue({
        anchors: undefined,
        loading: true,
        error: null,
        updateAnchor: mockUpdateAnchor,
        refetch: vi.fn(),
        getAnchor: vi.fn(),
        deleteAnchor: vi.fn(),
      });

      render(<LoadAnchorsEditor {...defaultProps} />);

      const container = screen.getByText(/加载中|加载/)?.closest('div');
      expect(container).toBeInTheDocument();
    });
  });

  describe('Error state', () => {
    it('should show error message on fetch failure', () => {
      const error = new Error('Failed to fetch anchors');

      mockUseLoadAnchors.mockReturnValue({
        anchors: undefined,
        loading: false,
        error,
        updateAnchor: mockUpdateAnchor,
        refetch: vi.fn(),
        getAnchor: vi.fn(),
        deleteAnchor: vi.fn(),
      });

      render(<LoadAnchorsEditor {...defaultProps} />);

      expect(screen.getByText('加载失败')).toBeInTheDocument();
      expect(screen.getByText(/Failed to fetch anchors/)).toBeInTheDocument();
    });

    it('should display error icon', () => {
      const error = new Error('Network error');

      mockUseLoadAnchors.mockReturnValue({
        anchors: undefined,
        loading: false,
        error,
        updateAnchor: mockUpdateAnchor,
        refetch: vi.fn(),
        getAnchor: vi.fn(),
        deleteAnchor: vi.fn(),
      });

      render(<LoadAnchorsEditor {...defaultProps} />);

      const errorIcon = document.querySelector('svg');
      expect(errorIcon).toBeInTheDocument();
    });
  });

  describe('Empty state', () => {
    it('should show empty state when no anchors', () => {
      mockUseLoadAnchors.mockReturnValue({
        anchors: {},
        loading: false,
        error: null,
        updateAnchor: mockUpdateAnchor,
        refetch: vi.fn(),
        getAnchor: vi.fn(),
        deleteAnchor: vi.fn(),
      });

      render(<LoadAnchorsEditor {...defaultProps} />);

      expect(screen.getByText('暂无负荷锚点')).toBeInTheDocument();
      expect(screen.getByText('完成训练后将自动记录')).toBeInTheDocument();
    });

    it('should show 0 count for empty anchors', () => {
      mockUseLoadAnchors.mockReturnValue({
        anchors: {},
        loading: false,
        error: null,
        updateAnchor: mockUpdateAnchor,
        refetch: vi.fn(),
        getAnchor: vi.fn(),
        deleteAnchor: vi.fn(),
      });

      render(<LoadAnchorsEditor {...defaultProps} />);

      expect(screen.getByText('0 个动作')).toBeInTheDocument();
    });
  });

  describe('Displaying anchors', () => {
    it('should display all anchor cards', () => {
      render(<LoadAnchorsEditor {...defaultProps} />);

      expect(screen.getByText('bench_press')).toBeInTheDocument();
      expect(screen.getByText('squat')).toBeInTheDocument();
      expect(screen.getByText('pull_up')).toBeInTheDocument();
      expect(screen.getByText('running')).toBeInTheDocument();
    });

    it('should display correct anchor count', () => {
      render(<LoadAnchorsEditor {...defaultProps} />);

      expect(screen.getByText('4 个动作')).toBeInTheDocument();
    });

    it('should show type badges for each anchor', () => {
      render(<LoadAnchorsEditor {...defaultProps} />);

      expect(screen.getByText('力量训练')).toBeInTheDocument(); // bench_press, squat
      expect(screen.getByText('自重训练')).toBeInTheDocument(); // pull_up
      expect(screen.getByText('有氧训练')).toBeInTheDocument(); // running
    });

    it('should show summaries for each anchor type', () => {
      render(<LoadAnchorsEditor {...defaultProps} />);

      // Strength type
      expect(screen.getByText(/100kg/)).toBeInTheDocument();
      expect(screen.getByText(/140kg/)).toBeInTheDocument();

      // Bodyweight type
      expect(screen.getByText(/15次/)).toBeInTheDocument();
      expect(screen.getByText(/Lv\.5/)).toBeInTheDocument();

      // Cardio type
      expect(screen.getByText(/60:00/)).toBeInTheDocument();
      expect(screen.getByText(/10000m/)).toBeInTheDocument();
    });

    it('should show relative timestamps', () => {
      render(<LoadAnchorsEditor {...defaultProps} />);

      expect(screen.getByText(/更新于/)).toBeInTheDocument();
    });

    it('should display anchors in grid layout on larger screens', () => {
      const { container } = render(<LoadAnchorsEditor {...defaultProps} />);

      const grid = container.querySelector('.grid');
      expect(grid).toBeInTheDocument();
      expect(grid).toHaveClass('md:grid-cols-2');
    });
  });

  describe('Editing functionality', () => {
    it('should open edit modal when clicking anchor card', async () => {
      const user = userEvent.setup();
      render(<LoadAnchorsEditor {...defaultProps} />);

      const benchPressCard = screen.getByText('bench_press').closest('.cursor-pointer');
      await user.click(benchPressCard!);

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('bench_press')).toBeInTheDocument();
    });

    it('should show correct form fields based on anchor type', async () => {
      const user = userEvent.setup();
      render(<LoadAnchorsEditor {...defaultProps} />);

      // Open strength type anchor
      const benchPressCard = screen.getByText('bench_press').closest('.cursor-pointer');
      await user.click(benchPressCard!);

      expect(screen.getByLabelText('最佳重量')).toBeInTheDocument();
      expect(screen.getByLabelText('最佳次数')).toBeInTheDocument();
      expect(screen.getByLabelText('预估1RM')).toBeInTheDocument();
    });

    it('should allow editing anchor values', async () => {
      const user = userEvent.setup();
      render(<LoadAnchorsEditor {...defaultProps} />);

      const benchPressCard = screen.getByText('bench_press').closest('.cursor-pointer');
      await user.click(benchPressCard!);

      const weightInput = screen.getByDisplayValue('100');
      await user.clear(weightInput);
      await user.type(weightInput, '105');

      expect(weightInput).toHaveValue(105);
    });

    it('should save changes when clicking save button', async () => {
      const user = userEvent.setup();
      render(<LoadAnchorsEditor {...defaultProps} />);

      const benchPressCard = screen.getByText('bench_press').closest('.cursor-pointer');
      await user.click(benchPressCard!);

      const saveButton = screen.getByText('保存');
      await user.click(saveButton);

      await waitFor(() => {
        expect(mockUpdateAnchor).toHaveBeenCalledWith(
          'bench_press',
          expect.objectContaining({
            best_weight: 100,
            best_reps: 5,
            est_1rm: 115,
          })
        );
      });
    });

    it('should update last_updated timestamp on save', async () => {
      const user = userEvent.setup();
      render(<LoadAnchorsEditor {...defaultProps} />);

      const benchPressCard = screen.getByText('bench_press').closest('.cursor-pointer');
      await user.click(benchPressCard!);

      const originalTimestamp = createMockLoadAnchors().bench_press.last_updated;

      const saveButton = screen.getByText('保存');
      await user.click(saveButton);

      await waitFor(() => {
        expect(mockUpdateAnchor).toHaveBeenCalledWith(
          'bench_press',
          expect.objectContaining({
            last_updated: expect.any(Number),
          })
        );
      });

      const savedAnchor = mockUpdateAnchor.mock.calls[0][1];
      expect(savedAnchor.last_updated).not.toBe(originalTimestamp);
    });

    it('should close modal on save', async () => {
      const user = userEvent.setup();
      render(<LoadAnchorsEditor {...defaultProps} />);

      const benchPressCard = screen.getByText('bench_press').closest('.cursor-pointer');
      await user.click(benchPressCard!);

      const saveButton = screen.getByText('保存');
      await user.click(saveButton);

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });

    it('should close modal when clicking backdrop', async () => {
      const user = userEvent.setup();
      render(<LoadAnchorsEditor {...defaultProps} />);

      const benchPressCard = screen.getByText('bench_press').closest('.cursor-pointer');
      await user.click(benchPressCard!);

      const backdrop = document.querySelector('.fixed.inset-0.z-50');
      await user.click(backdrop!);

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });
    });

    it('should close modal when clicking close button', async () => {
      const user = userEvent.setup();
      render(<LoadAnchorsEditor {...defaultProps} />);

      const benchPressCard = screen.getByText('bench_press').closest('.cursor-pointer');
      await user.click(benchPressCard!);

      const closeButton = document.querySelector('button[aria-label="Close"]') ||
        document.querySelector('button');
      if (closeButton) {
        await user.click(closeButton);

        await waitFor(() => {
          expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        });
      }
    });

    it('should reset changes on cancel', async () => {
      const user = userEvent.setup();
      render(<LoadAnchorsEditor {...defaultProps} />);

      const benchPressCard = screen.getByText('bench_press').closest('.cursor-pointer');
      await user.click(benchPressCard!);

      // Make changes
      const weightInput = screen.getByDisplayValue('100');
      await user.clear(weightInput);
      await user.type(weightInput, '105');

      // Cancel
      const cancelButton = screen.getByText('取消');
      await user.click(cancelButton);

      await waitFor(() => {
        expect(mockUpdateAnchor).not.toHaveBeenCalled();
      });
    });

    it('should disable save button while saving', async () => {
      const user = userEvent.setup();
      let resolveSave: () => void;
      const slowSave = new Promise<void>(resolve => {
        resolveSave = resolve;
      });

      mockUpdateAnchor.mockReturnValue(slowSave);

      render(<LoadAnchorsEditor {...defaultProps} />);

      const benchPressCard = screen.getByText('bench_press').closest('.cursor-pointer');
      await user.click(benchPressCard!);

      const saveButton = screen.getByText('保存');
      await user.click(saveButton);

      await waitFor(() => {
        expect(screen.getByText('保存中...')).toBeInTheDocument();
      });

      resolveSave!();
    });
  });

  describe('Type-specific forms', () => {
    it('should show bodyweight form fields', async () => {
      const user = userEvent.setup();

      const bodyweightAnchors: LoadAnchors = {
        pull_up: {
          best_reps: 15,
          progression_level: 5,
          last_updated: Date.now(),
        },
      };

      mockUseLoadAnchors.mockReturnValue({
        anchors: bodyweightAnchors,
        loading: false,
        error: null,
        updateAnchor: mockUpdateAnchor,
        refetch: vi.fn(),
        getAnchor: vi.fn(),
        deleteAnchor: vi.fn(),
      });

      render(<LoadAnchorsEditor {...defaultProps} />);

      const pullUpCard = screen.getByText('pull_up').closest('.cursor-pointer');
      await user.click(pullUpCard!);

      expect(screen.getByLabelText('最佳次数')).toBeInTheDocument();
      expect(screen.getByLabelText('进阶等级')).toBeInTheDocument();
    });

    it('should show cardio form fields', async () => {
      const user = userEvent.setup();

      const cardioAnchors: LoadAnchors = {
        running: {
          best_duration: 1800,
          best_distance: 5000,
          best_pace: 360,
          last_updated: Date.now(),
        },
      };

      mockUseLoadAnchors.mockReturnValue({
        anchors: cardioAnchors,
        loading: false,
        error: null,
        updateAnchor: mockUpdateAnchor,
        refetch: vi.fn(),
        getAnchor: vi.fn(),
        deleteAnchor: vi.fn(),
      });

      render(<LoadAnchorsEditor {...defaultProps} />);

      const runningCard = screen.getByText('running').closest('.cursor-pointer');
      await user.click(runningCard!);

      expect(screen.getByLabelText('最佳时长')).toBeInTheDocument();
      expect(screen.getByLabelText('最佳距离')).toBeInTheDocument();
      expect(screen.getByLabelText('最佳配速')).toBeInTheDocument();
    });

    it('should show isometric form fields', async () => {
      const user = userEvent.setup();

      const isometricAnchors: LoadAnchors = {
        plank: {
          best_duration: 90,
          best_weight: 0,
          last_updated: Date.now(),
        },
      };

      mockUseLoadAnchors.mockReturnValue({
        anchors: isometricAnchors,
        loading: false,
        error: null,
        updateAnchor: mockUpdateAnchor,
        refetch: vi.fn(),
        getAnchor: vi.fn(),
        deleteAnchor: vi.fn(),
      });

      render(<LoadAnchorsEditor {...defaultProps} />);

      const plankCard = screen.getByText('plank').closest('.cursor-pointer');
      await user.click(plankCard!);

      expect(screen.getByLabelText('最佳时长')).toBeInTheDocument();
      expect(screen.getByLabelText('负重')).toBeInTheDocument();
    });

    it('should show heartrate form fields', async () => {
      const user = userEvent.setup();

      const heartrateAnchors: LoadAnchors = {
        hr_zones: {
          max_hr: 180,
          resting_hr: 60,
          zone_2_threshold: 145,
          last_updated: Date.now(),
        },
      };

      mockUseLoadAnchors.mockReturnValue({
        anchors: heartrateAnchors,
        loading: false,
        error: null,
        updateAnchor: mockUpdateAnchor,
        refetch: vi.fn(),
        getAnchor: vi.fn(),
        deleteAnchor: vi.fn(),
      });

      render(<LoadAnchorsEditor {...defaultProps} />);

      const hrCard = screen.getByText('hr_zones').closest('.cursor-pointer');
      await user.click(hrCard!);

      expect(screen.getByLabelText('最大心率')).toBeInTheDocument();
      expect(screen.getByLabelText('静息心率')).toBeInTheDocument();
      expect(screen.getByLabelText('Zone2阈值')).toBeInTheDocument();
    });
  });

  describe('Header and layout', () => {
    it('should display header with title and count', () => {
      render(<LoadAnchorsEditor {...defaultProps} />);

      expect(screen.getByText('负荷锚点')).toBeInTheDocument();
      expect(screen.getByText('4 个动作')).toBeInTheDocument();
    });
  });

  describe('Edge cases', () => {
    it('should handle undefined anchors gracefully', () => {
      mockUseLoadAnchors.mockReturnValue({
        anchors: undefined,
        loading: false,
        error: null,
        updateAnchor: mockUpdateAnchor,
        refetch: vi.fn(),
        getAnchor: vi.fn(),
        deleteAnchor: vi.fn(),
      });

      render(<LoadAnchorsEditor {...defaultProps} />);

      expect(screen.getByText('0 个动作')).toBeInTheDocument();
    });

    it('should handle anchors with minimal data', () => {
      const minimalAnchors: LoadAnchors = {
        minimal: {
          best_reps: 10,
          last_updated: Date.now(),
        },
      };

      mockUseLoadAnchors.mockReturnValue({
        anchors: minimalAnchors,
        loading: false,
        error: null,
        updateAnchor: mockUpdateAnchor,
        refetch: vi.fn(),
        getAnchor: vi.fn(),
        deleteAnchor: vi.fn(),
      });

      render(<LoadAnchorsEditor {...defaultProps} />);

      expect(screen.getByText('minimal')).toBeInTheDocument();
      expect(screen.getByText('未分类')).toBeInTheDocument();
    });

    it('should handle special characters in exercise names', () => {
      const specialAnchors: LoadAnchors = {
        '特殊-动作_名称': {
          best_weight: 50,
          best_reps: 10,
          last_updated: Date.now(),
        },
      };

      mockUseLoadAnchors.mockReturnValue({
        anchors: specialAnchors,
        loading: false,
        error: null,
        updateAnchor: mockUpdateAnchor,
        refetch: vi.fn(),
        getAnchor: vi.fn(),
        deleteAnchor: vi.fn(),
      });

      render(<LoadAnchorsEditor {...defaultProps} />);

      expect(screen.getByText('特殊-动作_名称')).toBeInTheDocument();
    });
  });
});
