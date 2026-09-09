import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { setTabBarHidden } from '../../lib/nativeTabBar';

interface DeviationWarningModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  context: {
    exerciseName: string;
    field: 'weight' | 'reps' | 'targetRpe';
    original: number;
    current: number;
  };
}

/**
 * DeviationWarningModal — 参数偏差确认对话框
 * iOS Alert 规范（ios-sheet-modal-styling.md 拍板模板）：
 * 窄卡 w-[270px] rounded-[40px]（与运动卡片/屏角统一标准）+ 图标 w-9 + 标题 text-lg + 纵向蓝字按钮组。
 */
export const DeviationWarningModal: React.FC<DeviationWarningModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  context
}) => {
  const [selectedReason, setSelectedReason] = useState('');

  // iOS sheet 规范：盖住原生 tab bar
  useEffect(() => {
    if (!isOpen) return;
    setTabBarHidden(true);
    return () => setTabBarHidden(false);
  }, [isOpen]);

  if (!isOpen) return null;

  const reasons = ['状态极佳', '感到疲劳', '受伤预防', '器械限制'];

  const fieldLabels: Record<string, string> = {
    weight: '配重',
    reps: '次数',
    targetRpe: '目标强度'
  };

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white/95 backdrop-blur-xl w-[270px] rounded-[40px] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-300">
        {/* Warning Icon + Title */}
        <div className="flex flex-col items-center pt-5 px-4">
          <svg className="w-9 h-9 text-amber-500 mb-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
          <h2 className="text-lg font-semibold text-gray-900 text-center leading-snug">
            检测到显著参数调整
          </h2>
        </div>

        {/* Change Details — 紧凑单行 */}
        <div className="px-4 pt-3">
          <div className="bg-gray-50 rounded-2xl px-3 py-2.5">
            <p className="text-xs font-medium text-gray-500 text-center mb-1.5">
              你正在将 <span className="font-semibold text-gray-800">{fieldLabels[context.field]}</span>
            </p>
            <div className="flex items-center justify-center gap-3">
              <span className="text-lg font-bold text-gray-400 tabular-nums">{context.original}</span>
              <svg className="w-3.5 h-3.5 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
              <span className="text-lg font-bold text-star-accent tabular-nums">{context.current}</span>
            </div>
          </div>
        </div>

        {/* Reason Selection — 紧凑 chips */}
        <div className="px-4 pt-3.5 pb-4">
          <p className="text-xs font-medium text-gray-500 mb-2 text-center">调整原因（可选）</p>
          <div className="grid grid-cols-2 gap-1.5">
            {reasons.map((reason) => (
              <button
                key={reason}
                onClick={() => setSelectedReason(reason)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all active:scale-95 ${
                  selectedReason === reason
                    ? 'bg-star-accent text-white'
                    : 'bg-gray-100 text-gray-600 active:bg-gray-200'
                }`}
              >
                {reason}
              </button>
            ))}
          </div>
        </div>

        {/* Action Buttons — iOS Alert 纵向蓝字 */}
        <div className="border-t border-gray-200">
          <button
            onClick={onClose}
            className="w-full py-3 text-[17px] font-normal text-star-accent active:bg-gray-100 transition-colors border-b border-gray-200"
          >
            返回修改
          </button>
          <button
            onClick={() => onConfirm(selectedReason)}
            className="w-full py-3 text-[17px] font-semibold text-star-accent active:bg-gray-100 transition-colors"
          >
            确认保存
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
