/**
 * User Profile Panel Component V2 - 时间轴更新流视图 (方案C)
 *
 * 布局结构：
 * 1. 顶部状态快照 + 更新频率说明
 * 2. 中部时间轴更新流（横向滚动，左右滑动）
 * 3. 底部三栏完整档案（静态/动态/历史）
 * 4. 编辑弹窗（独立Modal，不受卡片限制）
 *
 * 视觉规范：
 * - 背景: star-white (#FAFAFA)
 * - 卡片: white + shadow-sm
 * - 主色: blue-500 (#3B82F6)
 * - 文字: gray-900(标题) / gray-500(次要)
 *
 * 数据契约: shared/contracts/index.ts
 *
 * @module UserProfilePanelV2
 * @version 3.1.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Edit,
  Dumbbell,
  Activity,
  TrendingUp,
  AlertCircle,
  Save,
  X,
  Plus,
  Trash2,
  Target,
  Clock,
  RotateCcw,
  Zap,
  Weight,
  ChevronLeft,
  ChevronRight,
  FileText,
  Layers,
  User,
} from 'lucide-react';
import { AdminService } from '../../services/api';
import type { FlattenedProfile } from '../../services/api';
import type {
  LoadAnchors,
  LoadAnchor,
  ActiveLimitation,
  BasicInfo,
  Preferences,
  Physiological,
  Psychological,
} from 'shared/contracts';
import { parseJSONSafe } from '../../../../types/validation';

// ============================================================================
// Types
// ============================================================================

type AdminUserProfile = FlattenedProfile;

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
  profile: AdminUserProfile | null;
  stats: UserStats | null;
  loading: boolean;
  onStatsUpdate?: (stats: UserStats) => void;
}

interface UpdateEvent {
  id: string;
  timestamp: number;
  type: 'static' | 'dynamic' | 'history';
  title: string;
  description: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

const formatDate = (timestamp: number | string | undefined): string => {
  if (!timestamp) return '-';
  const date = typeof timestamp === 'string' ? new Date(timestamp) : new Date(timestamp);
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
};

const formatDateTime = (timestamp: number | string | undefined): string => {
  if (!timestamp) return '-';
  const date = typeof timestamp === 'string' ? new Date(timestamp) : new Date(timestamp);
  return date.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const formatRelativeTime = (timestamp: number): string => {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;
  return formatDate(timestamp);
};

const getFitnessLevelText = (level: string): string => {
  const map: Record<string, string> = {
    beginner: '初学者',
    intermediate: '进阶',
    advanced: '高级',
  };
  return map[level] || level;
};

const getDataTypeLabel = (type: UpdateEvent['type']): string => {
  const map: Record<string, string> = {
    static: '静态档案',
    dynamic: '动态状态',
    history: '历史摘要',
  };
  return map[type];
};

const getDataTypeColor = (type: UpdateEvent['type']): string => {
  const map: Record<string, string> = {
    static: 'bg-slate-500',
    dynamic: 'bg-amber-500',
    history: 'bg-indigo-500',
  };
  return map[type];
};

const getDataTypeBadge = (type: UpdateEvent['type']): string => {
  const map: Record<string, string> = {
    static: 'bg-slate-100 text-slate-700 border-slate-200',
    dynamic: 'bg-amber-100 text-amber-700 border-amber-200',
    history: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  };
  return map[type];
};

// Generate update events from profile data
const generateUpdateEvents = (profile: AdminUserProfile | null): UpdateEvent[] => {
  if (!profile) return [];

  const events: UpdateEvent[] = [];

  if (profile.updated_at) {
    events.push({
      id: 'profile-updated',
      timestamp: new Date(profile.updated_at).getTime(),
      type: 'static',
      title: '档案更新',
      description: '用户画像数据已更新',
    });
  }

  if (profile.load_anchors) {
    const anchors = Object.entries(profile.load_anchors);
    if (anchors.length > 0) {
      const mostRecent = anchors.reduce((latest, [name, anchor]) => {
        const anchorTime = anchor.last_updated || 0;
        return anchorTime > latest.time ? { time: anchorTime, name } : latest;
      }, { time: 0, name: '' });

      if (mostRecent.time > 0) {
        events.push({
          id: 'anchor-updated',
          timestamp: mostRecent.time,
          type: 'dynamic',
          title: '负荷锚点更新',
          description: `${mostRecent.name} 数据已更新`,
        });
      }
    }
  }

  if (profile.active_limitations && profile.active_limitations.length > 0) {
    const mostRecent = profile.active_limitations.reduce((latest, limitation) => {
      const loggedTime = limitation.logged_at ? new Date(limitation.logged_at).getTime() : 0;
      return loggedTime > latest ? loggedTime : latest;
    }, 0);

    if (mostRecent > 0) {
      events.push({
        id: 'limitation-added',
        timestamp: mostRecent,
        type: 'dynamic',
        title: '伤病限制记录',
        description: `新增 ${profile.active_limitations.length} 处限制`,
      });
    }
  }

  return events.sort((a, b) => b.timestamp - a.timestamp).slice(0, 5);
};

// ============================================================================
// Component
// ============================================================================

export const UserProfilePanelV2: React.FC<UserProfilePanelProps> = ({
  userId,
  username,
  short_id,
  display_name,
  profile,
  stats,
  loading,
  onStatsUpdate,
}) => {
  const [localProfile, setLocalProfile] = useState<AdminUserProfile | null>(null);
  const [localStats, setLocalStats] = useState<UserStats | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingSection, setEditingSection] = useState<string | null>(null);

  // Edit form states
  const [editBasic, setEditBasic] = useState<Partial<BasicInfo>>({});
  const [editPreferences, setEditPreferences] = useState<Partial<Preferences>>({});
  const [editPhysiological, setEditPhysiological] = useState<Partial<Physiological>>({});
  const [editPsychological, setEditPsychological] = useState<Partial<Psychological>>({});
  const [editAnchors, setEditAnchors] = useState<LoadAnchors>({});
  const [editLimitations, setEditLimitations] = useState<ActiveLimitation[]>([]);
  const [editTrainingStrategy, setEditTrainingStrategy] = useState<string>('');
  const [newLimitationPart, setNewLimitationPart] = useState('');
  const [newLimitationSeverity, setNewLimitationSeverity] = useState(5);
  const [newAnchorName, setNewAnchorName] = useState('');

  useEffect(() => {
    if (profile) {
      setLocalProfile(profile);
    }
  }, [profile]);

  useEffect(() => {
    if (stats) {
      setLocalStats(stats);
    }
  }, [stats]);

  const updateEvents = React.useMemo(() => generateUpdateEvents(localProfile), [localProfile]);

  const handleUpdateProfile = useCallback(async (updates: Partial<AdminUserProfile>) => {
    if (!localProfile) return;

    const previousProfile = localProfile;
    setLocalProfile({ ...localProfile, ...updates });
    setSaving(true);

    try {
      const response = await AdminService.users.updateProfile(userId, updates);
      if (response.profile) {
        const parsedProfile: any = {
          ...response.profile as any,
          basic_info: (parseJSONSafe(response.profile.basic_info as string, "handleUpdateProfile basic_info") || {}) as Record<string, unknown>,
          preferences: (parseJSONSafe(response.profile.preferences as string, 'handleUpdateProfile preferences') || {}) as Record<string, unknown>,
          physiological: (parseJSONSafe(response.profile.physiological as string, 'handleUpdateProfile physiological') || {}) as Record<string, unknown>,
          psychological: (parseJSONSafe(response.profile.psychological as string, 'handleUpdateProfile psychological') || {}) as Record<string, unknown>,
          load_anchors: (parseJSONSafe(response.profile.load_anchors as unknown as string, 'handleUpdateProfile load_anchors') || {}) as unknown as Record<string, unknown>,
          red_flags: Array.isArray(response.profile.red_flags)
            ? response.profile.red_flags
            : parseJSONSafe(response.profile.red_flags, 'handleUpdateProfile red_flags') || [],
        };
        setLocalProfile(parsedProfile as any);

        if (onStatsUpdate) {
          const newStats = await AdminService.users.getStats(userId);
          setLocalStats(newStats);
          onStatsUpdate(newStats);
        }
      }
    } catch (error) {
      setLocalProfile(previousProfile);
      alert('保存失败: ' + (error as Error).message);
    } finally {
      setSaving(false);
    }
  }, [localProfile, userId, onStatsUpdate]);

  const startEdit = (section: string) => {
    if (!localProfile) return;

    switch (section) {
      case 'basic':
        setEditBasic(localProfile.basic_info || {});
        break;
      case 'preferences':
        setEditPreferences(localProfile.preferences || {});
        break;
      case 'physiological':
        setEditPhysiological(localProfile.physiological || {});
        break;
      case 'psychological':
        setEditPsychological(localProfile.psychological || {});
        break;
      case 'anchors':
        setEditAnchors(localProfile.load_anchors || {});
        break;
      case 'limitations':
        setEditLimitations(localProfile.active_limitations || []);
        break;
      case 'training_strategy':
        setEditTrainingStrategy(localProfile.training_strategy || '');
        break;
    }
    setEditingSection(section);
  };

  const saveEdit = async () => {
    let updates: Partial<AdminUserProfile> = {};

    switch (editingSection) {
      case 'basic':
        updates = { basic_info: editBasic };
        break;
      case 'preferences':
        updates = { preferences: editPreferences };
        break;
      case 'physiological':
        updates = { physiological: editPhysiological };
        break;
      case 'psychological':
        updates = { psychological: editPsychological };
        break;
      case 'anchors':
        updates = { load_anchors: editAnchors };
        break;
      case 'limitations':
        updates = { active_limitations: editLimitations };
        break;
      case 'training_strategy':
        updates = { training_strategy: editTrainingStrategy };
        break;
    }

    await handleUpdateProfile(updates);
    setEditingSection(null);
  };

  const cancelEdit = () => {
    setEditingSection(null);
    setNewLimitationPart('');
    setNewLimitationSeverity(5);
    setNewAnchorName('');
    setEditTrainingStrategy('');
  };

  const updateAnchor = (exercise: string, field: keyof LoadAnchor, value: string | number) => {
    setEditAnchors(prev => ({
      ...prev,
      [exercise]: {
        ...prev[exercise],
        [field]: typeof value === 'string' && field !== ('unit' as keyof LoadAnchor) ? Number(value) : value,
        last_updated: Date.now(),
      },
    }));
  };

  const removeAnchor = (exercise: string) => {
    setEditAnchors(prev => {
      const { [exercise]: _, ...rest } = prev;
      return rest;
    });
  };

  const addAnchor = () => {
    if (!newAnchorName.trim()) return;
    setEditAnchors(prev => ({
      ...prev,
      [newAnchorName.trim()]: { last_updated: Date.now() },
    }));
    setNewAnchorName('');
  };

  const removeLimitation = (part: string) => {
    setEditLimitations(prev => prev.filter(l => l.part !== part));
  };

  const addLimitation = () => {
    if (!newLimitationPart.trim()) return;
    const now = new Date().toISOString();
    const expireDays = Math.ceil(newLimitationSeverity * 0.8);
    const expireAt = new Date();
    expireAt.setDate(expireAt.getDate() + expireDays);

    setEditLimitations(prev => [
      ...prev,
      {
        part: newLimitationPart.trim(),
        severity: newLimitationSeverity,
        logged_at: now,
        expire_at: expireAt.toISOString(),
        auto_heal: true,
      },
    ]);
    setNewLimitationPart('');
    setNewLimitationSeverity(5);
  };

  if (loading) {
    return (
      <div className="h-full bg-star-white p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-24 bg-gray-200 rounded-xl" />
          <div className="h-32 bg-gray-200 rounded-xl" />
          <div className="h-64 bg-gray-200 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!localProfile) {
    return (
      <div className="h-full bg-star-white flex items-center justify-center">
        <div className="text-center text-gray-500">
          <AlertCircle size={48} className="mx-auto mb-4 text-gray-400" />
          <p>加载用户画像失败</p>
        </div>
      </div>
    );
  }

  const p = localProfile;
  const s = localStats;

  return (
    <div className="h-full bg-star-white overflow-y-auto" data-testid="user-profile-panel-v2">
      <div className="p-6 space-y-6">

        {/* ============================================
            SECTION 1: 状态快照 + 更新频率说明
            ============================================ */}
        <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
          <div className="flex items-start justify-between mb-6">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-blue-500 flex items-center justify-center text-white text-2xl font-bold">
                <User size={32} />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">
                  {display_name || username || short_id || userId.slice(0, 8)}
                </h1>
                <p className="text-sm text-gray-500">
                  {(username || short_id) && <span className="mr-2">{short_id || userId.slice(0, 8)} · </span>}
                  最后更新: {formatDateTime(p.updated_at || p.created_at)}
                </p>
              </div>
            </div>
            <span className="px-3 py-1.5 rounded-full text-sm font-medium bg-blue-100 text-blue-700 border border-blue-200">
              {getFitnessLevelText(p.fitness_level)}
            </span>
          </div>

          <div className="grid grid-cols-4 gap-4 mb-6">
            <SnapshotCard
              icon={<Target size={18} className="text-blue-500" />}
              label="训练次数"
              value={s?.session_count?.toString() || '0'}
            />
            <SnapshotCard
              icon={<Weight size={18} className="text-blue-500" />}
              label="总容量"
              value={`${((s?.total_volume || 0) / 1000).toFixed(1)}k`}
            />
            <SnapshotCard
              icon={<Activity size={18} className={p.active_limitations?.length ? 'text-red-500' : 'text-green-500'} />}
              label="当前限制"
              value={p.active_limitations?.length?.toString() || '0'}
              alert={!!p.active_limitations?.length}
            />
            <SnapshotCard
              icon={<Zap size={18} className="text-blue-500" />}
              label="恢复评分"
              value={p.recovery_state?.total_score?.toString() || '-'}
            />
          </div>

          <div className="flex items-center gap-6 pt-4 border-t border-gray-100">
            <div className="flex items-center gap-2 text-sm">
              <div className="w-3 h-3 rounded-full bg-slate-400" />
              <span className="text-gray-500">静态档案: 6-12月</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <div className="w-3 h-3 rounded-full bg-amber-400" />
              <span className="text-gray-500">动态状态: 每次训练后</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <div className="w-3 h-3 rounded-full bg-indigo-400" />
              <span className="text-gray-500">历史摘要: 每周</span>
            </div>
          </div>
        </div>

        {/* ============================================
            SECTION 2: 时间轴更新流（横向滚动）
            ============================================ */}
        <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Clock size={20} className="text-blue-500" />
              最近更新记录
            </h2>
            <button
              onClick={() => window.location.reload()}
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-blue-500 transition-colors"
            >
              <RotateCcw size={14} />
              刷新
            </button>
          </div>

          {/* Horizontal Timeline */}
          <div className="relative">
            {/* Timeline Track */}
            <div className="absolute top-8 left-0 right-0 h-0.5 bg-gray-200" />

            {/* Scrollable Container */}
            <div className="overflow-x-auto pb-4 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100">
              <div className="flex items-start gap-8 min-w-max px-4">
                {updateEvents.length > 0 ? (
                  updateEvents.map((event, index) => (
                    <div key={event.id} className="relative flex flex-col items-center" style={{ minWidth: '160px' }}>
                      {/* Time Label */}
                      <div className="text-xs text-gray-400 mb-2">
                        {formatRelativeTime(event.timestamp)}
                      </div>

                      {/* Node */}
                      <div className={`relative z-10 w-4 h-4 rounded-full border-2 border-white shadow-md ${getDataTypeColor(event.type)}`} />

                      {/* Content Card */}
                      <div className="mt-4 bg-gray-50 rounded-xl p-4 border border-gray-100 w-full">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="font-medium text-gray-900 text-sm">{event.title}</span>
                        </div>
                        <p className="text-xs text-gray-500 mb-2">{event.description}</p>
                        <span className={`inline-block text-xs px-2 py-0.5 rounded-full border ${getDataTypeBadge(event.type)}`}>
                          {getDataTypeLabel(event.type)}
                        </span>
                      </div>

                      {/* Arrow to next (if not last) */}
                      {index < updateEvents.length - 1 && (
                        <div className="absolute top-8 -right-6 text-gray-300">
                          <ChevronRight size={16} />
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="text-center text-gray-400 py-8 w-full">暂无更新记录</p>
                )}
              </div>
            </div>

            {/* Scroll Hints */}
            <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-white to-transparent pointer-events-none" />
            <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-white to-transparent pointer-events-none" />
          </div>
        </div>

        {/* ============================================
            SECTION 3: 三栏完整档案
            ============================================ */}
        <div className="grid grid-cols-3 gap-6">

          {/* ---- 静态档案 ---- */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-slate-700">
              <Layers size={20} />
              <h2 className="text-lg font-semibold text-gray-900">静态档案</h2>
              <span className="text-xs text-gray-400">6-12月更新</span>
            </div>

            <DataCard title="基础信息" editable onEdit={() => startEdit('basic')}>
              <div className="space-y-2">
                <DataRow label="年龄" value={p.basic_info?.age ? `${p.basic_info.age} 岁` : '-'} />
                <DataRow label="体重" value={p.basic_info?.weight ? `${p.basic_info.weight} kg` : '-'} />
                <DataRow label="身高" value={p.basic_info?.height ? `${p.basic_info.height} cm` : '-'} />
                <DataRow label="体脂率" value={p.basic_info?.body_fat ? `${p.basic_info.body_fat}%` : '-'} />
              </div>
            </DataCard>

            <DataCard title="训练偏好" editable onEdit={() => startEdit('preferences')}>
              <div className="space-y-2">
                <DataRow label="训练目标" value={p.preferences?.goal || '-'} />
                <DataRow label="可用器械" value={p.preferences?.equipment?.join(', ') || '-'} />
                <DataRow label="训练方法" value={p.preferences?.method?.join(', ') || '-'} />
                <DataRow label="时间限制" value={p.preferences?.time_constraint ? `${p.preferences.time_constraint} 分钟` : '-'} />
                <DataRow label="避免动作" value={p.preferences?.avoided?.join(', ') || '-'} />
              </div>
            </DataCard>

            <DataCard title="生理 / 心理特征" editable onEdit={() => startEdit('physiological')}>
              <div className="space-y-2">
                <DataRow label="睡眠" value={p.physiological?.sleep_hours ? `${p.physiological.sleep_hours}h` : '-'} />
                <DataRow label="压力" value={p.physiological?.stress_level || '-'} />
                <DataRow label="自律性" value={p.psychological?.accountability || '-'} />
                <DataRow label="风险偏好" value={p.psychological?.risk_preference || '-'} />
              </div>
            </DataCard>
          </div>

          {/* ---- 动态状态 ---- */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-amber-600">
              <Zap size={20} />
              <h2 className="text-lg font-semibold text-gray-900">动态状态</h2>
              <span className="text-xs text-gray-400">每次训练后更新</span>
            </div>

            <DataCard title="负荷锚点" editable onEdit={() => startEdit('anchors')}>
              <div className="space-y-2">
                {p.load_anchors && Object.entries(p.load_anchors).length > 0 ? (
                  Object.entries(p.load_anchors).map(([exercise, anchor]) => (
                    <div key={exercise} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                      <span className="text-sm font-medium text-gray-900">{exercise}</span>
                      <span className="text-sm text-gray-500">
                        {anchor.best_weight && anchor.best_reps
                          ? `${anchor.best_weight}kg × ${anchor.best_reps}`
                          : anchor.best_reps
                          ? `${anchor.best_reps} reps`
                          : anchor.best_duration
                          ? `${anchor.best_duration}s`
                          : '-'}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-gray-400 italic">暂无负荷锚点</p>
                )}
              </div>
            </DataCard>

            <DataCard title="当前限制" editable onEdit={() => startEdit('limitations')}>
              <div className="space-y-2">
                {p.active_limitations && p.active_limitations.length > 0 ? (
                  p.active_limitations.map((limitation, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${
                        limitation.severity >= 7 ? 'bg-red-500' :
                        limitation.severity >= 4 ? 'bg-yellow-500' : 'bg-green-500'
                      }`} />
                      <span className="text-sm text-gray-900">{limitation.part}</span>
                      <span className="text-xs text-gray-400">({limitation.severity}/10)</span>
                      {limitation.expire_at && (
                        <span className="text-xs text-gray-400 ml-auto">
                          至 {formatDate(limitation.expire_at)}
                        </span>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-gray-400 italic">无活跃限制</p>
                )}
              </div>
            </DataCard>

            <DataCard title="恢复状态">
              <div className="space-y-2">
                <DataRow label="总评分" value={p.recovery_state?.total_score ? `${p.recovery_state.total_score}/100` : '-'} />
                <DataRow label="急性负荷" value={p.recovery_state?.acute_load?.toString() || '-'} />
                <DataRow label="慢性负荷" value={p.recovery_state?.chronic_load?.toString() || '-'} />
                <DataRow label="CNS疲劳" value={p.recovery_state?.cns_fusing ? '是' : '否'} />
              </div>
            </DataCard>
          </div>

          {/* ---- 历史摘要 ---- */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-indigo-600">
              <TrendingUp size={20} />
              <h2 className="text-lg font-semibold text-gray-900">历史摘要</h2>
              <span className="text-xs text-gray-400">每周计算</span>
            </div>

            <DataCard title="训练趋势">
              <div className="space-y-3">
                <DataRow label="RPE趋势" value={p.trends?.rpe_trend || '-'} />
                <DataRow label="容量趋势" value={p.trends?.volume_trend || '-'} />
                <DataRow label="平均RPE" value={p.trends?.recent_avg_rpe?.toString() || '-'} />
                <DataRow label="疲劳等级" value={p.trends?.fatigue_level?.toString() || '-'} />
              </div>
            </DataCard>

            <DataCard title="关键指标">
              <div className="grid grid-cols-2 gap-3">
                <MetricBox label="总训练次数" value={s?.session_count?.toString() || '0'} />
                <MetricBox label="总容量 (kg)" value={`${((s?.total_volume || 0) / 1000).toFixed(1)}k`} />
                <MetricBox label="个人纪录" value={p.key_metrics?.personal_records?.toString() || '0'} />
                <MetricBox label="伤病次数" value={p.key_metrics?.injury_count?.toString() || '0'} />
              </div>
            </DataCard>

            {p.red_flags && p.red_flags.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <AlertCircle size={16} className="text-red-500" />
                  <span className="font-medium text-red-700">红旗警告</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {p.red_flags.map((flag, idx) => (
                    <span key={idx} className="px-2 py-1 bg-red-100 text-red-700 rounded text-sm">
                      {flag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <DataCard title="训练策略" editable onEdit={() => startEdit('training_strategy')}>
              <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                {p.training_strategy || '暂无训练策略'}
              </p>
            </DataCard>
          </div>

        </div>

      </div>

      {/* ============================================
          EDIT MODALS
          ============================================ */}

      {/* Basic Info Modal */}
      {editingSection === 'basic' && (
        <EditModal title="编辑基础信息" onSave={saveEdit} onCancel={cancelEdit} saving={saving}>
          <div className="space-y-4">
            <Input label="年龄" type="number" value={editBasic.age ?? ''} onChange={v => setEditBasic({ ...editBasic, age: v ? Number(v) : undefined })} />
            <Input label="体重 (kg)" type="number" value={editBasic.weight ?? ''} onChange={v => setEditBasic({ ...editBasic, weight: v ? Number(v) : undefined })} />
            <Input label="身高 (cm)" type="number" value={editBasic.height ?? ''} onChange={v => setEditBasic({ ...editBasic, height: v ? Number(v) : undefined })} />
            <Input label="体脂率 (%)" type="number" value={editBasic.body_fat ?? ''} onChange={v => setEditBasic({ ...editBasic, body_fat: v ? Number(v) : undefined })} />
          </div>
        </EditModal>
      )}

      {/* Preferences Modal */}
      {editingSection === 'preferences' && (
        <EditModal title="编辑训练偏好" onSave={saveEdit} onCancel={cancelEdit} saving={saving}>
          <div className="space-y-4">
            <Input label="训练方法 (逗号分隔)" value={editPreferences.method?.join(', ') ?? ''} onChange={v => setEditPreferences({ ...editPreferences, method: v.split(',').map(s => s.trim()).filter(Boolean) })} />
            <Input label="时间限制 (分钟)" type="number" value={editPreferences.time_constraint ?? ''} onChange={v => setEditPreferences({ ...editPreferences, time_constraint: v ? Number(v) : undefined })} />
            <Input label="避免动作 (逗号分隔)" value={editPreferences.avoided?.join(', ') ?? ''} onChange={v => setEditPreferences({ ...editPreferences, avoided: v.split(',').map(s => s.trim()).filter(Boolean) })} />
          </div>
        </EditModal>
      )}

      {/* Physiological Modal */}
      {editingSection === 'physiological' && (
        <EditModal title="编辑生理/心理特征" onSave={saveEdit} onCancel={cancelEdit} saving={saving}>
          <div className="space-y-4">
            <Input label="睡眠 (小时)" type="number" value={editPhysiological.sleep_hours ?? ''} onChange={v => setEditPhysiological({ ...editPhysiological, sleep_hours: v ? Number(v) : undefined })} />
            <Select label="压力水平" value={editPhysiological.stress_level ?? ''} onChange={v => setEditPhysiological({ ...editPhysiological, stress_level: v as 'low' | 'medium' | 'high' | undefined })} options={[{ value: 'low', label: '低' }, { value: 'medium', label: '中' }, { value: 'high', label: '高' }]} />
            <Select label="自律性" value={editPsychological.accountability ?? ''} onChange={v => setEditPsychological({ ...editPsychological, accountability: v as 'low' | 'medium' | 'high' | undefined })} options={[{ value: 'low', label: '低' }, { value: 'medium', label: '中' }, { value: 'high', label: '高' }]} />
            <Select label="风险偏好" value={editPsychological.risk_preference ?? ''} onChange={v => setEditPsychological({ ...editPsychological, risk_preference: v as 'conservative' | 'moderate' | 'aggressive' | undefined })} options={[{ value: 'conservative', label: '保守' }, { value: 'moderate', label: '适度' }, { value: 'aggressive', label: '激进' }]} />
          </div>
        </EditModal>
      )}

      {/* Load Anchors Modal */}
      {editingSection === 'anchors' && (
        <EditModal title="编辑负荷锚点" onSave={saveEdit} onCancel={cancelEdit} saving={saving}>
          <div className="space-y-4 max-h-96 overflow-y-auto">
            {Object.entries(editAnchors).map(([exercise, anchor]) => (
              <div key={exercise} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <span className="text-sm font-medium w-24 truncate">{exercise}</span>
                <input type="number" value={anchor.best_weight ?? ''} onChange={e => updateAnchor(exercise, 'best_weight', e.target.value)} className="w-20 px-2 py-1 border border-gray-200 rounded text-sm" placeholder="重量" />
                <span className="text-sm text-gray-400">kg ×</span>
                <input type="number" value={anchor.best_reps ?? ''} onChange={e => updateAnchor(exercise, 'best_reps', e.target.value)} className="w-16 px-2 py-1 border border-gray-200 rounded text-sm" placeholder="次" />
                <button onClick={() => removeAnchor(exercise)} className="ml-auto text-red-500 hover:text-red-700"><Trash2 size={16} /></button>
              </div>
            ))}
            <div className="flex items-center gap-2 pt-2 border-t border-gray-200">
              <input type="text" placeholder="新动作名称" value={newAnchorName} onChange={e => setNewAnchorName(e.target.value)} className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
              <button onClick={addAnchor} className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600"><Plus size={16} /></button>
            </div>
          </div>
        </EditModal>
      )}

      {/* Limitations Modal */}
      {editingSection === 'limitations' && (
        <EditModal title="编辑伤病限制" onSave={saveEdit} onCancel={cancelEdit} saving={saving}>
          <div className="space-y-4 max-h-96 overflow-y-auto">
            {editLimitations.map((limitation, idx) => (
              <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${limitation.severity >= 7 ? 'bg-red-500' : limitation.severity >= 4 ? 'bg-yellow-500' : 'bg-green-500'}`} />
                  <span className="font-medium">{limitation.part}</span>
                  <span className="text-sm text-gray-500">严重度: {limitation.severity}/10</span>
                </div>
                <button onClick={() => removeLimitation(limitation.part)} className="text-red-500 hover:text-red-700"><Trash2 size={16} /></button>
              </div>
            ))}
            <div className="flex items-center gap-2 pt-2 border-t border-gray-200">
              <input type="text" placeholder="部位名称" value={newLimitationPart} onChange={e => setNewLimitationPart(e.target.value)} className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm" />
              <input type="number" min={1} max={10} value={newLimitationSeverity} onChange={e => setNewLimitationSeverity(Number(e.target.value))} className="w-20 px-2 py-2 border border-gray-200 rounded-lg text-sm" />
              <button onClick={addLimitation} className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600"><Plus size={16} /></button>
            </div>
          </div>
        </EditModal>
      )}

      {/* Training Strategy Modal */}
      {editingSection === 'training_strategy' && (
        <EditModal title="编辑训练策略" onSave={saveEdit} onCancel={cancelEdit} saving={saving}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-500 mb-1">训练策略</label>
              <textarea
                value={editTrainingStrategy}
                onChange={e => setEditTrainingStrategy(e.target.value)}
                rows={10}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
                placeholder="输入训练策略..."
              />
            </div>
          </div>
        </EditModal>
      )}

    </div>
  );
};

// ============================================================================
// Sub Components
// ============================================================================

interface SnapshotCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  alert?: boolean;
}

const SnapshotCard: React.FC<SnapshotCardProps> = ({ icon, label, value, alert }) => (
  <div className={`p-4 rounded-xl border ${alert ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-100'}`}>
    <div className={`flex items-center gap-2 text-sm mb-1 ${alert ? 'text-red-600' : 'text-gray-500'}`}>
      {icon}
      <span>{label}</span>
    </div>
    <div className={`text-2xl font-bold ${alert ? 'text-red-700' : 'text-gray-900'}`}>
      {value}
    </div>
  </div>
);

interface DataCardProps {
  title: string;
  children: React.ReactNode;
  editable?: boolean;
  onEdit?: () => void;
}

const DataCard: React.FC<DataCardProps> = ({ title, children, editable, onEdit }) => (
  <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
    <div className="flex items-center justify-between mb-4">
      <h3 className="font-medium text-gray-900">{title}</h3>
      {editable && (
        <button onClick={onEdit} className="text-gray-400 hover:text-blue-500 transition-colors">
          <Edit size={14} />
        </button>
      )}
    </div>
    {children}
  </div>
);

interface DataRowProps {
  label: string;
  value: string;
}

const DataRow: React.FC<DataRowProps> = ({ label, value }) => (
  <div className="flex items-center justify-between py-1">
    <span className="text-sm text-gray-500">{label}</span>
    <span className="text-sm font-medium text-gray-900">{value}</span>
  </div>
);

interface MetricBoxProps {
  label: string;
  value: string;
}

const MetricBox: React.FC<MetricBoxProps> = ({ label, value }) => (
  <div className="bg-gray-50 rounded-lg p-3 text-center">
    <div className="text-lg font-bold text-gray-900">{value}</div>
    <div className="text-xs text-gray-500">{label}</div>
  </div>
);

interface InputProps {
  label: string;
  type?: string;
  value: string | number;
  onChange: (value: string) => void;
}

const Input: React.FC<InputProps> = ({ label, type = 'text', value, onChange }) => (
  <div>
    <label className="block text-sm text-gray-500 mb-1">{label}</label>
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
    />
  </div>
);

interface SelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}

const Select: React.FC<SelectProps> = ({ label, value, onChange, options }) => (
  <div>
    <label className="block text-sm text-gray-500 mb-1">{label}</label>
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
    >
      <option value="">-</option>
      {options.map(opt => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  </div>
);

interface EditModalProps {
  title: string;
  children: React.ReactNode;
  onSave: () => void;
  onCancel: () => void;
  saving?: boolean;
}

const EditModal: React.FC<EditModalProps> = ({ title, children, onSave, onCancel, saving }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
    <div className="bg-white rounded-2xl p-6 w-full max-w-lg max-h-[80vh] overflow-hidden shadow-2xl">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-600">
          <X size={20} />
        </button>
      </div>
      <div className="overflow-y-auto max-h-[50vh]">
        {children}
      </div>
      <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
        >
          取消
        </button>
        <button
          onClick={onSave}
          disabled={saving}
          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 flex items-center gap-2"
        >
          {saving ? <Clock size={16} className="animate-spin" /> : <Save size={16} />}
          {saving ? '保存中...' : '保存'}
        </button>
      </div>
    </div>
  </div>
);

export default UserProfilePanelV2;
