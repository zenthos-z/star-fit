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
      // 允许任意中间态（逐键输入 '31' 时首键 '3' 可能低于 min，不能在此拒绝），
      // 范围钳制放到失焦时（handleBlur），保证键盘可正常输入多位数。
      if (!isNaN(num)) {
        onChange(num);
      }
    },
    [onChange]
  );

  const handleBlur = useCallback(() => {
    if (value === undefined) return;
    let clamped = value;
    if (min !== undefined && clamped < min) clamped = min;
    if (max !== undefined && clamped > max) clamped = max;
    if (clamped !== value) onChange(clamped);
  }, [value, min, max, onChange]);

  return (
    <div className="relative">
      <input
        type="number"
        value={value ?? ''}
        onChange={handleChange}
        onBlur={handleBlur}
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
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleFieldChange = useCallback(
    <K extends keyof ProfileStatic>(field: K, value: ProfileStatic[K]) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
      setHasChanges(true);
      setSubmitError(null);
    },
    []
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!hasChanges) return;

      setIsSubmitting(true);
      setSubmitError(null);
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
      } catch (err) {
        // 更新失败：展示错误并保留表单内容供重试，不让 rejection 变成 Unhandled Rejection
        setSubmitError(err instanceof Error ? err.message : '保存失败，请重试');
         
        console.error('[BasicInfoForm] update failed:', err);
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
      className={`bg-white rounded-[24px] shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-5 ${className}`}
    >
      <h2 className="text-lg font-bold text-gray-900 tracking-tight mb-4">
        基本信息
      </h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* 提交错误提示 */}
        {submitError && (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600"
          >
            {submitError}
          </div>
        )}

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
                className="flex-1 rounded-full border border-gray-200 py-3 px-6
                          font-semibold text-gray-700 bg-white
                          hover:bg-gray-50
                          disabled:opacity-50 disabled:cursor-not-allowed
                          transition-colors"
              >
                重置
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 rounded-full bg-star-accent py-3 px-6
                          font-semibold text-white
                          hover:bg-star-accent/90
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
