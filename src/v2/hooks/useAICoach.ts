import { useState, useRef, useEffect, useCallback } from 'react';
import { getUserId } from '@/services';
// P010 signature-frozen seam: hooks program only against chat(req): AsyncIterable<AgentEvent>.
// The kernel swap (legacy multi-agent one-shot POST) is absorbed inside the
// seam; this hook consumes the SSE stream and synthesizes renderable uiHint
// cards, with no awareness of the backend agent implementation.
import { agentClient, consumeAgentStream, synthesizeUiHint } from '../services/agent/sseAgentClient';
import type { AgentScenario, UiHintCard } from 'shared/contracts';
import {
  saveChatThreadList,
  loadChatThreadList,
  saveChatMessages,
  loadChatMessages,
  deleteChatThread,
  migrateLegacyChatData,
  ChatThread
} from '@/storage';

export interface ChatMessage {
  role: 'user' | 'ai';
  text: string;
  isThinking?: boolean;
  uiHint?: any;
  agentTrace?: string;
  explanation?: string;  // 训练计划说明（由 Agent 生成）
  _isAnalyzing?: boolean;
  _analysisComplete?: boolean;
  _sessionId?: string;
  // 进度追踪
  progressItems?: ProgressItem[];
}

export interface ProgressItem {
  id: string;
  category: 'Node' | 'Tool';
  name: string;
  status: 'running' | 'completed';
  timestamp: number;
}

const MAX_THREADS = 10;

/**
 * Format relative time for thread display
 */
const formatRelativeTime = (timestamp: number): string => {
  const now = Date.now();
  const diff = now - timestamp;
  const oneDay = 24 * 60 * 60 * 1000;

  if (diff < oneDay) {
    const hours = Math.floor(diff / (60 * 60 * 1000));
    if (hours < 1) return '刚刚';
    return `${hours}小时前`;
  }
  if (diff < 2 * oneDay) return '昨天';

  const date = new Date(timestamp);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
};

/**
 * Generate thread title from first message
 */
const formatThreadTitle = (firstMessage: string): string => {
  const trimmed = firstMessage.trim();
  if (trimmed.length <= 10) return trimmed;
  return `${trimmed.slice(0, 10)}...`;
};

/**
 * useAICoach (V3)
 *
 * Upgraded hook to support:
 * 1. Thread-based conversation management
 * 2. Context Attachment injection (Phase 4.1)
 * 3. Non-blocking state management
 * 4. Atomic Batch Ops integration
 */
export const useAICoach = (
  session: any,
  onPlanConfirm: (plan: any[], mode: 'append' | 'replace') => void
) => {
  const [isAiOverlayOpen, setIsAiOverlayOpen] = useState(false);
  const [isPlanMode, setIsPlanMode] = useState(false);
  const [chatMessage, setChatMessage] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // [NEW] Thread Management State
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [currentThreadId, setCurrentThreadId] = useState<string>('');
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);

  // [NEW] Context Attachment State
  const [attachedContext, setAttachedContext] = useState<any>(null);

  // [NEW] Store workout data for questionnaire upload
  const workoutDataRef = useRef<any>(null);

  // [NEW] Flag to prevent triggerMASAnalysis from being called multiple times
  const analysisTriggeredRef = useRef<boolean>(false);
  // [NEW] Ref to track if analysis is currently in progress (stronger protection)
  const analysisInProgressRef = useRef<boolean>(false);
  // [NEW] Ref to prevent race condition when openAiCoach is called multiple times quickly
  const isOpeningOverlayRef = useRef<boolean>(false);

  // [SCROLL_FIX] Scroll state tracking refs
  const isUserScrollingRef = useRef<boolean>(false);
  const scrollAttemptRef = useRef<number>(0);
  const isScrollReadyRef = useRef<boolean>(false);

  // [FIX] Refs to store stable function references and prevent infinite loops
  const updateThreadMetaRef = useRef<typeof updateThreadMeta | null>(null);
  const scrollToBottomRef = useRef<typeof scrollToBottom | null>(null);

  // Enforce thread limit (max 10 threads)
  const enforceThreadLimit = useCallback((currentThreads: ChatThread[]): ChatThread[] => {
    if (currentThreads.length <= MAX_THREADS) return currentThreads;

    // Sort by updatedAt (oldest first)
    const sorted = [...currentThreads].sort((a, b) => a.updatedAt - b.updatedAt);
    const toDelete = sorted.slice(0, currentThreads.length - MAX_THREADS);

    // Delete oldest threads
    toDelete.forEach(thread => {
      deleteChatThread(thread.id);
    });

    // Return remaining threads sorted by updatedAt (newest first)
    return sorted.slice(currentThreads.length - MAX_THREADS).sort((a, b) => b.updatedAt - a.updatedAt);
  }, [session?.id]);

  // Create a new thread
  const createNewThread = useCallback(async (existingThreads?: ChatThread[]) => {
    const threadsList = existingThreads || threads;
    const newThreadId = `thread_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = Date.now();

    const newThread: ChatThread = {
      id: newThreadId,
      sessionId: session?.id || '',
      title: '新对话',
      createdAt: now,
      updatedAt: now,
      messageCount: 0
    };

    const updatedThreads = [newThread, ...threadsList];
    const limitedThreads = enforceThreadLimit(updatedThreads);

    setThreads(limitedThreads);
    setCurrentThreadId(newThreadId);
    setChatHistory([]);

    // Save to storage
    await saveChatThreadList(limitedThreads);
    await saveChatMessages(newThreadId, []);

    return newThreadId;
  }, [session?.id, threads, enforceThreadLimit]);

  // Switch to an existing thread
  const switchToThread = useCallback(async (threadId: string) => {
    if (threadId === currentThreadId) return;

    // Save current thread messages before switching
    if (currentThreadId && chatHistory.length > 0) {
      await saveChatMessages(currentThreadId, chatHistory);
    }

    // Load new thread messages
    const messages = await loadChatMessages(threadId);
    setChatHistory(messages || []);
    setCurrentThreadId(threadId);
  }, [currentThreadId, chatHistory]);

  // Update thread metadata from messages
  const updateThreadMeta = useCallback(async (threadId: string, messages: ChatMessage[]) => {
    const thread = threads.find(t => t.id === threadId);
    if (!thread) return;

    // Generate title from first user message if not set or is default
    let title = thread.title;
    if (title === '新对话' || !title) {
      const firstUserMsg = messages.find(m => m.role === 'user');
      if (firstUserMsg) {
        title = formatThreadTitle(firstUserMsg.text);
      }
    }

    // Get preview from last message
    const lastMsg = messages[messages.length - 1];
    const preview = lastMsg?.text?.slice(0, 30) || '';

    const updatedThread: ChatThread = {
      ...thread,
      title,
      updatedAt: Date.now(),
      messageCount: messages.length,
      preview
    };

    const updatedThreads = threads.map(t => t.id === threadId ? updatedThread : t);
    setThreads(updatedThreads);
    await saveChatThreadList(updatedThreads);
  }, [threads]);

  // Load threads on app mount (using deviceId for persistence)
  useEffect(() => {
    // 1. Migrate old data first
    migrateLegacyChatData().then(migrated => {
      if (migrated) {
        console.log('[useAICoach] Legacy chat data migrated');
      }
    });

    // 2. Load thread list
    loadChatThreadList().then(async list => {
      const existingThreads = list || [];
      const limitedThreads = enforceThreadLimit(existingThreads);
      setThreads(limitedThreads);

      // 3. Always create new thread on app start, but keep history
      // Previous conversations are saved in thread list, user can access via history panel
      await createNewThread(limitedThreads);
    });

    // Reset analysis flags
    analysisTriggeredRef.current = false;
    analysisInProgressRef.current = false;
  }, []);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // [SCROLL_FIX] Smart scroll function with animation synchronization
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth', force = false) => {
    if (!force && isUserScrollingRef.current) return;

    const attemptId = ++scrollAttemptRef.current;

    requestAnimationFrame(() => {
      if (attemptId !== scrollAttemptRef.current) return;

      const container = chatEndRef.current?.parentElement;
      if (!container) return;

      // Wait for content to render
      if (container.scrollHeight <= container.clientHeight) {
        setTimeout(() => scrollToBottom(behavior, force), 50);
        return;
      }

      chatEndRef.current?.scrollIntoView({ behavior, block: 'end' });
    });
  }, []);

  // [FIX] Sync function refs to prevent infinite loops
  useEffect(() => {
    updateThreadMetaRef.current = updateThreadMeta;
  }, [updateThreadMeta]);

  useEffect(() => {
    scrollToBottomRef.current = scrollToBottom;
  }, [scrollToBottom]);

  // [FIX] Save messages when chat history changes (fixed dependency)
  useEffect(() => {
    if (currentThreadId && chatHistory.length > 0) {
      saveChatMessages(currentThreadId, chatHistory);
      updateThreadMetaRef.current(currentThreadId, chatHistory);
    }
  }, [chatHistory, currentThreadId]);

  // [SCROLL_FIX] Scroll when overlay opens (wait for animation to complete)
  useEffect(() => {
    if (isAiOverlayOpen && chatHistory.length > 0) {
      const timer = setTimeout(() => {
        isScrollReadyRef.current = true;
        scrollToBottomRef.current('smooth', true);
      }, 350); // 300ms transition + 50ms buffer

      return () => clearTimeout(timer);
    } else if (!isAiOverlayOpen) {
      isScrollReadyRef.current = false;
    }
  }, [isAiOverlayOpen, chatHistory.length]);

  // [SCROLL_FIX] Scroll on new message (only if already at bottom)
  useEffect(() => {
    if (isAiOverlayOpen && isScrollReadyRef.current && chatHistory.length > 0) {
      const container = chatEndRef.current?.parentElement;
      if (container) {
        const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
        if (isNearBottom) {
          scrollToBottomRef.current('smooth');
        }
      }
    }
  }, [chatHistory, isAiOverlayOpen]);

  // Auto-resize
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [chatMessage]);

  const handleChatSubmit = async (e?: React.FormEvent, directMessage?: string) => {
    console.log('[handleChatSubmit] Called with:', { hasEvent: !!e, directMessage, isLoading });

    if (e) e.preventDefault();

    if (isLoading) {
      console.log('[handleChatSubmit] Already loading, ignoring duplicate submit');
      return;
    }

    if (analysisInProgressRef.current) {
      console.log('[handleChatSubmit] Analysis in progress, ignoring submit');
      return;
    }

    // Use directMessage if provided, otherwise use chatMessage state
    const messageToUse = directMessage || chatMessage;
    console.log('[handleChatSubmit] Message to use:', messageToUse);

    if (!messageToUse.trim()) {
      console.log('[handleChatSubmit] Empty message, returning');
      return;
    }

    const userMsg = messageToUse.trim();
    console.log('[handleChatSubmit] Sending message:', userMsg);

    // Handle survey data upload from SurveyCard
    if (userMsg.startsWith('[UPLOAD_SURVEY_DATA]:')) {
      try {
        const uploadData = JSON.parse(userMsg.replace('[UPLOAD_SURVEY_DATA]:', ''));

        setChatMessage("");
        setChatHistory(prev => [...prev, { role: 'user', text: '上传补充信息...' }]);
        setIsLoading(true);
        setChatHistory(prev => [...prev, { role: 'ai', text: '', isThinking: true, progressItems: [] }]);

        // [FIX] 根据是否有训练数据判断场景
        // - 有训练数据：workout_complete（训练后问卷）→ Agent 调用 load_history + update_profile
        // - 无训练数据：plan（初始问卷）→ Agent 调用 update_profile + 生成计划
        const hasWorkoutData = workoutDataRef.current?.exercises?.length > 0;
        const scenario = hasWorkoutData ? "workout_complete" : "plan";

        // 关键：message 必须明确要求 Agent 调用 MCP 工具，否则 Agent 只生成文字回复
        const message = hasWorkoutData
          ? `用户已完成训练后补充信息调查，请按照以下步骤处理：

1. 调用 load_history 获取最新用户画像和训练数据
2. 根据调查答案更新用户画像：
   - 如果用户报告疲劳（fatigue_level >= 7），更新 recovery_state
   - 如果用户报告疼痛或不适，添加到 active_limitations
   - 如果用户报告睡眠质量差，用 write_memory 记录
3. 调用 update_profile 将所有更新写入数据库
4. 返回 audit_complete 卡片，列出更新的字段

调查答案：
${JSON.stringify(uploadData, null, 2)}`
          : "用户已完成初始问卷，请保存画像并生成训练计划。";

        console.log('[useAICoach] Survey upload scenario:', scenario, '(hasWorkoutData:', hasWorkoutData, ')');

        const result = await consumeAgentStream(agentClient.chat({
          userId: getUserId(),
          message,
          scenario,
          metadata: {
            intent_context: {
              type: 'survey_upload',
              data: uploadData,
              workoutData: workoutDataRef.current
            }
          }
        }));

        console.log('[useAICoach] Survey upload response card:', result.card);

        // uiHint 合成：从 SSE card 产出可渲染卡片对象
        let uiHint = synthesizeUiHint(result.card);

        // [FIX] Defensive check: ensure backend didn't erroneously return plan_card
        if (uiHint?.type === 'plan_card') {
          console.error('[useAICoach] BUG: Backend returned plan_card after survey upload!');
          uiHint = undefined;  // Clear erroneous uiHint
        }

        setChatHistory(prev => {
          const filtered = prev.filter(m => !m.isThinking);
          return [...filtered, {
            role: 'ai',
            text: result.error ? "上传失败，请重试。" : (result.text || "感谢您的反馈。"),
            uiHint,
            explanation: undefined
          }];
        });

        // [FIX] Reset loading state immediately after successful response
        setIsLoading(false);
      } catch (err) {
        console.error("Survey upload error:", err);
        setChatHistory(prev => [...prev.filter(m => !m.isThinking), { role: 'ai', text: "上传失败，请重试。" }]);
        setIsLoading(false);
      }
      return;
    }

    // [DEBUG] Secret Character Trigger for UI Preview
    if (userMsg === '/preview-all-bubbles') {
      setChatMessage("");
      setChatHistory(prev => [
        ...prev,
        { role: 'user', text: userMsg },
        {
          role: 'ai',
          text: "正在为您展示所有特殊对话气泡预览...",
          uiHint: {
            type: 'instruction_card',
            data: {
              title: '气泡预览指南',
              steps: ['以下内容仅供 UI 测试', '不会记录在对话历史中', '仅在本地生效']
            }
          }
        },
        {
          role: 'ai',
          text: "1. 训练计划建议 (PlanCard)",
          uiHint: {
            type: 'plan_card',
            data: [
              { exerciseId: 'bench_press', name: '杠铃卧推', sets: 4, reps: 8, weight: 60 },
              { exerciseId: 'inclined_dumbell_press', name: '哑铃上斜卧推', sets: 3, reps: 12, weight: 20 },
              { exerciseId: 'cable_fly', name: '绳索夹胸', sets: 3, reps: 15, weight: 15 },
              { exerciseId: 'push_ups', name: '俯卧撑', sets: 3, reps: 20 },
              { exerciseId: 'tricep_pushdown', name: '绳索下压', sets: 4, reps: 12, weight: 25 }
            ],
            diff: { added: ['bench_press', 'inclined_dumbell_press', 'cable_fly', 'tricep_pushdown'], modified: ['push_ups'] }
          }
        },
        {
          role: 'ai',
          text: "2. 训练结算概览 (SummaryCard)",
          uiHint: {
            type: 'summary_card',
            data: {
              stats: {
                totalVolume: 5420,
                setsCount: 18,
                durationMinutes: 65,
                avgHr: 138
              },
              exercises: [
                { name: '杠铃卧推', type: 'Strength', result: '60kg x 4 sets' },
                { name: '哑铃上斜卧推', type: 'Strength', result: '20kg x 3 sets' },
                { name: '绳索夹胸', type: 'Hypertrophy', result: '15kg x 3 sets' },
                { name: '俯卧撑', type: 'Bodyweight', result: 'BW x 3 sets' },
                { name: '绳索下压', type: 'Isolation', result: '25kg x 4 sets' },
                { name: '跑步机热身', type: 'Cardio', result: '10 min' }
              ]
            }
          }
        },
        {
          role: 'ai',
          text: "3. 偏差调整确认 (DeviationCard)",
          uiHint: {
            type: 'deviation_confirmation',
            data: {
              exerciseId: 'bench_press',
              original: { weight: 60, reps: 8 },
              modified: { weight: 55, reps: 10 }
            }
          }
        },
        {
          role: 'ai',
          text: "4. 问卷调查 (SurveyCard)",
          uiHint: {
            type: 'survey_card',
            data: {
              question: '您对本次训练的强度感觉如何？',
              options: [
                { label: '太轻松 (RPE < 6)', value: 'easy' },
                { label: '适中 (RPE 7-8)', value: 'moderate' },
                { label: '非常有挑战 (RPE 9)', value: 'hard' },
                { label: '力竭 (RPE 10)', value: 'failure' }
              ]
            }
          }
        }
      ]);
      return;
    }

    const currentAttachment = attachedContext;

    setChatMessage("");
    setAttachedContext(null); // Clear attachment after send
    setChatHistory(prev => [...prev, { role: 'user', text: userMsg }]);

    if (textareaRef.current) textareaRef.current.style.height = '64px';

    setIsLoading(true);
    setChatHistory(prev => [...prev, { role: 'ai', text: '', isThinking: true, progressItems: [] }]);

    try {
      const scenario: AgentScenario = isPlanMode ? "plan" : "chat";

      // [PHASE 4.1] 流式增量渲染（打字机）：token 是纯散文（卡片 JSON 已被后端
      //  extractUiHintEvents 剥成单独的 uiHint 事件），逐字追加到 thinking 气泡即时显示；
      //  uiHint 卡片**只暂存、不渲染**——卡片必须加载完整才能显示，故流过程中这条消息
      //  的 uiHint 始终为 undefined，直到本轮流结束定型时才挂上 card 触发渲染。
      let accumulated = '';
      let card: UiHintCard | undefined;
      let error: { code: string; message: string } | undefined;

      for await (const ev of agentClient.chat({
        userId: getUserId(),
        message: userMsg,
        scenario,
        metadata: currentAttachment ? { intent_context: currentAttachment } : undefined,
      })) {
        if (ev.type === 'token' && ev.text) {
          accumulated += ev.text;
          // 逐字追加：只更新 thinking 气泡的 text；uiHint 保持 undefined（不渲染卡片）
          setChatHistory(prev => prev.map(m => (m.isThinking ? { ...m, text: accumulated } : m)));
        } else if (ev.type === 'uiHint' && ev.card) {
          card = ev.card; // 暂存，流结束后才渲染
        } else if (ev.type === 'error' && ev.error && !error) {
          error = { code: ev.error.code, message: ev.error.message };
        }
      }

      // 本轮流结束：定型这条消息 —— 现在才挂上卡片，卡片渲染在此刻发生
      setChatHistory(prev => prev.map(m => (m.isThinking ? {
        role: 'ai',
        text: error ? `[诊断] agent 返回错误 — ${error.code}: ${error.message}` : accumulated,
        uiHint: synthesizeUiHint(card),
        explanation: undefined,
        isThinking: false,
        progressItems: [],
      } : m)));
    } catch (err) {
      console.error("Chat Error:", err);
      const errMsg = err instanceof Error ? err.message : String(err);
      setChatHistory(prev => [...prev.filter(m => !m.isThinking), { role: 'ai', text: `[诊断] 调用抛异常 — ${errMsg}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmPlan = (planData: any[], mode: 'append' | 'replace') => {
    onPlanConfirm(planData, mode);
  };

  const openAiCoach = async (attachment?: any) => {

    console.log('[useAICoach] openAiCoach called with attachment:', attachment);
    console.log('[useAICoach] Current chat history length:', chatHistory.length);

    // [FIX] Prevent race condition when openAiCoach is called multiple times quickly
    if (isOpeningOverlayRef.current && attachment?.type === 'workout_complete') {
      console.log('[useAICoach] Already opening overlay with workout complete, skipping duplicate call');
      return;
    }

    if (attachment) {
      setAttachedContext(attachment);

      // Training end (Phase 1+2): persist session first, then call Agent
      // Phase 1: POST /api/sessions to persist session data
      // Phase 2: Agent reads from DB via load_history, generates summary + survey_card
      if (attachment.type === 'workout_complete') {
        console.log('[useAICoach] Detected workout_complete, persisting session first...');

        // Set flag to prevent duplicate calls
        isOpeningOverlayRef.current = true;

        // Store workout data for later use in questionnaire upload
        workoutDataRef.current = attachment.data;

        // Show "persisting" indicator
        const persistingMessage = `## 训练完成！正在保存数据...

**本次训练概览**
- 🏋️ 完成 ${attachment.data?.exercises?.length || 0} 个动作
- ⏱️ 用时 ${attachment.data?.stats?.durationMinutes || 0} 分钟
- 📊 总容量 ${attachment.data?.stats?.totalVolume || 0} kg
- ✅ 完成 ${attachment.data?.stats?.setsCount || 0} 组`;

        // Set overlay open first, then update chat history
        setIsAiOverlayOpen(true);
        setIsLoading(false);

        setTimeout(() => {
          setChatHistory(prev => {
            const newMessage: ChatMessage = {
              role: 'ai',
              text: persistingMessage,
              uiHint: undefined,
              _isAnalyzing: true,
              _sessionId: attachment.sessionId
            };
            const newHistory = [...prev, newMessage];
            console.log('[useAICoach] New chat history:', newHistory);
            isOpeningOverlayRef.current = false;
            return newHistory;
          });
        }, 0);

        // Phase 1: Persist session to DB first
        try {
          const sessionPayload = {
            sessionId: attachment.sessionId,
            startTime: attachment.data?.startTime,
            endTime: attachment.data?.endTime,
            exercises: attachment.data?.exercises,
            stats: attachment.data?.stats,
            notes: attachment.data?.notes
          };

          console.log('[useAICoach] POST /api/sessions with payload:', sessionPayload);

          const response = await fetch('/api/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sessionPayload)
          });

          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(`Failed to persist session: ${response.status} ${JSON.stringify(errData)}`);
          }

          const persistResult = await response.json();
          console.log('[useAICoach] Session persisted successfully:', persistResult);

        } catch (persistErr) {
          console.error('[useAICoach] Failed to persist session:', persistErr);
          // Continue with Agent analysis even if persistence failed
          // Agent will try to use whatever data is available
        }

        // Phase 2: Call Agent for analysis (reads from DB via load_history)
        console.log('[useAICoach] Calling analyzeWorkout...');
        if (!analysisTriggeredRef.current) {
          analysisTriggeredRef.current = true;
          analyzeWorkout(attachment).catch(err => {
            console.error('[useAICoach] Analysis failed:', err);
            setChatHistory(prev => prev.map(m =>
              m._isAnalyzing ? {
                role: 'ai',
                text: "训练数据处理完成。您可以稍后从历史记录查看详情。",
                _isAnalyzing: false,
                _analysisComplete: true
              } : m
            ));
          });
        }

        return;
      }

      // [PHASE 4.1] Auto-trigger summary bubble if type is workout_summary (legacy)
      if (attachment.type === 'workout_summary') {
        setIsAiOverlayOpen(true);
        setIsLoading(true);
        setChatHistory(prev => [...prev, { role: 'ai', text: '', isThinking: true, progressItems: [] }]);

        try {
          const result = await consumeAgentStream(agentClient.chat({
            userId: getUserId(),
            message: "请总结我刚刚的训练表现。",
            scenario: "chat",
            metadata: { intent_context: attachment }
          }));

          setChatHistory(prev => {
            const filtered = prev.filter(m => !m.isThinking);
            return [...filtered, {
              role: 'ai',
              text: result.error ? "" : (result.text || ""),
              uiHint: synthesizeUiHint(result.card),
              explanation: undefined
            }];
          });
        } catch (err) {
          console.error("Summary trigger error:", err);
          // [FIX] 给用户明确的错误反馈
          setChatHistory(prev => {
            const filtered = prev.filter(m => !m.isThinking);
            return [...filtered, {
              role: 'ai',
              text: "**训练总结生成失败**\n\n无法连接到 AI 教练服务。这可能是由于：\n- 网络连接问题\n- 服务器暂时不可用\n\n您的训练数据已安全保存。您可以：\n1. 关闭此界面后开始新的训练\n2. 稍后从历史记录页面查看本次训练详情\n3. 检查网络连接后重试",
            }];
          });
        } finally {
          setIsLoading(false);
        }
        return;
      }
    }
    setIsAiOverlayOpen(true);
  };

  /**
   * analyzeWorkout — call Agent for post-workout analysis
   *
   * Phase 2 of workout_complete refactor:
   * - Session already persisted by Phase 1 (POST /api/sessions, called above)
   * - Agent calls load_history to get data from DB
   * - Agent generates summary text + survey_card (smart, max 3 questions)
   * - Agent may call update_profile / write_memory as needed
   */
  async function analyzeWorkout(attachment: any) {
    if (analysisInProgressRef.current) {
      console.log('[analyzeWorkout] Analysis already in progress, skipping duplicate call');
      return;
    }

    console.log('[analyzeWorkout] Starting analysis for session:', attachment.sessionId);
    analysisInProgressRef.current = true;

    try {
      const result = await consumeAgentStream(agentClient.chat({
        userId: getUserId(),
        message: `训练已结束，session ${attachment.sessionId} 已持久化到数据库。请分析本次训练表现。`,
        scenario: 'workout_complete',
        metadata: {
          intent_context: {
            type: 'workout_complete',
            sessionId: attachment.sessionId,
            previewStats: attachment.data?.stats // Only for preview, Agent must use load_history
          }
        }
      }));

      console.log('[analyzeWorkout] response card:', result.card);

      // Remove analyzing indicator, show Agent's summary + card
      setChatHistory(prev => {
        // Remove _isAnalyzing flag from all messages
        const updated: ChatMessage[] = prev.map(m => {
          if (m._isAnalyzing) {
            return {
              ...m,
              text: result.text || m.text || '训练分析完成。',
              uiHint: synthesizeUiHint(result.card),
              _isAnalyzing: false,
              _analysisComplete: true
            };
          }
          return m;
        });

        // If Agent returned a survey_card as a separate message, append it
        // (Agent should have included it in the thinking message above via uiHintExtractor)
        // If Agent's card is NOT survey_card, it was already merged into the first message
        const synthesized = synthesizeUiHint(result.card);
        if (synthesized?.type === 'survey_card') {
          // survey_card was already extracted from Agent's text by uiHintExtractor
          // and merged into the thinking message above — no need for a separate message
          console.log('[analyzeWorkout] survey_card merged into first message');
        }

        return updated;
      });
    } catch (err) {
      console.error('[analyzeWorkout] Analysis failed:', err);
      setChatHistory(prev => prev.map(m =>
        m._isAnalyzing ? {
          role: 'ai',
          text: '训练分析暂时不可用，数据已保存。',
          _isAnalyzing: false,
          _analysisComplete: true
        } : m
      ));
    } finally {
      analysisInProgressRef.current = false;
    }
  }

  // Legacy triggerMASAnalysis — replaced by analyzeWorkout above
  // Kept only for backward compatibility, remove after full migration
  async function triggerMASAnalysis(attachment: any) {
    console.warn('[triggerMASAnalysis] DEPRECATED — use analyzeWorkout instead');
    return analyzeWorkout(attachment);
  }

  return {
    isAiOverlayOpen,
    setIsAiOverlayOpen,
    isPlanMode,
    setIsPlanMode,
    chatMessage,
    setChatMessage,
    chatHistory,
    setChatHistory,
    isLoading,
    handleChatSubmit,
    handleConfirmPlan,
    openAiCoach,
    chatEndRef,
    textareaRef,
    attachedContext,
    setAttachedContext,
    // [SCROLL_FIX] Export scroll controls
    scrollToBottom,
    isUserScrollingRef,
    // [NEW] Thread management
    threads,
    currentThreadId,
    showHistoryPanel,
    setShowHistoryPanel,
    createNewThread,
    switchToThread,
    formatRelativeTime
  };
};
