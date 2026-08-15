/**
 * AnchorTypeForm - Type-specific form for load anchors
 *
 * Renders appropriate form fields based on the anchor type
 * Supports: strength, bodyweight, isometric, cardio, heartrate
 *
 * @version 2.0.0
 */

import React, { useCallback } from 'react';
import type { LoadAnchor } from 'shared/contracts';

// ============================================================================
// Types
// ============================================================================

interface AnchorTypeFormProps {
  /** Current anchor data */
  anchor: LoadAnchor;
  /** Detected anchor type */
  type: string;
  /** Callback when anchor changes */
  onChange: (anchor: LoadAnchor) => void;
}

interface NumberFieldProps {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  suffix?: string;
  min?: number;
  max?: number;
}

// ============================================================================
// Components
// ============================================================================

function NumberField({ label, value, onChange, suffix, min, max }: NumberFieldProps): JSX.Element {
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
    <div className="space-y-1">
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      <div className="relative">
        <input
          type="number"
          value={value ?? ''}
          onChange={handleChange}
          className="w-full rounded-xl border-2 border-gray-200 px-3 py-2 text-sm
                     focus:border-star-accent focus:outline-none
                     transition-colors"
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function AnchorTypeForm({ anchor, type, onChange }: AnchorTypeFormProps): JSX.Element {
  const handleFieldChange = useCallback(
    (field: keyof LoadAnchor, value: number | undefined) => {
      onChange({ ...anchor, [field]: value });
    },
    [anchor, onChange]
  );

  switch (type) {
    case 'strength':
      return (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <NumberField
            label="最佳重量"
            value={anchor.best_weight}
            onChange={(v) => handleFieldChange('best_weight', v)}
            suffix="kg"
            min={0}
            max={1000}
          />
          <NumberField
            label="最佳次数"
            value={anchor.best_reps}
            onChange={(v) => handleFieldChange('best_reps', v)}
            suffix="次"
            min={1}
            max={100}
          />
          <NumberField
            label="预估 1RM"
            value={anchor.est_1rm}
            onChange={(v) => handleFieldChange('est_1rm', v)}
            suffix="kg"
            min={0}
            max={1000}
          />
        </div>
      );

    case 'bodyweight':
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <NumberField
            label="最佳次数"
            value={anchor.best_reps}
            onChange={(v) => handleFieldChange('best_reps', v)}
            suffix="次"
            min={1}
            max={1000}
          />
          <NumberField
            label="进阶等级"
            value={anchor.progression_level}
            onChange={(v) => handleFieldChange('progression_level', v)}
            suffix="级"
            min={1}
            max={10}
          />
        </div>
      );

    case 'isometric':
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <NumberField
            label="最佳时长"
            value={anchor.best_duration}
            onChange={(v) => handleFieldChange('best_duration', v)}
            suffix="秒"
            min={1}
            max={3600}
          />
          <NumberField
            label="负重"
            value={anchor.best_weight}
            onChange={(v) => handleFieldChange('best_weight', v)}
            suffix="kg"
            min={0}
            max={1000}
          />
        </div>
      );

    case 'cardio':
      return (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <NumberField
            label="最佳时长"
            value={anchor.best_duration}
            onChange={(v) => handleFieldChange('best_duration', v)}
            suffix="秒"
            min={1}
            max={86400}
          />
          <NumberField
            label="最佳距离"
            value={anchor.best_distance}
            onChange={(v) => handleFieldChange('best_distance', v)}
            suffix="m"
            min={1}
            max={100000}
          />
          <NumberField
            label="最佳配速"
            value={anchor.best_pace}
            onChange={(v) => handleFieldChange('best_pace', v)}
            suffix="/km"
            min={60}
            max={1800}
          />
        </div>
      );

    case 'heartrate':
      return (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <NumberField
            label="最大心率"
            value={anchor.max_hr}
            onChange={(v) => handleFieldChange('max_hr', v)}
            suffix="bpm"
            min={100}
            max={220}
          />
          <NumberField
            label="静息心率"
            value={anchor.resting_hr}
            onChange={(v) => handleFieldChange('resting_hr', v)}
            suffix="bpm"
            min={30}
            max={120}
          />
          <NumberField
            label="Zone2 阈值"
            value={anchor.zone_2_threshold}
            onChange={(v) => handleFieldChange('zone_2_threshold', v)}
            suffix="bpm"
            min={80}
            max={180}
          />
        </div>
      );

    default:
      return (
        <div className="p-4 bg-gray-50 rounded-xl text-sm text-gray-500 text-center">
          <p>无法识别该锚点类型</p>
          <p className="text-xs mt-1">请使用 LoadAnchorsEditor 进行编辑</p>
        </div>
      );
  }
}

export default AnchorTypeForm;
