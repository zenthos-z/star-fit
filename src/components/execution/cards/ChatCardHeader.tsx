import React from 'react';

interface ChatCardHeaderProps {
  title: string;
  subtitle?: string;
  /** 头部右侧附加区（触发徽标 / 关闭钮等） */
  right?: React.ReactNode;
}

/**
 * AI 教练聊天卡片共用头部（2026-09-11 统一规范）：
 * - 深色 star-dark 头 + 左侧空心小蓝圈标识（与执行页 CardHeader 定稿同款：
 *   w-2 h-2 rounded-full border-2，无辉光、无图标、无竖条）
 * - 标题 15px semibold 白字（去 italic/uppercase/tracking-widest 运动风装饰）
 * - 八张聊天卡片（Plan/Survey/SurveySuccess/Audit/Strategy/ProfileUpdate/Hitl/Summary）
 *   统一接入，语义色只允许出现在 right 槽徽标与卡片内容区
 */
export const ChatCardHeader: React.FC<ChatCardHeaderProps> = ({ title, subtitle, right }) => {
  return (
    <div className="bg-star-dark px-5 py-3.5 flex items-center gap-2.5 rounded-t-[24px]">
      <span
        className="w-2 h-2 rounded-full border-2 border-blue-500 shrink-0"
        aria-hidden="true"
      />
      <div className="flex-1 min-w-0">
        <span className="block text-[15px] font-semibold text-white leading-tight truncate">
          {title}
        </span>
        {subtitle && (
          <span className="block text-[11px] text-white/50 mt-0.5 truncate">{subtitle}</span>
        )}
      </div>
      {right}
    </div>
  );
};
