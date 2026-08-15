import React from 'react';

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
    <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-floating" data-testid="survey-success">
      <div className="bg-green-500 px-4 py-3 flex items-center gap-2">
        <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
        <h3 className="text-white text-lg font-black uppercase tracking-widest">{title}</h3>
      </div>

      <div className="p-6">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
            <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-gray-700 leading-relaxed" data-testid="survey-success-message">
              {message}
            </p>
          </div>
        </div>
      </div>

      <div className="p-5 pt-0">
        <button
          onClick={handleClick}
          className="w-full py-4 rounded-2xl font-black italic uppercase tracking-widest bg-star-accent text-white hover:bg-blue-600 shadow-lg shadow-blue-500/20 transition-all active:scale-95"
        >
          {actionLabel}
        </button>
      </div>
    </div>
  );
};
