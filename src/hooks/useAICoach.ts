import { useState, useRef, useEffect, useCallback } from 'react';
import { getUserId } from '@/services';
import { getHeaders, API_BASE } from '@/services/geminiService';
import { buildSessionPayload } from '../utils/workoutSummary';
// P010 signature-frozen seam: hooks program only against chat(req): AsyncIterable<AgentEvent>.
// The kernel swap (legacy multi-agent one-shot POST) is absorbed inside the
// seam; this hook consumes the SSE stream and synthesizes renderable uiHint
// cards, with no awareness of the backend agent implementation.
import { agentClient, consumeAgentStream, synthesizeUiHint } from '../services/agent/sseAgentClient';
import { resolveCoachPrefill } from '../utils/coachPrefill';
import { todayDateKey } from '../utils/weeklyPlanView';
import type { PlanConsumeRecord } from '../components/execution/cards/PlanCard';
import type { SurveySubmitRecord } from '../components/execution/cards/SurveyCard';
import type { ProfileUpdateDecisionRecord } from '../components/execution/cards/ProfileUpdateConfirmCard';
import type { AgentScenario, UiHintCard, TodayScheduleResponse } from 'shared/contracts';
import { parseJSONSafe } from 'shared/contracts';
import {
  saveChatThreadList,
  loadChatThreadList,
  saveChatMessages,
  loadChatMessages,
  deleteChatThread,
  migrateLegacyChatData,
  loadHistory,
  ChatThread
} from '@/storage';

export interface ChatMessage {
  role: 'user' | 'ai';
  text: string;
  /** 用户消息附带的图片预览（本地 dataUrl，仅 UI 展示；发送走 mediaId） */
  imageDataUrl?: string;
  /** 图片在服务器图床的引用 ID（内容寻址），线程删除时可据此释放服务器存储 */
  mediaId?: string;
  isThinking?: boolean;
  /** Agent 自我修订过程的思考文本（质量门打回重试轮次）——折叠显示，非正文 */
  thinkingText?: string;
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
 * [治理 2026-09-18] 通知后端清理该线程的 Agent checkpoint（fire-and-forget）。
 * 后端按 `${userId}:${threadId}` 复合键校验归属并三表连删。
 */
const notifyBackendThreadDeleted = (threadId: string): void => {
  fetch(`${API_BASE}/agent/thread/${encodeURIComponent(`${getUserId()}:${threadId}`)}`, {
    method: 'DELETE',
    headers: getHeaders(),
  }).catch(() => { /* 清理失败无碍：定期清理兜底 */ });
};

/**
 * 向服务器发送媒体释放信号（fire-and-forget）：线程被删除/挤出时，
 * 其消息里引用的图片立即从服务器图床释放，不等 N 天未引用的定期清理。
 */
const reclaimMediaIds = (messages: ChatMessage[]): void => {
  const ids = Array.from(
    new Set(messages.map(m => (m as any).mediaId).filter((id: any): id is string => typeof id === 'string' && id.length > 0)),
  );
  ids.forEach(id => {
    fetch(`${API_BASE}/media/reclaim/${id}`, { method: 'DELETE', headers: getHeaders() })
      .catch(() => { /* 释放失败无碍：N 天未引用清理会兜底 */ });
  });
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
  onPlanConfirm: (
    plan: any[],
    mode: 'append' | 'replace',
    opts?: { onConsumed?: (record: PlanConsumeRecord) => void; isTomorrow?: boolean }
  ) => void
) => {
  const [isAiOverlayOpen, setIsAiOverlayOpen] = useState(false);
  const [isPlanMode, setIsPlanMode] = useState(false);
  const [chatMessage, setChatMessage] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  // [B1 issue#5 返工] 入口预填 = placeholder 语义（2026-09-26 PR #27 打回）：
  // 建议文案走输入框 placeholder（原生浅灰、可被输入天然替换），不进正式值、不可发送。
  // 用户一旦输入任何内容即清空（下方 effect），发送亦清空——预填只服务「入口时刻」。
  const [entryPlaceholder, setEntryPlaceholder] = useState('');
  // [B1 二次返工] chatHistory 镜像 ref：预填守门用（useCallback([]) 里读不到最新历史，
  // 同 attachedContextRef 模式）——会话中途（已有消息）预填不复活
  const chatHistoryRef = useRef(chatHistory);

  // [NEW] Thread Management State
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [currentThreadId, setCurrentThreadId] = useState<string>('');
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);

  // [NEW] Context Attachment State
  const [attachedContext, setAttachedContext] = useState<any>(null);
  // [B1 issue#5] 附件镜像 ref：openAiCoach 与 state set 同 tick 调用时闭包里
  // 读不到新挂的附件（教学页「咨询教练」先 setAttachedContext 再 openAiCoach），
  // 预填据此让位——带附件=用户带着具体问题来，不预填
  const attachedContextRef = useRef<unknown>(null);
  useEffect(() => { attachedContextRef.current = attachedContext; }, [attachedContext]);
  useEffect(() => { chatHistoryRef.current = chatHistory; }, [chatHistory]);

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

    // Delete oldest threads (其图片附件随线程释放：立即发服务器释放信号，定期清理兜底)
    toDelete.forEach(async thread => {
      try {
        const msgs = await loadChatMessages(thread.id);
        if (msgs?.length) reclaimMediaIds(msgs);
      } catch { /* 读取失败也照删线程 */ }
      deleteChatThread(thread.id);
      notifyBackendThreadDeleted(thread.id);
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
    // 新对话 = 干净输入区：清掉上一线程残留的附件 chip，否则空「上下文附件」跨线程飘着
    setAttachedContext(null);
    // [B1 二次返工] 同理清预填 placeholder：预填只在打开入口时注入，切/建新话题不复活
    setEntryPlaceholder('');

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
  // 根因修复：旧实现用 chatEndRef.parentElement 判断"内容是否已渲染"，
  // 但那是内容包裹层（高度自适应、永不溢出），scrollHeight<=clientHeight 恒真，
  // 导致无限重试、scrollIntoView 从未执行——初始锚定完全失效。
  // 现改为：data-chat-scroll-container 精确定位滚动容器 + scrollTop 同步直赋
  // （绕开 WKWebView 对 scrollIntoView 与入场 transform 动画冲突的各类怪癖）。
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto', force = false, depth = 0) => {
    if (!force && isUserScrollingRef.current) return;

    const attemptId = ++scrollAttemptRef.current;

    requestAnimationFrame(() => {
      if (attemptId !== scrollAttemptRef.current) return;

      const el = chatEndRef.current;
      if (!el) return;
      const container = (el.closest('[data-chat-scroll-container]') as HTMLElement | null) ?? el.parentElement;
      if (!container) return;

      // 内容可能仍在异步渲染（Markdown/KaTeX/卡片），尚未可滚动时短暂重试（封顶防死循环）
      if (container.scrollHeight <= container.clientHeight) {
        if (depth < 10) setTimeout(() => scrollToBottom(behavior, force, depth + 1), 60);
        return;
      }

      if (behavior === 'smooth') {
        container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
      } else {
        container.scrollTop = container.scrollHeight; // 同步直设，无动画、必达
      }
    });
  }, []);

  // [FIX] Sync function refs to prevent infinite loops
  useEffect(() => {
    updateThreadMetaRef.current = updateThreadMeta;
  }, [updateThreadMeta]);

  useEffect(() => {
    scrollToBottomRef.current = scrollToBottom;
  }, [scrollToBottom]);

  // [PERF 2026-09-17] 历史对话卡顿根治：
  // 旧实现每次 chatHistory 变化（含流式打字机逐 token 的 setState！）都全量 JSON 序列化
  // 整个 chatHistory（可能含 imageDataUrl base64 大图，数百 KB~数 MB）写 storage，
  // 并同步 updateThreadMeta（再全量写 thread list）→ 主线程被序列化占满 → 返回按钮/滑动卡顿。
  // 修复：800ms debounce——流式期间高频 setState 只在停顿后落一次盘（图片仍随消息持久化，
  // 但频率从每 token 一次降到每停顿一次，序列化成本可忽略）。
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!currentThreadId || chatHistory.length === 0) return;
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      saveChatMessages(currentThreadId, chatHistory);
      updateThreadMetaRef.current(currentThreadId, chatHistory);
    }, 800);
    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, [chatHistory, currentThreadId]);

  // [SCROLL_FIX] Scroll when overlay opens (wait for animation to complete)
  // 初始锚定必须用 instant 而非 smooth：sheet 入场（420ms transform 过渡）期间，
  // iOS WKWebView 对正在 transform 的容器执行平滑 scrollIntoView 会被中断，
  // 结果停在顶部（最旧消息）。呈现态应直接落在底部锚点（iMessage 行为）；
  // 延迟二次锚定兜底 Markdown/KaTeX 等重内容异步撑高。
  useEffect(() => {
    if (isAiOverlayOpen && chatHistory.length > 0) {
      const timer = setTimeout(() => {
        isScrollReadyRef.current = true;
        scrollToBottomRef.current('auto', true);
      }, 350); // 300ms transition + 50ms buffer
      const lateTimer = setTimeout(() => {
        scrollToBottomRef.current('auto', true);
      }, 800); // 兜底：异步渲染内容二次撑高后再锚一次

      return () => {
        clearTimeout(timer);
        clearTimeout(lateTimer);
      };
    } else if (!isAiOverlayOpen) {
      isScrollReadyRef.current = false;
    }
  }, [isAiOverlayOpen, chatHistory.length]);

  // [SCROLL_FIX] 切换会话后直接锚定到底部：新载入的对话视口停在顶部（scrollTop=0），
  // 此时 isNearBottom 判定不成立，上面的「新消息跟随滚动」兜底不会触发
  useEffect(() => {
    if (isAiOverlayOpen && currentThreadId && chatHistory.length > 0) {
      const t1 = setTimeout(() => scrollToBottomRef.current?.('auto', true), 100);
      const t2 = setTimeout(() => scrollToBottomRef.current?.('auto', true), 600);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
  }, [isAiOverlayOpen, currentThreadId, chatHistory.length]);

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

  const handleChatSubmit = async (
    e?: React.FormEvent,
    directMessage?: string,
    scenarioOverride?: string,
    opts?: { silent?: boolean }
  ) => {
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

    // [B1 返工] 用户已实际发起对话 → 入口预填 placeholder 退场，不再回来
    setEntryPlaceholder('');

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
        // - 无训练数据：plan（初始问卷）→ Agent 生成计划
        const hasWorkoutData = workoutDataRef.current?.exercises?.length > 0;
        const scenario = hasWorkoutData ? "workout_complete" : "plan";

        // ★静态画像确定性写入（2026-09-17 问卷回传丢失修复）：
        // update_profile 工具只覆盖动态字段（load_anchors/limitations/recovery/psychological），
        // 静态字段（目标/经验/器械/周频次）在 Agent 工具侧无写入通道——纯靠 Agent 转述必然丢。
        // 契约红线：数据写入走 Service，不依赖 AI。前端把可识别字段直接写 profile_static，
        // 失败静默（Agent 消息里仍带原文，可由 write_memory 兜底记忆）。
        if (!hasWorkoutData) {
          try {
            const responses = (uploadData?.responses ?? uploadData) as Record<string, unknown>;
            const pick = (...keys: string[]) => {
              for (const k of keys) {
                const v = responses[k];
                if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
              }
              return undefined;
            };
            // ★按 shared/contracts 嵌套格式写（PUT /profile/static 的平铺白名单只认
            // age/weight/height/neuro_type 等，goal/experience/equipment 会被静默丢弃——实锤踩过）
            const staticPatch: Record<string, unknown> = { preferences: {}, basic_info: {} };
            const prefs = staticPatch.preferences as Record<string, unknown>;
            const basic = staticPatch.basic_info as Record<string, unknown>;

            const goal = pick("goal", "training_goal", "目标");
            if (goal) {
              const map: Record<string, string> = {
                增肌: "muscle_gain", 肌肥大: "muscle_gain",
                减脂: "fat_loss", 减肥: "fat_loss", 燃脂: "fat_loss",
                力量: "strength", 增力: "strength",
                健康: "health", 一般健康: "health",
                综合体能: "general_fitness", 体能: "general_fitness"
              };
              // 精确命中 → 子串兜底（Agent 生成的 label 是自由文本，如「增肌塑形」
              // 「提升力量」；2026-09-17 实测「增肌塑形」漏映射 fallback 成 general_fitness）
              const mapped =
                map[goal] ??
                (goal.includes("增肌") || goal.includes("肌肥大") || goal.includes("塑形") ? "muscle_gain"
                : goal.includes("减脂") || goal.includes("减肥") || goal.includes("燃脂") ? "fat_loss"
                : goal.includes("力量") ? "strength"
                : goal.includes("体能") || goal.includes("健康") ? "general_fitness"
                : undefined);
              prefs.goal = mapped ?? "general_fitness";
            }
            const equip = pick("equipment", "available_equipment", "器械", "器械条件");
            if (equip) prefs.equipment = equip.split(/[、,，/ ]+/).filter(Boolean);
            const exp = pick("experience", "training_experience", "经验", "训练经验");
            if (exp) {
              // 文本经验映射为训练年龄（月）：新手=3 / 中级=12 / 高级=36，数字直接用
              const n = parseFloat(exp);
              basic.training_age = isNaN(n)
                ? (/高级/.test(exp) ? 36 : /中|一年|1年/.test(exp) ? 12 : 3)
                : n;
            }
            const weekly = pick("weekly_frequency", "frequency", "days_per_week", "周频次", "每周次数");
            if (weekly) {
              const n = parseInt(weekly);
              if (!isNaN(n)) (staticPatch as Record<string, unknown>).weekly_frequency_days = n;
            }
            const injuries = pick("injuries", "injury", "limitations", "伤病");
            if (injuries && injuries !== "无" && injuries !== "没有" && injuries !== "无伤病") {
              (staticPatch as Record<string, unknown>).raw_injuries = injuries; // 原文留给 Agent 读
            }
            for (const k of Object.keys(staticPatch)) {
              if (!staticPatch[k] || (typeof staticPatch[k] === "object" && Object.keys(staticPatch[k] as object).length === 0)) {
                delete staticPatch[k];
              }
            }
            if (Object.keys(staticPatch).length > 0) {
              // fire-and-forget：不阻塞 Agent 对话流；401/网络失败由 catch 吞掉
              fetch(`${API_BASE}/admin/users/${encodeURIComponent(getUserId())}/profile/static`, {
                method: "PUT",
                headers: getHeaders(),
                body: JSON.stringify(staticPatch)
              }).then(r => {
                console.log('[useAICoach] Survey static profile sync:', r.ok ? "ok" : `HTTP ${r.status}`);
              }).catch(() => {});
            }
          } catch (e) {
            console.warn('[useAICoach] static profile patch build failed:', e);
          }
        }


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
          : `用户已完成初始问卷（答案同时已写入画像静态字段）。请：
1. 调用 load_history 读取用户画像，结合下方问卷答案理解用户
2. 按 plan 前置条件生成训练计划，输出 plan_card
3. 如问卷中提及伤病/疼痛，调用 update_profile 登记到 active_limitations

问卷答案原文：
${JSON.stringify(uploadData, null, 2)}`;

        console.log('[useAICoach] Survey upload scenario:', scenario, '(hasWorkoutData:', hasWorkoutData, ')');

        // [FIX 2026-09-17] 改流式增量渲染：原 consumeAgentStream 全量缓冲会丢弃
        // thinking/token 事件 → 提交后空白气泡干等 40s+ 才一次性弹出回复。
        // 与普通聊天分支（handleChatSubmit 主路径）对齐：token 逐字进正文、
        // thinking 进折叠思考区、uiHint 暂存到流结束才挂载渲染。
        let accumulated = '';
        let thinkingAccumulated = '';
        let card: UiHintCard | undefined;
        let streamError: { code: string; message: string } | undefined;

        for await (const ev of agentClient.chat({
          userId: getUserId(),
          message,
          scenario,
          // [治理 2026-09-18] threadId 必传：上下文按对话窗口隔离
          threadId: currentThreadId,
          metadata: {
            intent_context: {
              type: 'survey_upload',
              data: uploadData,
              workoutData: workoutDataRef.current
            }
          }
        })) {
          if (ev.type === 'token' && ev.text) {
            accumulated += ev.text;
            setChatHistory(prev => prev.map(m => (m.isThinking ? { ...m, text: accumulated } : m)));
          } else if (ev.type === 'thinking' && ev.text) {
            const isBlockNarration = ev.text.includes('\n');
            thinkingAccumulated = isBlockNarration
              ? (thinkingAccumulated ? `${thinkingAccumulated}\n\n${ev.text}` : ev.text)
              : thinkingAccumulated + ev.text;
            setChatHistory(prev => prev.map(m => (m.isThinking ? { ...m, thinkingText: thinkingAccumulated } : m)));
          } else if (ev.type === 'uiHint' && ev.card) {
            card = ev.card; // 暂存，流结束后才渲染
          } else if (ev.type === 'error' && ev.error && !streamError) {
            streamError = { code: ev.error.code, message: ev.error.message };
          }
        }

        console.log('[useAICoach] Survey upload response card:', card);

        // 本轮流结束：定型 thinking 气泡为最终消息（此刻才挂卡片）
        // uiHint 合成：从 SSE card 产出可渲染卡片对象
        let uiHint = synthesizeUiHint(card);

        // [FIX 2026-09-17] plan 场景（初始问卷）本来就要求 Agent 出 plan_card——
        // 此处旧防御「无条件丢弃 plan_card」把正常卡片吃掉了（实锤：模拟器实测文字
        // 说「卡片如下」但卡片消失）。仅在 workout_complete（练后补录问卷）场景
        // 保留防御：练后轮不该再弹计划卡。
        if (uiHint?.type === 'plan_card' && hasWorkoutData) {
          console.error('[useAICoach] BUG: Backend returned plan_card after workout survey!');
          uiHint = undefined;  // Clear erroneous uiHint
        }

        setChatHistory(prev => prev.map(m => (m.isThinking ? {
          role: 'ai',
          text: streamError
            ? `上传失败，请重试。[${streamError.code}: ${streamError.message}]`
            : (accumulated || "感谢您的反馈。"),
          thinkingText: thinkingAccumulated || undefined,
          uiHint,
          explanation: undefined,
          isThinking: false,
          progressItems: [],
        } : m)));

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

    // 照片附件：先把本地 dataUrl 上传到图床拿 mediaId，再以干净引用进 intent_context。
    // 上传失败则保留附件、中断发送（不丢用户刚拍的图），如实提示。
    let sendAttachment = currentAttachment;
    if (currentAttachment?.type === 'image' && currentAttachment.dataUrl && !currentAttachment.mediaId) {
      try {
        const up = await fetch(`${API_BASE}/media/uploadData`, {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify({ dataUrl: currentAttachment.dataUrl, mime: currentAttachment.mime || 'image/jpeg' }),
        });
        if (!up.ok) throw new Error(`HTTP ${up.status}`);
        const meta = await up.json();
        sendAttachment = {
          type: 'image',
          title: currentAttachment.title || '照片',
          mediaId: meta.id,
          mime: currentAttachment.mime || meta.mime || 'image/jpeg',
        };
      } catch (err) {
        console.error('[useAICoach] Photo upload failed:', err);
        setIsLoading(false);
        setChatHistory(prev => prev.filter(m => !m.isThinking));
        alert('图片上传失败，请重试。');
        return;
      }
    }

    // 文件附件：文本已在选取时读入（textContent），直接随 intent_context 透传，
    // 无需上传图床。后端会把文件内容注入模型上下文。
    if (currentAttachment?.type === 'file' && !currentAttachment.textContent) {
      setIsLoading(false);
      setChatHistory(prev => prev.filter(m => !m.isThinking));
      alert('文件内容为空，请重新选择文件。');
      return;
    }

    setChatMessage("");
    setAttachedContext(null); // Clear attachment after send
    // 静默轮（画像确认等系统回传）：不把指令文本推入聊天流，用户只看到 Agent 的回复
    // 图片消息：本地 dataUrl 挂上气泡供查看（上传失败已在上面的分支中断，到这里必已换到 mediaId）
    if (!opts?.silent) {
      setChatHistory(prev => [...prev, {
        role: 'user',
        text: userMsg,
        ...(currentAttachment?.type === 'image' && currentAttachment.dataUrl && sendAttachment?.type === 'image'
          ? { imageDataUrl: currentAttachment.dataUrl, mediaId: sendAttachment.mediaId }
          : {}),
      }]);
    }

    if (textareaRef.current) textareaRef.current.style.height = '64px';

    setIsLoading(true);
    setChatHistory(prev => [...prev, { role: 'ai', text: '', isThinking: true, progressItems: [] }]);

    try {
      // scenario 覆盖（如画像确认卡回传的 update_profile 执行轮），否则按模式默认
      const validScenarios = ['chat', 'plan', 'workout_complete', 'update_profile'];
      const scenario: AgentScenario = (
        scenarioOverride && validScenarios.includes(scenarioOverride)
          ? scenarioOverride
          : isPlanMode ? "plan" : "chat"
      ) as AgentScenario;

      // [PHASE 4.1] 流式增量渲染（打字机）：token 是纯散文（卡片 JSON 已被后端
      //  extractUiHintEvents 剥成单独的 uiHint 事件），逐字追加到 thinking 气泡即时显示；
      //  uiHint 卡片**只暂存、不渲染**——卡片必须加载完整才能显示，故流过程中这条消息
      //  的 uiHint 始终为 undefined，直到本轮流结束定型时才挂上 card 触发渲染。
      let accumulated = '';
      let thinkingAccumulated = '';
      let card: UiHintCard | undefined;
      let error: { code: string; message: string } | undefined;

      for await (const ev of agentClient.chat({
        userId: getUserId(),
        message: userMsg,
        scenario,
        // [治理 2026-09-18] threadId 必传：上下文按对话窗口隔离
        threadId: currentThreadId,
        metadata: sendAttachment ? { intent_context: sendAttachment } : undefined,
      })) {
        if (ev.type === 'token' && ev.text) {
          accumulated += ev.text;
          // 逐字追加：只更新 thinking 气泡的 text；uiHint 保持 undefined（不渲染卡片）
          setChatHistory(prev => prev.map(m => (m.isThinking ? { ...m, text: accumulated } : m)));
        } else if (ev.type === 'thinking' && ev.text) {
          // 被质量门打回轮次的自我修订文本 → 折叠思考区，不进正文。
          // 后端 thinking 有两类：①reasoning_content 逐 delta 小片段（直接拼接，
          // 加空行会把一句推理切成 n 段）；②叙事文本整段（如工具调用前的 narration，
          // 自带段落分隔，用空行拼接区分来源）。
          // 判据：片段内含换行 → 视为整段叙事；否则按 delta 无缝续接。
          const isBlockNarration = ev.text.includes('\n');
          thinkingAccumulated = isBlockNarration
            ? (thinkingAccumulated ? `${thinkingAccumulated}\n\n${ev.text}` : ev.text)
            : thinkingAccumulated + ev.text;
          setChatHistory(prev => prev.map(m => (m.isThinking ? { ...m, thinkingText: thinkingAccumulated } : m)));
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
        thinkingText: thinkingAccumulated || undefined,
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

  const handleConfirmPlan = (
    planData: any[],
    mode: 'append' | 'replace',
    opts?: { onConsumed?: (record: PlanConsumeRecord) => void; isTomorrow?: boolean }
  ) => {
    onPlanConfirm(planData, mode, opts);
  };

  /**
   * 计划卡一次性消费（2026-09-14）：把消费记录写入指定消息的 uiHint.consumed。
   * chatHistory 变化会被现有 effect 自动 saveChatMessages 持久化，
   * 重开对话/切会话后卡片保持「已消费」折叠态，不会重新出现操作按钮。
   */
  const markPlanConsumed = useCallback((msgIndex: number, record: PlanConsumeRecord) => {
    setChatHistory(prev => prev.map((m, i) => (
      i === msgIndex && m.uiHint?.type === 'plan_card'
        ? { ...m, uiHint: { ...m.uiHint, consumed: record } }
        : m
    )));
  }, []);

  /**
   * 问卷提交状态固化（2026-09-14）：把提交记录写入指定消息的 uiHint.submitted，
   * 随 thread 持久化 → 重开对话/切话题问卷保持「已提交」只读态，不再弹回可填。
   */
  const markSurveySubmitted = useCallback((msgIndex: number, record: SurveySubmitRecord) => {
    setChatHistory(prev => prev.map((m, i) => (
      i === msgIndex && m.uiHint?.type === 'survey_card'
        ? { ...m, uiHint: { ...m.uiHint, submitted: record } }
        : m
    )));
  }, []);

  /**
   * 画像更新决定固化（2026-09-14）：把确认/取消决定写入指定消息的 uiHint.decision，
   * 随 thread 持久化 → 重开对话保持「已更新/已放弃」终态，杜绝重复确认二次写库。
   */
  const markProfileDecision = useCallback((msgIndex: number, record: ProfileUpdateDecisionRecord) => {
    setChatHistory(prev => prev.map((m, i) => (
      i === msgIndex && m.uiHint?.type === 'profile_update_confirm'
        ? { ...m, uiHint: { ...m.uiHint, decision: record } }
        : m
    )));
  }, []);

  /**
   * [B1 issue#5 返工] 入口预填（placeholder 语义）：手动打开 AI 教练时按三场景
   * 把建议文案写入输入框 placeholder——
   *   A 有周计划且今日有条目 → 今日计划摘要（E2 确定性课表 API 组装）
   *   B 无计划新手（本地无训练记录 + 本周无计划）→ 引导预填
   *   C 老用户无今日计划 → 轻预填
   * 红线：纯前端确定性组装（scheduleService 已交付今日课表，AI 零参与）；
   * 只动 placeholder 不动 chatMessage（正式值），用户输入天然替换之；
   * 挂附件的入口（教学页「咨询教练」）= 带着具体问题来 → 让位并清残留；
   * 会话中途（当前线程已有消息）不复活——预填只在打开入口、会话未开始时注入。
   */
  const prefillCoachEntry = useCallback(async () => {
    // 一检（同步，省一次无效 fetch）：带附件 / 会话已开始 → 不注入
    if (attachedContextRef.current) {
      setEntryPlaceholder('');
      return;
    }
    if (chatHistoryRef.current.length > 0) return;
    try {
      const res = await fetch(`${API_BASE}/schedule/today?date=${todayDateKey()}`, {
        headers: getHeaders(),
      });
      // 形态防御：status 非三态之一视同课表不可得，交由路由走「不猜」分支
      const raw = res.ok
        ? parseJSONSafe<TodayScheduleResponse>(await res.text(), 'coachPrefill')
        : null;
      const schedule: TodayScheduleResponse | null =
        raw && (raw.status === 'planned' || raw.status === 'rest_day' || raw.status === 'no_plan')
          ? raw
          : null;
      // 新手判定的另一半：本地训练历史（不新增后端字段；读取失败按无记录处理）
      let localHistory: unknown[] | null = null;
      try {
        localHistory = await loadHistory();
      } catch { /* IDB 不可用 → 按无记录 */ }
      const hasHistory = Array.isArray(localHistory) && localHistory.length > 0;

      const text = resolveCoachPrefill(schedule, hasHistory);
      // 二检（防 fetch 窗口内竞态）：
      // 附件（教学页同 tick 先 setAttachedContext）→ 让位并清残留，不盖问题场景；
      // 会话已开始（窗口期内发出消息）→ 不复活
      if (attachedContextRef.current) {
        setEntryPlaceholder('');
        return;
      }
      if (chatHistoryRef.current.length > 0) return;
      setEntryPlaceholder(text);
    } catch (err) {
      console.warn('[useAICoach] entry prefill skipped:', err);
    }
  }, []);

  // [B1 返工] 用户一旦输入任何内容 → 预填清除（原生 placeholder 的「可替换」
  // 只在输入非空期间成立；这里把它变成一次性：输入过就不再回来）
  useEffect(() => {
    if (chatMessage.trim()) setEntryPlaceholder('');
  }, [chatMessage]);

  const openAiCoach = async (attachment?: any) => {

    console.log('[useAICoach] openAiCoach called with attachment:', attachment);
    console.log('[useAICoach] Current chat history length:', chatHistory.length);

    // [FIX] Prevent race condition when openAiCoach is called multiple times quickly
    if (isOpeningOverlayRef.current && attachment?.type === 'workout_complete') {
      console.log('[useAICoach] Already opening overlay with workout complete, skipping duplicate call');
      return;
    }

    // [B1 issue#5] 入口预填 placeholder（fire-and-forget，不阻塞开浮层）：
    // 无附件=手动进入按场景预填；带附件（workout_complete/教学页）=让位并清残留
    void prefillCoachEntry();

    if (attachment) {
      // workout_complete / workout_summary 是内部触发（训练结束自动分析），
      // 不是用户手动挂的输入附件——不进附件 chip，否则训练后输入框上方
      // 残留一个无标题的空「上下文附件」chip，且分析完成后无人清除（2026-09-16）
      if (attachment.type !== 'workout_complete' && attachment.type !== 'workout_summary') {
        setAttachedContext(attachment);
      }

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
- 完成 ${attachment.data?.exercises?.length || 0} 个动作
- 用时 ${attachment.data?.stats?.durationMinutes || 0} 分钟
- 总容量 ${attachment.data?.stats?.totalVolume || 0} kg
- 完成 ${attachment.data?.stats?.setsCount || 0} 组`;

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

        // Phase 1: Persist session to DB first (pre-formatted payload)
        try {
          // Pre-process: raw Exercise[] → formatted training record
          // (per-exercise aggregate rows + type-aware session stats)
          const sessionPayload = buildSessionPayload({
            id: attachment.sessionId,
            startTime: attachment.data?.startTime,
            endTime: attachment.data?.endTime,
            exercises: attachment.data?.exercises,
          });

          if (!sessionPayload) {
            throw new Error('No persistable workout data (empty exercises or invalid timestamps)');
          }

          console.log('[useAICoach] POST /api/sessions with payload:', sessionPayload);

          const response = await fetch('/api/sessions', {
            method: 'POST',
            headers: getHeaders(), // X-User-Id + Content-Type
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
            threadId: currentThreadId,
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
        threadId: currentThreadId,
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
    // [B1 issue#5 返工] 入口预填 placeholder（AICoachOverlay 输入框展示用）
    entryPlaceholder,
    handleChatSubmit,
    handleConfirmPlan,
    markPlanConsumed,
    markSurveySubmitted,
    markProfileDecision,
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
