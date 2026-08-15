import React, { useState } from 'react';
import { createPortal } from 'react-dom';

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

export const DeviationWarningModal: React.FC<DeviationWarningModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  context
}) => {
  if (!isOpen) return null;

  const [selectedReason, setSelectedReason] = useState('');
  const reasons = ['状态极佳', '感到疲劳', '受伤预防', '器械限制'];

  const fieldLabels: Record<string, string> = {
    weight: '配重',
    reps: '次数',
    targetRpe: '目标强度'
  };

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl p-8 animate-in fade-in zoom-in-95 duration-300">
        {/* Warning Icon */}
        <div className="flex justify-center mb-6">
          <svg className="w-16 h-16 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>

        {/* Title */}
        <h2 className="text-2xl font-black text-gray-900 text-center mb-4">
          检测到显著参数调整
        </h2>

        {/* Change Details */}
        <div className="bg-gray-50 rounded-xl p-4 mb-6">
          <p className="text-sm font-bold text-gray-600 mb-2">
            你正在将 <span className="text-gray-900">{fieldLabels[context.field]}</span>
          </p>
          <div className="flex items-center justify-center gap-4">
            <div className="text-center">
              <p className="text-xs font-bold text-gray-400 uppercase">原值</p>
              <p className="text-xl font-black text-gray-500">{context.original}</p>
            </div>
            <svg className="w-6 h-6 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
            <div className="text-center">
              <p className="text-xs font-bold text-gray-400 uppercase">新值</p>
              <p className="text-xl font-black text-star-accent">{context.current}</p>
            </div>
          </div>
        </div>

        {/* Reason Selection */}
        <p className="text-sm font-bold text-gray-600 mb-3 text-center">
          调整原因 (可选)
        </p>
        <div className="space-y-2 mb-8">
          {reasons.map((reason) => (
            <button
              key={reason}
              onClick={() => setSelectedReason(reason)}
              className={`w-full px-4 py-3 rounded-xl font-bold text-sm transition-all ${
                selectedReason === reason
                  ? 'bg-star-dark text-white shadow-lg'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {reason}
            </button>
          ))}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-xl font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-all"
          >
            返回修改
          </button>
          <button
            onClick={() => onConfirm(selectedReason)}
            className="flex-1 py-3 rounded-xl font-bold text-white bg-star-dark hover:bg-black transition-all shadow-lg"
          >
            确认并保存
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
