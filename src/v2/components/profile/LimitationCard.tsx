/**
 * LimitationCard - Individual Active Limitation Card
 *
 * Displays a single active limitation with:
 * - Body part name
 * - Severity indicator (1-10 with color gradient)
 * - Expiration countdown
 * - Remove button
 *
 * @version 2.0.0
 */

import React from 'react';
import { motion } from 'framer-motion';
import type { ActiveLimitation } from 'shared/contracts';
import { staggerItem } from '../../lib/animations';

// ============================================================================
// Types
// ============================================================================

interface LimitationCardProps {
  /** The limitation to display */
  limitation: ActiveLimitation;
  /** Callback when remove button is clicked */
  onRemove: () => void;
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Get severity color based on severity level (1-10)
 */
function getSeverityColor(severity: number): string {
  if (severity <= 3) return 'bg-green-500';
  if (severity <= 6) return 'bg-yellow-500';
  if (severity <= 8) return 'bg-orange-500';
  return 'bg-red-500';
}

function getSeverityBgColor(severity: number): string {
  if (severity <= 3) return 'bg-green-100 text-green-700';
  if (severity <= 6) return 'bg-yellow-100 text-yellow-700';
  if (severity <= 8) return 'bg-orange-100 text-orange-700';
  return 'bg-red-100 text-red-700';
}

function getSeverityLabel(severity: number): string {
  if (severity <= 3) return '轻微';
  if (severity <= 6) return '中等';
  if (severity <= 8) return '严重';
  return '极严重';
}

/**
 * Format expiration time as relative countdown
 */
function formatCountdown(expireAt: string): string {
  const now = new Date();
  const expire = new Date(expireAt);
  const diffMs = expire.getTime() - now.getTime();

  if (diffMs <= 0) return '已过期';

  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  if (diffDays === 0) {
    if (diffHours === 0) {
      const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      return `${diffMinutes}分钟后`;
    }
    return `${diffHours}小时后`;
  }
  if (diffDays === 1) return '明天';
  if (diffDays < 7) return `${diffDays}天后`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}周后`;
  return `${Math.floor(diffDays / 30)}个月后`;
}

/**
 * Get body part display name
 */
function getBodyPartDisplayName(part: string): string {
  const displayNames: Record<string, string> = {
    head: '头部',
    neck: '颈部',
    shoulder_left: '左肩',
    shoulder_right: '右肩',
    shoulder: '肩部',
    chest: '胸部',
    upper_back: '上背',
    lower_back: '下背',
    waist: '腰部',
    hip_left: '左髋',
    hip_right: '右髋',
    hip: '臀部',
    thigh_front: '大腿前侧',
    thigh_back: '大腿后侧',
    thigh: '大腿',
    knee_left: '左膝',
    knee_right: '右膝',
    knee: '膝盖',
    calf: '小腿',
    ankle: '脚踝',
    upper_arm: '上臂',
    forearm: '前臂',
    wrist_left: '左手腕',
    wrist_right: '右手腕',
    wrist: '手腕',
    elbow: '手肘',
    hand: '手部',
    foot: '足部',
  };
  return displayNames[part] || part;
}

// ============================================================================
// Main Component
// ============================================================================

export function LimitationCard({ limitation, onRemove }: LimitationCardProps): JSX.Element {
  const severityColor = getSeverityColor(limitation.severity);
  const severityBgColor = getSeverityBgColor(limitation.severity);
  const severityLabel = getSeverityLabel(limitation.severity);
  const countdown = formatCountdown(limitation.expire_at);
  const displayName = getBodyPartDisplayName(limitation.part);

  return (
    <motion.div
      variants={staggerItem}
      className="bg-gray-50 rounded-xl p-4 border border-gray-100"
    >
      <div className="flex items-start justify-between">
        {/* Left: Body part and note */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="font-semibold text-gray-900">{displayName}</h4>
            <span className={`text-xs px-2 py-0.5 rounded-full ${severityBgColor}`}>
              {severityLabel}
            </span>
          </div>

          {(limitation as any).note && (
            <p className="mt-1 text-sm text-gray-600 truncate">{(limitation as any).note}</p>
          )}

          {/* Expiration countdown */}
          <div className="flex items-center gap-2 mt-2">
            <svg
              className="h-4 w-4 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span className="text-xs text-gray-500">{countdown}过期</span>
            {limitation.auto_heal && (
              <span className="text-xs text-green-600">· 自动愈合</span>
            )}
          </div>
        </div>

        {/* Right: Severity bar and remove button */}
        <div className="flex flex-col items-end gap-2 ml-4">
          {/* Severity indicator */}
          <div className="flex items-center gap-1">
            <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className={`h-full ${severityColor} transition-all`}
                style={{ width: `${limitation.severity * 10}%` }}
              />
            </div>
            <span className="text-xs font-medium text-gray-600 w-4">
              {limitation.severity}
            </span>
          </div>

          {/* Remove button */}
          <button
            onClick={onRemove}
            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
            title="移除限制"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        </div>
      </div>
    </motion.div>
  );
}

export default LimitationCard;
