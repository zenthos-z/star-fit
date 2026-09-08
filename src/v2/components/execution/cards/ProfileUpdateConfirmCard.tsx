import React, { useMemo, useState } from 'react';

/**
 * ProfileUpdateConfirmCard (profile_update_confirm) - 用户画像更新确认气泡
 *
 * docs/profile-update-frontend-spec.md §3:
 * Agent 在 day_end / injury_report / key_parameter_change 时机主动提议更新画像，
 * 本卡片渲染提案列表（label + change 逐条，value 可折叠）并给出确认/取消双按钮。
 * 点击后气泡冻结为已选状态，防止重复提交。确认/取消均由父级
 * （AICoachOverlay onConfirm）发起 scenario=update_profile 的执行轮。
 *
 * 视觉语言与 AuditCompleteCard / StrategyConfirmCard 统一：
 * 白底圆角卡 + bg-star-dark 深色头部 + star-accent 主操作按钮。
 */

interface ProfileUpdateProposal {
  field: 'load_anchors' | 'active_limitations' | 'recovery_state' | 'memories';
  label: string;
  change: string;
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
    };
  };
  onConfirm?: (payload: {
    action: 'confirm_update' | 'cancel_update';
    proposals: ProfileUpdateProposal[];
  }) => void;
}

type Decision = 'idle' | 'confirmed' | 'cancelled';

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
  const [decision, setDecision] = useState<Decision>('idle');
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

  const frozen = decision !== 'idle';

  const handleConfirm = () => {
    if (frozen || !onConfirm) return;
    setDecision('confirmed');
    onConfirm({ action: 'confirm_update', proposals });
  };

  const handleCancel = () => {
    if (frozen || !onConfirm) return;
    setDecision('cancelled');
    onConfirm({ action: 'cancel_update', proposals });
  };

  return (
    <div
      className={`bg-white border rounded-2xl overflow-hidden shadow-floating transition-colors ${
        frozen ? 'border-gray-100 opacity-90' : 'border-gray-100'
      }`}
      role="group"
      aria-label={title}
    >
      {/* Header - dark theme, matching AuditCompleteCard */}
      <div className="bg-star-dark px-4 py-3 flex items-center gap-2">
        <svg className="w-5 h-5 text-star-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 3v18m-7-9.5a14.5 14.5 0 007 3.5m0-11a14.5 14.5 0 00-7 3.5m14 4a14.5 14.5 0 00-7-3.5m0 11a14.5 14.5 0 007-3.5" />
        </svg>
        <h3 className="text-white text-lg font-black uppercase tracking-widest">{title}</h3>
        {triggerBadge && (
          <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full font-bold ${triggerBadge.className}`}>
            {triggerBadge.label}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="p-6">
        <div className="flex items-start gap-4 mb-4">
          <div className="flex-shrink-0 w-12 h-12 rounded-full bg-star-accent/10 flex items-center justify-center">
            <svg className="w-6 h-6 text-star-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 3v18m-7-9.5a14.5 14.5 0 007 3.5m0-11a14.5 14.5 0 00-7 3.5m14 4a14.5 14.5 0 00-7-3.5m0 11a14.5 14.5 0 007-3.5" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-gray-700 leading-relaxed">
              {message || '教练希望更新你的训练画像，请确认以下改动。'}
            </p>
          </div>
        </div>

        {/* Proposals list */}
        {proposals.length > 0 && (
          <div className="space-y-2 mt-4 pt-4 border-t border-gray-100">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">更新提案</p>
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

      {/* Action buttons - 冻结态：选中高亮、另一按钮禁用 */}
      <div className="p-5 pt-0 flex items-center gap-3">
        <button
          onClick={handleCancel}
          disabled={frozen}
          aria-pressed={decision === 'cancelled'}
          className={`flex-1 py-4 rounded-2xl font-black italic uppercase tracking-widest transition-all active:scale-95 disabled:cursor-not-allowed ${
            decision === 'cancelled'
              ? 'bg-gray-800 text-white shadow-lg'
              : frozen
              ? 'bg-gray-100 text-gray-300'
              : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
          }`}
        >
          {decision === 'cancelled' ? '已保留原状' : cancelLabel}
        </button>
        <button
          onClick={handleConfirm}
          disabled={frozen}
          aria-pressed={decision === 'confirmed'}
          className={`flex-1 py-4 rounded-2xl font-black italic uppercase tracking-widest transition-all active:scale-95 disabled:cursor-not-allowed ${
            decision === 'confirmed'
              ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/20'
              : frozen
              ? 'bg-gray-100 text-gray-300'
              : 'bg-star-accent text-white hover:bg-blue-600 shadow-lg shadow-blue-500/20'
          }`}
        >
          {decision === 'confirmed' ? '✓ 已更新' : confirmLabel}
        </button>
      </div>
    </div>
  );
};

export default ProfileUpdateConfirmCard;
