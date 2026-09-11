import React, { useMemo, useState } from 'react';
import { ChatCardHeader } from './ChatCardHeader';
import { ChatCardShell, ChatPrimaryButton, ChatSecondaryButton } from './ChatCardShell';

interface HitlConfirmCardProps {
  uiHint: {
    type: 'hitl_confirm';
    data: any;
  };
  onConfirm?: (payload: any) => void;
}

/**
 * HitlConfirmCard (hitl_confirm) - Human-in-the-loop 确认卡
 *
 * 2026-09-11 聊天卡片视觉统一：琥珀色头部 → 统一深色头 + 空心小蓝圈
 * （警示语义改由内容区琥珀徽标表达），按钮斜体大写 → 胶囊 semibold。
 */
export const HitlConfirmCard: React.FC<HitlConfirmCardProps> = ({ uiHint, onConfirm }) => {
  const [isModifying, setIsModifying] = useState(false);
  const [draft, setDraft] = useState('');

  const { title, message, rawData } = useMemo(() => {
    const raw = uiHint?.data || {};
    const subType = String(raw?.sub_type || raw?.subType || '').trim();
    const data = raw?.data ?? raw;
    const msg = String(data?.reason || data?.message || data?.prompt || '').trim();

    const t = subType
      ? subType.replace(/_/g, ' ')
      : (raw?.type ? String(raw.type) : '需要确认');

    return { title: t || '需要确认', message: msg || '需要确认后继续。', rawData: raw };
  }, [uiHint?.data]);

  const handleAccept = () => onConfirm?.({ decision: 'accept' });
  const handleReject = () => onConfirm?.({ decision: 'reject' });

  const handleOpenModify = () => {
    setIsModifying(true);
    try {
      setDraft(JSON.stringify(rawData?.data ?? {}, null, 2));
    } catch {
      setDraft('');
    }
  };

  const handleModify = () => {
    let parsed: any = undefined;
    try {
      parsed = draft ? JSON.parse(draft) : {};
    } catch {
      parsed = { raw: draft };
    }
    onConfirm?.({ decision: 'modify', payload: parsed });
  };

  return (
    <ChatCardShell>
      <ChatCardHeader
        title={title}
        right={
          <span className="ml-1 text-[10px] px-2 py-0.5 rounded-full font-semibold bg-amber-50 text-amber-600 shrink-0">
            待确认
          </span>
        }
      />

      <div className="p-5 space-y-3">
        <div className="text-[15px] text-gray-800 leading-relaxed">{message}</div>

        {isModifying && (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full min-h-[120px] font-mono text-xs p-3 rounded-2xl border border-gray-200 bg-gray-50 outline-none focus:border-star-accent"
            placeholder='{"value": 105}'
          />
        )}

        <div className="flex items-center gap-2.5">
          <ChatPrimaryButton className="flex-1" onClick={handleAccept}>
            接受
          </ChatPrimaryButton>
          {!isModifying ? (
            <>
              <ChatSecondaryButton className="flex-1" onClick={handleOpenModify}>
                修改
              </ChatSecondaryButton>
              <ChatSecondaryButton className="flex-1" onClick={handleReject}>
                拒绝
              </ChatSecondaryButton>
            </>
          ) : (
            <ChatSecondaryButton className="flex-1" onClick={handleModify}>
              提交修改
            </ChatSecondaryButton>
          )}
        </div>
      </div>
    </ChatCardShell>
  );
};

export default HitlConfirmCard;
