/**
 * AnchorCard - Individual Load Anchor Card
 *
 * Display and edit card for a single load anchor
 * Shows exercise name, type badge, summary, and last updated time
 *
 * @version 2.0.0
 */

import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { LoadAnchor } from 'shared/contracts';
import { staggerItem, modalBackdrop, modalContent } from '../../lib/animations';

// ============================================================================
// Types
// ============================================================================

interface AnchorCardProps {
  /** Exercise ID/name */
  exerciseId: string;
  /** Load anchor data */
  anchor: LoadAnchor;
  /** Callback when anchor is saved */
  onSave: (anchor: LoadAnchor) => Promise<void>;
}

// ============================================================================
// Utilities
// ============================================================================

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) {
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours === 0) {
      const minutes = Math.floor(diff / (1000 * 60));
      return minutes === 0 ? '刚刚' : `${minutes}分钟前`;
    }
    return `${hours}小时前`;
  }
  if (days === 1) return '昨天';
  if (days < 7) return `${days}天前`;
  if (days < 30) return `${Math.floor(days / 7)}周前`;
  return `${Math.floor(days / 30)}个月前`;
}

function detectAnchorType(anchor: LoadAnchor): string {
  if (anchor.best_weight !== undefined && anchor.best_reps !== undefined) {
    return 'strength';
  }
  if (anchor.progression_level !== undefined) {
    return 'bodyweight';
  }
  if (anchor.best_duration !== undefined && anchor.best_distance === undefined) {
    return 'isometric';
  }
  if (anchor.best_pace !== undefined || anchor.best_distance !== undefined) {
    return 'cardio';
  }
  if (anchor.max_hr !== undefined || anchor.resting_hr !== undefined) {
    return 'heartrate';
  }
  return 'unknown';
}

function getTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    strength: '力量训练',
    bodyweight: '自重训练',
    isometric: '等长训练',
    cardio: '有氧训练',
    heartrate: '心率数据',
    unknown: '未分类',
  };
  return labels[type] || '未分类';
}

function getTypeColor(type: string): string {
  const colors: Record<string, string> = {
    strength: 'bg-blue-100 text-blue-700',
    bodyweight: 'bg-green-100 text-green-700',
    isometric: 'bg-purple-100 text-purple-700',
    cardio: 'bg-orange-100 text-orange-700',
    heartrate: 'bg-red-100 text-red-700',
    unknown: 'bg-gray-100 text-gray-700',
  };
  return colors[type] || colors.unknown;
}

function getAnchorSummary(anchor: LoadAnchor): string {
  const parts: string[] = [];
  if (anchor.best_weight !== undefined) parts.push(`${anchor.best_weight}kg`);
  if (anchor.best_reps !== undefined) parts.push(`${anchor.best_reps}次`);
  if (anchor.est_1rm !== undefined) parts.push(`1RM:${anchor.est_1rm}kg`);
  if (anchor.progression_level !== undefined) parts.push(`Lv.${anchor.progression_level}`);
  if (anchor.best_duration !== undefined) {
    const mins = Math.floor(anchor.best_duration / 60);
    const secs = anchor.best_duration % 60;
    parts.push(`${mins}:${secs.toString().padStart(2, '0')}`);
  }
  if (anchor.best_distance !== undefined) parts.push(`${anchor.best_distance}m`);
  if (anchor.best_pace !== undefined) parts.push(`${anchor.best_pace}/km`);
  if (anchor.max_hr !== undefined) parts.push(`HRmax ${anchor.max_hr}`);
  return parts.join(' · ') || '暂无数据';
}

// ============================================================================
// Anchor Type Form Component
// ============================================================================

interface AnchorTypeFormProps {
  anchor: LoadAnchor;
  type: string;
  onChange: (anchor: LoadAnchor) => void;
}

function AnchorTypeForm({ anchor, type, onChange }: AnchorTypeFormProps): JSX.Element {
  const handleNumberChange = useCallback(
    (field: keyof LoadAnchor, value: string) => {
      const num = value === '' ? undefined : parseFloat(value);
      onChange({ ...anchor, [field]: num });
    },
    [anchor, onChange]
  );

  const renderField = (label: string, field: keyof LoadAnchor, suffix?: string) => (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      <div className="relative">
        <input
          type="number"
          value={anchor[field] ?? ''}
          onChange={(e) => handleNumberChange(field, e.target.value)}
          className="w-full rounded-xl border-2 border-gray-200 px-3 py-2 text-sm
                     focus:border-star-accent focus:outline-none"
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );

  switch (type) {
    case 'strength':
      return (
        <div className="grid grid-cols-3 gap-3">
          {renderField('最佳重量', 'best_weight', 'kg')}
          {renderField('最佳次数', 'best_reps', '次')}
          {renderField('预估1RM', 'est_1rm', 'kg')}
        </div>
      );
    case 'bodyweight':
      return (
        <div className="grid grid-cols-2 gap-3">
          {renderField('最佳次数', 'best_reps', '次')}
          {renderField('进阶等级', 'progression_level', '级')}
        </div>
      );
    case 'isometric':
      return (
        <div className="grid grid-cols-2 gap-3">
          {renderField('最佳时长', 'best_duration', '秒')}
          {renderField('负重', 'best_weight', 'kg')}
        </div>
      );
    case 'cardio':
      return (
        <div className="grid grid-cols-3 gap-3">
          {renderField('最佳时长', 'best_duration', '秒')}
          {renderField('最佳距离', 'best_distance', 'm')}
          {renderField('最佳配速', 'best_pace', '/km')}
        </div>
      );
    case 'heartrate':
      return (
        <div className="grid grid-cols-3 gap-3">
          {renderField('最大心率', 'max_hr', 'bpm')}
          {renderField('静息心率', 'resting_hr', 'bpm')}
          {renderField('Zone2阈值', 'zone_2_threshold', 'bpm')}
        </div>
      );
    default:
      return (
        <div className="text-sm text-gray-500">
          未知类型，请手动编辑字段
        </div>
      );
  }
}

// ============================================================================
// Main Component
// ============================================================================

export function AnchorCard({ exerciseId, anchor, onSave }: AnchorCardProps): JSX.Element {
  const [isEditing, setIsEditing] = useState(false);
  const [editedAnchor, setEditedAnchor] = useState<LoadAnchor>(anchor);
  const [isSaving, setIsSaving] = useState(false);

  const type = detectAnchorType(anchor);
  const typeLabel = getTypeLabel(type);
  const typeColor = getTypeColor(type);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      await onSave({ ...editedAnchor, last_updated: Date.now() });
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  }, [editedAnchor, onSave]);

  const handleCancel = useCallback(() => {
    setEditedAnchor(anchor);
    setIsEditing(false);
  }, [anchor]);

  return (
    <>
      <motion.div
        variants={staggerItem}
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
        onClick={() => setIsEditing(true)}
        className="bg-white rounded-xl border border-gray-200 p-4 cursor-pointer
                   hover:border-star-accent hover:shadow-md transition-all"
      >
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="font-semibold text-gray-900 truncate">{exerciseId}</h4>
              <span className={`text-xs px-2 py-0.5 rounded-full ${typeColor}`}>
                {typeLabel}
              </span>
            </div>
            <p className="text-sm text-gray-600">{getAnchorSummary(anchor)}</p>
            <p className="text-xs text-gray-400 mt-1">
              更新于 {formatRelativeTime(anchor.last_updated)}
            </p>
          </div>
          <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </motion.div>

      {/* Edit Modal */}
      <AnimatePresence>
        {isEditing && (
          <motion.div
            variants={modalBackdrop}
            initial="initial"
            animate="animate"
            exit="exit"
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
            onClick={handleCancel}
          >
            <motion.div
              variants={modalContent}
              initial="initial"
              animate="animate"
              exit="exit"
              className="bg-white rounded-2xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">{exerciseId}</h3>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${typeColor}`}>
                    {typeLabel}
                  </span>
                </div>
                <button
                  onClick={handleCancel}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <svg className="h-5 w-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                <AnchorTypeForm
                  anchor={editedAnchor}
                  type={type}
                  onChange={setEditedAnchor}
                />

                <div className="flex gap-3 pt-4">
                  <button
                    onClick={handleCancel}
                    className="flex-1 rounded-[2rem] border-2 border-gray-200 py-3 px-6
                               font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="flex-1 rounded-[2rem] bg-star-dark py-3 px-6
                               font-black text-white italic uppercase
                               hover:bg-star-dark/90 disabled:opacity-50
                               transition-colors flex items-center justify-center gap-2"
                  >
                    {isSaving ? (
                      <>
                        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-r-transparent" />
                        保存中...
                      </>
                    ) : (
                      '保存'
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export default AnchorCard;
