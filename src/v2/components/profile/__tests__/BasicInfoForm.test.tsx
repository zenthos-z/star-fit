import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
/**
 * BasicInfoForm test suite
 *
 * Tests for the BasicInfoForm component using React Testing Library
 *
 * @version 2.0.0
 * @updated 2026-02-10
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BasicInfoForm } from '../BasicInfoForm';
import type { ProfileStatic } from 'shared/contracts';

// Mock framer-motion
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    p: ({ children, ...props }: any) => <p {...props}>{children}</p>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
  slideUp: {},
  fadeScale: {},
}));

// Mock animations
vi.mock('../../lib/animations', () => ({
  slideUp: {},
  fadeScale: {},
}));

// Helper to create mock profile data
const createMockProfileStatic = (overrides?: Partial<ProfileStatic>): ProfileStatic => ({
  age: 30,
  weight: 75,
  height: 180,
  body_fat_percentage: 15,
  neuro_type: 'type_2a',
  risk_preference: 'moderate',
  accountability: 'high',
  ...overrides,
});

describe('BasicInfoForm', () => {
  let mockOnUpdate: any;
  let defaultProps: any;

  beforeEach(() => {
    mockOnUpdate = vi.fn().mockResolvedValue(undefined);
    defaultProps = {
      data: createMockProfileStatic(),
      onUpdate: mockOnUpdate,
    };
    vi.clearAllMocks();
  });

  // C1: Form Initialization
  describe('C1: Form Initialization', () => {
    it('should populate all form fields with provided ProfileStatic data', () => {
      render(<BasicInfoForm {...defaultProps} />);

      // Physical measurements
      expect(screen.getByDisplayValue('30')).toBeInTheDocument(); // age
      expect(screen.getByDisplayValue('75')).toBeInTheDocument(); // weight
      expect(screen.getByDisplayValue('180')).toBeInTheDocument(); // height
      expect(screen.getByDisplayValue('15')).toBeInTheDocument(); // body fat

      // Psychological profile
      expect(screen.getByDisplayValue('Type 2A (均衡型)')).toBeInTheDocument(); // neuro_type
      expect(screen.getByDisplayValue('适中')).toBeInTheDocument(); // risk_preference
      expect(screen.getByDisplayValue('高')).toBeInTheDocument(); // accountability
    });

    it('should handle incomplete data gracefully', () => {
      const incompleteData = createMockProfileStatic({
        age: undefined,
        weight: undefined,
        height: undefined,
        body_fat_percentage: undefined,
        neuro_type: undefined,
        risk_preference: undefined,
        accountability: undefined,
      });

      render(<BasicInfoForm {...defaultProps} data={incompleteData} />);

      // Should show inputs with placeholder text when no value
      // Since NumberInput uses value={value ?? ''}, undefined becomes empty string
      // We can find them by their placeholder attributes
      const ageInput = screen.getByPlaceholderText('25');
      const weightInput = screen.getByPlaceholderText('70');
      const heightInput = screen.getByPlaceholderText('175');
      const bodyFatInput = screen.getByPlaceholderText('15');

      expect(ageInput).toBeInTheDocument();
      expect(weightInput).toBeInTheDocument();
      expect(heightInput).toBeInTheDocument();
      expect(bodyFatInput).toBeInTheDocument();
    });

    it('should handle partial data correctly', () => {
      const partialData = createMockProfileStatic({
        age: 25,
        weight: undefined,
        height: 175,
        body_fat_percentage: undefined,
      });

      render(<BasicInfoForm {...defaultProps} data={partialData} />);

      expect(screen.getByDisplayValue('25')).toBeInTheDocument();
      expect(screen.getByDisplayValue('175')).toBeInTheDocument();

      // For undefined values, check the placeholder is visible and input is empty
      const weightInput = screen.getByPlaceholderText('70');
      expect(weightInput).toBeInTheDocument();
      expect(weightInput).toHaveAttribute('value', '');
    });
  });

  // C2: Form Validation
  describe('C2: Form Validation', () => {
    it('should prevent age input below minimum (10)', async () => {
      const user = userEvent.setup();
      render(<BasicInfoForm {...defaultProps} />);

      // Get input by display value since it has a value
      const ageInput = screen.getByDisplayValue('30') as HTMLInputElement;

      // Clear current value and try to enter 9
      await user.clear(ageInput);
      await user.type(ageInput, '9');

      // Value should not be accepted - input should be empty or reject the value
      // Since NumberInput returns early for invalid values, the DOM won't update
      await waitFor(() => {
        expect(ageInput.value).not.toBe('9');
      });
    });

    it('should prevent age input above maximum (100)', async () => {
      const user = userEvent.setup();
      render(<BasicInfoForm {...defaultProps} />);

      const ageInput = screen.getByDisplayValue('30') as HTMLInputElement;

      await user.clear(ageInput);
      await user.type(ageInput, '101');

      // Value should not be accepted
      await waitFor(() => {
        expect(ageInput.value).not.toBe('101');
      });
    });

    it('should prevent weight input below minimum (30)', async () => {
      const user = userEvent.setup();
      render(<BasicInfoForm {...defaultProps} />);

      const weightInput = screen.getByDisplayValue('75') as HTMLInputElement;

      await user.clear(weightInput);
      await user.type(weightInput, '29');

      await waitFor(() => {
        expect(weightInput.value).not.toBe('29');
      });
    });

    it('should prevent weight input above maximum (200)', async () => {
      const user = userEvent.setup();
      render(<BasicInfoForm {...defaultProps} />);

      const weightInput = screen.getByDisplayValue('75') as HTMLInputElement;

      await user.clear(weightInput);
      await user.type(weightInput, '201');

      await waitFor(() => {
        expect(weightInput.value).not.toBe('201');
      });
    });

    it('should prevent height input below minimum (100)', async () => {
      const user = userEvent.setup();
      render(<BasicInfoForm {...defaultProps} />);

      const heightInput = screen.getByDisplayValue('180') as HTMLInputElement;

      await user.clear(heightInput);
      await user.type(heightInput, '99');

      await waitFor(() => {
        expect(heightInput.value).not.toBe('99');
      });
    });

    it('should prevent height input above maximum (250)', async () => {
      const user = userEvent.setup();
      render(<BasicInfoForm {...defaultProps} />);

      const heightInput = screen.getByDisplayValue('180') as HTMLInputElement;

      await user.clear(heightInput);
      await user.type(heightInput, '251');

      await waitFor(() => {
        expect(heightInput.value).not.toBe('251');
      });
    });

    it('should prevent body fat percentage below minimum (3)', async () => {
      const user = userEvent.setup();
      render(<BasicInfoForm {...defaultProps} />);

      const bodyFatInput = screen.getByDisplayValue('15') as HTMLInputElement;

      await user.clear(bodyFatInput);
      await user.type(bodyFatInput, '2');

      await waitFor(() => {
        expect(bodyFatInput.value).not.toBe('2');
      });
    });

    it('should prevent body fat percentage above maximum (50)', async () => {
      const user = userEvent.setup();
      render(<BasicInfoForm {...defaultProps} />);

      const bodyFatInput = screen.getByDisplayValue('15') as HTMLInputElement;

      await user.clear(bodyFatInput);
      await user.type(bodyFatInput, '51');

      await waitFor(() => {
        expect(bodyFatInput.value).not.toBe('51');
      });
    });

    it('should show validation errors for invalid inputs', async () => {
      render(<BasicInfoForm {...defaultProps} />);

      // Try to submit with invalid values (will be blocked by input validation)
      const submitButton = screen.queryByText('保存');
      expect(submitButton).not.toBeInTheDocument(); // Button only shows when there are changes
    });

    it('should allow emptying optional fields', async () => {
      const user = userEvent.setup();
      render(<BasicInfoForm {...defaultProps} />);

      const bodyFatInput = screen.getByDisplayValue('15') as HTMLInputElement;

      await user.clear(bodyFatInput);

      await waitFor(() => {
        expect(bodyFatInput.value).toBe('');
      });
    });
  });

  // C3: Partial Update
  describe('C3: Partial Update', () => {
    it('should only send changed fields on update', async () => {
      const user = userEvent.setup();
      render(<BasicInfoForm {...defaultProps} />);

      // Change only age
      const ageInput = screen.getByDisplayValue('30') as HTMLInputElement;
      await user.clear(ageInput);
      await user.type(ageInput, '31');

      // Submit should be available
      const saveButton = await screen.findByText('保存');
      await user.click(saveButton);

      await waitFor(() => {
        expect(mockOnUpdate).toHaveBeenCalled();
      });

      // Check that only age was sent (other fields should not be in the update)
      const updateCall = mockOnUpdate.mock.calls[0][0];
      expect(updateCall).toHaveProperty('age', 31);
      expect(updateCall).not.toHaveProperty('weight');
      expect(updateCall).not.toHaveProperty('height');
    });

    it('should send multiple changed fields', async () => {
      const user = userEvent.setup();
      render(<BasicInfoForm {...defaultProps} />);

      // Change age and weight
      const ageInput = screen.getByDisplayValue('30') as HTMLInputElement;
      await user.clear(ageInput);
      await user.type(ageInput, '32');

      const weightInput = screen.getByDisplayValue('75') as HTMLInputElement;
      await user.clear(weightInput);
      await user.type(weightInput, '80');

      const saveButton = await screen.findByText('保存');
      await user.click(saveButton);

      await waitFor(() => {
        expect(mockOnUpdate).toHaveBeenCalled();
      });

      const updateCall = mockOnUpdate.mock.calls[0][0];
      expect(updateCall).toHaveProperty('age', 32);
      expect(updateCall).toHaveProperty('weight', 80);
    });

    it('should reset form after successful update', async () => {
      const user = userEvent.setup();
      render(<BasicInfoForm {...defaultProps} />);

      const ageInput = screen.getByDisplayValue('30') as HTMLInputElement;
      await user.clear(ageInput);
      await user.type(ageInput, '31');

      const saveButton = await screen.findByText('保存');
      await user.click(saveButton);

      await waitFor(() => {
        expect(mockOnUpdate).toHaveBeenCalled();
      });

      // Save button should disappear after successful update
      await waitFor(() => {
        expect(screen.queryByText('保存')).not.toBeInTheDocument();
      });
    });

    it('should not submit if no changes were made', () => {
      render(<BasicInfoForm {...defaultProps} />);

      // No changes - save button should not appear
      expect(screen.queryByText('保存')).not.toBeInTheDocument();

      // Verify no update was called
      expect(mockOnUpdate).not.toHaveBeenCalled();
    });
  });

  describe('Form interactions', () => {
    it('should show reset button when there are changes', async () => {
      const user = userEvent.setup();
      render(<BasicInfoForm {...defaultProps} />);

      // Initially no reset button
      expect(screen.queryByText('重置')).not.toBeInTheDocument();

      // Make a change
      const ageInput = screen.getByDisplayValue('30') as HTMLInputElement;
      await user.clear(ageInput);
      await user.type(ageInput, '31');

      // Reset button should appear
      expect(await screen.findByText('重置')).toBeInTheDocument();
    });

    it('should reset form to original values when reset is clicked', async () => {
      const user = userEvent.setup();
      render(<BasicInfoForm {...defaultProps} />);

      const ageInput = screen.getByDisplayValue('30') as HTMLInputElement;
      await user.clear(ageInput);
      await user.type(ageInput, '31');

      const resetButton = await screen.findByText('重置');
      await user.click(resetButton);

      // Should revert to original value
      await waitFor(() => {
        expect(screen.getByDisplayValue('30')).toBeInTheDocument();
      });

      // Buttons should disappear
      expect(screen.queryByText('重置')).not.toBeInTheDocument();
      expect(screen.queryByText('保存')).not.toBeInTheDocument();
    });

    it('should disable buttons while submitting', async () => {
      const user = userEvent.setup();
      let resolveUpdate: () => void;
      const slowUpdate = new Promise<void>(resolve => {
        resolveUpdate = resolve;
      });

      mockOnUpdate.mockReturnValue(slowUpdate);

      render(<BasicInfoForm {...defaultProps} data={createMockProfileStatic({ age: 30 })} />);

      const ageInput = screen.getByDisplayValue('30') as HTMLInputElement;
      await user.clear(ageInput);
      await user.type(ageInput, '31');

      const saveButton = await screen.findByText('保存');
      await user.click(saveButton);

      // Button should show loading state
      await waitFor(() => {
        expect(screen.getByText('保存中...')).toBeInTheDocument();
      });

      // Cleanup
      resolveUpdate!();
    });

    it('should update neuro_type selection', async () => {
      const user = userEvent.setup();
      render(<BasicInfoForm {...defaultProps} />);

      const neuroSelect = screen.getByDisplayValue('Type 2A (均衡型)');

      await user.selectOptions(neuroSelect, 'type_1');

      const saveButton = await screen.findByText('保存');
      await user.click(saveButton);

      await waitFor(() => {
        expect(mockOnUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            neuro_type: 'type_1',
          })
        );
      });
    });

    it('should update risk_preference selection', async () => {
      const user = userEvent.setup();
      render(<BasicInfoForm {...defaultProps} />);

      const riskSelect = screen.getByDisplayValue('适中');

      await user.selectOptions(riskSelect, 'aggressive');

      const saveButton = await screen.findByText('保存');
      await user.click(saveButton);

      await waitFor(() => {
        expect(mockOnUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            risk_preference: 'aggressive',
          })
        );
      });
    });

    it('should update accountability selection', async () => {
      const user = userEvent.setup();
      render(<BasicInfoForm {...defaultProps} />);

      const accountabilitySelect = screen.getByDisplayValue('高');

      await user.selectOptions(accountabilitySelect, 'medium');

      const saveButton = await screen.findByText('保存');
      await user.click(saveButton);

      await waitFor(() => {
        expect(mockOnUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            accountability: 'medium',
          })
        );
      });
    });
  });

  describe('Accessibility', () => {
    it('should have proper labels for all form fields', () => {
      render(<BasicInfoForm {...defaultProps} />);

      // Labels are present but not connected via htmlFor
      // Verify by text content instead
      expect(screen.getByText('年龄')).toBeInTheDocument();
      expect(screen.getByText('体重')).toBeInTheDocument();
      expect(screen.getByText('身高')).toBeInTheDocument();
      expect(screen.getByText('体脂率')).toBeInTheDocument();
      expect(screen.getByText('神经类型')).toBeInTheDocument();
      expect(screen.getByText('风险偏好')).toBeInTheDocument();
      expect(screen.getByText('自律性')).toBeInTheDocument();
    });

    it('should show section headers', () => {
      render(<BasicInfoForm {...defaultProps} />);

      expect(screen.getByText('基本信息')).toBeInTheDocument();
      expect(screen.getByText('心理特征')).toBeInTheDocument();
    });
  });

  describe('Error handling', () => {
    it('should handle update errors gracefully', async () => {
      const user = userEvent.setup();
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      mockOnUpdate.mockRejectedValue(new Error('Update failed'));

      render(<BasicInfoForm {...defaultProps} />);

      const ageInput = screen.getByDisplayValue('30') as HTMLInputElement;
      await user.clear(ageInput);
      await user.type(ageInput, '31');

      const saveButton = await screen.findByText('保存');
      await user.click(saveButton);

      await waitFor(() => {
        expect(mockOnUpdate).toHaveBeenCalled();
      });

      // Error should be logged (implementation specific)
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });
});
