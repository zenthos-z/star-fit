/**
 * ProfileFullSheet — 用户画像完整版（桌面全屏浮层，三列网格）
 *
 * 定位（用户拍板的重构）：
 * - 管理界面的用户信息展示**只保留精简摘要**；任何复杂信息全部整合到这个
 *   全页浮层里看完整版。
 * - **桌面优先排版**（2026-09）：内容 max-w-6xl 居中，三列网格 = 静态档案 /
 *   动态状态 / 历史摘要，不再用移动式单列纵排浪费横向空间。
 * - 三分区对齐 UserProfileV2 三态模型（静态 6-12 月 / 动态每训 / 历史每周）。
 * - 每个数据块可点击选中 → 出现「+」→ 点击将块内容作为上下文附件挂到
 *   Agent 对话悬浮窗（agentContextStore），**非输入框文本**。
 * - 无手动编辑子弹窗：发现数据有误 → 附加给 Agent 让它改。
 *
 * 视觉：Codex 式极简——白底、1px 灰边框、扁平、黑色为唯一强调色；
 * 红色仅用于语义告警（红旗/伤病）。
 *
 * @module ProfileFullSheet
 * @version 3.0.0 (desktop grid)
 */

import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  X, Plus, User, Activity, History, AlertTriangle,
} from 'lucide-react';
import type { FlattenedProfile } from '../../services/api';
import type { LoadAnchor } from 'shared/contracts';
import { agentContextStore } from '../../state/agentContextStore';
import { transitions } from '../../../../v2/lib/animations';

interface ProfileFullSheetProps {
  userId: string;
  displayName: string;
  profile: FlattenedProfile | null;
  loading: boolean;
  onClose: () => void;
  /** 附件添加成功后回调（父层可弹 toast） */
  onAttached?: (title: string) => void;
}

// ============================================================================
// Helpers
// ============================================================================

const fmtDateTime = (v: string | number | undefined): string => {
  if (!v) return '-';
  return new Date(v).toLocaleString('zh-CN', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

const fmtDate = (v: string | number | undefined): string => {
  if (!v) return '-';
  return new Date(v).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
};

const FITNESS_LEVEL_TEXT: Record<string, string> = {
  beginner: '初学者', intermediate: '进阶', advanced: '高级', UNKNOWN: '未知',
};

const NEURO_TYPE_TEXT: Record<string, string> = {
  UNKNOWN: '未知', type_1: 'Type I（耐力型）', type_2a: 'Type IIa（混合型）',
  type_2b: 'Type IIb（爆发型）', type_3: 'Type III',
};

const RISK_PREF_TEXT: Record<string, string> = {
  UNKNOWN: '未知', conservative: '保守', moderate: '适中', aggressive: '激进',
};

const ACCOUNTABILITY_TEXT: Record<string, string> = {
  UNKNOWN: '未知', low: '低', medium: '中', high: '高',
};

const STRESS_TEXT: Record<string, string> = { low: '低', medium: '中', high: '高' };

const unknownIfEmpty = (v: unknown): boolean =>
  v === undefined || v === null || v === '' ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0);

// ============================================================================
// AttachableSection — 可选中 + 挂「+」附件的数据块
// ============================================================================

interface AttachableSectionProps {
  /** 附件去重 id，如 `profile:load_anchors` */
  attachId: string;
  title: string;
  /** 序列化给 Agent 的内容（对象）；空数据时块不可附加 */
  content: Record<string, unknown>;
  /** 块内是否有可展示数据 */
  hasData: boolean;
  children: React.ReactNode;
  /** 已在附件池中 */
  attached: boolean;
  onAttach: (title: string) => void;
}

const AttachableSection: React.FC<AttachableSectionProps> = ({
  attachId, title, content, hasData, children, attached, onAttach,
}) => {
  return (
    <div
      data-testid={`sheet-section-${attachId}`}
      className={`group relative rounded-xl border transition-colors ${
        attached
          ? 'border-gray-900 bg-gray-50/60'
          : 'border-gray-200 bg-white hover:border-gray-400'
      }`}
    >
      {/* 块头：标题 + 附加状态 */}
      <div className="flex items-center justify-between px-3.5 pt-2.5 pb-1">
        <h3 className="text-xs font-medium text-gray-500">
          {title}
          {!hasData && <span className="text-gray-300 font-normal ml-1.5">待补充</span>}
        </h3>
        {attached && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-900 text-white">
            已附加
          </span>
        )}
      </div>

      <div className="px-3.5 pb-3">
        {hasData ? children : <p className="text-xs text-gray-300 py-1.5">暂无数据</p>}
      </div>

      {/* 悬停浮出的「+」按钮（右上角）；已附加的不重复加；空块也可附加（交给 Agent 补充） */}
      {!attached && (
        <button
          className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-gray-900 text-white shadow-md flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
          aria-label={`将「${title}」加入 Agent 上下文`}
          title={hasData ? '加入 Agent 对话上下文' : '数据为空，附加后可让 Agent 补充'}
          onClick={(e) => {
            e.stopPropagation();
            agentContextStore.add({
              id: attachId,
              title,
              source: 'profile',
              content,
            });
            onAttach(title);
          }}
        >
          <Plus size={15} />
        </button>
      )}
    </div>
  );
};

// ============================================================================
// Column — 一列分区（分区标题 + 数据块堆叠）
// ============================================================================

const Column: React.FC<{
  icon: React.ReactNode;
  title: string;
  cadence: string;
  children: React.ReactNode;
}> = ({ icon, title, cadence, children }) => (
  <div className="flex flex-col min-w-0">
    <div className="flex items-baseline justify-between border-b border-gray-200 pb-2 mb-3">
      <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-900 tracking-wide">
        {icon} {title}
      </span>
      <span className="text-[10px] text-gray-400">{cadence}</span>
    </div>
    <div className="space-y-3">{children}</div>
  </div>
);

// ============================================================================
// Main Component
// ============================================================================

export const ProfileFullSheet: React.FC<ProfileFullSheetProps> = ({
  userId, displayName, profile, loading, onClose, onAttached,
}) => {
  const [attachedIds, setAttachedIds] = useState<Set<string>>(new Set());

  const handleAttach = (attachId: string, title: string) => {
    setAttachedIds((prev) => new Set(prev).add(attachId));
    onAttached?.(title);
  };

  // /profiles/:userId 返回的是扁平结构（FlattenedProfile）：active_limitations /
  // recovery_state / trends / key_metrics 都在顶层，不在三态容器里
  const raw = (profile ?? {}) as unknown as Record<string, unknown>;
  const historyData: Record<string, unknown> = {
    trends: raw.trends,
    key_metrics: raw.key_metrics,
    recent_summary: raw.summary,
  };

  // ---- 各区块内容构建 ----
  const basicInfo = (raw.basic_info ?? {}) as Record<string, unknown>;
  const physiological = (raw.physiological ?? {}) as Record<string, unknown>;
  const psycho = (raw.psycho_os ?? {}) as Record<string, unknown>;
  const anchors = (raw.load_anchors ?? {}) as Record<string, LoadAnchor>;
  const limitations = (raw.active_limitations ?? []) as NonNullable<FlattenedProfile['active_limitations']>;
  const recovery = raw.recovery_state as FlattenedProfile['recovery_state'] ?? null;
  const trends = (historyData.trends ?? {}) as Record<string, string>;
  const keyMetrics = (historyData.key_metrics ?? {}) as Record<string, number>;

  const anchorEntries = useMemo(() => Object.entries(anchors), [anchors]);

  return (
    <motion.div
      className="fixed inset-0 z-[150] bg-white flex flex-col"
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={transitions.springGentle}
      data-testid="profile-full-sheet"
    >
      {/* 桌面工具栏：左标题 / 右提示 + 关闭 */}
      <div className="h-14 shrink-0 border-b border-gray-200 flex items-center justify-between px-6">
        <div className="flex items-baseline gap-3 min-w-0">
          <h2 className="text-sm font-semibold text-gray-900">完整用户画像</h2>
          <p className="text-xs text-gray-400 truncate">{displayName}</p>
        </div>
        <div className="flex items-center gap-4">
          <p className="text-[11px] text-gray-400 hidden md:block">
            悬停数据块 → 点 <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-gray-900 text-white text-[9px] align-middle mx-0.5">+</span> 加入 Agent 上下文 · 空白块也可附加让 Agent 补充
          </p>
          <button
            className="w-8 h-8 rounded-lg border border-gray-200 text-gray-500 hover:text-gray-900 hover:border-gray-400 flex items-center justify-center transition-colors"
            aria-label="关闭"
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* 内容区：三列网格（桌面密度） */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-6 py-6">
          {loading && (
            <div className="grid grid-cols-3 gap-6 animate-pulse">
              <div className="h-64 bg-gray-100 rounded-xl" />
              <div className="h-64 bg-gray-100 rounded-xl" />
              <div className="h-64 bg-gray-100 rounded-xl" />
            </div>
          )}

          {!loading && !profile && (
            <div className="flex flex-col items-center justify-center py-32 text-gray-400">
              <AlertTriangle size={32} className="mb-3" />
              <p className="text-sm">画像数据加载失败</p>
            </div>
          )}

          {!loading && profile && (
            <div className="grid grid-cols-3 gap-6 items-start">
              {/* ============ 列 1 · 静态档案 ============ */}
              <Column icon={<User size={13} className="text-gray-400" />} title="静态档案" cadence="6-12 个月更新">
                <AttachableSection
                  attachId="profile:basic_info"
                  title="基本信息"
                  content={basicInfo}
                  hasData={!unknownIfEmpty(basicInfo)}
                  attached={attachedIds.has('profile:basic_info')}
                  onAttach={(t) => handleAttach('profile:basic_info', t)}
                >
                  <div className="grid grid-cols-2 gap-1.5">
                    {basicInfo.age !== undefined && (
                      <Field label="年龄" value={`${basicInfo.age} 岁`} />
                    )}
                    {basicInfo.gender && (
                      <Field label="性别" value={{ male: '男', female: '女', other: '其他' }[basicInfo.gender as string] ?? String(basicInfo.gender)} />
                    )}
                    {basicInfo.height !== undefined && (
                      <Field label="身高" value={`${basicInfo.height} cm`} />
                    )}
                    {basicInfo.weight !== undefined && (
                      <Field label="体重" value={`${basicInfo.weight} kg`} />
                    )}
                    {basicInfo.body_fat !== undefined && (
                      <Field label="体脂" value={`${basicInfo.body_fat}%`} />
                    )}
                    {basicInfo.training_age !== undefined && (
                      <Field label="训练龄" value={`${basicInfo.training_age} 个月`} />
                    )}
                  </div>
                </AttachableSection>

                <AttachableSection
                  attachId="profile:fitness_level"
                  title="能力分级与标签"
                  content={{
                    fitness_level: profile.fitness_level,
                    tags: profile.tags ?? [],
                    red_flags: profile.red_flags ?? [],
                    training_strategy: profile.training_strategy ?? null,
                  }}
                  hasData={!unknownIfEmpty([profile.fitness_level, profile.tags ?? [], profile.red_flags ?? []].flat())}
                  attached={attachedIds.has('profile:fitness_level')}
                  onAttach={(t) => handleAttach('profile:fitness_level', t)}
                >
                  <div className="flex flex-wrap gap-1.5">
                    {profile.fitness_level && (
                      <span className="text-xs px-2 py-0.5 rounded-md bg-gray-900 text-white">
                        {FITNESS_LEVEL_TEXT[profile.fitness_level] ?? profile.fitness_level}
                      </span>
                    )}
                    {(profile.tags ?? []).map((t) => (
                      <span key={t} className="text-xs px-2 py-0.5 rounded-md bg-gray-50 text-gray-600 border border-gray-200">{t}</span>
                    ))}
                    {(profile.red_flags ?? []).map((t) => (
                      <span key={t} className="text-xs px-2 py-0.5 rounded-md bg-red-50 text-red-600 border border-red-200">{t}</span>
                    ))}
                  </div>
                  {profile.training_strategy && (
                    <p className="text-xs text-gray-500 mt-2 whitespace-pre-wrap leading-relaxed">{profile.training_strategy}</p>
                  )}
                </AttachableSection>

                <AttachableSection
                  attachId="profile:psycho"
                  title="神经心理特征"
                  content={{ ...psycho, ...physiological }}
                  hasData={!unknownIfEmpty({ ...psycho, ...physiological })}
                  attached={attachedIds.has('profile:psycho')}
                  onAttach={(t) => handleAttach('profile:psycho', t)}
                >
                  <div className="grid grid-cols-2 gap-1.5">
                    {psycho.neurotype && <Field label="肌纤维类型" value={NEURO_TYPE_TEXT[psycho.neurotype as string] ?? String(psycho.neurotype)} />}
                    {psycho.riskPreference && <Field label="风险偏好" value={RISK_PREF_TEXT[psycho.riskPreference as string] ?? String(psycho.riskPreference)} />}
                    {psycho.accountability && <Field label="自律程度" value={ACCOUNTABILITY_TEXT[psycho.accountability as string] ?? String(psycho.accountability)} />}
                    {physiological.sleep_hours !== undefined && <Field label="睡眠" value={`${physiological.sleep_hours} h`} />}
                    {physiological.stress_level && <Field label="压力" value={STRESS_TEXT[physiological.stress_level as string] ?? String(physiological.stress_level)} />}
                  </div>
                </AttachableSection>
              </Column>

              {/* ============ 列 2 · 动态状态 ============ */}
              <Column icon={<Activity size={13} className="text-gray-400" />} title="动态状态" cadence="每次训练后更新">
                <AttachableSection
                  attachId="profile:load_anchors"
                  title="负荷锚点"
                  content={anchors}
                  hasData={anchorEntries.length > 0}
                  attached={attachedIds.has('profile:load_anchors')}
                  onAttach={(t) => handleAttach('profile:load_anchors', t)}
                >
                  <div className="space-y-1">
                    {anchorEntries.map(([name, a]) => (
                      <div key={name} className="flex items-center justify-between text-sm py-1 border-b border-gray-100 last:border-0">
                        <span className="text-gray-700 truncate">{name}</span>
                        <span className="text-gray-500 font-mono text-xs shrink-0 ml-2 tabular-nums">
                          {a.best_weight !== undefined ? `${a.best_weight}kg × ${a.best_reps ?? '-'}` : ''}
                          {a.best_weight === undefined && a.best_duration !== undefined ? `${a.best_duration}s` : ''}
                          {a.best_weight === undefined && a.best_duration === undefined && a.best_distance !== undefined ? `${(a.best_distance / 1000).toFixed(2)}km` : ''}
                          {a.est_1rm !== undefined ? ` · 1RM≈${a.est_1rm}` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                </AttachableSection>

                <AttachableSection
                  attachId="profile:active_limitations"
                  title="伤病限制"
                  content={{ active_limitations: limitations }}
                  hasData={limitations.length > 0}
                  attached={attachedIds.has('profile:active_limitations')}
                  onAttach={(t) => handleAttach('profile:active_limitations', t)}
                >
                  <div className="space-y-1">
                    {limitations.map((l, i) => (
                      <div key={i} className="py-1.5 border-b border-gray-100 last:border-0">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-gray-700">{l.part}</span>
                          <span className="text-xs text-red-500 tabular-nums">严重度 {l.severity}/10</span>
                        </div>
                        <p className="text-[11px] text-gray-400 mt-0.5">
                          {fmtDate(l.logged_at)} 记录 · {l.auto_heal ? `${fmtDate(l.expire_at)} 自愈` : '需手动处理'}
                        </p>
                      </div>
                    ))}
                  </div>
                </AttachableSection>

                <AttachableSection
                  attachId="profile:recovery_state"
                  title="恢复状态"
                  content={recovery ?? {}}
                  hasData={!!recovery}
                  attached={attachedIds.has('profile:recovery_state')}
                  onAttach={(t) => handleAttach('profile:recovery_state', t)}
                >
                  {recovery && (
                    <div className="grid grid-cols-3 gap-1.5">
                      <Field label="恢复评分" value={`${recovery.total_score}/100`} />
                      <Field label="CNS 疲劳" value={recovery.cns_fusing ? '是' : '否'} />
                      <Field label="评估于" value={fmtDateTime(recovery.last_assessed)} />
                    </div>
                  )}
                </AttachableSection>
              </Column>

              {/* ============ 列 3 · 历史摘要 ============ */}
              <Column icon={<History size={13} className="text-gray-400" />} title="历史摘要" cadence="每周更新">
                <AttachableSection
                  attachId="profile:history_summary"
                  title="历史摘要"
                  content={historyData as Record<string, unknown>}
                  hasData={!unknownIfEmpty(historyData)}
                  attached={attachedIds.has('profile:history_summary')}
                  onAttach={(t) => handleAttach('profile:history_summary', t)}
                >
                  <div className="space-y-2.5">
                    {typeof historyData.recent_summary === 'string' && historyData.recent_summary && (
                      <p className="text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">{historyData.recent_summary}</p>
                    )}
                    <div className="grid grid-cols-2 gap-1.5">
                      {keyMetrics.total_sessions !== undefined && <Field label="总次数" value={String(keyMetrics.total_sessions)} />}
                      {keyMetrics.personal_records !== undefined && <Field label="PR 数" value={String(keyMetrics.personal_records)} />}
                      {trends.rpe_trend && <Field label="RPE 趋势" value={trends.rpe_trend} />}
                      {trends.volume_trend && <Field label="容量趋势" value={trends.volume_trend} />}
                    </div>
                  </div>
                </AttachableSection>
              </Column>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};

// ============================================================================
// Field
// ============================================================================

const Field: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="bg-gray-50 rounded-lg px-2.5 py-1.5">
    <p className="text-[10px] text-gray-400">{label}</p>
    <p className="text-sm font-medium text-gray-800 tabular-nums">{value}</p>
  </div>
);
