/**
 * BasicInfoForm - User Basic Information Form
 *
 * Form for editing user basic information (age, weight, height, body fat, etc.)
 * Uses ProfileStatic type from shared/contracts
 *
 * @version 2.0.0
 */

import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ProfileStatic } from 'shared/contracts';
import { slideUp, fadeScale } from '../../lib/animations';

// ============================================================================
// Types
// ============================================================================

interface BasicInfoFormProps {
  /** Profile static data */
  data: ProfileStatic;
  /** Callback when form is submitted */
  onUpdate: (updates: Partial<ProfileStatic>) => Promise<void>;
  /** Optional className for styling */
  className?: string;
}

interface FormFieldProps {
  label: string;
  children: React.ReactNode;
  error?: string;
}

// ============================================================================
// Constants
// ============================================================================

const NEURO_TYPE_OPTIONS = [
  { value: 'UNKNOWN', label: '未知' },
  { value: 'type_1', label: 'Type 1 (耐力型)' },
  { value: 'type_2a', label: 'Type 2A (均衡型)' },
  { value: 'type_2b', label: 'Type 2B (力量型)' },
  { value: 'type_3', label: 'Type 3 (神经敏感型)' },
] as const;

const RISK_PREFERENCE_OPTIONS = [
  { value: 'UNKNOWN', label: '未知' },
  { value: 'conservative', label: '保守' },
  { value: 'moderate', label: '适中' },
  { value: 'aggressive', label: '激进' },
] as const;

const ACCOUNTABILITY_OPTIONS = [
  { value: 'UNKNOWN', label: '未知' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
] as const;

// ============================================================================
// Components
// ============================================================================

function FormField({ label, children, error }: FormFieldProps): JSX.Element {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-semibold text-gray-700">
        {label}
      </label>
      {children}
      <AnimatePresence>
        {error && (
          <motion.p
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="text-xs text-red-500"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  placeholder,
  suffix,
}: {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  min?: number;
  max?: number;
  placeholder?: string;
  suffix?: string;
}): JSX.Element {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      if (val === '') {
        onChange(undefined);
        return;
      }
      const num = parseFloat(val);
      if (!isNaN(num)) {
        if (min !== undefined && num < min) return;
        if (max !== undefined && num > max) return;
        onChange(num);
      }
    },
    [onChange, min, max]
  );

  return (
    <div className="relative">
      <input
        type="number"
        value={value ?? ''}
        onChange={handleChange}
        placeholder={placeholder}
        className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-900
                   placeholder:text-gray-400
                   focus:border-star-accent focus:outline-none focus:ring-0
                   transition-colors"
      />
      {suffix && (
        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-gray-500">
          {suffix}
        </span>
      )}
    </div>
  );
}

function SelectInput({
  value,
  onChange,
  options,
}: {
  value: string | undefined;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
}): JSX.Element {
  return (
    <select
      value={value ?? 'UNKNOWN'}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-2xl border-2 border-gray-200 px-4 py-3 text-gray-900
                 bg-white
                 focus:border-star-accent focus:outline-none focus:ring-0
                 transition-colors appearance-none cursor-pointer"
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%236B7280'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 12px center',
        backgroundSize: '20px',
      }}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function BasicInfoForm({
  data,
  onUpdate,
  className = '',
}: BasicInfoFormProps): JSX.Element {
  const [formData, setFormData] = useState<ProfileStatic>({
    age: data.age,
    weight: data.weight,
    height: data.height,
    body_fat_percentage: data.body_fat_percentage,
    neuro_type: data.neuro_type,
    risk_preference: data.risk_preference,
    accountability: data.accountability,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const handleFieldChange = useCallback(
    <K extends keyof ProfileStatic>(field: K, value: ProfileStatic[K]) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
      setHasChanges(true);
    },
    []
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!hasChanges) return;

      setIsSubmitting(true);
      try {
        // Only send changed fields
        const updates: Partial<ProfileStatic> = {};
        (Object.keys(formData) as Array<keyof ProfileStatic>).forEach((key) => {
          if (formData[key] !== data[key]) {
            updates[key] = formData[key] as never;
          }
        });

        await onUpdate(updates);
        setHasChanges(false);
      } finally {
        setIsSubmitting(false);
      }
    },
    [formData, data, hasChanges, onUpdate]
  );

  const handleReset = useCallback(() => {
    setFormData({
      age: data.age,
      weight: data.weight,
      height: data.height,
      body_fat_percentage: data.body_fat_percentage,
      neuro_type: data.neuro_type,
      risk_preference: data.risk_preference,
      accountability: data.accountability,
    });
    setHasChanges(false);
  }, [data]);

  return (
    <motion.div
      variants={slideUp}
      initial="initial"
      animate="animate"
      className={`bg-white rounded-2xl border border-gray-100 shadow-sm p-4 ${className}`}
    >
      <h2 className="text-xl font-black text-star-dark italic uppercase mb-4">
        基本信息
      </h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Physical Measurements */}
        <div className="grid grid-cols-2 gap-4">
          <FormField label="年龄">
            <NumberInput
              value={formData.age}
              onChange={(v) => handleFieldChange('age', v)}
              min={10}
              max={100}
              placeholder="25"
              suffix="岁"
            />
          </FormField>

          <FormField label="体重">
            <NumberInput
              value={formData.weight}
              onChange={(v) => handleFieldChange('weight', v)}
              min={30}
              max={200}
              placeholder="70"
              suffix="kg"
            />
          </FormField>

          <FormField label="身高">
            <NumberInput
              value={formData.height}
              onChange={(v) => handleFieldChange('height', v)}
              min={100}
              max={250}
              placeholder="175"
              suffix="cm"
            />
          </FormField>

          <FormField label="体脂率">
            <NumberInput
              value={formData.body_fat_percentage}
              onChange={(v) => handleFieldChange('body_fat_percentage', v)}
              min={3}
              max={50}
              placeholder="15"
              suffix="%"
            />
          </FormField>
        </div>

        {/* Psychological Profile */}
        <div className="space-y-4 pt-4 border-t border-gray-100">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
            心理特征
          </h3>

          <FormField label="神经类型">
            <SelectInput
              value={formData.neuro_type}
              onChange={(v) =>
                handleFieldChange(
                  'neuro_type',
                  v as ProfileStatic['neuro_type']
                )
              }
              options={NEURO_TYPE_OPTIONS}
            />
          </FormField>

          <div className="grid grid-cols-2 gap-4">
            <FormField label="风险偏好">
              <SelectInput
                value={formData.risk_preference}
                onChange={(v) =>
                  handleFieldChange(
                    'risk_preference',
                    v as ProfileStatic['risk_preference']
                  )
                }
                options={RISK_PREFERENCE_OPTIONS}
              />
            </FormField>

            <FormField label="自律性">
              <SelectInput
                value={formData.accountability}
                onChange={(v) =>
                  handleFieldChange(
                    'accountability',
                    v as ProfileStatic['accountability']
                  )
                }
                options={ACCOUNTABILITY_OPTIONS}
              />
            </FormField>
          </div>
        </div>

        {/* Actions */}
        <AnimatePresence>
          {hasChanges && (
            <motion.div
              variants={fadeScale}
              initial="initial"
              animate="animate"
              exit="exit"
              className="flex gap-3 pt-4"
            >
              <button
                type="button"
                onClick={handleReset}
                disabled={isSubmitting}
                className="flex-1 rounded-[2rem] border-2 border-gray-200 py-3 px-6
                           font-semibold text-gray-700
                           hover:bg-gray-50
                           disabled:opacity-50 disabled:cursor-not-allowed
                           transition-colors"
              >
                重置
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 rounded-[2rem] bg-star-dark py-3 px-6
                           font-black text-white italic uppercase
                           hover:bg-star-dark/90
                           disabled:opacity-50 disabled:cursor-not-allowed
                           transition-colors flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-r-transparent" />
                    保存中...
                  </>
                ) : (
                  '保存'
                )}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </form>
    </motion.div>
  );
}

export default BasicInfoForm;
