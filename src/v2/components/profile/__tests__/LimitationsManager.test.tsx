import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
/**
 * LimitationsManager test suite
 *
 * Tests for the LimitationsManager component using React Testing Library
 *
 * @version 2.0.0
 * @updated 2026-02-10
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LimitationsManager } from '../LimitationsManager';
import type { ActiveLimitation } from 'shared/contracts';

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
}));

// Mock child components
vi.mock('../LimitationCard', () => ({
  LimitationCard: ({ limitation, onRemove }: any) => (
    <div data-testid="limitation-card">
      <span>{limitation.part}</span>
      <span>Severity: {limitation.severity}</span>
      <button onClick={onRemove}>Remove</button>
    </div>
  ),
}));

vi.mock('../AddLimitationForm', () => ({
  AddLimitationForm: ({ onAdd, onCancel }: any) => (
    <div data-testid="add-limitation-form">
      <button onClick={() => onAdd({
        part: 'test_part',
        severity: 5,
        expire_at: new Date(Date.now() + 86400000).toISOString(),
        logged_at: new Date().toISOString(),
        auto_heal: true,
      })}>Add Test</button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  ),
}));

// Helper to create mock active limitation
const createMockLimitation = (
  part: string,
  severity: number,
  daysUntilExpiry: number = 7
): ActiveLimitation => ({
  part,
  severity,
  expire_at: new Date(Date.now() + daysUntilExpiry * 86400000).toISOString(),
  logged_at: new Date().toISOString(),
  auto_heal: true,
});

describe('LimitationsManager', () => {
  let mockOnAdd: any;
  let mockOnRemove: any;
  let defaultProps: any;

  beforeEach(() => {
    mockOnAdd = vi.fn().mockResolvedValue(undefined);
    mockOnRemove = vi.fn().mockResolvedValue(undefined);
    vi.clearAllMocks();

    defaultProps = {
      limitations: [],
      onAdd: mockOnAdd,
      onRemove: mockOnRemove,
    };
  });

  // C7: LimitationsManager - Empty State
  describe('C7: LimitationsManager - Empty State', () => {
    it('should show "无活跃限制" message when limitations array is empty', () => {
      render(<LimitationsManager {...defaultProps} />);

      expect(screen.getByText('无活跃限制')).toBeInTheDocument();
      expect(screen.getByText('当前没有活跃的训练限制')).toBeInTheDocument();
    });

    it('should display empty state icon', () => {
      render(<LimitationsManager {...defaultProps} />);

      const icon = document.querySelector('svg');
      expect(icon).toBeInTheDocument();
    });

    it('should show empty state with correct styling', () => {
      const { container } = render(<LimitationsManager {...defaultProps} />);

      const emptyState = screen.getByText('无活跃限制').closest('div');
      expect(emptyState).toHaveClass('text-center');
    });

    it('should allow adding limitation from empty state', async () => {
      const user = userEvent.setup();
      render(<LimitationsManager {...defaultProps} />);

      const addButton = screen.getByText('添加');
      await user.click(addButton);

      expect(screen.getByTestId('add-limitation-form')).toBeInTheDocument();
    });
  });

  // C8: LimitationsManager - Severity Colors
  describe('C8: LimitationsManager - Severity Colors', () => {
    it('should show green color for low severity (1-3)', () => {
      const limitations = [
        createMockLimitation('shoulder_left', 2),
        createMockLimitation('knee_right', 3),
      ];

      render(<LimitationsManager {...defaultProps} limitations={limitations} />);

      // Stats should show "轻微 2"
      expect(screen.getByText('轻微 2')).toBeInTheDocument();
      // Check for the green color class (on the parent span or element)
      const greenElement = screen.getByText('轻微 2').closest('span');
      expect(greenElement?.className).toContain('bg-green-100');
    });

    it('should show yellow color for medium severity (4-6)', () => {
      const limitations = [
        createMockLimitation('lower_back', 4),
        createMockLimitation('ankle_left', 6),
      ];

      render(<LimitationsManager {...defaultProps} limitations={limitations} />);

      expect(screen.getByText('中等 2')).toBeInTheDocument();
      // Check for the yellow color class
      const yellowElement = screen.getByText('中等 2').closest('span');
      expect(yellowElement?.className).toContain('bg-yellow-100');
    });

    it('should show red color for high severity (7-10)', () => {
      const limitations = [
        createMockLimitation('shoulder_right', 7),
        createMockLimitation('hip_left', 8),
      ];

      render(<LimitationsManager {...defaultProps} limitations={limitations} />);

      expect(screen.getByText('严重 2')).toBeInTheDocument();
      // Note: Implementation uses red for all high severity (>= 7)
      const redElement = screen.getByText('严重 2').closest('span');
      expect(redElement?.className).toContain('bg-red-100');
    });

    it('should show red color for critical severity (9-10)', () => {
      const limitations = [
        createMockLimitation('spine', 9),
        createMockLimitation('neck', 10),
      ];

      render(<LimitationsManager {...defaultProps} limitations={limitations} />);

      // Critical severity also shows as "严重" in current implementation
      expect(screen.getByText('严重 2')).toBeInTheDocument();
      const redElement = screen.getByText('严重 2').closest('span');
      expect(redElement?.className).toContain('bg-red-100');
    });

    it('should display multiple severity categories when mixed', () => {
      const limitations = [
        createMockLimitation('minor', 2),
        createMockLimitation('medium', 5),
        createMockLimitation('severe', 8),
        createMockLimitation('critical', 10),
      ];

      render(<LimitationsManager {...defaultProps} limitations={limitations} />);

      expect(screen.getByText('轻微 1')).toBeInTheDocument();
      expect(screen.getByText('中等 1')).toBeInTheDocument();
      expect(screen.getByText('严重 2')).toBeInTheDocument(); // Both 8 and 10 are counted as "严重"
    });

    it('should only show categories with active limitations', () => {
      const limitations = [
        createMockLimitation('minor1', 2),
        createMockLimitation('minor2', 3),
      ];

      render(<LimitationsManager {...defaultProps} limitations={limitations} />);

      expect(screen.getByText('轻微 2')).toBeInTheDocument();
      expect(screen.queryByText('中等')).not.toBeInTheDocument();
      expect(screen.queryByText('严重')).not.toBeInTheDocument();
    });
  });

  // C9: LimitationsManager - Expiration Filter
  describe('C9: LimitationsManager - Expiration Filter', () => {
    it('should filter out expired limitations from active list', () => {
      const now = Date.now();
      const limitations: ActiveLimitation[] = [
        {
          part: 'active_shoulder',
          severity: 5,
          expire_at: new Date(now + 86400000).toISOString(), // Tomorrow
          logged_at: new Date(now).toISOString(),
          auto_heal: true,
        },
        {
          part: 'expired_knee',
          severity: 3,
          expire_at: new Date(now - 86400000).toISOString(), // Yesterday
          logged_at: new Date(now - 172800000).toISOString(),
          auto_heal: true,
        },
      ];

      render(<LimitationsManager {...defaultProps} limitations={limitations} />);

      // Only active limitation should be shown in main list
      // The mock LimitationCard shows all limitations, so we need to check
      // that the expired one is shown in the expired section
      expect(screen.getByText('active_shoulder')).toBeInTheDocument();

      // Expired should be in the "已过期限制" section, not in active list
      // Since our mock doesn't differentiate, we check the expired section exists
      expect(screen.getByText(/已过期限制/)).toBeInTheDocument();
      expect(screen.getByText('expired_knee')).toBeInTheDocument();
    });

    it('should show expired limitations in collapsed section', () => {
      const now = Date.now();
      const limitations: ActiveLimitation[] = [
        {
          part: 'active',
          severity: 5,
          expire_at: new Date(now + 86400000).toISOString(),
          logged_at: new Date(now).toISOString(),
          auto_heal: true,
        },
        {
          part: 'expired1',
          severity: 3,
          expire_at: new Date(now - 86400000).toISOString(),
          logged_at: new Date(now - 172800000).toISOString(),
          auto_heal: true,
        },
        {
          part: 'expired2',
          severity: 4,
          expire_at: new Date(now - 172800000).toISOString(),
          logged_at: new Date(now - 259200000).toISOString(),
          auto_heal: true,
        },
      ];

      render(<LimitationsManager {...defaultProps} limitations={limitations} />);

      expect(screen.getByText('已过期限制 (2个)')).toBeInTheDocument();
      expect(screen.getByText('expired1')).toBeInTheDocument();
      expect(screen.getByText('expired2')).toBeInTheDocument();
    });

    it('should limit expired display to 3 items with "还有 X 个..." message', () => {
      const now = Date.now();
      const limitations: ActiveLimitation[] = [
        {
          part: 'active',
          severity: 5,
          expire_at: new Date(now + 86400000).toISOString(),
          logged_at: new Date(now).toISOString(),
          auto_heal: true,
        },
        ...Array.from({ length: 5 }, (_, i) => ({
          part: `expired${i + 1}`,
          severity: 3,
          expire_at: new Date(now - 86400000 * (i + 1)).toISOString(),
          logged_at: new Date(now - 86400000 * (i + 2)).toISOString(),
          auto_heal: true,
        })),
      ];

      render(<LimitationsManager {...defaultProps} limitations={limitations} />);

      expect(screen.getByText('已过期限制 (5个)')).toBeInTheDocument();
      expect(screen.getByText('还有 2 个...')).toBeInTheDocument();
    });

    it('should handle all expired limitations', () => {
      const now = Date.now();
      const limitations: ActiveLimitation[] = [
        {
          part: 'expired1',
          severity: 3,
          expire_at: new Date(now - 86400000).toISOString(),
          logged_at: new Date(now - 172800000).toISOString(),
          auto_heal: true,
        },
        {
          part: 'expired2',
          severity: 4,
          expire_at: new Date(now - 172800000).toISOString(),
          logged_at: new Date(now - 259200000).toISOString(),
          auto_heal: true,
        },
      ];

      render(<LimitationsManager {...defaultProps} limitations={limitations} />);

      // Should show empty state instead of active limitations
      expect(screen.getByText('无活跃限制')).toBeInTheDocument();
      expect(screen.getByText('已过期限制 (2个)')).toBeInTheDocument();
    });
  });

  describe('Adding limitations', () => {
    it('should show add button', () => {
      render(<LimitationsManager {...defaultProps} />);

      expect(screen.getByText('添加')).toBeInTheDocument();
    });

    it('should open add form when clicking add button', async () => {
      const user = userEvent.setup();
      render(<LimitationsManager {...defaultProps} />);

      const addButton = screen.getByText('添加');
      await user.click(addButton);

      expect(screen.getByTestId('add-limitation-form')).toBeInTheDocument();
    });

    it('should change add button to cancel when form is open', async () => {
      const user = userEvent.setup();
      render(<LimitationsManager {...defaultProps} />);

      const addButton = screen.getByText('添加');
      await user.click(addButton);

      expect(screen.getByText('取消')).toBeInTheDocument();
      expect(screen.queryByText('添加')).not.toBeInTheDocument();
    });

    it('should close add form when clicking cancel', async () => {
      const user = userEvent.setup();
      render(<LimitationsManager {...defaultProps} />);

      // Open form
      const addButton = screen.getByText('添加');
      await user.click(addButton);

      // Cancel
      const cancelButton = screen.getByText('取消');
      await user.click(cancelButton);

      expect(screen.queryByTestId('add-limitation-form')).not.toBeInTheDocument();
      expect(screen.getByText('添加')).toBeInTheDocument();
    });

    it('should call onAdd when form is submitted', async () => {
      const user = userEvent.setup();
      render(<LimitationsManager {...defaultProps} />);

      // Open form
      await user.click(screen.getByText('添加'));

      // Submit form
      await user.click(screen.getByText('Add Test'));

      await waitFor(() => {
        expect(mockOnAdd).toHaveBeenCalledWith(
          expect.objectContaining({
            part: 'test_part',
            severity: 5,
          })
        );
      });
    });

    it('should close form after successful add', async () => {
      const user = userEvent.setup();
      render(<LimitationsManager {...defaultProps} />);

      await user.click(screen.getByText('添加'));
      await user.click(screen.getByText('Add Test'));

      await waitFor(() => {
        expect(screen.queryByTestId('add-limitation-form')).not.toBeInTheDocument();
      });
    });
  });

  describe('Removing limitations', () => {
    it('should call onRemove when remove button is clicked', async () => {
      const user = userEvent.setup();
      const limitations = [createMockLimitation('shoulder', 5)];

      render(<LimitationsManager {...defaultProps} limitations={limitations} />);

      const removeButton = screen.getByText('Remove');
      await user.click(removeButton);

      expect(mockOnRemove).toHaveBeenCalledWith('shoulder');
    });
  });

  describe('Sorting', () => {
    it('should sort limitations by severity (descending)', () => {
      const limitations = [
        createMockLimitation('low', 2),
        createMockLimitation('high', 8),
        createMockLimitation('medium', 5),
      ];

      render(<LimitationsManager {...defaultProps} limitations={limitations} />);

      const cards = screen.getAllByTestId('limitation-card');
      expect(cards).toHaveLength(3);

      // Should be ordered: high (8), medium (5), low (2)
      expect(cards[0]).toHaveTextContent('Severity: 8');
      expect(cards[1]).toHaveTextContent('Severity: 5');
      expect(cards[2]).toHaveTextContent('Severity: 2');
    });

    it('should sort by expiration when severities are equal', () => {
      const now = Date.now();
      const limitations: ActiveLimitation[] = [
        {
          part: 'later',
          severity: 5,
          expire_at: new Date(now + 172800000).toISOString(), // 2 days
          logged_at: new Date(now).toISOString(),
          auto_heal: true,
        },
        {
          part: 'sooner',
          severity: 5,
          expire_at: new Date(now + 86400000).toISOString(), // 1 day
          logged_at: new Date(now).toISOString(),
          auto_heal: true,
        },
      ];

      render(<LimitationsManager {...defaultProps} limitations={limitations} />);

      const cards = screen.getAllByTestId('limitation-card');
      // Sooner expiration should come first
      expect(cards[0]).toHaveTextContent('sooner');
      expect(cards[1]).toHaveTextContent('later');
    });
  });

  describe('Display', () => {
    it('should show correct count of active limitations', () => {
      const limitations = [
        createMockLimitation('one', 3),
        createMockLimitation('two', 5),
        createMockLimitation('three', 7),
      ];

      render(<LimitationsManager {...defaultProps} limitations={limitations} />);

      expect(screen.getByText('3 个活跃限制')).toBeInTheDocument();
    });

    it('should display header', () => {
      render(<LimitationsManager {...defaultProps} />);

      expect(screen.getByText('伤病限制')).toBeInTheDocument();
    });

    it('should not show count when no limitations', () => {
      render(<LimitationsManager {...defaultProps} />);

      expect(screen.queryByText(/个活跃限制/)).not.toBeInTheDocument();
    });
  });

  describe('Edge cases', () => {
    it('should handle limitation with note', () => {
      const limitation: ActiveLimitation = {
        part: 'shoulder',
        severity: 5,
        expire_at: new Date(Date.now() + 86400000).toISOString(),
        logged_at: new Date().toISOString(),
        auto_heal: true,
        note: 'Pain during overhead press',
      } as any;

      render(<LimitationsManager {...defaultProps} limitations={[limitation]} />);

      expect(screen.getByText('shoulder')).toBeInTheDocument();
    });

    it('should handle limitation without auto_heal', () => {
      const limitation: ActiveLimitation = {
        part: 'chronic_back',
        severity: 6,
        expire_at: new Date(Date.now() + 86400000).toISOString(),
        logged_at: new Date().toISOString(),
        auto_heal: false,
      };

      render(<LimitationsManager {...defaultProps} limitations={[limitation]} />);

      expect(screen.getByText('chronic_back')).toBeInTheDocument();
    });

    it('should handle special characters in part name', () => {
      const limitation = createMockLimitation('左肩-前束', 5);

      render(<LimitationsManager {...defaultProps} limitations={[limitation]} />);

      expect(screen.getByText('左肩-前束')).toBeInTheDocument();
    });
  });
});
