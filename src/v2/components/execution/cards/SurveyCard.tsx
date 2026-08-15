import React, { useState, useRef } from 'react';

interface QuestionOption {
  label: string;
  value: string;
}

interface Question {
  id: string;
  question: string;
  required?: boolean;
  options?: QuestionOption[];  // 可选 - 如果没有 options 则显示文本输入
  placeholder?: string;         // 文本输入的占位符
  inputType?: 'text' | 'number' | 'select' | 'checkbox' | 'textarea'; // 输入类型
}

interface SurveyCardProps {
  uiHint: {
    type: 'survey_card';
    data: {
      title?: string;
      subtitle?: string;
      sessionId?: string;
      questions?: Question[];
      // Legacy single question support
      question?: string;
      options?: Array<{ label: string; value: string }>;
      multiSelect?: boolean;
    };
  };
  onConfirm?: (value: string | string[]) => void;
}

/**
 * SurveyCard (SURVEY_CARD) - Post-Workout / Biometric Collection
 *
 * Implements "Dynamic Intent Mapping". MAS provides the questions and options.
 * Supports both legacy single-question format and new multi-question format.
 */
export const SurveyCard: React.FC<SurveyCardProps> = ({ uiHint, onConfirm }) => {
  // selectedOptions 可以存储字符串（单选）或字符串数组（多选）
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string | string[]>>({});
  const [textInputs, setTextInputs] = useState<Record<string, string>>({});  // 新增：存储文本输入
  const [isUploading, setIsUploading] = useState(false);
  // [FIX] Use ref to prevent race conditions with state updates
  const isUploadingRef = useRef(false);

  // Support both new multi-question format and legacy single-question format
  const data = uiHint?.data || {};
  const questions = data.questions || [];

  // Legacy support: if no questions array but has question/options, convert to new format
  // Ensure displayQuestions is always an array to avoid "Cannot read properties of undefined"
  const displayQuestions: Question[] = (questions && questions.length > 0)
    ? questions
    : (data.question ? [{
        id: 'legacy_question',
        question: data.question,
        required: true,
        options: data.options || []
      }] : []);

  const title = data.title || '补充训练信息';
  const subtitle = data.subtitle;

  const handleOptionClick = (questionId: string, value: string, isMultiSelect: boolean = false) => {
    setSelectedOptions(prev => {
      if (isMultiSelect) {
        // 多选：切换选项的选中状态
        const currentValues = prev[questionId];
        if (Array.isArray(currentValues)) {
          // 已经是数组，切换该值
          if (currentValues.includes(value)) {
            // 已选中，移除
            return { ...prev, [questionId]: currentValues.filter(v => v !== value) };
          } else {
            // 未选中，添加
            return { ...prev, [questionId]: [...currentValues, value] };
          }
        } else if (currentValues) {
          // 当前有单个值，转换为数组
          return { ...prev, [questionId]: [currentValues, value] };
        } else {
          // 当前没有值，创建新数组
          return { ...prev, [questionId]: [value] };
        }
      } else {
        // 单选：直接覆盖
        return { ...prev, [questionId]: value };
      }
    });
  };

  // 新增：处理文本输入变化
  const handleTextInputChange = (questionId: string, value: string) => {
    setTextInputs(prev => ({ ...prev, [questionId]: value }));
    // 同时更新到 selectedOptions，便于统一处理
    setSelectedOptions((prev: Record<string, string | string[]>) => ({ ...prev, [questionId]: value }));
  };

  const handleUpload = () => {
    // [FIX] Check ref first to prevent race conditions
    if (isUploadingRef.current) {
      console.log('[SurveyCard] Upload already in progress, ignoring duplicate click');
      return;
    }

    isUploadingRef.current = true;
    setIsUploading(true);

    // 合并选项选择和文本输入
    const allResponses = { ...selectedOptions, ...textInputs };

    // Build upload data
    const uploadData = JSON.stringify({
      sessionId: data.sessionId,
      responses: allResponses,
      timestamp: Date.now()
    });

    // Use the special upload format that handleChatSubmit will recognize
    onConfirm?.(`[UPLOAD_SURVEY_DATA]:${uploadData}`);

    // [FIX] Reset flag after a reasonable delay (assuming API response within 10 seconds)
    setTimeout(() => {
      isUploadingRef.current = false;
      setIsUploading(false);
    }, 10000);
  };

  // Check if all required questions are answered
  const allRequiredAnswered = displayQuestions.every((q: Question) => {
    if (q.required !== true) return true;

    const value = selectedOptions[q.id];
    if (Array.isArray(value)) {
      // 多选：至少选中一个选项
      return value.length > 0;
    } else {
      // 单选或文本：有值即可
      return value !== undefined && value !== '';
    }
  });

  // Legacy mode: single question, direct confirm
  const isLegacyMode = questions.length === 0 && data.question;

  if (isLegacyMode) {
    // Legacy single-question mode
    const question = data.question || '加载中...';
    const options = data.options || [];

    return (
      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
        <div className="bg-gray-50/50 px-4 py-3 border-b border-gray-100 flex items-center gap-2">
          <svg className="w-4 h-4 text-star-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
          <span className="text-xs font-bold text-star-accent uppercase tracking-widest">练后调研</span>
        </div>

        <div className="p-5">
          <h4 className="text-sm font-bold text-gray-800 leading-relaxed mb-6">
            {question}
          </h4>

          <div className="space-y-2.5">
            {options.map((opt: QuestionOption, idx: number) => (
              <button
                key={opt?.value || idx}
                onClick={() => onConfirm?.(opt?.value)}
                className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl text-left text-sm font-bold text-gray-700 hover:border-star-accent hover:bg-star-accent/5 hover:text-star-accent transition-all active:scale-95 flex justify-between items-center group shadow-sm"
              >
                {opt?.label || '未知选项'}
                <svg className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // New multi-question mode with upload button
  return (
    <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-floating" data-testid="survey-card">
      <div className="bg-star-dark px-4 py-3 flex justify-between items-center" data-testid="survey-header">
        <div>
          <h3 className="text-white text-lg font-black italic uppercase tracking-widest" data-testid="survey-title">{title}</h3>
          {subtitle && (
            <p className="text-star-accent text-[10px] mt-1 uppercase tracking-widest" data-testid="survey-subtitle">{subtitle}</p>
          )}
        </div>
      </div>

      <div className="p-5 space-y-4" data-testid="survey-questions">
        {displayQuestions.map((q: Question, idx: number) => {
          // 判断是否有选项：有 options 显示按钮，没有显示输入框
          const hasOptions = Array.isArray(q?.options) && q.options.length > 0;
          const options = hasOptions ? q.options : [];

          return (
            <div key={q?.id || idx} className="space-y-3" data-testid={`survey-question-${q?.id}`}>
              <div className="flex items-start gap-2">
                <span className="text-star-accent font-bold">{idx + 1}.</span>
                <p className="font-bold text-gray-800 flex-1">{q?.question || '未知问题'}</p>
                {q?.required && <span className="text-red-500 text-xs">*</span>}
              </div>

              {/* 有选项：显示选项按钮 */}
              {hasOptions && (
                <div className="flex flex-wrap gap-2 pl-6">
                  {options.map((opt: QuestionOption, optIdx: number) => {
                    // 判断是否是多选类型
                    const isMultiSelect = q?.inputType === 'checkbox';
                    const value = selectedOptions[q.id];

                    // 判断当前选项是否被选中
                    const isSelected = Array.isArray(value)
                      ? value.includes(opt.value)
                      : value === opt.value;

                    return (
                      <button
                        key={opt.value || optIdx}
                        data-testid={`survey-option-${q?.id}-${opt.value}`}
                        onClick={() => handleOptionClick(q.id, opt.value, isMultiSelect)}
                        className={`
                          px-4 py-3 rounded-2xl text-sm font-bold transition-all active:scale-95 shadow-sm
                          ${isSelected
                            ? 'bg-star-accent text-white shadow-lg shadow-blue-500/20'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}
                        `}
                      >
                        <span className="flex items-center gap-2">
                          {isMultiSelect && (
                            <svg className={`w-4 h-4 ${isSelected ? 'text-white' : 'text-gray-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d={isSelected ? "M5 13l4 4L19 7" : "M9 5l7 7-7 7"} />
                            </svg>
                          )}
                          {opt.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* 没有选项：显示文本输入框 */}
              {!hasOptions && (
                <div className="pl-6">
                  <input
                    type={q?.inputType || 'text'}
                    data-testid={`survey-question-${q?.id}`}
                    value={textInputs[q.id] || selectedOptions[q.id] || ''}
                    onChange={(e) => handleTextInputChange(q.id, e.target.value)}
                    placeholder={q?.placeholder || '请输入...'}
                    className={`
                      w-full px-4 py-3 rounded-2xl border-2 text-sm font-medium
                      transition-all outline-none shadow-sm
                      ${textInputs[q.id] || selectedOptions[q.id]
                        ? 'border-star-accent bg-star-accent/5'
                        : 'border-gray-200 bg-gray-50 focus:border-star-accent focus:bg-white'}
                    `}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="p-5 pt-0">
        <button
          onClick={handleUpload}
          disabled={!allRequiredAnswered || isUploading}
          data-testid="survey-submit-button"
          className={`
            w-full py-4 rounded-2xl font-black italic uppercase tracking-widest
            transition-all active:scale-95
            ${!allRequiredAnswered || isUploading
              ? 'bg-gray-200 text-gray-400 cursor-not-allowed shadow-none'
              : 'bg-star-accent text-white hover:bg-blue-600 shadow-lg shadow-blue-500/20'}
          `}
        >
          {isUploading ? '上传中...' : '上传补充信息'}
        </button>
        {!allRequiredAnswered && (
          <p className="text-xs text-gray-400 text-center mt-2">请完成所有必填问题</p>
        )}
      </div>
    </div>
  );
};
