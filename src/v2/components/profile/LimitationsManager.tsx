/**
 * LimitationsManager - Active Limitations Management
 *
 * Complete management interface for active limitations (injuries/restrictions)
 * Shows active limitations with severity indicators and expiration countdown
 *
 * @version 2.0.0
 */

import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ActiveLimitation } from 'shared/contracts';
import { slideUp, fadeScale, staggerContainer, staggerItem } from '../../lib/animations';
import { LimitationCard } from './LimitationCard';
import { AddLimitationForm } from './AddLimitationForm';

// ============================================================================
// Types
// ============================================================================

interface LimitationsManagerProps {
  /** Array of active limitations */
  limitations: ActiveLimitation[];
  /** Callback when adding a new limitation */
  onAdd: (limitation: Omit<ActiveLimitation, 'logged_at'>) => Promise<void>;
  /** Callback when removing a limitation */
  onRemove: (part: string) => Promise<void>;
  /** Optional className for styling */
  className?: string;
}

// ============================================================================
// Utilities
// ============================================================================

function isLimitationExpired(limitation: ActiveLimitation): boolean {
  return new Date(limitation.expire_at) < new Date();
}

function sortLimitations(limitations: ActiveLimitation[]): ActiveLimitation[] {
  return [...limitations].sort((a, b) => {
    // Sort by severity (descending), then by expiration time (ascending)
    if (b.severity !== a.severity) {
      return b.severity - a.severity;
    }
    return new Date(a.expire_at).getTime() - new Date(b.expire_at).getTime();
  });
}

// ============================================================================
// Components
// ============================================================================

function EmptyState(): JSX.Element {
  return (
    <div className="text-center py-6">
      <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-600 mb-3">
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <h3 className="text-sm font-semibold text-gray-900">无活跃限制</h3>
      <p className="mt-1 text-xs text-gray-500">当前没有活跃的训练限制</p>
    </div>
  );
}

function LimitationsStats({ limitations }: { limitations: ActiveLimitation[] }): JSX.Element {
  const highSeverity = limitations.filter(l => l.severity >= 7).length;
  const mediumSeverity = limitations.filter(l => l.severity >= 4 && l.severity < 7).length;
  const lowSeverity = limitations.filter(l => l.severity < 4).length;

  return (
    <div className="flex gap-2 mb-4">
      {highSeverity > 0 && (
        <span className="text-xs px-2 py-1 rounded-full bg-red-100 text-red-700">
          严重 {highSeverity}
        </span>
      )}
      {mediumSeverity > 0 && (
        <span className="text-xs px-2 py-1 rounded-full bg-yellow-100 text-yellow-700">
          中等 {mediumSeverity}
        </span>
      )}
      {lowSeverity > 0 && (
        <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-700">
          轻微 {lowSeverity}
        </span>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function LimitationsManager({
  limitations,
  onAdd,
  onRemove,
  className = '',
}: LimitationsManagerProps): JSX.Element {
  const [isAdding, setIsAdding] = useState(false);

  // Separate active and expired limitations
  const activeLimitations = limitations.filter(l => !isLimitationExpired(l));
  const expiredLimitations = limitations.filter(l => isLimitationExpired(l));

  const sortedActive = sortLimitations(activeLimitations);

  const handleAdd = useCallback(async (limitation: Omit<ActiveLimitation, 'logged_at'>) => {
    await onAdd(limitation);
    setIsAdding(false);
  }, [onAdd]);

  return (
    <motion.div
      variants={slideUp}
      initial="initial"
      animate="animate"
      className={`bg-white rounded-2xl border border-gray-100 shadow-sm p-4 ${className}`}
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-black text-star-dark italic uppercase">
            伤病限制
          </h2>
          {activeLimitations.length > 0 && (
            <p className="text-xs text-gray-500 mt-1">
              {activeLimitations.length} 个活跃限制
            </p>
          )}
        </div>
        <button
          onClick={() => setIsAdding(!isAdding)}
          className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-star-dark text-white text-sm font-semibold hover:bg-star-dark/90 transition-colors"
        >
          {isAdding ? (
            <>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              取消
            </>
          ) : (
            <>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              添加
            </>
          )}
        </button>
      </div>

      {/* Stats */}
      {activeLimitations.length > 0 && (
        <LimitationsStats limitations={activeLimitations} />
      )}

      {/* Add Form */}
      <AnimatePresence>
        {isAdding && (
          <motion.div
            variants={fadeScale}
            initial="initial"
            animate="animate"
            exit="exit"
            className="mb-4"
          >
            <AddLimitationForm onAdd={handleAdd} onCancel={() => setIsAdding(false)} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Active Limitations List */}
      {sortedActive.length === 0 ? (
        <EmptyState />
      ) : (
        <motion.div
          variants={staggerContainer}
          initial="initial"
          animate="animate"
          className="space-y-3"
        >
          {sortedActive.map(limitation => (
            <LimitationCard
              key={limitation.part}
              limitation={limitation}
              onRemove={() => onRemove(limitation.part)}
            />
          ))}
        </motion.div>
      )}

      {/* Expired Limitations (Collapsed) */}
      {expiredLimitations.length > 0 && (
        <div className="mt-6 pt-4 border-t border-gray-100">
          <p className="text-xs text-gray-400 mb-2">
            已过期限制 ({expiredLimitations.length}个)
          </p>
          <div className="space-y-2 opacity-60">
            {expiredLimitations.slice(0, 3).map(limitation => (
              <div
                key={limitation.part}
                className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg"
              >
                <span className="text-sm text-gray-500">{limitation.part}</span>
                <span className="text-xs text-gray-400">已过期</span>
              </div>
            ))}
            {expiredLimitations.length > 3 && (
              <p className="text-xs text-gray-400 text-center">
                还有 {expiredLimitations.length - 3} 个...
              </p>
            )}
          </div>
        </div>
      )}
    </motion.div>
  );
}

export default LimitationsManager;
