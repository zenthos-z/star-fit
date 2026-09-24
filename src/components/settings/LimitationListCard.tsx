/**
 * LimitationListCard — 伤病限制只读展示（设置页「用户画像」区）。
 *
 * 伤病限制由 Agent 维护（profile_update_confirm 确认卡机制 + update_profile 工具），
 * App 端只读展示后端 profile_dynamic.active_limitations，无手动添加/删除入口
 * （2026-09-11 拍板：让 AI 来完成）。
 *
 * @version 2.0.0
 */

import React from 'react';
import type { ActiveLimitation } from 'shared/contracts';

// ============================================================================
// Utilities
// ============================================================================

function getSeverityMeta(severity: number): { label: string; bg: string } {
  if (severity <= 3) return { label: '轻微', bg: 'bg-green-100 text-green-700' };
  if (severity <= 6) return { label: '中等', bg: 'bg-yellow-100 text-yellow-700' };
  if (severity <= 8) return { label: '严重', bg: 'bg-orange-100 text-orange-700' };
  return { label: '极严重', bg: 'bg-red-100 text-red-700' };
}

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

function getBodyPartDisplayName(part: string): string {
  const displayNames: Record<string, string> = {
    head: '头部', neck: '颈部',
    shoulder_left: '左肩', shoulder_right: '右肩', shoulder: '肩部',
    chest: '胸部', upper_back: '上背', lower_back: '下背', waist: '腰部',
    hip_left: '左髋', hip_right: '右髋', hip: '臀部',
    thigh_front: '大腿前侧', thigh_back: '大腿后侧', thigh: '大腿',
    knee_left: '左膝', knee_right: '右膝', knee: '膝盖',
    calf: '小腿', ankle: '脚踝',
    upper_arm: '上臂', forearm: '前臂',
    wrist_left: '左手腕', wrist_right: '右手腕', wrist: '手腕', elbow: '手肘',
    hand: '手部', foot: '足部',
  };
  return displayNames[part] || part;
}

// ============================================================================
// Main Component
// ============================================================================

interface LimitationListCardProps {
  limitations: ActiveLimitation[];
  /** 是否处于加载中（决定骨架/空态展示） */
  loading?: boolean;
  /** 加载失败信息（展示错误而不是空态） */
  error?: string | null;
}

export function LimitationListCard({ limitations, loading = false, error = null }: LimitationListCardProps): JSX.Element {
  return (
    <div className="bg-white rounded-[24px] shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-gray-900 tracking-tight">伤病限制</h2>
        <span className="text-[10px] text-gray-400 font-medium">由 AI 自动维护</span>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-8">
          <div className="inline-block h-6 w-6 animate-spin rounded-full border-4 border-solid border-current border-r-transparent text-star-accent" />
        </div>
      )}

      {error && !loading && (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 break-words [overflow-wrap:anywhere]">
          {error}
        </div>
      )}

      {!loading && !error && limitations.length === 0 && (
        <div className="text-center py-8">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-400 mb-3">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="text-sm font-semibold text-gray-900">暂无伤病限制</h3>
          <p className="mt-1 text-xs text-gray-500">受伤后 AI 会自动记录并跟踪恢复</p>
        </div>
      )}

      {!loading && !error && limitations.length > 0 && (
        <div className="space-y-3">
          {limitations.map((limitation, idx) => {
            const meta = getSeverityMeta(limitation.severity);
            const displayName = getBodyPartDisplayName(limitation.part);
            return (
              <div key={`${limitation.part}-${idx}`} className="bg-gray-50 rounded-2xl p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <h4 className="font-semibold text-gray-900">{displayName}</h4>
                    <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${meta.bg}`}>
                      {meta.label} {limitation.severity}
                    </span>
                  </div>
                  <span className="text-xs text-gray-400 shrink-0 ml-2">
                    {formatCountdown(limitation.expire_at)}过期
                  </span>
                </div>
                {(limitation as any).note && (
                  <p className="mt-1 text-sm text-gray-600 truncate">{(limitation as any).note}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default LimitationListCard;
