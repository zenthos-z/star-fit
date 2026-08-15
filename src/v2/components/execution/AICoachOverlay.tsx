import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { ExerciseRenderer } from './ExerciseRenderer';
import { ChatHistoryPanel } from './ChatHistoryPanel';
import { ChatMessage, ProgressItem } from '../../hooks/useAICoach';
import type { ChatThread } from '@/storage';
import { API_BASE, getHeaders } from '../../../services/geminiService';

interface MessageProgressIndicatorProps {
  items: ProgressItem[];
  isGenerating: boolean;
}

const MessageProgressIndicator: React.FC<MessageProgressIndicatorProps> = ({ items, isGenerating }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!items || items.length === 0) return null;

  const hasRunning = items.some(item => item.status === 'running');
  const runningItem = items.find(item => item.status === 'running');
  const displayItem = runningItem || items[items.length - 1];

  return (
    <div className="flex flex-col gap-1.5 mb-2">
      {/* 主指示器行 */}
      <div className="flex items-center gap-2 text-[10px] font-mono">
        {/* 圆点指示器 */}
        <div className="relative flex items-center justify-center">
          <div className={`absolute w-3 h-3 rounded-full bg-blue-500/20 ${hasRunning ? 'animate-[ping_1.5s_infinite]' : ''}`} />
          <div className={`relative w-2 h-2 rounded-full ${hasRunning ? 'bg-blue-600' : 'bg-gray-400'}`} />
        </div>

        {/* 默认显示：当前节点或最新节点 */}
        {!isExpanded && displayItem && (
          <span className={hasRunning && displayItem.status === 'running' ? 'text-gray-900 font-medium' : 'text-gray-600'}>
            [{displayItem.category}] {displayItem.name}
            {hasRunning && displayItem.status === 'running' && <span className="text-blue-600 ml-1">执行中...</span>}
          </span>
        )}

        {/* 展开/收起按钮 */}
        {items.length > 0 && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-gray-400 hover:text-gray-600 flex items-center gap-1 transition-colors"
          >
            [{isExpanded ? `▲ 收起` : `▼ 显示全部 (${items.length})`}]
          </button>
        )}
      </div>

      {/* 展开显示完整链条 - 时间轴样式 */}
      <div
        className={`overflow-hidden transition-all duration-300 ease-in-out ${
          isExpanded ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="flex flex-col gap-1.5 ml-4 pl-4 border-l-2 border-gray-200">
          {items.map((item, index) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-4 text-[10px] py-1"
            >
              {/* 左侧：类型标签 */}
              <span className="font-mono text-gray-400 uppercase text-[9px] min-w-[40px]">
                [{item.category}]
              </span>

              {/* 中间：节点名称 */}
              <span className={item.status === 'running' ? 'text-gray-900 font-medium' : 'text-gray-600'}>
                {item.name}
              </span>

              {/* 右侧：状态标记 */}
              <div className="flex items-center gap-2">
                {item.status === 'running' && (
                  <>
                    <span className="text-blue-600 text-[9px]">执行中...</span>
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse" />
                  </>
                )}
                {item.status === 'completed' && (
                  <>
                    <span className="text-green-600 text-[9px]">完成</span>
                    <svg className="w-3 h-3 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

interface AICoachOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  chatHistory: ChatMessage[];
  chatMessage: string;
  setChatMessage: (msg: string) => void;
  isLoading: boolean;
  isPlanMode: boolean;
  setIsPlanMode: (mode: boolean) => void;
  handleChatSubmit: (e?: React.FormEvent, directMessage?: string) => void;
  handleConfirmPlan: (plan: any[], mode: 'append' | 'replace') => void;
  chatEndRef: React.RefObject<HTMLDivElement>;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  attachedContext?: any;
  onRemoveAttachment?: () => void;
  onViewDetails?: () => void;
  sessionStatus: 'idle' | 'active' | 'paused' | 'finished';
  sessionSessionId?: string; // [NEW] Session ID for progress tracking
  isTransitioning?: boolean;
  // [NEW] Thread management props
  threads?: ChatThread[];
  currentThreadId?: string;
  showHistoryPanel?: boolean;
  setShowHistoryPanel?: (show: boolean) => void;
  onSwitchThread?: (threadId: string) => void;
  onCreateNewThread?: () => void;
  formatRelativeTime?: (timestamp: number) => string;
}

/**
 * AICoachOverlay (V2) - The Interaction Gateway
 *
 * Implements Phase 4: Non-blocking, context-aware dialogue.
 * Supports Polymorphic Cards, Reasoning Visibility, and Context Attachments.
 */
export const AICoachOverlay: React.FC<AICoachOverlayProps> = ({
  isOpen,
  onClose,
  chatHistory,
  chatMessage,
  setChatMessage,
  isLoading,
  isPlanMode,
  setIsPlanMode,
  handleChatSubmit,
  handleConfirmPlan,
  chatEndRef,
  textareaRef,
  attachedContext,
  onRemoveAttachment,
  onViewDetails,
  sessionStatus,
  sessionSessionId,
  isTransitioning = false,
  // [NEW] Thread management
  threads = [],
  currentThreadId = '',
  showHistoryPanel = false,
  setShowHistoryPanel = () => {},
  onSwitchThread = () => {},
  onCreateNewThread = () => {},
  formatRelativeTime = (t: number) => new Date(t).toLocaleDateString()
}) => {
  const [showContent, setShowContent] = useState(true);
  const [isStrategyActive, setIsStrategyActive] = useState(false);
  const [chatHistoryWithProgress, setChatHistoryWithProgress] = useState<ChatMessage[]>(chatHistory);

  // Reset strategy active state when message is sent (isLoading becomes true)
  useEffect(() => {
    if (isLoading && isStrategyActive) {
      setIsStrategyActive(false);
    }
  }, [isLoading, isStrategyActive]);

  // 同步 chatHistory 到 chatHistoryWithProgress，保留已有的 progressItems
  useEffect(() => {
    setChatHistoryWithProgress(prev => {
      // 如果长度不同，说明有新消息
      if (chatHistory.length !== prev.length) {
        return chatHistory.map((msg, i) => {
          // 保留对应位置消息的 progressItems
          const oldMsg = prev[i];
          if (oldMsg && oldMsg.progressItems) {
            return {
              ...msg,
              progressItems: oldMsg.progressItems
            };
          }
          return msg;
        });
      }
      // 长度相同时，也需要保留 progressItems（不要直接返回 chatHistory！）
      return chatHistory.map((msg, i) => {
        const oldMsg = prev[i];
        // 保留非空的 progressItems
        if (oldMsg && oldMsg.progressItems && oldMsg.progressItems.length > 0) {
          return {
            ...msg,
            progressItems: oldMsg.progressItems
          };
        }
        return msg;
      });
    });
  }, [chatHistory]);

  // 当开始生成新消息时，清空旧的展开状态
  const prevIsLoadingRef = useRef(isLoading);
  useEffect(() => {
    if (prevIsLoadingRef.current === false && isLoading === true) {
      // 开始生成新消息，收起所有展开的进度
      setChatHistoryWithProgress(prev => prev.map(msg => ({
        ...msg,
        _progressExpanded: false
      })));
    }
    prevIsLoadingRef.current = isLoading;
  }, [isLoading]);

  const isAnalyzing = chatHistory.some(msg => msg._isAnalyzing);
  const isBusy = isLoading || isAnalyzing;
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleChatSubmit();
    }
  };

  // Handle input change with strategy active state reset
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setChatMessage(newValue);
    // Reset strategy active state if user clears the input or types something else
    if (isStrategyActive && newValue !== '更新策略') {
      setIsStrategyActive(false);
    }
  };

  // Helper function to handle survey upload directly
  const handleSurveyUpload = (payload: string) => {
    // Pass the payload directly to handleChatSubmit to avoid state timing issues
    // This bypasses the need to wait for React state updates
    handleChatSubmit(undefined, payload);
  };

  // Handle strategy save API call
  const handleStrategySave = async (content: string) => {
    try {
      // Get user ID from localStorage (might be username or UUID)
      const userIdInput = localStorage.getItem('starfit_user_id') || 'global';

      // First, try to get the actual user UUID by username
      let actualUserId = userIdInput;

      // If the input looks like a username (not a UUID), fetch the actual UUID
      if (!userIdInput.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
        try {
          const userLookupResponse = await fetch(`${API_BASE}/admin/users/by-username/${encodeURIComponent(userIdInput)}`, {
            method: 'GET',
            headers: getHeaders()
          });

          if (userLookupResponse.ok) {
            const userData = await userLookupResponse.json();
            if (userData.success && userData.data?.id) {
              actualUserId = userData.data.id;
              console.log('[AICoachOverlay] Resolved userId:', userIdInput, '->', actualUserId);
            }
          }
        } catch (e) {
          console.warn('[AICoachOverlay] Failed to resolve userId, using input:', userIdInput);
        }
      }

      // training_strategy is stored in profile_static, use PUT /profile/static
      const response = await fetch(`${API_BASE}/admin/users/${actualUserId}/profile/static`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({ training_strategy: content })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[AICoachOverlay] API error:', errorText);
        throw new Error(`保存失败 (${response.status}): ${errorText}`);
      }

      const result = await response.json();
      console.log('[AICoachOverlay] Strategy saved successfully:', result);
      return result;
    } catch (error) {
      console.error('[AICoachOverlay] Failed to save strategy:', error);
      throw error; // Re-throw to let StrategyConfirmCard handle the error
    }
  };

  return (
    <div className={`
      fixed inset-0 z-50 flex flex-col h-full
      ${isOpen ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'}
      ${!isTransitioning ? 'backdrop-blur-2xl bg-white/90 transition-all duration-500' : 'bg-white'}
    `}>
      {/* Dynamic Background Gradients */}
      <div className={`absolute top-[-20%] left-[-20%] w-[80vw] h-[80vw] bg-blue-100/30 rounded-full blur-[120px] pointer-events-none ${showContent ? 'animate-pulse' : ''}`}></div>
      <div className="absolute bottom-[-20%] right-[-20%] w-[80vw] h-[80vw] bg-indigo-100/30 rounded-full blur-[120px] pointer-events-none"></div>

      {/* Header with MAS Status */}
      <div className={`flex-shrink-0 z-20 px-6 pt-12 pb-4 flex justify-between items-center relative border-b border-gray-100/30 transition-opacity duration-300 ${showContent ? 'opacity-100' : 'opacity-0'}`}>
        <div className={`flex items-center gap-3 transition-all duration-500 ${chatHistory.length === 0 ? 'opacity-0 -translate-x-4 pointer-events-none' : 'opacity-100 translate-x-0'}`}>
          <div className="relative flex items-center justify-center">
            <div className={`absolute w-3 h-3 rounded-full bg-blue-500/20 ${isBusy ? 'animate-[ping_1.5s_infinite] opacity-75 scale-150' : ''}`}></div>
            <div className={`relative w-2 h-2 rounded-full ${isBusy ? 'bg-blue-600 shadow-[0_0_8px_rgba(37,99,235,0.5)]' : 'bg-gray-400'}`}></div>
          </div>
          <div>
            <span className="font-black text-lg text-gray-900 tracking-tighter block leading-none">
              STARFIT <span className="text-blue-600">MAS</span>
            </span>
            <span className="text-[9px] text-gray-400 font-bold uppercase tracking-[0.15em] mt-1 block">
              {isBusy ? '正在同步云端智能...' : '多智能体协作系统已就绪'}
            </span>
          </div>
        </div>

        {/* Header Actions */}
        <div className="flex items-center gap-2">
          {/* [NEW] History Button */}
          <button
            onClick={() => setShowHistoryPanel(true)}
            className="h-10 px-3 rounded-2xl bg-gray-100/80 flex items-center gap-2 text-gray-500 hover:bg-gray-200 hover:text-black transition-all active:scale-95 backdrop-blur-md"
            title="历史对话"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-xs font-bold hidden sm:inline">历史</span>
          </button>

          <button
            onClick={onClose}
            className="w-10 h-10 rounded-2xl bg-gray-100/80 flex items-center justify-center text-gray-500 hover:bg-gray-200 hover:text-black transition-all active:scale-95 backdrop-blur-md shadow-sm"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Chat Body */}
      <div className={`flex-1 overflow-y-auto px-6 relative z-10 custom-scrollbar transition-opacity duration-300 ${showContent ? 'opacity-100' : 'opacity-0'}`}>
        {chatHistory.length === 0 ? (
          <WelcomeScreen />
        ) : (
          <div className="space-y-8 pt-6 pb-12">
            {chatHistoryWithProgress.map((msg, i) => (
              <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} ${showContent ? 'animate-in fade-in slide-in-from-bottom-4 duration-500' : 'opacity-0'}`}>

                {/* AI 消息：进度指示器显示在消息前面 */}
                {msg.role === 'ai' && msg.progressItems && msg.progressItems.length > 0 && (
                  <MessageProgressIndicator
                    items={msg.progressItems}
                    isGenerating={isLoading && i === chatHistoryWithProgress.length - 1 && msg.progressItems.some(item => item.status === 'running')}
                  />
                )}

                {/* Reasoning Chain Visibility */}
                {msg.role === 'ai' && msg.isThinking && (
                  <ReasoningTrace trace={msg.agentTrace} />
                )}

                {/* Message Bubble */}
                {(!msg.isThinking || msg.text) && (
                  <div className={`
                    px-5 py-4 rounded-2xl text-sm leading-relaxed max-w-[92%] shadow-sm overflow-hidden markdown-body
                    ${msg.role === 'user'
                      ? 'bg-gray-900 text-white rounded-tr-sm'
                      : 'bg-white border border-gray-100 text-gray-800 rounded-tl-sm'
                    }
                  `}>
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm, remarkMath]}
                      rehypePlugins={[rehypeKatex]}
                    >
                      {String(msg.text || (msg.uiHint ? "教练为您生成了以下交互卡片：" : "正在解析数据..."))}
                    </ReactMarkdown>
                    {/* 训练计划说明（explanation）- 由 Agent 生成 */}
                    {msg.explanation && (
                      <div className="mt-4 pt-4 border-t border-gray-100">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm, remarkMath]}
                          rehypePlugins={[rehypeKatex]}
                        >
                          {msg.explanation}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>
                )}

                {/* Polymorphic Card Injection */}
                {msg.uiHint && (
                  <div className={`w-full mt-3 ${showContent ? 'animate-in zoom-in-95 duration-300' : 'opacity-0'}`}>
                    <ExerciseRenderer
                      uiHint={
                        msg.uiHint.type === 'plan_card' && sessionStatus === 'finished'
                          ? { ...msg.uiHint, context: 'post_finish' }
                          : msg.uiHint
                      }
                      onConfirm={(payload) => {
                        console.log('[AICoachOverlay] onConfirm called:', { uiHintType: msg.uiHint.type, payload, isLoading });
                        const uiHintType = msg.uiHint?.type || '';

                        if (uiHintType === 'plan_card') {
                          // [DEBUG] Log the plan data to verify exercise_type field
                          console.log('[AICoachOverlay] plan_card onConfirm:', {
                            mode: payload.mode,
                            planData: msg.uiHint.data.map((ex: any) => ({
                              id: ex?.id,
                              name: ex?.name,
                              exercise_type: ex?.exercise_type,
                              exerciseType: ex?.exerciseType,
                              type: ex?.type,
                              sets: ex?.sets,
                              reps: ex?.reps
                            }))
                          });
                          handleConfirmPlan(msg.uiHint.data, payload.mode);
                        } else if (uiHintType === 'survey_card') {
                          // Survey card: use helper function to handle upload
                          handleSurveyUpload(String(payload));
                        } else if (uiHintType === 'survey_success') {
                          // [方案 B] Survey success: user confirmed, request plan generation
                          console.log('[AICoachOverlay] SURVEY_SUCCESS confirmed, sending plan request');
                          console.log('[AICoachOverlay] About to call handleChatSubmit');
                          handleChatSubmit(undefined, '请基于我的信息生成训练计划');
                          console.log('[AICoachOverlay] handleChatSubmit call completed');
                        } else if (uiHintType === 'summary_card') {
                          if (payload?.action === 'view_details') {
                            onViewDetails?.();
                          } else {
                            // Legacy save poster logic or other actions
                            console.log('[SavePoster] Workout summary save requested', msg.uiHint.data);
                          }
                        } else if (uiHintType === 'strategy_confirm') {
                          if (payload?.action === 'save') {
                            // Save strategy via API - returns Promise for async handling
                            return handleStrategySave(payload.content);
                          }
                        }
                      }}
                    />
                  </div>
                )}
              </div>
            ))}

            <div ref={chatEndRef} />
          </div>
        )}
      </div>

      <div className={`p-6 pb-10 flex-shrink-0 z-20 bg-white/50 backdrop-blur-lg border-t border-gray-100/50 transition-all duration-300 ${showContent ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}`}>

        <div className="flex items-center justify-between gap-4 mb-4">
          <div className="flex-1 flex items-center gap-3">
             {/* Mode Toggle as a sleek pill */}
             <button
              onClick={() => setIsPlanMode(!isPlanMode)}
              className={`
                h-8 px-4 rounded-full flex items-center gap-2 text-[9px] font-black uppercase tracking-widest transition-all active:scale-95
                ${isPlanMode
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
                  : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}
              `}
            >
              <div className={`w-1.5 h-1.5 rounded-full ${isPlanMode ? 'bg-white animate-pulse' : 'bg-gray-300'}`} />
              {isPlanMode ? '计划模式' : '标准模式'}
            </button>

            {/* Update Strategy Button - toggle style matching mode button */}
            <button
              onClick={() => {
                if (isStrategyActive) {
                  // Cancel: clear message and deactivate
                  setChatMessage('');
                  setIsStrategyActive(false);
                } else {
                  // Activate: fill message and focus
                  setChatMessage('更新策略');
                  setIsStrategyActive(true);
                  textareaRef.current?.focus();
                }
              }}
              className={`
                h-8 px-4 rounded-full flex items-center gap-2 text-[9px] font-black uppercase tracking-widest transition-all active:scale-95
                ${isStrategyActive
                  ? 'bg-purple-600 text-white shadow-lg shadow-purple-500/20'
                  : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}
              `}
            >
              <div className={`w-1.5 h-1.5 rounded-full ${isStrategyActive ? 'bg-white animate-pulse' : 'bg-gray-300'}`} />
              {isStrategyActive ? '更新策略' : '更新策略'}
            </button>
          </div>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); handleChatSubmit(); }} className="relative group">
          <div className="absolute inset-0 bg-blue-500/5 rounded-2xl blur-2xl opacity-0 group-focus-within:opacity-100 transition-opacity pointer-events-none"></div>
          <textarea
            ref={textareaRef}
            rows={1}
            value={chatMessage}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={
              isAnalyzing
                ? "MAS 正在根据本次训练生成问题，请稍候..."
                : isPlanMode
                  ? "Agent 正在等待您的调整指令..."
                  : "向您的 AI 教练提问..."
            }
            disabled={isBusy}
            className="relative w-full min-h-[64px] py-5 bg-gray-50/80 border border-gray-200/50 backdrop-blur-md rounded-2xl pl-8 pr-16 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all placeholder-gray-400 text-gray-800 shadow-inner resize-none custom-scrollbar"
          />
          <button
            type="submit"
            disabled={isBusy}
            className="absolute right-2.5 bottom-2.5 w-11 h-11 bg-gray-900 text-white rounded-2xl flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-xl shadow-gray-200 disabled:bg-gray-300 z-10"
          >
            {isBusy ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
            )}
          </button>
        </form>
      </div>

      {/* [NEW] Chat History Panel */}
      <ChatHistoryPanel
        isOpen={showHistoryPanel}
        onClose={() => setShowHistoryPanel(false)}
        threads={threads}
        currentThreadId={currentThreadId}
        onSelectThread={onSwitchThread}
        onCreateNewThread={onCreateNewThread}
        formatRelativeTime={formatRelativeTime}
      />
    </div>
  );
};

const ReasoningTrace: React.FC<{ trace?: string }> = ({ trace }) => {
  if (!trace) return null;

  return (
    <div className="mb-3 flex flex-col gap-1.5 animate-in fade-in slide-in-from-left-2 duration-500">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50/50 backdrop-blur-sm border border-gray-100/50 rounded-lg w-fit">
        <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.5)]"></div>
        <span className="font-mono text-[9px] font-bold text-gray-400 tracking-widest uppercase">
          MAS 核心: {trace.toUpperCase()}
        </span>
      </div>
    </div>
  );
};

const WelcomeScreen: React.FC = () => (
  <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="relative mb-8"
    >
      <div className="absolute inset-0 bg-blue-500/10 blur-3xl rounded-full animate-pulse"></div>
      <div className="relative w-20 h-20 bg-gray-900 rounded-[2rem] flex items-center justify-center shadow-2xl transform rotate-3">
        <svg className="w-10 h-10 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      </div>
    </motion.div>

    <div className="text-center space-y-3">
      <h3 className="text-4xl font-black text-gray-900 tracking-tighter">
        STARFIT <span className="text-blue-600">MAS</span>
      </h3>
      <p className="text-gray-400 text-sm font-medium leading-relaxed max-w-[260px] mx-auto">
        您的多智能体个人教练系统，为高性能训练而生。
      </p>
    </div>
  </div>
);

const WelcomeChip: React.FC<{ label: string; icon: string }> = ({ label, icon }) => (
  <div className="flex items-center gap-2 px-4 py-3 bg-white border border-gray-100 rounded-2xl shadow-sm hover:border-blue-100 transition-colors">
    <span className="text-sm">{icon}</span>
    <span className="text-[9px] font-black text-gray-500 uppercase tracking-widest">{label}</span>
  </div>
);
