/**
 * Settings Page - User Settings Main Page
 *
 * Main settings page that integrates:
 * - ProfileContainer for basic info and load anchors
 * - LimitationContainer for injury/restriction management
 *
 * @version 2.0.0
 */

import React, { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { ProfileContainer } from '../components/profile/ProfileContainer';
import { LimitationContainer } from '../components/profile/LimitationContainer';
import { BasicInfoForm } from '../components/profile/BasicInfoForm';
import { LoadAnchorsForm } from '../components/profile/LoadAnchorsForm';
import { LimitationsManager } from '../components/profile/LimitationsManager';
import { staggerContainer, staggerItem } from '../lib/animations';
import { SuggestionService, type SuggestionSyncStatus } from '../../services/suggestionService';

// ============================================================================
// Types
// ============================================================================

interface SettingsPageProps {
  /** User ID from auth context */
  userId: string;
  /** Callback when user wants to close the settings page */
  onClose?: () => void;
}

// ============================================================================
// Loading & Error Components
// ============================================================================

function LoadingSpinner(): JSX.Element {
  return (
    <div className="flex items-center justify-center p-8">
      <div className="text-center">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent text-star-primary" />
        <p className="mt-4 text-sm text-gray-500">加载中...</p>
      </div>
    </div>
  );
}

function ErrorAlert({ error }: { error: Error }): JSX.Element {
  return (
    <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700">
      <p className="font-semibold">加载失败</p>
      <p className="text-sm">{error.message}</p>
    </div>
  );
}

// ============================================================================
// AI Suggestion Sync Status Card（防静默失效无感知的反馈位）
// ============================================================================

function formatSyncTime(ts: number | null): string {
  if (!ts) return '从未';
  const diff = Date.now() - ts;
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)} 小时前`;
  return `${Math.floor(diff / 86400000)} 天前`;
}

function SuggestionSyncCard(): JSX.Element {
  const [status, setStatus] = useState<SuggestionSyncStatus | null>(null);

  const refresh = useCallback(() => {
    SuggestionService.getSyncStatus().then(setStatus).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    return SuggestionService.subscribe(refresh);
  }, [refresh]);

  const onManualRefresh = async () => {
    await SuggestionService.forceRefresh();
    refresh();
  };

  // 三态：在线云端 / 缓存（离线或标脏）/ 无数据
  const state = !status?.hasCache
    ? { label: '本地估算模式', desc: '暂无缓存数据，建议值由本地启发式估算', dot: 'bg-amber-400', tone: 'text-amber-600' }
    : status.serverOnline === false
      ? { label: '后端离线，使用缓存', desc: '恢复连接后将自动批量更新', dot: 'bg-gray-400', tone: 'text-gray-500' }
      : status.stale
        ? { label: '缓存（待更新）', desc: '训练数据已变化，将在后台自动刷新', dot: 'bg-gray-400', tone: 'text-gray-500' }
        : { label: '云端', desc: '建议值与后端公式同步', dot: 'bg-blue-400', tone: 'text-blue-500' };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${state.dot} ${status?.isSyncing ? 'animate-pulse' : ''}`} />
          <h3 className="text-sm font-black text-star-dark">AI 建议</h3>
          <span className={`text-[10px] font-bold ${state.tone}`}>{state.label}</span>
        </div>
        <button
          onClick={onManualRefresh}
          disabled={status?.isSyncing}
          className="text-[10px] font-bold text-gray-400 hover:text-star-dark disabled:opacity-40 transition-colors flex items-center gap-1"
        >
          <svg className={`w-3 h-3 ${status?.isSyncing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
          {status?.isSyncing ? '同步中' : '立即刷新'}
        </button>
      </div>
      <p className="text-xs text-gray-500">{state.desc}</p>
      <div className="flex items-center gap-4 mt-3 text-[10px] font-bold text-gray-400">
        <span>最近同步 {formatSyncTime(status?.lastSyncTime ?? null)}</span>
        {status?.count ? <span>{status.count} 个动作</span> : null}
        {status?.lastError ? <span className="text-amber-500">上次错误：{status.lastError}</span> : null}
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function SettingsPage({ userId, onClose }: SettingsPageProps): JSX.Element {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-star-dark px-4 py-6 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black text-white italic uppercase">
              用户设置
            </h1>
            <p className="text-sm text-white/70 mt-1">
              管理您的个人资料和训练偏好
            </p>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
              aria-label="关闭设置"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="p-4 max-w-3xl mx-auto">
        <motion.div
          variants={staggerContainer}
          initial="initial"
          animate="animate"
          className="space-y-6"
        >
          {/* Basic Info Card */}
          <motion.div variants={staggerItem}>
            <ProfileContainer
              userId={userId}
              renderProfileStatic={(data, actions) => (
                <BasicInfoForm
                  data={data}
                  onUpdate={actions.onUpdateStatic}
                />
              )}
              renderLoading={() => <LoadingSpinner />}
              renderError={(error) => <ErrorAlert error={error} />}
            />
          </motion.div>

          {/* Load Anchors Card */}
          <motion.div variants={staggerItem}>
            <ProfileContainer
              userId={userId}
              renderProfileDynamic={(data, actions) => (
                <LoadAnchorsForm
                  anchors={data.load_anchors}
                  onUpdate={async (exerciseId, anchor) => {
                    const currentAnchors = data.load_anchors || {};
                    await actions.onUpdateDynamic({
                      load_anchors: {
                        ...currentAnchors,
                        [exerciseId]: anchor,
                      },
                    });
                  }}
                />
              )}
              renderLoading={() => <LoadingSpinner />}
              renderError={(error) => <ErrorAlert error={error} />}
              renderProfileStatic={undefined as any}
            />
          </motion.div>

          {/* AI Suggestion Sync Status Card */}
          <motion.div variants={staggerItem}>
            <SuggestionSyncCard />
          </motion.div>

          {/* Limitations Card */}
          <motion.div variants={staggerItem}>
            <LimitationContainer
              userId={userId}
              renderLimitations={(limitations, actions) => (
                <LimitationsManager
                  limitations={limitations}
                  onAdd={async (limitation) => {
                    await actions.addLimitation(
                      limitation.part,
                      limitation.severity,
                      (limitation as any).note
                    );
                  }}
                  onRemove={actions.removeLimitation}
                />
              )}
              renderLoading={() => <LoadingSpinner />}
              renderError={(error) => <ErrorAlert error={error} />}
            />
          </motion.div>
        </motion.div>
      </main>
    </div>
  );
}

export default SettingsPage;
