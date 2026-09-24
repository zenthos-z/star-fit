/**
 * Settings Page - User Settings Main Page
 *
 * 两大块（2026-09-11 拍板）：
 * 1. 用户画像 —— 基本信息（可编辑）+ 负荷锚点（只读，自动维护）+ 伤病限制（只读，AI 维护）
 * 2. Agent 与运行环境 —— Agent 配置（只读+测试连接）+ AI 建议同步状态 + 服务器/令牌/数据管理
 *
 * @version 2.0.0
 */

import React, { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import type { Session } from '@/src/types/legacy';
import { ProfileContainer } from '../components/profile/ProfileContainer';
import { BasicInfoForm } from '../components/profile/BasicInfoForm';
import { LoadAnchorsForm } from '../components/profile/LoadAnchorsForm';
import { AgentConfigCard } from '../components/settings/AgentConfigCard';
import { EnvironmentCard } from '../components/settings/EnvironmentCard';
import { WatchStatusCard, BackendConnectionRow } from '../components/settings/WatchStatusCard';
import { LimitationListCard } from '../components/settings/LimitationListCard';
import { staggerContainer, staggerItem } from '../lib/animations';
import { SuggestionService, type SuggestionSyncStatus } from '../../services/suggestionService';

// ============================================================================
// Types
// ============================================================================

interface SettingsPageProps {
  /** User ID from auth context */
  userId: string;
  /** 当前用户训练记录（数据导出用） */
  sessions?: Session[];
  /** 导入备份合并回调（App.tsx handleImportHistory） */
  onImport?: (sessions: Session[]) => void;
  /** Callback when user wants to close the settings page */
  onClose?: () => void;
}

// ============================================================================
// Section Header（iOS 分组表头样式）
// ============================================================================

function SectionHeader({ title }: { title: string }): JSX.Element {
  return (
    <h2 className="text-xs font-semibold text-gray-500 tracking-wider px-1 pt-1">
      {title}
    </h2>
  );
}

// ============================================================================
// Loading & Error Components
// ============================================================================

function LoadingSpinner(): JSX.Element {
  return (
    <div className="flex items-center justify-center py-10">
      <div className="text-center">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent text-star-accent" />
        <p className="mt-4 text-sm text-gray-500">加载中...</p>
      </div>
    </div>
  );
}

function ErrorAlert({ error }: { error: Error }): JSX.Element {
  return (
    <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-red-700">
      <p className="font-semibold">加载失败</p>
      <p className="text-sm break-words [overflow-wrap:anywhere]">{error.message}</p>
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
    <div className="bg-white rounded-[24px] shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${state.dot} ${status?.isSyncing ? 'animate-pulse' : ''}`} />
          <h3 className="text-lg font-bold text-gray-900 tracking-tight">AI 建议</h3>
          <span className={`text-[10px] font-bold ${state.tone}`}>{state.label}</span>
        </div>
        <button
          onClick={onManualRefresh}
          disabled={status?.isSyncing}
          className="text-xs font-semibold text-gray-400 hover:text-gray-900 disabled:opacity-40 transition-colors flex items-center gap-1"
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

export function SettingsPage({ userId, sessions = [], onImport, onClose }: SettingsPageProps): JSX.Element {
  const [isScrolled, setIsScrolled] = useState(false);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setIsScrolled(e.currentTarget.scrollTop > 30);
  }, []);

  return (
    <div className="fixed inset-0 z-[100] bg-star-white overflow-y-auto" onScroll={handleScroll}>
      {/* 导航栏 — History/动作库同规格：返回钮与 Large Title 同行垂直居中（未滚动）；滚动后大标题收起、居中小标题淡入 */}
      <div
        className="sticky top-0 z-20 px-4 bg-star-white/85 backdrop-blur-md transition-all duration-200 flex items-center justify-between"
        style={{ paddingTop: 'calc(var(--safe-top, 0px) + 4px)', paddingBottom: '10px', marginBottom: isScrolled ? 0 : 16 }}
      >
        {onClose ? (
          <button
            onClick={onClose}
            aria-label="返回"
            className="w-11 h-11 shrink-0 rounded-full bg-white shadow-sm flex items-center justify-center text-gray-600 active:scale-90 transition-all"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-5 h-5" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
        ) : (
          <div className="w-11 h-11 shrink-0" />
        )}
        {/* Large Title — 与返回钮同行垂直居中（History 页同规格），滚动时折叠 */}
        <h1
          className="ml-3 text-[34px] leading-[41px] font-bold text-star-dark tracking-tight transition-all duration-200 overflow-hidden"
          style={{ opacity: isScrolled ? 0 : 1, maxHeight: isScrolled ? 0 : 41 }}
          aria-hidden={isScrolled}
        >
          设置
        </h1>
        {/* 折叠居中小标题（滚动后淡入） */}
        <span
          className="absolute left-1/2 -translate-x-1/2 text-[17px] font-semibold text-star-dark transition-opacity duration-200 pointer-events-none"
          style={{ opacity: isScrolled ? 1 : 0 }}
          aria-hidden={!isScrolled}
        >
          设置
        </span>
        {/* 右侧占位，保持对称 */}
        <div className="w-11 h-11 shrink-0" />
      </div>

      {/* Main Content */}
      <main className="px-4 pb-[calc(env(safe-area-inset-bottom,0px)+32px)] max-w-3xl mx-auto">
        <motion.div
          variants={staggerContainer}
          initial="initial"
          animate="animate"
          className="space-y-4"
        >
          {/* ========== 块 1：用户画像 ========== */}
          <SectionHeader title="用户画像" />

          <motion.div variants={staggerItem}>
            <div className="space-y-4">
              <ProfileContainer
                userId={userId}
                renderProfileStatic={(data, actions) => (
                  <BasicInfoForm
                    data={data}
                    onUpdate={actions.onUpdateStatic}
                  />
                )}
                renderProfileDynamic={(data) => (
                  <>
                    <LoadAnchorsForm anchors={data.load_anchors} />
                    <LimitationListCard
                      limitations={data.active_limitations || []}
                      loading={false}
                    />
                  </>
                )}
                renderLoading={() => <LoadingSpinner />}
                renderError={(error) => <ErrorAlert error={error} />}
              />
            </div>
          </motion.div>

          {/* ========== 块 2：Agent 与运行环境 ========== */}
          <SectionHeader title="Agent 与运行环境" />

          <motion.div variants={staggerItem}>
            <BackendConnectionRow />
          </motion.div>

          <motion.div variants={staggerItem}>
            <WatchStatusCard />
          </motion.div>

          <motion.div variants={staggerItem}>
            <AgentConfigCard />
          </motion.div>

          <motion.div variants={staggerItem}>
            <SuggestionSyncCard />
          </motion.div>

          {onImport && (
            <motion.div variants={staggerItem}>
              <EnvironmentCard sessions={sessions} onImport={onImport} />
            </motion.div>
          )}
        </motion.div>
      </main>
    </div>
  );
}

export default SettingsPage;
