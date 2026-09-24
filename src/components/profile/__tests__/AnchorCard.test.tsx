import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
/**
 * AnchorCard test suite
 *
 * Tests for the AnchorCard component using React Testing Library
 *
 * @version 2.0.0
 * @updated 2026-02-10
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AnchorCard } from '../AnchorCard';
import type { LoadAnchor } from 'shared/contracts';

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, onClick, ...props }: any) => (
      <div onClick={onClick} {...props}>
        {children}
      </div>
    ),
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// Mock animations
vi.mock('../../lib/animations', () => ({
  staggerItem: {},
  modalBackdrop: {},
  modalContent: {},
}));

describe('AnchorCard', () => {
  let mockOnSave: any;
  let defaultProps: any;

  beforeEach(() => {
    mockOnSave = vi.fn().mockResolvedValue(undefined);
    vi.clearAllMocks();
  });

  // C6: AnchorCard - Type Recognition
  describe('C6: AnchorCard - Type Recognition', () => {
    it('should recognize and display resistance type correctly', () => {
      const resistanceAnchor: LoadAnchor = {
        best_weight: 100,
        best_reps: 5,
        est_1rm: 115,
        last_updated: Date.now(),
      };

      defaultProps = {
        exerciseId: 'bench_press',
        anchor: resistanceAnchor,
        onSave: mockOnSave,
      };

      render(<AnchorCard {...defaultProps} />);

      expect(screen.getByText('bench_press')).toBeInTheDocument();
      expect(screen.getByText('力量训练')).toBeInTheDocument();
      expect(screen.getByText(/100kg/)).toBeInTheDocument();
      expect(screen.getByText(/5次/)).toBeInTheDocument();
      expect(screen.getByText(/1RM:115kg/)).toBeInTheDocument();
    });

    it('should recognize and display bodyweight type correctly', () => {
      const bodyweightAnchor: LoadAnchor = {
        best_reps: 15,
        progression_level: 5,
        last_updated: Date.now(),
      };

      defaultProps = {
        exerciseId: 'pull_up',
        anchor: bodyweightAnchor,
        onSave: mockOnSave,
      };

      render(<AnchorCard {...defaultProps} />);

      expect(screen.getByText('pull_up')).toBeInTheDocument();
      expect(screen.getByText('自重训练')).toBeInTheDocument();
      expect(screen.getByText(/15次/)).toBeInTheDocument();
      expect(screen.getByText(/Lv\.5/)).toBeInTheDocument();
    });

    it('should recognize and display cardio type correctly', () => {
      const cardioAnchor: LoadAnchor = {
        best_duration: 3600,
        best_distance: 10000,
        best_pace: 360,
        last_updated: Date.now(),
      };

      defaultProps = {
        exerciseId: 'running_5k',
        anchor: cardioAnchor,
        onSave: mockOnSave,
      };

      render(<AnchorCard {...defaultProps} />);

      expect(screen.getByText('running_5k')).toBeInTheDocument();
      expect(screen.getByText('有氧训练')).toBeInTheDocument();
      // The actual format is "60:00" (60 mins : 00 secs)
      expect(screen.getByText(/60:00/)).toBeInTheDocument();
      expect(screen.getByText(/10000m/)).toBeInTheDocument();
      expect(screen.getByText(/360\/km/)).toBeInTheDocument();
    });

    it('should recognize and display isometric type correctly', () => {
      const isometricAnchor: LoadAnchor = {
        best_duration: 90,
        best_weight: 20,
        last_updated: Date.now(),
      };

      defaultProps = {
        exerciseId: 'plank_hold',
        anchor: isometricAnchor,
        onSave: mockOnSave,
      };

      render(<AnchorCard {...defaultProps} />);

      expect(screen.getByText('plank_hold')).toBeInTheDocument();
      expect(screen.getByText('等长训练')).toBeInTheDocument();
      // The actual format is "1:30" for 90 seconds (mins:secs)
      expect(screen.getByText(/1:30/)).toBeInTheDocument();
    });

    it('should recognize and display heartrate type correctly', () => {
      const heartrateAnchor: LoadAnchor = {
        max_hr: 180,
        resting_hr: 60,
        zone_2_threshold: 145,
        last_updated: Date.now(),
      };

      defaultProps = {
        exerciseId: 'hr_zones',
        anchor: heartrateAnchor,
        onSave: mockOnSave,
      };

      render(<AnchorCard {...defaultProps} />);

      expect(screen.getByText('hr_zones')).toBeInTheDocument();
      expect(screen.getByText('心率数据')).toBeInTheDocument();
      expect(screen.getByText(/HRmax 180/)).toBeInTheDocument();
    });

    it('should show "未分类" for unknown types', () => {
      const unknownAnchor: LoadAnchor = {
        last_updated: Date.now(),
      };

      defaultProps = {
        exerciseId: 'unknown_exercise',
        anchor: unknownAnchor,
        onSave: mockOnSave,
      };

      render(<AnchorCard {...defaultProps} />);

      expect(screen.getByText('unknown_exercise')).toBeInTheDocument();
      expect(screen.getByText('未分类')).toBeInTheDocument();
      expect(screen.getByText('暂无数据')).toBeInTheDocument();
    });

    it('should show correct color badges for different types', () => {
      const testCases = [
        {
          anchor: { best_weight: 100, best_reps: 5, last_updated: Date.now() },
          type: '力量训练',
          colorClass: 'bg-blue-100',
        },
        {
          anchor: { best_reps: 15, progression_level: 5, last_updated: Date.now() },
          type: '自重训练',
          colorClass: 'bg-green-100',
        },
        {
          anchor: { best_duration: 60, last_updated: Date.now() },
          type: '等长训练',
          colorClass: 'bg-purple-100',
        },
        {
          anchor: { best_pace: 300, last_updated: Date.now() },
          type: '有氧训练',
          colorClass: 'bg-orange-100',
        },
        {
          anchor: { max_hr: 180, last_updated: Date.now() },
          type: '心率数据',
          colorClass: 'bg-red-100',
        },
      ];

      testCases.forEach(({ anchor, type, colorClass }) => {
        const { container } = render(
          <AnchorCard
            exerciseId="test"
            anchor={anchor}
            onSave={mockOnSave}
          />
        );

        expect(screen.getByText(type)).toBeInTheDocument();
        const badge = screen.getByText(type).closest('span');
        expect(badge).toHaveClass(colorClass);
      });
    });
  });

  describe('Edit modal', () => {
    it('should open edit modal on click', async () => {
      const user = userEvent.setup();
      const anchor: LoadAnchor = {
        best_weight: 100,
        best_reps: 5,
        est_1rm: 115,
        last_updated: Date.now(),
      };

      defaultProps = {
        exerciseId: 'bench_press',
        anchor,
        onSave: mockOnSave,
      };

      render(<AnchorCard {...defaultProps} />);

      // Click on the card element to open modal
      const card = screen.getByText('bench_press').closest('div');
      await user.click(card!);

      // Modal should be visible with backdrop
      const backdrop = document.querySelector('.fixed.inset-0.z-50');
      expect(backdrop).toBeInTheDocument();
    });

    it('should close modal when clicking backdrop', async () => {
      const user = userEvent.setup();
      const anchor: LoadAnchor = {
        best_weight: 100,
        best_reps: 5,
        last_updated: Date.now(),
      };

      defaultProps = {
        exerciseId: 'test',
        anchor,
        onSave: mockOnSave,
      };

      render(<AnchorCard {...defaultProps} />);

      // Open modal
      const card = screen.getByText('test').closest('div');
      await user.click(card!);

      // Click backdrop
      const backdrop = document.querySelector('.fixed.inset-0.z-50');
      await user.click(backdrop!);

      await waitFor(() => {
        expect(backdrop).not.toBeInTheDocument();
      });
    });

    it('should close modal when clicking close button', async () => {
      const user = userEvent.setup();
      const anchor: LoadAnchor = {
        best_weight: 100,
        best_reps: 5,
        last_updated: Date.now(),
      };

      defaultProps = {
        exerciseId: 'test',
        anchor,
        onSave: mockOnSave,
      };

      render(<AnchorCard {...defaultProps} />);

      // Open modal
      const card = screen.getByText('test').closest('div');
      await user.click(card!);

      // Click close button (X icon)
      const closeButton = document.querySelector('button[aria-label="Close"]') ||
        document.querySelector('button')?.closest('button');
      if (closeButton) {
        await user.click(closeButton);
      }

      // Modal should close
      await waitFor(() => {
        const backdrop = document.querySelector('.fixed.inset-0.z-50');
        expect(backdrop).not.toBeInTheDocument();
      });
    });

    it('should show correct type-specific form in modal', async () => {
      const user = userEvent.setup();
      const anchor: LoadAnchor = {
        best_weight: 100,
        best_reps: 5,
        est_1rm: 115,
        last_updated: Date.now(),
      };

      defaultProps = {
        exerciseId: 'bench_press',
        anchor,
        onSave: mockOnSave,
      };

      render(<AnchorCard {...defaultProps} />);

      const card = screen.getByText('bench_press').closest('div');
      await user.click(card!);

      // Should show strength-specific fields (using text content instead of label)
      await waitFor(() => {
        expect(screen.getByText('最佳重量')).toBeInTheDocument();
        expect(screen.getByText('最佳次数')).toBeInTheDocument();
        expect(screen.getByText('预估1RM')).toBeInTheDocument();
      });
    });
  });

  describe('Editing functionality', () => {
    it('should allow editing number fields', async () => {
      const user = userEvent.setup();
      const anchor: LoadAnchor = {
        best_weight: 100,
        best_reps: 5,
        est_1rm: 115,
        last_updated: Date.now(),
      };

      defaultProps = {
        exerciseId: 'bench_press',
        anchor,
        onSave: mockOnSave,
      };

      render(<AnchorCard {...defaultProps} />);

      // Open modal
      const card = screen.getByText('bench_press').closest('div');
      await user.click(card!);

      // Edit fields
      const weightInput = screen.getByDisplayValue('100');
      await user.clear(weightInput);
      await user.type(weightInput, '105');

      expect(weightInput).toHaveValue(105);
    });

    it('should save changes and close modal', async () => {
      const user = userEvent.setup();
      const anchor: LoadAnchor = {
        best_weight: 100,
        best_reps: 5,
        est_1rm: 115,
        last_updated: Date.now(),
      };

      defaultProps = {
        exerciseId: 'bench_press',
        anchor,
        onSave: mockOnSave,
      };

      render(<AnchorCard {...defaultProps} />);

      // Open modal
      const card = screen.getByText('bench_press').closest('div');
      await user.click(card!);

      // Click save button
      const saveButton = screen.getByText('保存');
      await user.click(saveButton);

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
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
      const originalTimestamp = Date.now() - 10000;
      const anchor: LoadAnchor = {
        best_weight: 100,
        best_reps: 5,
        last_updated: originalTimestamp,
      };

      defaultProps = {
        exerciseId: 'test',
        anchor,
        onSave: mockOnSave,
      };

      render(<AnchorCard {...defaultProps} />);

      // Open and save
      const card = screen.getByText('test').closest('div');
      await user.click(card!);

      const saveButton = screen.getByText('保存');
      await user.click(saveButton);

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalled();
        const savedAnchor = mockOnSave.mock.calls[0][0];
        expect(savedAnchor.last_updated).toBeGreaterThanOrEqual(originalTimestamp);
        expect(savedAnchor.last_updated).not.toBe(originalTimestamp);
      });
    });

    it('should reset changes on cancel', async () => {
      const user = userEvent.setup();
      const anchor: LoadAnchor = {
        best_weight: 100,
        best_reps: 5,
        last_updated: Date.now(),
      };

      defaultProps = {
        exerciseId: 'test',
        anchor,
        onSave: mockOnSave,
      };

      render(<AnchorCard {...defaultProps} />);

      // Open modal
      const card = screen.getByText('test').closest('div');
      await user.click(card!);

      // Make changes
      const weightInput = screen.getByDisplayValue('100');
      await user.clear(weightInput);
      await user.type(weightInput, '105');

      // Cancel
      const cancelButton = screen.getByText('取消');
      await user.click(cancelButton);

      await waitFor(() => {
        expect(mockOnSave).not.toHaveBeenCalled();
      });
    });

    it('should disable save button while saving', async () => {
      const user = userEvent.setup();
      let resolveSave: () => void;
      const slowSave = new Promise<void>(resolve => {
        resolveSave = resolve;
      });

      mockOnSave.mockReturnValue(slowSave);

      const anchor: LoadAnchor = {
        best_weight: 100,
        best_reps: 5,
        last_updated: Date.now(),
      };

      defaultProps = {
        exerciseId: 'test',
        anchor,
        onSave: mockOnSave,
      };

      render(<AnchorCard {...defaultProps} />);

      // Open modal
      const card = screen.getByText('test').closest('div');
      await user.click(card!);

      // Click save
      const saveButton = screen.getByText('保存');
      await user.click(saveButton);

      // Should show loading state
      await waitFor(() => {
        expect(screen.getByText('保存中...')).toBeInTheDocument();
      });

      resolveSave!();
    });
  });

  describe('Type-specific forms', () => {
    it('should show bodyweight form fields', async () => {
      const user = userEvent.setup();
      const anchor: LoadAnchor = {
        best_reps: 15,
        progression_level: 5,
        last_updated: Date.now(),
      };

      defaultProps = {
        exerciseId: 'pull_up',
        anchor,
        onSave: mockOnSave,
      };

      render(<AnchorCard {...defaultProps} />);

      const card = screen.getByText('pull_up').closest('div');
      await user.click(card!);

      await waitFor(() => {
        expect(screen.getByText('最佳次数')).toBeInTheDocument();
        expect(screen.getByText('进阶等级')).toBeInTheDocument();
      });
    });

    it('should show isometric form fields', async () => {
      const user = userEvent.setup();
      const anchor: LoadAnchor = {
        best_duration: 60,
        best_weight: 20,
        last_updated: Date.now(),
      };

      defaultProps = {
        exerciseId: 'plank',
        anchor,
        onSave: mockOnSave,
      };

      render(<AnchorCard {...defaultProps} />);

      const card = screen.getByText('plank').closest('div');
      await user.click(card!);

      await waitFor(() => {
        expect(screen.getByText('最佳时长')).toBeInTheDocument();
        expect(screen.getByText('负重')).toBeInTheDocument();
      });
    });

    it('should show cardio form fields', async () => {
      const user = userEvent.setup();
      const anchor: LoadAnchor = {
        best_duration: 1800,
        best_distance: 5000,
        best_pace: 360,
        last_updated: Date.now(),
      };

      defaultProps = {
        exerciseId: 'running',
        anchor,
        onSave: mockOnSave,
      };

      render(<AnchorCard {...defaultProps} />);

      const card = screen.getByText('running').closest('div');
      await user.click(card!);

      await waitFor(() => {
        expect(screen.getByText('最佳时长')).toBeInTheDocument();
        expect(screen.getByText('最佳距离')).toBeInTheDocument();
        expect(screen.getByText('最佳配速')).toBeInTheDocument();
      });
    });

    it('should show heartrate form fields', async () => {
      const user = userEvent.setup();
      const anchor: LoadAnchor = {
        max_hr: 180,
        resting_hr: 60,
        zone_2_threshold: 145,
        last_updated: Date.now(),
      };

      defaultProps = {
        exerciseId: 'hr_zones',
        anchor,
        onSave: mockOnSave,
      };

      render(<AnchorCard {...defaultProps} />);

      const card = screen.getByText('hr_zones').closest('div');
      await user.click(card!);

      await waitFor(() => {
        expect(screen.getByText('最大心率')).toBeInTheDocument();
        expect(screen.getByText('静息心率')).toBeInTheDocument();
        expect(screen.getByText('Zone2阈值')).toBeInTheDocument();
      });
    });
  });

  describe('Relative time display', () => {
    it('should display "刚刚" for recent updates', () => {
      const now = Date.now();
      const recentAnchor: LoadAnchor = {
        best_reps: 10,
        last_updated: now - 1000, // 1 second ago
      };

      defaultProps = {
        exerciseId: 'recent',
        anchor: recentAnchor,
        onSave: mockOnSave,
      };

      render(<AnchorCard {...defaultProps} />);

      // Using a more flexible match to handle timing issues
      expect(screen.getByText(/刚刚/)).toBeInTheDocument();
    });

    it('should display minutes ago for recent updates', () => {
      const now = Date.now();
      const minutesAgoAnchor: LoadAnchor = {
        best_reps: 10,
        last_updated: now - 300000, // 5 minutes ago
      };

      defaultProps = {
        exerciseId: 'recent_min',
        anchor: minutesAgoAnchor,
        onSave: mockOnSave,
      };

      render(<AnchorCard {...defaultProps} />);

      expect(screen.getByText(/5分钟前/)).toBeInTheDocument();
    });

    it('should display hours ago', () => {
      const now = Date.now();
      const hoursAgoAnchor: LoadAnchor = {
        best_reps: 10,
        last_updated: now - 7200000, // 2 hours ago
      };

      defaultProps = {
        exerciseId: 'hours_ago',
        anchor: hoursAgoAnchor,
        onSave: mockOnSave,
      };

      render(<AnchorCard {...defaultProps} />);

      expect(screen.getByText(/2小时前/)).toBeInTheDocument();
    });

    it('should display days ago', () => {
      const now = Date.now();
      const daysAgoAnchor: LoadAnchor = {
        best_reps: 10,
        last_updated: now - 172800000, // 2 days ago
      };

      defaultProps = {
        exerciseId: 'days_ago',
        anchor: daysAgoAnchor,
        onSave: mockOnSave,
      };

      render(<AnchorCard {...defaultProps} />);

      expect(screen.getByText(/2天前/)).toBeInTheDocument();
    });

    it('should display weeks ago', () => {
      const now = Date.now();
      const weeksAgoAnchor: LoadAnchor = {
        best_reps: 10,
        last_updated: now - 1209600000, // 2 weeks ago
      };

      defaultProps = {
        exerciseId: 'weeks_ago',
        anchor: weeksAgoAnchor,
        onSave: mockOnSave,
      };

      render(<AnchorCard {...defaultProps} />);

      expect(screen.getByText(/2周前/)).toBeInTheDocument();
    });
  });

  describe('Edge cases', () => {
    it('should handle empty anchor values', () => {
      const emptyAnchor: LoadAnchor = {
        last_updated: Date.now(),
      };

      defaultProps = {
        exerciseId: 'empty',
        anchor: emptyAnchor,
        onSave: mockOnSave,
      };

      render(<AnchorCard {...defaultProps} />);

      expect(screen.getByText('暂无数据')).toBeInTheDocument();
      expect(screen.getByText('未分类')).toBeInTheDocument();
    });

    it('should handle partial anchor data', () => {
      const partialAnchor: LoadAnchor = {
        best_weight: 100,
        last_updated: Date.now(),
      };

      defaultProps = {
        exerciseId: 'partial',
        anchor: partialAnchor,
        onSave: mockOnSave,
      };

      render(<AnchorCard {...defaultProps} />);

      expect(screen.getByText(/100kg/)).toBeInTheDocument();
    });
  });
});
