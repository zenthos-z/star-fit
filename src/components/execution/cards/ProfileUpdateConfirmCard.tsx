import React, { useMemo, useState } from 'react';
import { ChatCardHeader } from './ChatCardHeader';
import { ChatCardShell, ChatPrimaryButton, ChatSecondaryButton } from './ChatCardShell';

/**
 * ProfileUpdateConfirmCard (profile_update_confirm) - 用户画像更新确认气泡
 *
 * docs/profile-update-frontend-spec.md §3 + [B5 issue#37] 两气泡合一：
 * 「确认画像更新」与「画像更新完成」在同一条消息内流转，不再新开气泡。
 * 按钮状态机：初始「确认更新」→ 点击进入加载态（按钮不可再点，写入中…）→
 * 确定性写入（前端直调 POST /api/profile/apply-proposals，无 LLM、毫秒级）
 * → 成功变「已更新」（终态）/ 失败变「更新未完成」（可重试）。
 * 写入成功且卡片带待续意图（pending_intent）时，父级自动续跑用户原始意图。
 *
 * 决定记录（decision）持久化在 ChatMessage.uiHint 上（切话题/重启不回弹，
 * 2026-09-14）；result 子状态由写入端点结果回填（pending/done/failed）。
 *
 * 视觉语言与 AuditCompleteCard 统一：
 * 白底圆角卡 + bg-star-dark 深色头部 + star-accent 主操作按钮。
 */

interface ProfileUpdateProposal {
  field: 'load_anchors' | 'active_limitations' | 'recovery_state' | 'memories';
  label: string;
  change: string;
  /** [B5] 最终值（Agent 提案轮算好，确认后由系统确定性写入） */
  value?: unknown;
}

interface ProfileUpdateConfirmCardProps {
  uiHint: {
    type: 'profile_update_confirm';
    data: {
      title?: string;
      message: string;
      trigger?: 'day_end' | 'injury_report' | 'key_parameter_change' | 'user_request';
      proposals: ProfileUpdateProposal[];
      confirmLabel?: string;
      cancelLabel?: string;
      /** [B5 issue#37] 待续意图：写入完成后据此续跑用户原始请求 */
      pending_intent?: {
        user_message: string;
        summary: string;
        scenario?: 'chat' | 'plan';
      };
    };
    /** 决定记录（持久化在 ChatMessage.uiHint 上，切话题/重启不回弹，2026-09-14） */
    decision?: ProfileUpdateDecisionRecord;
  };
  onConfirm?: (payload: {
    action: 'confirm_update' | 'cancel_update';
    proposals: ProfileUpdateProposal[];
  }) => void;
}

/** 画像更新决定记录：固化确认/取消状态，随 thread 持久化 */
export interface ProfileUpdateDecisionRecord {
  action: 'confirm_update' | 'cancel_update';
  decidedAt: number;      // epoch ms
  /** 写库结果（确认时由消费端回填）：done=成功 / failed=失败 / pending=写入中 */
  result?: 'done' | 'failed' | 'pending';
}

/**
 * 卡片相位（[B5] 同一气泡内的完整流转）：
 * idle（可确认/可取消）→ writing（确定性写入中）→ done（终态「已更新」）
 * / failed（写入失败，可重试）；cancelled（取消终态）。
 */
type Phase = 'idle' | 'writing' | 'done' | 'failed' | 'cancelled';

const TRIGGER_BADGE: Record<string, { label: string; className: string }> = {
  day_end: { label: '今日总结', className: 'bg-blue-50 text-blue-600' },
  injury_report: { label: '伤情上报', className: 'bg-rose-50 text-rose-600' },
  key_parameter_change: { label: '参数变化', className: 'bg-amber-50 text-amber-600' },
  user_request: { label: '用户请求', className: 'bg-gray-100 text-gray-600' },
};

/** proposals.field 的强调色（与 AuditCompleteCard getFieldColor 同构） */
const getFieldColor = (field: string) => {
  switch (field) {
    case 'load_anchors': return 'text-blue-600 bg-blue-50';
    case 'recovery_state': return 'text-green-600 bg-green-50';
    case 'memories': return 'text-purple-600 bg-purple-50';
    case 'active_limitations': return 'text-orange-600 bg-orange-50';
    default: return 'text-gray-600 bg-gray-50';
  }
};

export const ProfileUpdateConfirmCard: React.FC<ProfileUpdateConfirmCardProps> = ({ uiHint, onConfirm }) => {
  const [decision, setDecision] = useState<'idle' | 'confirmed' | 'cancelled'>('idle');
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const { title, message, proposals, confirmLabel, cancelLabel, triggerBadge } = useMemo(() => {
    const raw = (uiHint?.data || {}) as ProfileUpdateConfirmCardProps['uiHint']['data'];
    const list = Array.isArray(raw?.proposals) ? raw.proposals : [];
    const trigger = raw?.trigger && TRIGGER_BADGE[raw.trigger]
      ? TRIGGER_BADGE[raw.trigger]
      : undefined;
    return {
      title: raw.title || '用户画像更新建议',
      message: String(raw.message || '').trim(),
      proposals: list,
      confirmLabel: raw.confirmLabel || '确认更新',
      cancelLabel: raw.cancelLabel || '暂不更新',
      triggerBadge: trigger,
    };
  }, [uiHint?.data]);

  // 相位合成：持久化决定优先（写入结果由消费端回填），内存态覆盖点击后的
  // 短暂间隙（decision 固化传播到 props 前）。failed 可重试（回到可点）。
  const persistedDecision = uiHint?.decision;
  const phase: Phase = useMemo(() => {
    if (persistedDecision) {
      if (persistedDecision.action === 'cancel_update') return 'cancelled';
      if (persistedDecision.result === 'done') return 'done';
      if (persistedDecision.result === 'failed') return 'failed';
      return 'writing'; // confirm_update + pending/未知 → 写入中
    }
    if (decision === 'confirmed') return 'writing';
    if (decision === 'cancelled') return 'cancelled';
    return 'idle';
  }, [persistedDecision, decision]);

  const canAct = phase === 'idle' || phase === 'failed';

  const handleConfirm = () => {
    if (!canAct || !onConfirm) return;
    setDecision('confirmed');
    onConfirm({ action: 'confirm_update', proposals });
  };

  const handleCancel = () => {
    if (!canAct || !onConfirm) return;
    setDecision('cancelled');
    onConfirm({ action: 'cancel_update', proposals });
  };

  return (
    <ChatCardShell
      className={phase === 'done' || phase === 'cancelled' ? 'opacity-90' : ''}
    >
      {/* Header - 统一深色头 + 空心小蓝圈 */}
      <ChatCardHeader
        title={title}
        right={triggerBadge && (
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${triggerBadge.className} shrink-0`}>
            {triggerBadge.label}
          </span>
        )}
      />

      {/* Content */}
      <div className="p-6">
        <div className="flex items-start gap-4 mb-4">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center">
            <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 3v18m-7-9.5a14.5 14.5 0 007 3.5m0-11a14.5 14.5 0 00-7 3.5m14 4a14.5 14.5 0 00-7-3.5m0 11a14.5 14.5 0 007-3.5" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-[15px] text-gray-800 leading-relaxed">
              {message || '教练希望更新你的训练画像，请确认以下改动。'}
            </p>
          </div>
        </div>

        {/* Proposals list */}
        {proposals.length > 0 && (
          <div className="space-y-2 mt-4 pt-4 border-t border-gray-100">
            <p className="text-xs font-medium text-gray-400 mb-2">更新提案</p>
            {proposals.map((p, idx) => {
              const expanded = expandedIdx === idx;
              const hasValue = p.value !== undefined && p.value !== null;
              return (
                <div key={idx} className={`px-3 py-2 rounded-xl ${getFieldColor(p.field)}`}>
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold">{p.label}</span>
                        <span className="text-[10px] px-1.5 py-0.5 bg-white/60 rounded-full font-bold uppercase">
                          {p.field}
                        </span>
                      </div>
                      <p className="text-xs font-medium mt-0.5 leading-relaxed break-words">{p.change}</p>
                    </div>
                    {hasValue && (
                      <button
                        onClick={() => setExpandedIdx(expanded ? null : idx)}
                        aria-expanded={expanded}
                        aria-label={expanded ? '收起新值预览' : '展开新值预览'}
                        className="flex-shrink-0 w-7 h-7 rounded-lg bg-white/60 flex items-center justify-center text-gray-500 hover:bg-white transition-colors"
                      >
                        <svg className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    )}
                  </div>
                  {expanded && hasValue && (
                    <pre className="mt-2 text-[10px] font-mono bg-white/70 text-gray-700 rounded-lg p-2 whitespace-pre-wrap break-words max-h-40 overflow-y-auto custom-scrollbar">
                      {JSON.stringify(p.value, null, 2)}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Action area - 相位状态机（[B5] 同一气泡内流转）：
          writing：主按钮转加载态（写入中…，不可再点），取消一并禁用
          done / cancelled：终态状态行（不再渲染按钮）
          failed：状态行提示失败 + 按钮组重现（可重试 / 可放弃） */}
      {phase === 'writing' ? (
        <div className="p-5 pt-0 flex items-center gap-3">
          <ChatSecondaryButton className="flex-1 opacity-50" disabled>
            {cancelLabel}
          </ChatSecondaryButton>
          <ChatPrimaryButton className="flex-1 opacity-70" disabled>
            <span className="inline-flex items-center justify-center gap-2">
              <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              更新中…
            </span>
          </ChatPrimaryButton>
        </div>
      ) : phase === 'done' || phase === 'cancelled' ? (
        <div className="p-5 pt-0 flex items-center justify-center gap-2 py-2.5">
          <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
            phase === 'cancelled' ? 'bg-gray-100 text-gray-500' : 'bg-emerald-50 text-emerald-500'
          }`}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </span>
          <p className="text-[15px] font-semibold text-gray-900">
            {phase === 'done' ? '画像已更新' : '已保留原状，未修改'}
          </p>
        </div>
      ) : (
        <div className="p-5 pt-0 flex flex-col gap-2">
          {phase === 'failed' && (
            <div className="flex items-center justify-center gap-2 py-1.5">
              <span className="w-5 h-5 rounded-full bg-rose-50 text-rose-500 flex items-center justify-center shrink-0">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </span>
              <p className="text-[13px] font-medium text-rose-500">更新未完成，可重试</p>
            </div>
          )}
          <div className="flex items-center gap-3">
            <ChatSecondaryButton
              className="flex-1"
              onClick={handleCancel}
            >
              {phase === 'failed' ? '暂不更新' : (decision === 'cancelled' ? '已保留原状' : cancelLabel)}
            </ChatSecondaryButton>
            <ChatPrimaryButton
              className="flex-1"
              onClick={handleConfirm}
            >
              {phase === 'failed' ? '重试更新' : confirmLabel}
            </ChatPrimaryButton>
          </div>
        </div>
      )}
    </ChatCardShell>
  );
};

export default ProfileUpdateConfirmCard;
