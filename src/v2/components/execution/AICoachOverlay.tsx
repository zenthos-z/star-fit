import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion'
import { haptic } from '../../../lib/nativeHaptics';;
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { ExerciseRenderer } from './ExerciseRenderer';
import { ChatHistoryPanel } from './ChatHistoryPanel';
import { ChatMessage, ProgressItem } from '../../hooks/useAICoach';
import type { ChatThread } from '@/storage';
import { API_BASE, getHeaders } from '../../../services/geminiService';
import { setTabBarHidden } from '../../../lib/nativeTabBar';

interface MessageProgressIndicatorProps {
  items: ProgressItem[];
  isGenerating: boolean;
}

/**
 * 拍照 / 相册取图 → 压缩 dataUrl 附件。
 * 原生：@capacitor/camera（source: Prompt 系统 action sheet：拍照 / 照片图库）。
 * Web：文件选择器降级（accept="image/*" 同样支持移动端拍照/相册）。
 * 用户取消 → 静默；其他错误 → alert 提示（不挂假附件）。
 */
async function pickPhoto(setCtx: (c: any) => void) {
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform()) {
      const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
      const photo = await Camera.getPhoto({
        source: CameraSource.Prompt,
        resultType: CameraResultType.DataUrl,
        quality: 80,
        width: 1600,
        correctOrientation: true,
      });
      if (photo?.dataUrl) {
        setCtx({ type: 'image', title: '照片', dataUrl: photo.dataUrl, mime: `image/${photo.format || 'jpeg'}` });
      }
    } else {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = () => {
        const f = input.files?.[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => {
          setCtx({ type: 'image', title: '照片', dataUrl: String(reader.result), mime: f.type || 'image/jpeg' });
        };
        reader.readAsDataURL(f);
      };
      input.click();
    }
  } catch (err: any) {
    // 用户取消（"User cancelled"）静默；真实错误才提示
    const msg = err?.message || '';
    if (/cancel/i.test(msg)) return;
    console.error('[AICoachOverlay] pickPhoto failed:', err);
    alert(`无法获取照片：${err?.message || err || '未知错误'}`);
  }
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
  handleChatSubmit: (
    e?: React.FormEvent,
    directMessage?: string,
    scenarioOverride?: string,
    opts?: { silent?: boolean }
  ) => void;
  handleConfirmPlan: (plan: any[], mode: 'append' | 'replace') => void;
  chatEndRef: React.RefObject<HTMLDivElement>;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  attachedContext?: any;
  setAttachedContext?: (ctx: any) => void;
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
  setAttachedContext,
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
  const [showAttachPanel, setShowAttachPanel] = useState(false);
  const [isFetchingStats, setIsFetchingStats] = useState(false);
  const [isStrategyActive, setIsStrategyActive] = useState(false);
  const [chatHistoryWithProgress, setChatHistoryWithProgress] = useState<ChatMessage[]>(chatHistory);

  // Reset strategy active state when message is sent (isLoading becomes true)
  // iOS sheet 规范：sheet 呈现时盖住原生 tab bar，关闭恢复
  useEffect(() => {
    setTabBarHidden(true);
    return () => setTabBarHidden(false);
  }, []);

  // ★键盘安全区冻结（修复导航栏顶进灵动岛）：iOS 26 WebKit 在输入框聚焦/键盘状态切换时
  // 会把 env(safe-area-inset-top) 坍缩为 0（Apple Forums FB20386257 同源问题），
  // 透明 Header 的 padding-top(calc(var(--safe-top)+8px)) 随之归零 → 标题/返回钮顶进灵动岛。
  // 本 sheet 挂载时把 --safe-top / --safe-bottom 钉死在进入时的基线值，卸载时还原。
  useEffect(() => {
    const root = document.documentElement;
    const inlineTop = root.style.getPropertyValue('--safe-top');
    const inlineBottom = root.style.getPropertyValue('--safe-bottom');
    const computedTop = parseFloat(getComputedStyle(root).getPropertyValue('--safe-top')) || 0;
    const computedBottom = parseFloat(getComputedStyle(root).getPropertyValue('--safe-bottom')) || 0;
    const freeze = (name: string, px: number) => {
      if (px > 0) root.style.setProperty(name, `${px}px`);
    };
    freeze('--safe-top', computedTop);
    freeze('--safe-bottom', computedBottom);
    return () => {
      if (inlineTop) root.style.setProperty('--safe-top', inlineTop);
      else root.style.removeProperty('--safe-top');
      if (inlineBottom) root.style.setProperty('--safe-bottom', inlineBottom);
      else root.style.removeProperty('--safe-bottom');
    };
  }, []);

  // ★键盘视口反顶（第二道防线）：即使 Keyboard 插件配了 resize:'none'，
  // WKWebView 聚焦输入框时内部 scrollView 仍会自动滚动以"露出"输入框，
  // 把 fixed inset-0 的整个 sheet（含导航栏）顶出安全区、推进灵动岛。
  // 监听原生键盘事件，在滚动发生前后把 window/document 的滚动位置强制归零。
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    if (!isOpen) return;
    const pin = () => {
      if (window.scrollY !== 0) window.scrollTo(0, 0);
      if (document.scrollingElement && document.scrollingElement.scrollTop !== 0) {
        document.scrollingElement.scrollTop = 0;
      }
    };
    let cancelled = false;
    const nativeHandles: import('@capacitor/core').PluginListenerHandle[] = [];
    (async () => {
      try {
        const { Keyboard } = await import('@capacitor/keyboard');
        if (cancelled) return;
        nativeHandles.push(
          await Keyboard.addListener('keyboardWillShow', (info) => {
            pin();
            setKbHeight(info?.keyboardHeight ?? 0);
          }),
          await Keyboard.addListener('keyboardWillHide', () => setKbHeight(0)),
          await Keyboard.addListener('keyboardDidShow', pin)
        );
      } catch {
        // 非 Capacitor 环境（纯浏览器调试）：静默降级，聚焦归零仍生效
      }
    })();
    window.addEventListener('focusin', pin, true);
    window.addEventListener('scroll', pin, true); // capture: 接住 webview 的自动滚动
    return () => {
      cancelled = true;
      window.removeEventListener('focusin', pin, true);
      window.removeEventListener('scroll', pin, true);
      nativeHandles.forEach(h => h.remove());
    };
  }, [isOpen]);

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

  // 教学页「咨询教练」等入口挂入附件后，聚焦输入框引导用户直接提问（iMessage 行为）
  useEffect(() => {
    if (isOpen && attachedContext && textareaRef.current) {
      // 等 sheet 滑入动画结束再聚焦，避免动画期间键盘弹起打断
      const t = setTimeout(() => textareaRef.current?.focus(), 450);
      return () => clearTimeout(t);
    }
  }, [isOpen, attachedContext, textareaRef]);

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
    <div
      style={{
        // iOS sheet 观感：从底部滑入/滑出（系统 search 呈现的近似）
        transition: 'transform 420ms cubic-bezier(0.32,0.72,0,1), opacity 300ms ease',
        transform: isOpen ? 'translateY(0)' : 'translateY(100%)',
        opacity: isOpen ? 1 : 0,
        pointerEvents: isOpen ? 'auto' : 'none',
      }}
      className={`fixed inset-0 z-[110] rounded-t-[40px] shadow-[0_-8px_40px_rgba(0,0,0,0.18)] overflow-hidden bg-[#FAFAFA]`}
    >
      {/* 顶部渐隐：对话内容上滑穿过导航栏，无硬切分割 */}
      <div className="absolute top-0 inset-x-0 h-28 z-[15] pointer-events-none bg-gradient-to-b from-[#FAFAFA] via-[#FAFAFA]/85 to-transparent" />

      {/* Header — iMessage 风格：左关闭 / 中标题 / 右历史（透明悬浮层） */}
      <div className="absolute top-0 inset-x-0 z-20 px-4 pt-2 pb-3 flex items-center justify-between" style={{ paddingTop: 'calc(var(--safe-top) + 8px)' }}>
        <button
          onClick={onClose}
          className="h-11 px-4 rounded-full bg-white shadow-sm flex items-center gap-1.5 text-gray-800 active:scale-95 transition-all"
          aria-label="关闭"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="text-center">
          <div className="text-[17px] font-semibold text-gray-900 leading-tight">AI 教练</div>
          <div className="text-[11px] text-gray-400">
            {isBusy ? '正在输入…' : 'Agent 系统已就绪'}
          </div>
        </div>
        <button
          onClick={() => setShowHistoryPanel(true)}
          className="w-11 h-11 rounded-full bg-white shadow-sm flex items-center justify-center text-gray-700 active:scale-95 transition-all"
          aria-label="历史对话"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
      </div>

      {/* Chat Body — 全高滚动，内容从导航栏/输入栏后面穿过（玻璃悬浮层可折射内容） */}
      <div className={`absolute inset-0 overflow-y-auto px-6 z-10 custom-scrollbar transition-opacity duration-300 ${showContent ? 'opacity-100' : 'opacity-0'}`}>
        {chatHistory.length === 0 ? (
          <WelcomeScreen />
        ) : (
          <div className="space-y-2.5 pt-[calc(var(--safe-top)+64px)] pb-[calc(var(--safe-bottom)+80px)] px-1">
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

                {/* 被质量门打回轮次的思考文本：折叠显示，不与正文争夺层级 */}
                {msg.role === 'ai' && msg.thinkingText && (
                  <ThinkingBlock text={msg.thinkingText} streaming={!!msg.isThinking} />
                )}

                {/* Message Bubble（内容层用实色卡片：HIG 禁止 content 层玻璃化/glass-on-glass） */}
                {(!msg.isThinking || msg.text) && (
                  <div className={`
                    px-4 py-2.5 text-[16px] leading-[1.35] markdown-body break-words [overflow-wrap:anywhere] min-w-0
                    ${msg.role === 'user'
                      ? 'max-w-[78%] bg-[#0A84FF] text-white rounded-[20px] rounded-br-[6px]'
                      : 'w-full bg-[#E9E9EB] text-gray-900 rounded-[20px] rounded-bl-[6px]'
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
                        } else if (uiHintType === 'profile_update_confirm') {
                          // [画像更新闭环] docs/profile-update-frontend-spec.md §3.3
                          // 确认/取消均为静默回传：指令不进聊天流，用户只看到 Agent 回复
                          // 确认 → scenario=update_profile 执行轮（携带 proposals 原文）→
                          //   Agent 写库后回 audit_complete 卡片（含「查看详情」）
                          // 取消 → scenario=chat 纯文本确认轮，不做任何写入
                          const proposals = Array.isArray(payload?.proposals) ? payload.proposals : [];
                          const silentOpts = { silent: true };
                          if (payload?.action === 'confirm_update') {
                            const proposalsText = proposals.map((p: any) =>
                              `${p.label}(${p.field}): ${p.change}` + (p.value !== undefined ? ` 新值: ${JSON.stringify(p.value)}` : '')
                            ).join('；');
                            handleChatSubmit(
                              undefined,
                              `已确认画像更新，请按以下提案执行：${proposalsText}`,
                              'update_profile',
                              silentOpts
                            );
                          } else if (payload?.action === 'cancel_update') {
                            const fields = proposals.map((p: any) => p.field).join('、');
                            handleChatSubmit(
                              undefined,
                              `用户选择暂不更新画像（放弃提案：${fields || '无'}）。请简短确认，不做任何修改。`,
                              'chat',
                              silentOpts
                            );
                          }
                        } else if (uiHintType === 'audit_complete') {
                          // [画像更新闭环] 「查看详情」无 auditContent 时的兜底已移入卡片内：
                          // 有 updates 就地展开明细；仅当真正无内容可看时才通知父级
                          if (payload?.action === 'view_audit_details') {
                            console.log('[AICoachOverlay] audit details requested', payload);
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

      {/* Input Bar — iMessage 风格：[+] [胶囊输入框] [🎤/↑]，玻璃悬浮层（透明底，内容从后穿过） */}
      <div
        className="absolute bottom-0 inset-x-0 z-20 px-4 pt-2 pb-3 transition-transform duration-250 ease-out"
        style={{
          paddingTop: 8,
          paddingBottom: 'calc(var(--safe-bottom) + 8px)',
          // 键盘弹出时把输入栏抬到键盘上沿（resize:none 下 webview 不缩放，需自管）
          transform: kbHeight > 0 ? `translateY(-${kbHeight}px)` : 'translateY(0)'
        }}
      >
        {/* iOS 26 Menu：参考信息 App——大型白色圆角浮层，大图标+大字，无分隔线 */}
        {showAttachPanel && (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
            className="fixed inset-x-4 bottom-[120px] top-auto z-40 rounded-[40px] bg-white/80 backdrop-blur-2xl shadow-[0_12px_48px_rgba(0,0,0,0.16)] overflow-hidden px-4 py-3"
          >
            {[
              { key: 'plan', label: '生成训练计划', bg: 'linear-gradient(135deg,#34C759,#30B350)', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4' },
              { key: 'stats', label: '附上训练数据', bg: 'linear-gradient(135deg,#FF9F0A,#FF7A00)', icon: 'M13 7h3l2 4m0 0l-2-4-2 4m2 0v9m-9-9h3l2 4m0 0l-2-4-2 4m2 0V4m-6 5h18' },
              { key: 'photo', label: '照片', bg: 'linear-gradient(135deg,#0A84FF,#0066CC)', icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z' },
            ].map((a) => (
              <button
                key={a.key}
                type="button"
                disabled={a.key === 'stats' && isFetchingStats}
                onClick={async () => {
                  setShowAttachPanel(false);
                  if (a.key === 'plan') {
                    setIsPlanMode(true);
                  } else if (a.key === 'stats') {
                    // 拉最近一次训练 session 挂为附件，Agent 经 intent_context 读取
                    try {
                      setIsFetchingStats(true);
                      // API_BASE 本身以 /api 结尾（geminiService），故只需拼 /sessions/recent
                      const res = await fetch(`${API_BASE}/sessions/recent?limit=1`, { headers: getHeaders() });
                      if (!res.ok) throw new Error(`HTTP ${res.status}`);
                      const data = await res.json();
                      const s = data?.sessions?.[0];
                      if (s) {
                        setAttachedContext({
                          type: 'workout_data',
                          title: '最近训练数据',
                          data: s,
                        });
                      } else {
                        // 无已持久化 session：仍挂附件，指示 Agent 用 load_history 自查 DB
                        setAttachedContext({
                          type: 'workout_data',
                          title: '最近训练数据',
                          data: null,
                          hint: '前端无已持久化的 session，请调用 load_history 读取我最近的训练记录后再回答',
                        });
                      }
                    } catch (err) {
                      console.error('[AICoachOverlay] Fetch recent session failed:', err);
                    } finally {
                      setIsFetchingStats(false);
                    }
                  } else if (a.key === 'photo') {
                    // 拍照/相册：原生走 @capacitor/camera（iOS 弹系统 action sheet：
                    // 拍照 / 照片图库）；Web 降级为系统文件选择（同样支持拍照/相册）。
                    await pickPhoto(setAttachedContext);
                  }
                }}
                className="w-full flex items-center gap-5 px-2 py-3.5 text-left active:bg-black/5 rounded-2xl transition-colors"
              >
                <div className="w-12 h-12 rounded-full flex items-center justify-center shrink-0 text-white shadow-sm" style={{ background: a.bg }}>
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={a.icon} />
                  </svg>
                </div>
                <span className="text-[19px] text-gray-900">{a.label}</span>
              </button>
            ))}
          </motion.div>
        )}

        <div className="flex items-end gap-2">
          {/* + 附件按钮：Liquid Glass（Apple glassEffect(.regular) 配方材质） */}
          <button
            type="button"
            onClick={() => setShowAttachPanel(!showAttachPanel)}
            className={`glass-ring w-11 h-11 rounded-full flex items-center justify-center shrink-0 transition-all active:scale-90 text-gray-800 ${showAttachPanel ? 'rotate-45' : ''}`}
            aria-label="附件"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </button>

          {/* 胶囊输入框：iMessage 官方「胶囊内增高」布局——附件悬浮在胶囊内部上层，
              一条发丝分割线隔开下方文字区（Apple Messages 原版行为，非外部浮层） */}
          <div className="relative flex-1">
            <form onSubmit={(e) => { e.preventDefault(); handleChatSubmit(); }} className="glass-ring flex flex-col rounded-[22px] overflow-hidden">
            {/* 附件区（胶囊内部上层）：可点 × 移除；出现/消失时胶囊平滑增高/回落 */}
            <AnimatePresence initial={false}>
              {attachedContext && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
                  className="overflow-hidden"
                >
                  <div className="flex items-center gap-2.5 pl-4 pr-3 pt-2.5 pb-2.5">
                    {attachedContext?.type === 'image' && attachedContext.dataUrl ? (
                      <img
                        src={attachedContext.dataUrl}
                        alt="附件照片"
                        className="w-8 h-8 rounded-md object-cover shrink-0 border border-black/5"
                      />
                    ) : (
                    <div className="w-7 h-7 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
                      <svg className="w-3.5 h-3.5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.182 15.182a4.5 4.5 0 01-6.364 0M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75zm-.375 0h.375m4.875 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75zm0 0h-.375" />
                      </svg>
                    </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-medium text-gray-800 truncate leading-tight">
                        {attachedContext.title || attachedContext.exerciseName || '上下文附件'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={onRemoveAttachment}
                      className="w-5 h-5 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 active:bg-gray-300 active:scale-90 transition-all shrink-0"
                      aria-label="移除附件"
                    >
                      <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  {/* 发丝分割线：附件区与文字区之间（Messages 原版样式，两侧留边） */}
                  <div className="h-px bg-black/10 mx-4" />
                </motion.div>
              )}
            </AnimatePresence>

            {/* 文字输入行 */}
            <div className="flex items-end gap-1 pl-4 pr-1.5 py-1.5">
            <textarea
              ref={textareaRef}
              rows={1}
              value={chatMessage}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={
                isAnalyzing
                  ? "正在分析本次训练…"
                  : isPlanMode
                    ? "描述你想调整的内容…"
                    : "给教练发消息"
              }
              disabled={isBusy}
              className="flex-1 resize-none bg-transparent outline-none text-[16px] leading-[1.4] py-1.5 max-h-24 text-gray-900 placeholder-gray-400 custom-scrollbar"
            />
            {/* 发送 / 麦克风：空文本=麦克风，有文本=蓝色发送箭头 */}
            <button
              type="submit"
              disabled={isBusy || !chatMessage.trim()}
              className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mb-0.5 transition-all active:scale-90 ${
                chatMessage.trim() && !isBusy
                  ? 'bg-[#0A84FF] text-white shadow-sm'
                  : 'bg-gray-200 text-gray-400'
              }`}
              aria-label={chatMessage.trim() ? '发送' : '语音输入'}
            >
              {chatMessage.trim() && !isBusy ? (
                <svg className="w-4.5 h-4.5 w-[18px] h-[18px]" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
                </svg>
              ) : (
                <svg className="w-[18px] h-[18px]" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8.25 4.5a3.75 3.75 0 117.5 0v8.25a3.75 3.75 0 11-7.5 0V4.5z" />
                  <path d="M6 12v.75a6 6 0 0012 0V12m-6 9v-3.75" stroke="currentColor" strokeWidth={1.8} fill="none" strokeLinecap="round" />
                </svg>
              )}
            </button>
            </div>
            </form>
          </div>
        </div>
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
          {trace.toUpperCase()}
        </span>
      </div>
    </div>
  );
};

/**
 * ThinkingBlock — 折叠的 Agent 思考区（主流 Agent UX 模式）：
 * - 默认收起，只显示一行状态标签（不与答案争夺视觉层级）；
 * - 流式生成中自动展开实时预览，结束后自动收起；
 * - 用户手动展开/收起后尊重用户选择。
 */
const ThinkingBlock: React.FC<{ text?: string; streaming?: boolean }> = ({ text, streaming }) => {
  const [manuallyToggled, setManuallyToggled] = useState(false);
  const [expanded, setExpanded] = useState(false);

  if (!text) return null;

  // 流式中默认展开；结束后默认收起；用户手动操作后以用户为准
  const isOpen = manuallyToggled ? expanded : streaming;

  return (
    <div className="mb-3 w-full max-w-[92%]">
      <button
        onClick={() => { setManuallyToggled(true); setExpanded(!isOpen); }}
        className="flex items-center gap-2 px-3 py-1.5 bg-gray-50/80 backdrop-blur-sm border border-gray-100 rounded-lg hover:bg-gray-100/80 transition-colors active:scale-[0.98]"
      >
        {streaming ? (
          <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
        ) : (
          <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
          </svg>
        )}
        <span className="text-[10px] font-bold text-gray-400 tracking-wide">
          {streaming ? '思考中…' : '已深度思考（点击展开）'}
        </span>
        <svg
          className={`w-3 h-3 text-gray-300 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      <motion.div
        initial={false}
        animate={{ height: isOpen ? 'auto' : 0, opacity: isOpen ? 1 : 0 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="overflow-hidden"
      >
        <div className="mt-2 px-4 py-3 bg-gray-50/50 border-l-2 border-gray-200 rounded-r-lg text-xs leading-relaxed text-gray-500 whitespace-pre-wrap">
          {text}
        </div>
      </motion.div>
    </div>
  );
};

const WelcomeScreen: React.FC = () => (
  // min-h-full 而非 flex-1：父容器是 absolute inset-0 的滚动容器，
  // flex-1 会被内容高度塌缩（欢迎语贴在导航栏下），min-h-full 才能真正垂直居中
  <div className="min-h-full flex flex-col items-center justify-center p-8 pt-[calc(var(--safe-top)+64px)] pb-[calc(var(--safe-bottom)+120px)] text-center">
    <div className="text-center space-y-3">
      <h3 className="text-4xl font-black text-gray-900 tracking-tighter">
        STAR<span className="text-blue-600">FIT</span>
      </h3>
      <p className="text-gray-400 text-sm font-medium leading-relaxed max-w-[260px] mx-auto">
        您的个人 AI 训练教练，基于您的训练记录与目标，为每一次训练保驾护航。
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
