import React from 'react';

interface ChatCardShellProps {
  children: React.ReactNode;
  className?: string;
  /** 供 UI 测试定位 */
  testId?: string;
}

/**
 * AI 教练聊天卡片共用外壳（2026-09-11 统一规范）：
 * 白底 rounded-[24px]（对齐聊天气泡圆角）+ 轻阴影 + border-gray-100。
 * 历史三档圆角（2.5rem/40px 与 2xl/16px 混用）收敛到 24px 一档。
 */
export const ChatCardShell: React.FC<ChatCardShellProps> = ({ children, className = '', testId }) => {
  return (
    <div
      data-testid={testId}
      className={`bg-white border border-gray-100 rounded-[24px] overflow-hidden shadow-sm ${className}`}
    >
      {children}
    </div>
  );
};

/** 主操作按钮：蓝底白字胶囊（统一 h-11 / semibold 15px，禁 italic/uppercase） */
export const ChatPrimaryButton: React.FC<{
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}> = ({ children, onClick, disabled, className = '' }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`h-11 rounded-full bg-star-accent text-white text-[15px] font-semibold transition-all active:scale-95 disabled:opacity-50 disabled:scale-100 ${className}`}
  >
    {children}
  </button>
);

/** 次要操作按钮：灰底胶囊 */
export const ChatSecondaryButton: React.FC<{
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}> = ({ children, onClick, disabled, className = '' }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`h-11 rounded-full bg-gray-100 text-gray-700 text-[15px] font-semibold transition-all active:scale-95 disabled:opacity-50 disabled:scale-100 ${className}`}
  >
    {children}
  </button>
);
