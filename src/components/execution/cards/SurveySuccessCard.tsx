import React from 'react';
import { ChatCardHeader } from './ChatCardHeader';
import { ChatCardShell, ChatPrimaryButton } from './ChatCardShell';

interface SurveySuccessCardProps {
  uiHint: {
    type: 'survey_success';
    data: {
      title?: string;
      message: string;
      actionLabel?: string;
      requiresConfirmation?: boolean;
    };
  };
  onConfirm?: (value: any) => void;
}

/**
 * SurveySuccessCard (SURVEY_SUCCESS) - Survey completion confirmation
 *
 * [方案 B] Shown when user profile is successfully saved from survey.
 * Displays a success message with a confirmation button to continue.
 * When confirmed, triggers a second request to generate the training plan.
 *
 * 2026-09-11 聊天卡片视觉统一：绿色头部 → 统一深色头 + 空心小蓝圈
 * （成功语义改由内容区 ✓ 图标表达），按钮斜体大写 → 胶囊 semibold。
 */
export const SurveySuccessCard: React.FC<SurveySuccessCardProps> = ({ uiHint, onConfirm }) => {
  const data = uiHint?.data || {} as SurveySuccessCardProps['uiHint']['data'];
  const title = data.title || '信息已保存';
  const message = data.message || '您的信息已成功保存';
  const actionLabel = data.actionLabel || '继续';

  const handleClick = () => {
    console.log('[SurveySuccessCard] Button clicked, calling onConfirm');
    onConfirm?.('confirmed');
  };

  return (
    <ChatCardShell testId="survey-success">
      <ChatCardHeader title={title} />

      <div className="p-5">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-green-50 flex items-center justify-center">
            <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-[15px] text-gray-800 leading-relaxed" data-testid="survey-success-message">
              {message}
            </p>
          </div>
        </div>
      </div>

      <div className="p-5 pt-0">
        <ChatPrimaryButton className="w-full" onClick={handleClick}>
          {actionLabel}
        </ChatPrimaryButton>
      </div>
    </ChatCardShell>
  );
};
