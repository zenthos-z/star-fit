/**
 * LoadAnchorsForm - Load Anchors Overview Display
 *
 * Displays user's load anchors in a list/grid format
 * Shows exercise name, best weight/reps, and last updated time
 *
 * @version 2.0.0
 */

import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { LoadAnchors, LoadAnchor } from 'shared/contracts';
import { slideUp, fadeScale, staggerContainer, staggerItem } from '../../lib/animations';

// ============================================================================
// Types
// ============================================================================

interface LoadAnchorsFormProps {
  /** Load anchors data */
  anchors: LoadAnchors | undefined;
  /** Callback when an anchor is updated */
  onUpdate?: (exerciseId: string, anchor: LoadAnchor) => Promise<void>;
  /** Optional className for styling */
  className?: string;
}

interface AnchorDisplayProps {
  exerciseId: string;
  anchor: LoadAnchor;
  onEdit?: () => void;
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

function getAnchorSummary(anchor: LoadAnchor): string {
  const parts: string[] = [];

  if (anchor.best_weight !== undefined) {
    parts.push(`${anchor.best_weight}kg`);
  }
  if (anchor.best_reps !== undefined) {
    parts.push(`${anchor.best_reps}次`);
  }
  if (anchor.est_1rm !== undefined) {
    parts.push(`1RM: ${anchor.est_1rm}kg`);
  }
  if (anchor.progression_level !== undefined) {
    parts.push(`等级 ${anchor.progression_level}`);
  }
  if (anchor.best_duration !== undefined) {
    const minutes = Math.floor(anchor.best_duration / 60);
    const seconds = anchor.best_duration % 60;
    parts.push(`${minutes}:${seconds.toString().padStart(2, '0')}`);
  }
  if (anchor.best_distance !== undefined) {
    parts.push(`${anchor.best_distance}m`);
  }
  if (anchor.best_pace !== undefined) {
    parts.push(`${anchor.best_pace}/km`);
  }
  if (anchor.max_hr !== undefined) {
    parts.push(`最大心率 ${anchor.max_hr}`);
  }

  return parts.join(' · ') || '暂无数据';
}

// ============================================================================
// Components
// ============================================================================

function AnchorDisplay({ exerciseId, anchor, onEdit }: AnchorDisplayProps): JSX.Element {
  const summary = getAnchorSummary(anchor);
  const relativeTime = formatRelativeTime(anchor.last_updated);

  return (
    <motion.div
      variants={staggerItem}
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      onClick={onEdit}
      className="bg-gray-50 rounded-xl p-4 cursor-pointer
                 hover:bg-gray-100 transition-colors
                 border border-transparent hover:border-gray-200"
    >
      <div className="flex items-center justify-between"
      >
        <h4 className="font-semibold text-gray-900 truncate"
          style={{ maxWidth: '60%' }}
        >
          {exerciseId}
        </h4>
        <span className="text-xs text-gray-400 whitespace-nowrap">
          {relativeTime}
        </span>
      </div>
      <p className="mt-1 text-sm text-gray-600 truncate">
        {summary}
      </p>
    </motion.div>
  );
}

function EmptyState(): JSX.Element {
  return (
    <div className="text-center py-8">
      <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-400 mb-3">
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
          />
        </svg>
      </div>
      <h3 className="text-sm font-semibold text-gray-900">暂无负荷锚点</h3>
      <p className="mt-1 text-xs text-gray-500">完成训练后将自动记录</p>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function LoadAnchorsForm({
  anchors,
  onUpdate,
  className = '',
}: LoadAnchorsFormProps): JSX.Element {
  const [editingId, setEditingId] = useState<string | null>(null);

  const handleEdit = useCallback((exerciseId: string) => {
    setEditingId(exerciseId);
  }, []);

  const handleCloseEdit = useCallback(() => {
    setEditingId(null);
  }, []);

  const anchorEntries = anchors ? Object.entries(anchors) : [];

  return (
    <motion.div
      variants={slideUp}
      initial="initial"
      animate="animate"
      className={`bg-white rounded-2xl border border-gray-100 shadow-sm p-4 ${className}`}
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-black text-star-dark italic uppercase">
          负荷锚点
        </h2>
        <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
          {anchorEntries.length} 个动作
        </span>
      </div>

      {anchorEntries.length === 0 ? (
        <EmptyState />
      ) : (
        <motion.div
          variants={staggerContainer}
          initial="initial"
          animate="animate"
          className="grid gap-3"
        >
          {anchorEntries.map(([exerciseId, anchor]) => (
            <AnchorDisplay
              key={exerciseId}
              exerciseId={exerciseId}
              anchor={anchor}
              onEdit={() => handleEdit(exerciseId)}
            />
          ))}
        </motion.div>
      )}

      {/* Edit Modal Placeholder - Would integrate with LoadAnchorsEditor */}
      <AnimatePresence>
        {editingId && (
          <motion.div
            variants={fadeScale}
            initial="initial"
            animate="animate"
            exit="exit"
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
            onClick={handleCloseEdit}
          >
            <div
              className="bg-white rounded-2xl p-6 max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-gray-900 mb-4">
                编辑负荷锚点
              </h3>
              <p className="text-gray-600 mb-4">
                动作: {editingId}
              </p>
              <p className="text-sm text-gray-500 mb-4">
                当前值: {getAnchorSummary(anchors?.[editingId] || { last_updated: Date.now() })}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={handleCloseEdit}
                  className="flex-1 rounded-[2rem] border-2 border-gray-200 py-3 px-6
                             font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  关闭
                </button>
                {onUpdate && (
                  <button
                    onClick={() => {
                      // This would open the full editor
                      handleCloseEdit();
                    }}
                    className="flex-1 rounded-[2rem] bg-star-dark py-3 px-6
                               font-black text-white italic uppercase
                               hover:bg-star-dark/90 transition-colors"
                  >
                    编辑
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default LoadAnchorsForm;
