/**
 * UserProfilePanel.v2 — 精简版用户画像主面板（2026-09 三列布局重写）
 *
 * 重构定位（用户拍板）：
 * - admin = 训练素材管理 + 用户画像查看 + Agent 配置；本页 = 用户画像**查看**。
 * - 去掉一切手动编辑子弹窗——复杂数据的错误修法 = 选中 → 附加给 Agent 让它改；
 *   仅最基础参数（年龄/身高/体重/体脂）保留行内快速编辑。
 * - Agent 对话**不做悬浮小窗**：给它一整列，与画像列并排。
 * - 完整画像 → 全页 sheet（ProfileFullSheet），sheet 内任意数据块可「+」
 *   加入 Agent 对话上下文。
 *
 * 布局（本组件 = 页面**左列**，Agent 对话由父层作为独立列渲染）：
 *   ┌ 头像/名称/等级/更新时间
 *   ├ 基本参数行内编辑条
 *   ├ 状态快照 4 格
 *   └ [查看完整画像 →] 入口卡
 *
 * @module UserProfilePanelV2
 * @version 5.0.0
 */

import React, { useState, useEffect } from 'react';
import {
  AlertCircle, User, ChevronRight, Check, X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { AdminService } from '../../services/api';
import type { FlattenedProfile } from '../../services/api';
import { ProfileFullSheet } from './ProfileFullSheet';
import { parseJSONSafe } from '../../../../types/validation';
import { transitions } from '../../../../v2/lib/animations';

interface UserStats {
  session_count?: number;
  total_volume?: number;
  lastTrainingDate?: string;
}

interface UserProfilePanelProps {
  userId: string;
  username?: string | null;
  short_id?: string | null;
  display_name?: string;
  profile: FlattenedProfile | null;
  stats: UserStats | null;
  loading: boolean;
  onStatsUpdate?: (stats: UserStats) => void;
  /** 画像更新后通知父层刷新 */
  onProfileUpdate?: () => void;
}

const FITNESS_LEVEL_TEXT: Record<string, string> = {
  beginner: '初学者', intermediate: '进阶', advanced: '高级', UNKNOWN: '未知',
};

const formatDateTime = (timestamp: number | string | undefined): string => {
  if (!timestamp) return '-';
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

export const UserProfilePanelV2: React.FC<UserProfilePanelProps> = ({
  userId, username, short_id, display_name, profile, stats, loading, onStatsUpdate, onProfileUpdate,
}) => {
  const [localProfile, setLocalProfile] = useState<FlattenedProfile | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // 行内编辑：仅基本参数
  const [editingBasic, setEditingBasic] = useState(false);
  const [basicDraft, setBasicDraft] = useState<{ age: string; height: string; weight: string; body_fat: string }>({
    age: '', height: '', weight: '', body_fat: '',
  });
  const [savingBasic, setSavingBasic] = useState(false);

  useEffect(() => {
    if (profile) setLocalProfile(profile);
  }, [profile]);

  const p = localProfile;
  const basic = (p?.basic_info ?? {}) as Record<string, unknown>;

  const startEditBasic = () => {
    setBasicDraft({
      age: basic.age !== undefined && basic.age !== null ? String(basic.age) : '',
      height: basic.height !== undefined && basic.height !== null ? String(basic.height) : '',
      weight: basic.weight !== undefined && basic.weight !== null ? String(basic.weight) : '',
      body_fat: basic.body_fat !== undefined && basic.body_fat !== null ? String(basic.body_fat) : '',
    });
    setEditingBasic(true);
  };

  const saveBasic = async () => {
    if (!p) return;
    const nextBasicInfo = { ...basic };
    const num = (s: string) => (s.trim() === '' ? undefined : Number(s));
    nextBasicInfo.age = num(basicDraft.age);
    nextBasicInfo.height = num(basicDraft.height);
    nextBasicInfo.weight = num(basicDraft.weight);
    nextBasicInfo.body_fat = num(basicDraft.body_fat);

    const prev = p;
    setLocalProfile({ ...p, basic_info: nextBasicInfo } as FlattenedProfile);
    setSavingBasic(true);
    try {
      await AdminService.users.updateProfile(userId, { basic_info: nextBasicInfo });
      setEditingBasic(false);
      onProfileUpdate?.();
    } catch (err) {
      setLocalProfile(prev);
      alert('保存失败: ' + (err as Error).message);
    } finally {
      setSavingBasic(false);
    }
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  if (loading) {
    return (
      <div className="h-full bg-star-white p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-20 bg-gray-200 rounded-2xl" />
          <div className="h-16 bg-gray-200 rounded-2xl" />
          <div className="h-24 bg-gray-200 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!p) {
    return (
      <div className="h-full bg-star-white flex items-center justify-center">
        <div className="text-center text-gray-500">
          <AlertCircle size={48} className="mx-auto mb-4 text-gray-400" />
          <p>加载用户画像失败</p>
        </div>
      </div>
    );
  }

  const displayName = display_name || username || short_id || userId.slice(0, 8);
  const limitationsCount = (p.active_limitations ?? []).length;
  const hasRedFlags = (p.red_flags ?? []).length > 0;

  return (
    <div className="h-full bg-star-white flex flex-col overflow-hidden" data-testid="user-profile-panel-v2">
      <div className="flex-1 min-h-0 flex flex-col p-5 gap-4 overflow-y-auto">
        {/* ============ 头部：身份 ============ */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-11 h-11 rounded-xl bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-600 shrink-0">
            <User size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold text-gray-900 truncate">{displayName}</h1>
              <span className="text-[11px] px-2 py-0.5 rounded-md bg-gray-50 text-gray-500 border border-gray-200 shrink-0">
                {FITNESS_LEVEL_TEXT[p.fitness_level] ?? p.fitness_level}
              </span>
            </div>
            <p className="text-[11px] text-gray-400">
              {(short_id || userId.slice(0, 8)) + ' · 更新于 ' + formatDateTime(p.updated_at || p.created_at)}
              {hasRedFlags && <span className="text-red-500 ml-1.5">· {p.red_flags!.length} 项红旗</span>}
            </p>
          </div>
        </div>

        {/* ============ 基本参数行内编辑 ============ */}
        <div className="rounded-xl border border-gray-200 px-4 py-3 shrink-0" data-testid="basic-params-row">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-gray-400">基本参数</span>
            {!editingBasic && (
              <button
                className="text-[11px] text-gray-600 hover:text-gray-900 underline underline-offset-2 decoration-gray-300"
                onClick={startEditBasic}
              >
                编辑
              </button>
            )}
          </div>
          {!editingBasic ? (
            <div className="grid grid-cols-4 gap-2">
              <MiniParam label="年龄" value={basic.age !== undefined && basic.age !== null ? `${basic.age} 岁` : '-'} />
              <MiniParam label="身高" value={basic.height !== undefined && basic.height !== null ? `${basic.height}cm` : '-'} />
              <MiniParam label="体重" value={basic.weight !== undefined && basic.weight !== null ? `${basic.weight}kg` : '-'} />
              <MiniParam label="体脂" value={basic.body_fat !== undefined && basic.body_fat !== null ? `${basic.body_fat}%` : '-'} />
            </div>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-4 gap-2">
                <MiniInput label="年龄(岁)" value={basicDraft.age} onChange={(v) => setBasicDraft((d) => ({ ...d, age: v }))} />
                <MiniInput label="身高(cm)" value={basicDraft.height} onChange={(v) => setBasicDraft((d) => ({ ...d, height: v }))} />
                <MiniInput label="体重(kg)" value={basicDraft.weight} onChange={(v) => setBasicDraft((d) => ({ ...d, weight: v }))} />
                <MiniInput label="体脂(%)" value={basicDraft.body_fat} onChange={(v) => setBasicDraft((d) => ({ ...d, body_fat: v }))} />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  className="px-3 py-1.5 rounded-lg text-xs text-gray-600 border border-gray-200 hover:bg-gray-50"
                  onClick={() => setEditingBasic(false)}
                >
                  <X size={12} className="inline mr-1" />取消
                </button>
                <button
                  className="px-3 py-1.5 rounded-lg text-xs text-white bg-gray-900 hover:bg-gray-700 disabled:opacity-50"
                  disabled={savingBasic}
                  onClick={saveBasic}
                >
                  <Check size={12} className="inline mr-1" />{savingBasic ? '保存中…' : '保存'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ============ 状态快照 ============ */}
        <div className="grid grid-cols-4 gap-2 shrink-0">
          <SnapshotCard label="训练次数" value={String(stats?.session_count ?? 0)} />
          <SnapshotCard label="总容量" value={`${((stats?.total_volume ?? 0) / 1000).toFixed(1)}k`} />
          <SnapshotCard
            label="当前限制" value={String(limitationsCount)} alert={limitationsCount > 0}
          />
          <SnapshotCard label="恢复评分" value={String(p.recovery_state?.total_score ?? '-')} />
        </div>

        {/* ============ 查看完整画像入口 ============ */}
        <button
          className="shrink-0 w-full rounded-xl border border-gray-200 px-4 py-3.5 flex items-center justify-between hover:border-gray-400 transition-colors group text-left"
          onClick={() => setSheetOpen(true)}
          data-testid="open-profile-full-sheet"
        >
          <div>
            <p className="text-sm font-medium text-gray-900">查看完整画像</p>
            <p className="text-[11px] text-gray-400 mt-0.5">锚点 · 伤病 · 恢复 · 历史摘要 · 点击数据块可附加给 Agent</p>
          </div>
          <ChevronRight size={16} className="text-gray-300 group-hover:text-gray-600 transition-colors shrink-0" />
        </button>
      </div>

      {/* 全页 sheet：完整画像 */}
      <AnimatePresence>
        {sheetOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-[140] bg-black/30"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setSheetOpen(false)}
            />
            <ProfileFullSheet
              userId={userId}
              displayName={displayName}
              profile={p}
              loading={false}
              onClose={() => setSheetOpen(false)}
              onAttached={(title) => showToast(`「${title}」已加入 Agent 上下文`)}
            />
          </>
        )}
      </AnimatePresence>

      {/* 附加成功 toast（静默回传风格，只看结果） */}
      <AnimatePresence>
        {toast && (
          <motion.div
            className="fixed z-[160] left-1/2 -translate-x-1/2 top-6 bg-gray-900/90 text-white text-xs px-4 py-2 rounded-full shadow-lg"
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            transition={transitions.spring}
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ============================================================================
// Sub-components
// ============================================================================

const MiniParam: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="bg-gray-50 rounded-xl px-2.5 py-1.5 text-center">
    <p className="text-[10px] text-gray-400">{label}</p>
    <p className="text-sm font-semibold text-gray-800">{value}</p>
  </div>
);

const MiniInput: React.FC<{ label: string; value: string; onChange: (v: string) => void }> = ({ label, value, onChange }) => (
  <div className="bg-gray-50 rounded-xl px-2 py-1.5 text-center border border-transparent focus-within:border-blue-300">
    <p className="text-[10px] text-gray-400">{label}</p>
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      inputMode="decimal"
      className="w-full bg-transparent text-center text-sm font-medium text-gray-800 outline-none"
    />
  </div>
);

const SnapshotCard: React.FC<{ label: string; value: string; alert?: boolean }> = ({ label, value, alert }) => (
  <div className={`rounded-xl border px-3 py-2.5 ${alert ? 'border-red-200 bg-red-50/50' : 'border-gray-200'}`}>
    <p className="text-[10px] text-gray-400 truncate">{label}</p>
    <p className={`text-base font-semibold ${alert ? 'text-red-600' : 'text-gray-900'}`}>{value}</p>
  </div>
);
