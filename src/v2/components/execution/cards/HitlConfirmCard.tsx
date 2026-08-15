import React, { useMemo, useState } from 'react';

interface HitlConfirmCardProps {
  uiHint: {
    type: 'hitl_confirm';
    data: any;
  };
  onConfirm?: (payload: any) => void;
}

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
    <div className="bg-white border border-amber-100 rounded-2xl overflow-hidden shadow-sm">
      <div className="bg-amber-50 px-4 py-3 border-b border-amber-100 flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-amber-500" />
        <span className="text-xs font-bold text-amber-700 uppercase">{title}</span>
      </div>

      <div className="p-4 space-y-3">
        <div className="text-sm text-gray-700 leading-relaxed">{message}</div>

        {isModifying && (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full min-h-[120px] font-mono text-xs p-3 rounded-2xl border border-gray-200 bg-gray-50 outline-none focus:ring-2 focus:ring-amber-200"
            placeholder='{"value": 105}'
          />
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={handleAccept}
            className="flex-1 py-3 rounded-2xl bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-emerald-700 active:scale-95 transition-all shadow-lg shadow-emerald-500/10"
          >
            接受
          </button>
          <button
            onClick={handleReject}
            className="flex-1 py-3 rounded-2xl bg-rose-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-rose-700 active:scale-95 transition-all shadow-lg shadow-rose-500/10"
          >
            拒绝
          </button>
          {!isModifying ? (
            <button
              onClick={handleOpenModify}
              className="px-6 py-3 rounded-2xl bg-gray-100 text-gray-700 text-[10px] font-black uppercase tracking-widest hover:bg-gray-200 active:scale-95 transition-all"
            >
              修改
            </button>
          ) : (
            <button
              onClick={handleModify}
              className="px-6 py-3 rounded-2xl bg-amber-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-amber-700 active:scale-95 transition-all shadow-lg shadow-amber-500/10"
            >
              提交
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default HitlConfirmCard;

