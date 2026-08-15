/**
 * AddLimitationForm - Form for adding new active limitations
 *
 * Form fields:
 * - Body part (dropdown with body part options)
 * - Severity (1-10 slider or number input)
 * - Expiration (preset days or custom)
 * - Note (optional description)
 *
 * @version 2.0.0
 */

import React, { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import type { ActiveLimitation } from 'shared/contracts';
import { fadeScale } from '../../lib/animations';

// ============================================================================
// Types
// ============================================================================

interface AddLimitationFormProps {
  /** Callback when form is submitted */
  onAdd: (limitation: Omit<ActiveLimitation, 'logged_at'>) => Promise<void>;
  /** Callback when form is cancelled */
  onCancel?: () => void;
}

// ============================================================================
// Constants
// ============================================================================

const BODY_PART_OPTIONS = [
  { value: 'head', label: '头部' },
  { value: 'neck', label: '颈部' },
  { value: 'shoulder', label: '肩部' },
  { value: 'chest', label: '胸部' },
  { value: 'upper_back', label: '上背' },
  { value: 'lower_back', label: '下背' },
  { value: 'waist', label: '腰部' },
  { value: 'hip', label: '臀部' },
  { value: 'thigh_front', label: '大腿前侧' },
  { value: 'thigh_back', label: '大腿后侧' },
  { value: 'knee', label: '膝盖' },
  { value: 'calf', label: '小腿' },
  { value: 'ankle', label: '脚踝' },
  { value: 'upper_arm', label: '上臂' },
  { value: 'forearm', label: '前臂' },
  { value: 'wrist', label: '手腕' },
  { value: 'elbow', label: '手肘' },
] as const;

const EXPIRATION_PRESETS = [
  { days: 3, label: '3天' },
  { days: 7, label: '7天' },
  { days: 14, label: '14天' },
  { days: 30, label: '30天' },
] as const;

// ============================================================================
// Components
// ============================================================================

function FormField({ label, children, error }: { label: string; children: React.ReactNode; error?: string }): JSX.Element {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-semibold text-gray-700">
        {label}
      </label>
      {children}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

function SeveritySlider({ value, onChange }: { value: number; onChange: (value: number) => void }): JSX.Element {
  const getColor = (v: number) => {
    if (v <= 3) return 'text-green-600';
    if (v <= 6) return 'text-yellow-600';
    if (v <= 8) return 'text-orange-600';
    return 'text-red-600';
  };

  const getLabel = (v: number) => {
    if (v <= 3) return '轻微';
    if (v <= 6) return '中等';
    if (v <= 8) return '严重';
    return '极严重';
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={1}
          max={10}
          value={value}
          onChange={(e) => onChange(parseInt(e.target.value))}
          className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-star-dark"
        />
        <div className="flex items-center gap-2 min-w-[80px]">
          <span className={`text-lg font-bold ${getColor(value)}`}>{value}</span>
          <span className="text-xs text-gray-500">{getLabel(value)}</span>
        </div>
      </div>
      <div className="flex justify-between text-xs text-gray-400 px-1">
        <span>1</span>
        <span>5</span>
        <span>10</span>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function AddLimitationForm({ onAdd, onCancel }: AddLimitationFormProps): JSX.Element {
  const [part, setPart] = useState<string>('');
  const [severity, setSeverity] = useState<number>(5);
  const [expirationDays, setExpirationDays] = useState<number>(7);
  const [customDays, setCustomDays] = useState<number | undefined>(undefined);
  const [note, setNote] = useState<string>('');
  const [autoHeal, setAutoHeal] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};

    if (!part) {
      newErrors.part = '请选择受伤部位';
    }

    if (severity < 1 || severity > 10) {
      newErrors.severity = '严重程度必须在 1-10 之间';
    }

    const days = customDays ?? expirationDays;
    if (!days || days < 1) {
      newErrors.expiration = '请输入有效的过期天数';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [part, severity, expirationDays, customDays]);

  const handleSubmit = useCallback(async () => {
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      const days = customDays ?? expirationDays;
      const expireAt = new Date();
      expireAt.setDate(expireAt.getDate() + days);

      await onAdd({
        part,
        severity,
        expire_at: expireAt.toISOString(),
        auto_heal: autoHeal,
        note: note || undefined,
      } as any);

      // Reset form
      setPart('');
      setSeverity(5);
      setExpirationDays(7);
      setCustomDays(undefined);
      setNote('');
      setErrors({});
    } finally {
      setIsSubmitting(false);
    }
  }, [part, severity, expirationDays, customDays, note, autoHeal, onAdd, validate]);

  return (
    <motion.div
      variants={fadeScale}
      initial="initial"
      animate="animate"
      exit="exit"
      className="bg-gray-50 rounded-xl p-4 border border-gray-200"
    >
      <h3 className="text-sm font-semibold text-gray-900 mb-4">添加新限制</h3>

      <div className="space-y-4">
        {/* Body Part */}
        <FormField label="受伤部位" error={errors.part}>
          <select
            value={part}
            onChange={(e) => setPart(e.target.value)}
            className="w-full rounded-xl border-2 border-gray-200 px-3 py-2 text-sm
                       bg-white focus:border-star-accent focus:outline-none
                       transition-colors appearance-none cursor-pointer"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%236B7280'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 8px center',
              backgroundSize: '16px',
            }}
          >
            <option value="">选择部位...</option>
            {BODY_PART_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </FormField>

        {/* Severity */}
        <FormField label="严重程度 (1-10)" error={errors.severity}>
          <SeveritySlider value={severity} onChange={setSeverity} />
        </FormField>

        {/* Expiration */}
        <FormField label="预计恢复时间" error={errors.expiration}>
          <div className="flex flex-wrap gap-2">
            {EXPIRATION_PRESETS.map((preset) => (
              <button
                key={preset.days}
                type="button"
                onClick={() => {
                  setExpirationDays(preset.days);
                  setCustomDays(undefined);
                }}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors
                  ${expirationDays === preset.days && customDays === undefined
                    ? 'bg-star-dark text-white'
                    : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
                  }`}
              >
                {preset.label}
              </button>
            ))}
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={customDays ?? ''}
                onChange={(e) => {
                  const val = parseInt(e.target.value);
                  setCustomDays(isNaN(val) ? undefined : val);
                }}
                placeholder="自定义"
                className="w-20 rounded-lg border-2 border-gray-200 px-2 py-1.5 text-sm
                           focus:border-star-accent focus:outline-none text-center"
              />
              <span className="text-sm text-gray-500">天</span>
            </div>
          </div>
        </FormField>

        {/* Note */}
        <FormField label="备注 (可选)">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="例如：运动中感到刺痛"
            className="w-full rounded-xl border-2 border-gray-200 px-3 py-2 text-sm
                       focus:border-star-accent focus:outline-none
                       transition-colors"
          />
        </FormField>

        {/* Auto-heal toggle */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={autoHeal}
            onChange={(e) => setAutoHeal(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 text-star-dark focus:ring-star-dark"
          />
          <span className="text-sm text-gray-700">自动愈合（到期后自动移除）</span>
        </label>

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={isSubmitting}
              className="flex-1 rounded-[2rem] border-2 border-gray-200 py-2.5 px-4
                         font-semibold text-gray-700 text-sm
                         hover:bg-white disabled:opacity-50
                         transition-colors"
            >
              取消
            </button>
          )}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || !part}
            className="flex-1 rounded-[2rem] bg-star-dark py-2.5 px-4
                       font-black text-white text-sm italic uppercase
                       hover:bg-star-dark/90 disabled:opacity-50
                       transition-colors flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <>
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-r-transparent" />
                添加中...
              </>
            ) : (
              '添加限制'
            )}
          </button>
        </div>
      </div>
    </motion.div>
  );
}

export default AddLimitationForm;
