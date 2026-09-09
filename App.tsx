import React, { useState, useEffect, useRef, useCallback, useReducer } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { motion, AnimatePresence, useMotionValue, animate } from 'framer-motion';
import { Exercise, ExerciseSet, ExerciseType, Session, AppRoute, AiConfig, AiScenario } from './types';
import { navigationReducer, initialNavigation } from './src/v2/lib/navigation';
import { computeSettlementSummary } from './src/v2/lib/settlementSummary';
import { LoadAnchors } from './src/v2/types/protocol';
import TimerCapsule from './components/TimerCapsule';
import { ExerciseCardV2 } from './src/v2/components/execution/ExerciseCardV2';
import ReorderMode from './src/v2/components/execution/ReorderMode';
import SettlementV2 from './src/v2/components/settlement/SettlementV2';
import History from './components/History';
import { haptic } from './src/lib/nativeHaptics';
import { startLiveActivity, pauseLiveActivity, endLiveActivity } from './src/lib/liveActivity';
import TimeEditor from './components/TimeEditor';
import MainTabBar, { MainTab } from './components/MainTabBar';
import ExerciseSettingsModal from './components/ExerciseSettingsModal';
import { ExerciseAction } from './src/v2/types/protocol';

import { ExerciseTutorialModal } from './src/v2/components/execution/ExerciseTutorialModal';
import LoginV2 from './components/LoginV2';
import { AICoachOverlay } from './src/v2/components/execution/AICoachOverlay';
import { SettingsPage } from './src/v2/pages';
import { useAICoach } from './src/v2/hooks/useAICoach';
import { useLoginStatus } from './src/hooks/useLoginStatus';
import { UserProfileService } from './src/services/userProfileService';
import {
  SyncService,
  socketService,
  ExerciseLibraryService
} from './services';
import { SuggestionService } from './src/services/suggestionService';
import { App as CapacitorApp } from '@capacitor/app';
import { eventTracking, TrackingEvent } from './services/eventTracking';
import { DEFAULT_REST_TIME, RPE_COLORS, DEFAULT_AI_CONFIG } from './constants';
import {
  saveHistory,
  loadHistory,
  saveAiConfig,
  loadAiConfig,
  saveWorkoutDraft,
  loadWorkoutDraft,
  requestPersist,
  saveActiveSession,
  loadActiveSession,
  setPendingSummary,
  hasPendingSummary,
  saveNextPlan,
  saveDayPlan,
  loadNextPlan,
  clearNextPlan,
  migrateLegacyLoginData
} from './storage';

interface ChatMessage {
    role: 'user' | 'ai';
    text: string;
    planData?: any[]; // Stores the raw plan data from AI before adding to session
    isThinking?: boolean;
}

/**
 * 将 Exercise 转换为 ExerciseAction 用于 ExerciseSettingsModal
 * Simplified: Direct type mapping (lowercase to lowercase, no conversion needed)
 */
function convertToExerciseAction(exercise: Exercise): ExerciseAction {
  return {
    protocol_version: '2.0.0',
    id: exercise.id,
    exerciseId: exercise.id,  // Use NanoID format directly
    type: exercise.type as any,  // Direct type mapping, no conversion needed
    sets: exercise.sets.map((s, idx) => ({
      index: idx,
      reps: s.reps || 0,
      weight: s.weight || 0,
      duration: s.duration || 0,
      distance: s.distance || 0,
      rpe: s.rpe,
      status: s.completed ? 'COMPLETED' : (s.status === 'ACTIVE' ? 'PLANNED' : (s.status || 'PLANNED'))
    })),
    metadata: {
      name: exercise.name,
      targetRpe: exercise.targetRpe,
      referenceBodyweight: exercise.referenceBodyweight,
      primaryMuscles: exercise.primaryMuscles,
      equipment: exercise.equipment,
      bodyCategory: exercise.bodyCategory,
      originalType: exercise.type,  // Dual insurance: preserve original type
      ...exercise.metadata
    }
  };
}

function convertActionSetsToExerciseSets(actionSets: any[] | undefined, existingSets: ExerciseSet[]): ExerciseSet[] {
  if (!actionSets) return existingSets;
  return actionSets.map((s): ExerciseSet => ({
    id: uuidv4(),
    reps: s.reps ?? 0,
    weight: s.weight ?? 0,
    duration: s.duration ?? 0,
    distance: s.distance ?? 0,
    rpe: s.rpe,
    completed: s.status === 'COMPLETED',
    status: s.status === 'ACTIVE' ? 'PLANNED' : (s.status ?? 'UNKNOWN')
  }));
}

const App: React.FC = () => {
  // State
  const [session, setSession] = useState<Session>({
    id: uuidv4(),
    startTime: 0,
    pausedDuration: 0,
    status: 'idle',
    exercises: []
  });

  // History State with Persistence
  const [history, setHistory] = useState<Session[]>([]);

  // Load Anchors State - User's historical best values for exercises
  const [loadAnchors, setLoadAnchors] = useState<LoadAnchors>({});

  // AI Config State with Persistence and Migration
  const [aiConfig, setAiConfig] = useState<AiConfig>(DEFAULT_AI_CONFIG);
  const [hydrated, setHydrated] = useState(false);
  const { isLoggedIn, userId, serverUrl, login, logout } = useLoginStatus();
  const skipNextSync = useRef<string | null>(null);

  // New Exercise Creation State
  const [pendingExercise, setPendingExercise] = useState<Exercise | null>(null);
  const [isDragEnded, setIsDragEnded] = useState(false);

  // Initialize Sync Service
  useEffect(() => {
    SyncService.init();
    ExerciseLibraryService.init();
    // 动作建议缓存：online/可见性/history-updated 触发后台批量刷新
    SuggestionService.init();

    // WebSocket auto-connects on import, no manual connect needed

    // Listen for remote updates
    const onRemoteUpdate = () => {
        loadHistory().then(h => {
            if (h && Array.isArray(h)) {
              if (h.length > 0) {
                  skipNextSync.current = h[0].id; // Mark the newest ID as remote
              }
              const normalized = h.map(item => ({
                pausedDuration: 0,
                status: 'finished',
                ...item
              }));
              setHistory(normalized as any);
            }
        });
    };
    window.addEventListener('history-updated', onRemoteUpdate);
    return () => window.removeEventListener('history-updated', onRemoteUpdate);
  }, []);

  // Save history on change (only after hydration)
  useEffect(() => {
    if (!hydrated) return;
    saveHistory(history as any);
    
    // Trigger sync for new items
    if (history.length > 0) {
        const latest = history[0];
        if (skipNextSync.current === latest.id) {
            console.log('[App] Skipping sync trigger for remote update:', latest.id);
            skipNextSync.current = null;
            return;
        }
        
        SyncService.enqueue(latest.id);
    }
  }, [history]);

  // Save AI config on change (only after hydration)
  useEffect(() => {
    if (!hydrated) return;
    saveAiConfig(aiConfig as any);
  }, [aiConfig]);

  // Update History Summary Context when history changes (Simple Autopilot)
  // [NOTE] We are keeping this "code compression" as a fallback, 
  // but user can now trigger "AI Summary" via the modal for better results.
  // We won't auto-trigger AI here to save cost unless requested.
  useEffect(() => {
     if (history.length > 0) {
         const recent = history.slice(0, 3);
         const summary = recent.map(s => {
             const d = new Date(s.startTime).toLocaleDateString();
             const m = s.exercises.map(e => e.name).join(", ");
             return `[${d}]: ${m}`;
         }).join("\n");
         
         // Only update if different to avoid loop
         if (summary !== aiConfig.context.historySummary) {
             setAiConfig(prev => ({
                 ...prev,
                 context: { ...prev.context, historySummary: summary }
             }));
         }
     }
  }, [history]); 

  useEffect(() => {
    (async () => {
      // Phase 0: Migrate legacy login data to IDB
      await migrateLegacyLoginData();

      await requestPersist();
      const savedHistory = await loadHistory();
      if (savedHistory && Array.isArray(savedHistory)) {
        setHistory(savedHistory as any);
      }
      const savedCfg = await loadAiConfig();
      if (savedCfg) {
        const parsed = savedCfg;
        if (parsed.context && parsed.context.coreSystem && !parsed.context.systemPrompts) {
          setAiConfig({
            ...DEFAULT_AI_CONFIG,
            ...parsed,
            context: {
              ...parsed.context,
              systemPrompts: {
                [AiScenario.CHAT]: parsed.context.coreSystem,
                [AiScenario.PLAN]: parsed.context.coreSystem,
                [AiScenario.CARD]: parsed.context.coreSystem,
                [AiScenario.CALC]: parsed.context.coreSystem,
                [AiScenario.IMAGE]: parsed.context.coreSystem
              },
              coreSystem: undefined
            }
          });
        } else {
          const merged = { ...DEFAULT_AI_CONFIG, ...parsed };
          if (merged.models && !merged.models[AiScenario.IMAGE]) {
            merged.models[AiScenario.IMAGE] = DEFAULT_AI_CONFIG.models[AiScenario.IMAGE];
          }
          setAiConfig(merged);
        }
      }

      // [FIX] Check for pending summary
      const pending = await hasPendingSummary();
      if (pending) {
        // Find the last finished session in history to resume summary
        const lastSession = savedHistory?.find(s => s.status === 'finished');
        if (lastSession) {
          // [FIX] 直接重置而不是恢复，避免新旧结算系统冲突
          // 如果用户真的想看历史训练，可以从历史记录页面进入
          setSession({ id: uuidv4(), startTime: 0, pausedDuration: 0, status: 'idle', exercises: [] });
          // 清除pending标记
          setPendingSummary(false).catch(console.error);
          showToast("检测到未完成的训练总结，已自动清除。如需查看训练记录，请从历史记录页面进入。");
        }
      }

      setHydrated(true);
    })();
  }, []);

  // Fetch load anchors when training starts
  useEffect(() => {
    if (session.status === 'active' && isLoggedIn && userId) {
      console.log('[App] Training started, fetching load anchors for user:', userId);
      UserProfileService.getLoadAnchors(userId).then(anchors => {
        console.log('[App] Load anchors fetched:', anchors);
        setLoadAnchors(anchors);
      }).catch(err => {
        console.error('[App] Failed to fetch load anchors:', err);
        setLoadAnchors({});
      });
    }
  }, [session.status, isLoggedIn, userId]);

  // Invalidate load anchors cache when training finishes
  useEffect(() => {
    if (session.status === 'finished' && userId) {
      console.log('[App] Training finished, invalidating load anchors cache for user:', userId);
      UserProfileService.invalidateCache(userId).catch(err => {
        console.error('[App] Failed to invalidate load anchors cache:', err);
      });
    }
  }, [session.status, userId]);

  // 灵动岛 Live Activity：训练计时同步到系统胶囊（退桌面/锁屏可见，系统跳秒）
  // 全部静默降级：Web/Android/未授权 → no-op。等 hydrated 后再动作，避免冷启动恢复草稿期间误报。
  useEffect(() => {
    if (!hydrated) return;
    if (session.status === 'active') {
      startLiveActivity(session.id, session.startTime + session.pausedDuration);
    } else if (session.status === 'paused') {
      pauseLiveActivity(session.pauseStartTime ?? Date.now());
    } else {
      endLiveActivity();
    }
  }, [hydrated, session.status, session.id, session.startTime, session.pausedDuration, session.pauseStartTime]);

  const dateKey = new Date().toISOString().slice(0,10);
  const throttledSaveRef = useRef<any>(null);
  const sessionRef = useRef<Session>(session);
  const dateKeyRef = useRef<string>(dateKey);
  useEffect(() => {
    clearTimeout(throttledSaveRef.current);
    throttledSaveRef.current = setTimeout(() => {
      const draft = {
        id: session.id,
        date: dateKey,
        items: session.exercises,
        lastUpdatedAt: Date.now()
      };
      saveWorkoutDraft(dateKey, draft);
      if (hydrated) saveActiveSession(session as any);
    }, 500);
  }, [session, dateKey]);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  useEffect(() => {
    dateKeyRef.current = dateKey;
  }, [dateKey]);
  useEffect(() => {
    const flush = () => {
      const s = sessionRef.current;
      const dk = dateKeyRef.current;
      const draft = {
        id: s.id,
        date: dk,
        items: s.exercises,
        lastUpdatedAt: Date.now()
      };
      saveWorkoutDraft(dk, draft);
      saveActiveSession(s as any);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    const onPageHide = () => flush();
    const onFreeze = () => flush();
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);
    (document as any).addEventListener('freeze', onFreeze);
    (async () => {
      const persisted = await loadActiveSession();
      if (persisted && persisted.id && typeof persisted.startTime === 'number') {
        setSession(prev => ({ ...prev, ...persisted }));
      }
      const draft = await loadWorkoutDraft(dateKey);
      if (draft && draft.items && Array.isArray(draft.items) && draft.items.length > 0) {
        setSession(prev => ({ ...prev, exercises: draft.items as any }));
      }
      const storedNextPlan = await loadNextPlan();
      if (storedNextPlan && Array.isArray(storedNextPlan) && storedNextPlan.length > 0) {
        setNextPlan(storedNextPlan);
      }
    })();
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
      (document as any).removeEventListener('freeze', onFreeze);
    };
  }, []);

  const [isTransitioning, setIsTransitioning] = useState(false);
  // [nav-state-machine] screen 层（home/history/settings/history-detail/settlement）由
  // navigationReducer 统一承载；currentRoute/viewHistorySession 为下方派生的兼容层，
  // 供既有渲染分支与 effect 继续使用。AI 浮层仍由 useAICoach hook 自治（内部含自动打开逻辑）。
  const [navigation, dispatchNav] = useReducer(navigationReducer, initialNavigation);
  const currentRoute: AppRoute =
    navigation.screen === 'settings' ? AppRoute.SETTINGS
    : navigation.screen === 'history' || navigation.screen === 'history-detail' ? AppRoute.HISTORY
    : navigation.screen === 'settlement' ? AppRoute.SETTLEMENT
    : AppRoute.HOME;
  const viewHistorySession: Session | null =
    navigation.screen === 'history-detail'
      ? history.find(s => s.id === navigation.sessionId) ?? null
      : null;
  const [transitionOrigin, setTransitionOrigin] = useState<{ x: number, y: number } | null>(null);

  // Overlays
  const [showSettingsId, setShowSettingsId] = useState<string | null>(null);
  const [showTimeEditor, setShowTimeEditor] = useState(false);
 
  const [tutorialExerciseId, setTutorialExerciseId] = useState<string | null>(null);
  const [nextPlan, setNextPlan] = useState<any[] | null>(null);
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [toast, setToast] = useState<{ msg: string; visible: boolean }>({ msg: '', visible: false });
  const lastBackPressRef = useRef<number>(0);

  // Reorder Mode State
  const [reorderMode, setReorderMode] = useState<{ 
      exerciseId: string; 
      exerciseName: string; 
      currentIndex: number;
      currentPointer?: { x: number; y: number };
      isDropping?: boolean;
  } | null>(null);

  useEffect(() => {
    console.log('reorderMode state changed:', reorderMode);
  }, [reorderMode]);

  const showToast = useCallback((msg: string) => {
    setToast({ msg, visible: true });
    setTimeout(() => setToast(prev => ({ ...prev, visible: false })), 2000);
    console.log(`[TOAST]: ${msg}`);
  }, []);

  // Overscroll Elasticity (Apple-style rubber-band)
  // 拖动时 1:1 橡筋阻尼跟随（越拉越紧、有上限，不露灰底）；松手后弹簧回弹。
  const overscrollY = useMotionValue(0);
  const RUBBER_BAND_MAX = 70; // 位移上限（px）
  // 标准 iOS rubber-band 曲线：limit + (1 - 1/(x/limit + 1)) * limit，渐进逼近上限
  const rubberBand = (x: number): number => {
    const sign = Math.sign(x);
    const v = Math.abs(x);
    return sign * (RUBBER_BAND_MAX * (1 - 1 / (v / RUBBER_BAND_MAX + 1)));
  };

  const startTouchY = useRef(0);
  const lastTouchY = useRef(0);
  const lastTouchTime = useRef(0);
  const isAtTop = useRef(false);
  const isAtBottom = useRef(false);
  // 惯性滚动监控（scroll 事件）：手指抬起后页面靠惯性滚动，冲到边缘的瞬间
  // 若速度够快则播一次 bounce（「到边了」的弹力提示），硬停变弹回。
  const lastScrollPos = useRef(0);
  const lastScrollTime = useRef(0);
  const scrollVelocity = useRef(0); // px/s，正=向下
  const bounceCooldownUntil = useRef(0); // 防重复触发
  const inMomentumBounce = useRef(false); // 动量 bounce 进行中（抑制速度污染）

  const handleOverscrollTouchStart = (e: React.TouchEvent) => {
    if (currentRoute !== AppRoute.HOME || isAiOverlayOpen || showSettingsId || tutorialExerciseId || reorderMode) return;
    // 新触摸：终止进行中的动量 bounce（把控制权还给手指）
    if (inMomentumBounce.current) {
      overscrollY.stop();
      overscrollY.set(0);
      inMomentumBounce.current = false;
    }
    const scrollTop = window.scrollY;
    const scrollHeight = document.documentElement.scrollHeight;
    const clientHeight = window.innerHeight;
    isAtTop.current = scrollTop <= 2;
    isAtBottom.current = scrollTop + clientHeight >= scrollHeight - 10;
    startTouchY.current = e.touches[0].pageY;
    lastTouchY.current = e.touches[0].pageY;
    lastTouchTime.current = performance.now();
  };

  const handleOverscrollTouchMove = (e: React.TouchEvent) => {
    if (currentRoute !== AppRoute.HOME || isAiOverlayOpen || showSettingsId || tutorialExerciseId || reorderMode) return;
    const currentY = e.touches[0].pageY;
    const deltaY = currentY - startTouchY.current;
    if ((isAtTop.current && deltaY > 0) || (isAtBottom.current && deltaY < 0)) {
      overscrollY.set(rubberBand(deltaY));
    } else {
      overscrollY.set(0);
    }
  };

  const handleOverscrollTouchEnd = () => {
    if (overscrollY.get() !== 0) {
      // 拖拽释放：Apple 标准 spring（响应快、微过冲一次）
      animate(overscrollY, 0, { type: 'spring', stiffness: 400, damping: 34, mass: 0.9 });
    }
    // 手指抬起后进入惯性滚动阶段：armed，让 scroll 监听开始测速
    lastScrollPos.current = window.scrollY;
    lastScrollTime.current = performance.now();
    scrollVelocity.current = 0;
  };

  const buildExercisesFromPlan = (planData: any[]): Exercise[] => {
    console.log('[buildExercisesFromPlan] Input planData:', planData);
    console.log('[buildExercisesFromPlan] First item keys:', planData[0] ? Object.keys(planData[0]) : 'no items');
    console.log('[buildExercisesFromPlan] First item exercise_type:', planData[0]?.exercise_type);

    return planData.map(ex => {
      const setsCount = ex.sets || 1;
      const reps = ex.reps || 0;
      const weight = ex.weight || 0;
      // Use NanoID format (id field) from MAS
      const exerciseId = ex.id || ex.exerciseId || ex.name;
      // Get exercise_type from backend (maps to frontend 'type' field)
      const exerciseType = ex.exercise_type || ex.exerciseType || ex.type || 'resistance';

      console.log(`[buildExercisesFromPlan] Exercise "${ex.name}" -> type: "${exerciseType}" (sources: exercise_type="${ex.exercise_type}", exerciseType="${ex.exerciseType}", type="${ex.type}")`);

      const exerciseSets: ExerciseSet[] = [];
      for (let i = 0; i < setsCount; i++) {
        exerciseSets.push({
          id: uuidv4(),
          reps,
          weight,
          duration: 0, // 初始实际时长为 0
          distance: 0,
          targetDuration: ex.duration, // 保存目标时长
          targetDistance: ex.distance, // 保存目标距离
          completed: false
        } as any);
      }

      return {
        id: uuidv4(),
        libraryId: exerciseId,   // @deprecated - use id instead
        name: ex.name || '未知动作',
        sets: exerciseSets,
        type: exerciseType,  // Use exercise_type from backend (snake_case → camelCase)
        targetRpe: ex.targetRpe || 7,
        referenceBodyweight: ex.referenceBodyweight,
        metadata: {
          name: ex.name,
          libraryId: exerciseId,  // @deprecated
          id: exerciseId,         // NanoID format
          targetDuration: ex.duration,
          targetDistance: ex.distance
        }
      } as Exercise;
    });
  };

  const handleConfirmPlan = (planData: any[], mode: 'append' | 'replace') => {
    const safePlan = Array.isArray(planData) ? planData : [];
    const newExercises = buildExercisesFromPlan(safePlan);

    if (session.status === 'finished') {
      setNextPlan(prev => {
        const merged = mode === 'append' && prev && prev.length > 0 ? [...prev, ...safePlan] : safePlan;
        saveNextPlan(merged).catch(console.error);
        const tomorrow = new Date(Date.now() + 86400000);
        const d = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth()+1).padStart(2,'0')}-${String(tomorrow.getDate()).padStart(2,'0')}`;
        saveDayPlan(d, merged).catch(console.error);
        window.dispatchEvent(new CustomEvent('starfit:dayplans-changed'));
        return merged;
      });
      showToast(mode === 'replace' ? `已保存为明日训练计划 (${newExercises.length} 个动作)` : `已将动作追加到明日训练计划 (${newExercises.length} 个动作)`);
      return;
    }

    setSession(prev => ({
      ...prev,
      exercises: mode === 'replace' ? newExercises : [...prev.exercises, ...newExercises]
    }));

    showToast(mode === 'replace' ? `已覆盖为新的训练计划 (${newExercises.length} 个动作)` : `已追加 ${newExercises.length} 个动作`);
  };

  const {
      isAiOverlayOpen,
      setIsAiOverlayOpen,
      isPlanMode,
      setIsPlanMode,
      chatMessage,
      setChatMessage,
      chatHistory,
      isLoading,
      handleChatSubmit,
      handleConfirmPlan: handleAiConfirmPlan,
      openAiCoach,
      chatEndRef,
      textareaRef,
      attachedContext,
      setAttachedContext,
      // [NEW] Thread management
      threads,
      currentThreadId,
      showHistoryPanel,
      setShowHistoryPanel,
      createNewThread,
      switchToThread,
      formatRelativeTime
  } = useAICoach(session, handleConfirmPlan);

  // ===== 3 页签导航（历史 / 开始运动 / AI Agent，默认中间）=====
  const [mainTab, setMainTab] = useState<MainTab>(1);
  const mainTabRef = useRef(mainTab);
  mainTabRef.current = mainTab;

  /** Tab 选择 → 路由切换。运动页签=回到主页；历史/AI=对应路由。 */
  const handleTabSelect = useCallback((tab: MainTab) => {
    setMainTab(tab);
    if (tab === 1) {
      // 回运动主页（关历史详情/AI 浮层）
      if (viewHistorySession) dispatchNav({ type: 'BACK' });
      else if (currentRoute === AppRoute.HISTORY || currentRoute === AppRoute.SETTINGS) dispatchNav({ type: 'HOME' });
      if (isAiOverlayOpen) setIsAiOverlayOpen(false);
      return;
    }
    if (tab === 0) {
      if (isAiOverlayOpen) setIsAiOverlayOpen(false);
      setTransitionOrigin(null);
      dispatchNav({ type: 'OPEN_HISTORY' });
      return;
    }
    if (tab === 2) {
      // AI Agent 页签 → 打开 AI 浮层（浮层为 sheet：盖住 tab bar）
      if (viewHistorySession) dispatchNav({ type: 'BACK' });
      else if (currentRoute === AppRoute.HISTORY || currentRoute === AppRoute.SETTINGS) dispatchNav({ type: 'HOME' });
      setTransitionOrigin(null);
      openAiCoach();
      return;
    }
}, [currentRoute, isAiOverlayOpen, viewHistorySession, openAiCoach]);

  // 挂全局 scroll 监听（惯性阶段 touch 事件已全部结束，只有 scroll 能观测到滚动）：
  // 惯性滚动冲到边缘的瞬间若速度够快，播一次 bounce（「到边了」的弹力提示），硬停变弹回。
  useEffect(() => {
    const onScroll = () => {
      if (currentRoute !== AppRoute.HOME || isAiOverlayOpen || showSettingsId || tutorialExerciseId || reorderMode) return;
      if (overscrollY.get() !== 0 && !inMomentumBounce.current) return; // 拖拽 rubber-band 中，别捣乱
      const now = performance.now();
      const pos = window.scrollY;
      const dt = now - lastScrollTime.current;
      // 测速：只采纳朝当前滚动方向的位移样本。撞边后浏览器把 scrollY 钳在 0/最大值，
      // 会补发 v≈0 的 scroll 事件——若采纳会把速度估计迅速稀释成 0（触发变弱/失效）。
      if (dt > 0 && dt < 120) {
        const raw = (pos - lastScrollPos.current) / dt * 1000;
        const v = scrollVelocity.current;
        if (raw === 0 || raw * v >= 0) { // 静止样本不稀释；反向样本（新的滚动）直接采纳
          scrollVelocity.current = v * 0.6 + raw * 0.4;
        } else if (Math.abs(raw) > 300) {
          scrollVelocity.current = raw;
        }
      }
      lastScrollPos.current = pos;
      lastScrollTime.current = now;

      const scrollHeight = document.documentElement.scrollHeight;
      const clientHeight = window.innerHeight;
      const v = scrollVelocity.current;
      const cooled = now >= bounceCooldownUntil.current;
      // 符号约定：scroll 速度 v 正 = scrollY 增大 = 页面向下滚（冲向底部）。
      // 手指快速下拉 → scrollY 减小 → v 为负 → 惯性冲向顶部。
      const hitTop = pos <= 0 && v < -400;
      const hitBottom = pos + clientHeight >= scrollHeight - 1 && v > 400;
      if (cooled && (hitTop || hitBottom)) {
        bounceCooldownUntil.current = now + 900;
        const impact = Math.abs(v);
        const dir = hitTop ? 1 : -1; // 顶部内容往下弹，底部内容往上弹
        scrollVelocity.current = 0;
        inMomentumBounce.current = true;
        // 动量连续的 bounce：把撞边瞬间的滚动速度作为初速度注入阻尼弹簧，
        // 内容带着惯性自然冲出→减速→弹回，全程速度连续，无「硬停再起步」断崖。
        // 物理：x'' = (-k·x - c·x')/m，x(0)=0，x'(0)=撞边速度（换算到像素幅度）。
        const v0 = dir * Math.min(impact * 0.4, 1400); // 初速度 px/s（与冲量成正比，封顶防爆）
        animate(overscrollY, 0, {
          type: 'spring',
          stiffness: 170,   // k：偏软，冲得出去
          damping: 18,      // c：欠阻尼 ζ≈0.69，冲出后自然回弹一次半
          mass: 1,
          velocity: v0,     // ← 关键：初速度 = 撞边动能，动画从运动中接棒而非从静止起步
        }).then(() => {
          inMomentumBounce.current = false;
        });
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [currentRoute, isAiOverlayOpen, showSettingsId, tutorialExerciseId, reorderMode]);

  // 路由侧变化反向同步 tab 高亮（结算完成回主页等场景）
  useEffect(() => {
    if (currentRoute === AppRoute.SETTLEMENT) return;
    if (currentRoute === AppRoute.HISTORY || viewHistorySession) { if (mainTabRef.current !== 0) setMainTab(0); return; }
    // AI 浮层打开 = AI 页签高亮；关闭回运动页
    if (isAiOverlayOpen) { if (mainTabRef.current !== 2) setMainTab(2); return; }
    if (mainTabRef.current !== 1) setMainTab(1);
  }, [currentRoute, viewHistorySession, isAiOverlayOpen]);

  // Back button handler for Android
  useEffect(() => {
    const handleBack = async () => {
      // [NEW] Allow child components to intercept back button via custom event
      const backEvent = new CustomEvent('starfit-back-button', { cancelable: true });
      window.dispatchEvent(backEvent);
      if (backEvent.defaultPrevented) {
        console.log('[App] Back button intercepted by child component');
        return;
      }

      // Priority: Highest to Lowest (Modal stack)
      if (reorderMode) {
        setReorderMode(null);
      } else if (isLibraryOpen) {
        setIsLibraryOpen(false);
      } else if (tutorialExerciseId) {
        setTutorialExerciseId(null);
      } else if (showSettingsId || pendingExercise) {
        setShowSettingsId(null);
        setPendingExercise(null);
      } else if (isAiOverlayOpen) {
        setIsAiOverlayOpen(false);
        // [FIX] Thread-based system auto-saves, no need to clear
        if (session.status === 'finished') {
            setSession({ id: uuidv4(), startTime: 0, pausedDuration: 0, status: 'idle', exercises: [] });
            dispatchNav({ type: 'HOME' });
            setPendingSummary(false).catch(console.error);
        }
      } else if (showTimeEditor) {
        setShowTimeEditor(false);
      } else if (viewHistorySession) {
        dispatchNav({ type: 'BACK' });
      } else if (currentRoute !== AppRoute.HOME) {
        dispatchNav({ type: 'BACK' });
      } else {
        // We are on HOME screen
        const now = Date.now();
        if (now - lastBackPressRef.current < 2000) {
          CapacitorApp.exitApp();
        } else {
          lastBackPressRef.current = now;
          showToast("再按一次退出应用");
        }
      }
    };

    const backListener = CapacitorApp.addListener('backButton', () => {
      handleBack();
    });

    return () => {
      backListener.then(l => l.remove());
    };
  }, [
    reorderMode,
    isLibraryOpen,
    tutorialExerciseId,
    showSettingsId,
    pendingExercise,
    isAiOverlayOpen,
    viewHistorySession,
    currentRoute,
    showTimeEditor,
    session.status,
    showToast
  ]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleChatSubmit();
    }
  };

  const handleStartSession = () => {
    haptic('medium'); // 主操作：开始训练
    // If no exercises, clicking START should trigger adding an exercise instead of starting the timer
    if (session.exercises.length === 0) {
      handleAddSingleExercise();
      return;
    }

    if (session.status === 'idle' || session.status === 'finished') {
      setSession(prev => ({
        ...prev,
        id: uuidv4(),
        startTime: Date.now(),
        pausedDuration: 0, // Reset pause duration on start
        status: 'active',
        exercises: prev.exercises
      }));
      haptic('medium'); // 开始训练：主操作触感
    }
  };

  const handlePauseSession = () => {
    if (session.status === 'active') {
        const now = Date.now();
        setSession(prev => ({ ...prev, status: 'paused', pauseStartTime: now }));
        haptic('light'); // 暂停：轻触感
    }
  };

  const handleResumeSession = () => {
    if (session.status === 'paused') {
        const now = Date.now();
        // 计算本次暂停的持续时间并累加到 pausedDuration
        const pauseDuration = session.pauseStartTime ? now - session.pauseStartTime : 0;
        
        // 调整所有正在休息的组的 restEndTime，使其在恢复后继续计时
        const updatedExercises = session.exercises.map(ex => ({
            ...ex,
            sets: ex.sets.map((s: ExerciseSet) => {
                if (s.restEndTime && s.restEndTime > (session.pauseStartTime || now)) {
                    return {
                        ...s,
                        restEndTime: s.restEndTime + pauseDuration
                    };
                }
                return s;
            })
        }));

        setSession(prev => ({
            ...prev,
            status: 'active',
            pausedDuration: prev.pausedDuration + pauseDuration,
            pauseStartTime: undefined, // 清除暂停开始时间
            exercises: updatedExercises
        }));
    }
  };

  const handleManualTimeConfirm = (newDurationMs: number) => {
    const now = Date.now();
    const newPausedDuration = now - session.startTime - newDurationMs;
    setSession(prev => ({ ...prev, pausedDuration: newPausedDuration, pauseStartTime: undefined, status: 'idle' }));
    setTimeout(() => {
        setSession(prev => ({ ...prev, status: 'paused' }));
        setShowTimeEditor(false);
    }, 0);
  };

  const handleAddSingleExercise = () => {
    // Create placeholder exercise - user must select from library
    const newEx: Exercise = {
        id: '', // Empty id until user selects from library
        libraryId: '',
        name: '', // Empty name triggers auto-open library in modal
        type: 'resistance',
        sets: [{id: uuidv4(), reps: 10, weight: 0, completed: false}],
        targetRpe: 8,
        unilateral: false
    }
    setPendingExercise(newEx);
    setIsLibraryOpen(true);
  };

  const handleImportNextPlan = () => {
    if (!nextPlan || !Array.isArray(nextPlan) || nextPlan.length === 0) {
      showToast("暂无可导入的计划");
      return;
    }
    const newExercises = buildExercisesFromPlan(nextPlan);
    setSession({
      id: uuidv4(),
      startTime: 0,
      pausedDuration: 0,
      status: 'idle',
      exercises: newExercises
    });
    clearNextPlan().catch(console.error);
    setNextPlan(null);
    showToast(`已导入计划 (${newExercises.length} 个动作)`);
  };

  const handleUpdateSet = (exId: string, setId: string, updates: Partial<ExerciseSet>) => {
    // [AUTO-RESUME] 如果当前是暂停或未开始状态，且有动作更新（特别是静力动作计时或完成状态），则自动恢复/开始
    if (session.status === 'paused') {
      handleResumeSession();
    } else if (session.status === 'idle') {
      handleStartSession();
    }

    // [TRACKING] Weight Correction
    if (updates.weight !== undefined) {
      const ex = session.exercises.find(e => e.id === exId);
      const oldSet = ex?.sets.find(s => s.id === setId);
      if (oldSet && oldSet.weight !== updates.weight) {
        eventTracking.track(TrackingEvent.CORRECTION_WEIGHT, {
          exerciseName: ex?.name,
          oldWeight: oldSet.weight,
          newWeight: updates.weight
        });
      }
    }

    setSession(prev => {
      const updatedExercises = prev.exercises.map(ex => {
        if (ex.id === exId) {
          const updatedSets = ex.sets.map(s => {
            if (s.id === setId) {
              const newSet = { ...s, ...updates };

              // 当完成一个组时，设置该组的休息结束时间
              if (updates.completed === true && !s.completed) {
                const now = Date.now();
                const DEFAULT_REST_TIME = 60; // 默认60秒
                const restSecs = DEFAULT_REST_TIME;
                newSet.restEndTime = now + restSecs * 1000;
              }
              // 当取消完成时，清除休息时间
              else if (updates.completed === false) {
                newSet.restEndTime = undefined;
              }

              return newSet;
            }
            return s;
          });
          return { ...ex, sets: updatedSets };
        }
        return ex;
      });
      return { ...prev, exercises: updatedExercises };
    });
  };

  const handleUpdateExerciseSettings = (exId: string, updates: Partial<Exercise> | Partial<ExerciseAction>) => {
    setSession(prev => {
      const updatedExercises: Exercise[] = prev.exercises.map(ex => {
        if (ex.id !== exId) {
          return ex;
        }

        if ('exerciseId' in updates) {
          const actionUpdates = updates as Partial<ExerciseAction>;
          const newSets = convertActionSetsToExerciseSets(actionUpdates.sets, ex.sets);
          const updatedExercise = {
            ...ex,
            name: actionUpdates.metadata?.name ?? ex.name,
            type: (actionUpdates.type as ExerciseType) || actionUpdates.metadata?.originalType || ex.type,
            sets: newSets,
            targetRpe: actionUpdates.metadata?.targetRpe,
            referenceBodyweight: actionUpdates.metadata?.referenceBodyweight,
            metadata: actionUpdates.metadata
          } as Exercise;
          return updatedExercise;
        }

        return { ...ex, ...updates } as Exercise;
      });

      return { ...prev, exercises: updatedExercises };
    });
  };

  const handleDeleteExercise = (exId: string) => {
      const ex = session.exercises.find(e => e.id === exId);
      eventTracking.track(TrackingEvent.CORRECTION_EXERCISE, {
        action: 'delete',
        exerciseName: ex?.name
      });
      setSession(prev => ({
          ...prev,
          exercises: prev.exercises.filter(ex => ex.id !== exId)
      }));
      showToast("已删除动作");
  };

  const handleReorderExercise = (targetIndex: number) => {
      if (!reorderMode) return;
      const currentIndex = reorderMode.currentIndex;
      if (currentIndex === targetIndex) {
          setReorderMode(null);
          return;
      }

      setSession(prev => {
          const newExercises = [...prev.exercises];
          const [movedExercise] = newExercises.splice(currentIndex, 1);
          newExercises.splice(targetIndex, 0, movedExercise);
          return { ...prev, exercises: newExercises };
      });

      setReorderMode(null);
      showToast("已调整顺序");
  };
 
  const handleDeleteSession = (sessionId: string) => {
      setHistory(prev => prev.filter(s => s.id !== sessionId));
      // Sync deletion to server
      SyncService.enqueueDeletion(sessionId);
      showToast("已删除历史记录");
  };

  const handleReuseSession = (pastSession: Session) => {
      if (!pastSession) return;

      const newExercises: Exercise[] = pastSession.exercises.map(ex => ({
          ...ex,
          id: uuidv4(), // Generate new ID
          sets: ex.sets.map(s => ({
              ...s,
              id: uuidv4(), // Generate new Set ID
              completed: false, // Reset completion status
              rpe: undefined // Clear logged RPE
          }))
      }));

      setSession({
          id: uuidv4(),
          startTime: Date.now(), // Reset time implies starting fresh or idle
          pausedDuration: 0,
          status: 'idle', // Start as idle so user can review before starting
          exercises: newExercises
      });

      dispatchNav({ type: 'HOME' });
      showToast("已复用训练计划");
  };

  /**
   * Calculate workout statistics from exercises
   * Returns total volume (kg), completed sets count, and optional average heart rate
   */
  // [unified-stats] 训练完成统计与 Settlement 展示共用 settlementSummary 纯函数口径
  // （isometric 无配重走 referenceBodyweight 兜底，取代旧硬编码 75kg；外场 isometric 误判 bug 一并消除）
  const calculateWorkoutStats = useCallback((exercises: Exercise[]): {
    totalVolume: number;
    setsCount: number;
    avgHr?: number;
  } => {
    const { totalVolume, totalSets, avgHr } = computeSettlementSummary(exercises);
    return { totalVolume, setsCount: totalSets, avgHr };
  }, []);

  /**
   * Detect training anomalies for personalized question generation
   * Identifies weight adjustments, incomplete sets, form issues, and pain reports
   */
  const detectTrainingAnomalies = (exercises: Exercise[]): {
    weightAdjustments: string[];
    incompleteSets: string[];
    formIssues: string[];
    painReported: boolean;
  } => {
    const anomalies = {
      weightAdjustments: [] as string[],
      incompleteSets: [] as string[],
      formIssues: [] as string[],
      painReported: false
    };

    exercises.forEach(ex => {
      // Detect weight adjustments (different weights across sets)
      const weights = new Set(ex.sets.map((s: any) => s.weight));
      if (weights.size > 1) {
        anomalies.weightAdjustments.push(ex.name);
      }

      // Detect incomplete sets
      const incompleteSets = ex.sets.filter((s: any) => !s.completed);
      if (incompleteSets.length > 0) {
        anomalies.incompleteSets.push(ex.name);
      }

      // TODO: Detect form issues from user notes
      // - Keywords: "借力", "不标准", "姿势", "调整"
      // - This requires analyzing user notes when notes are implemented

      // TODO: Detect pain reports from user notes
      // - Keywords: "疼痛", "不适", "酸", "疼"
    });

    return anomalies;
  };

  const handleEndSession = () => {
    console.log('[App] handleEndSession called');
    const finishedSession: Session = { ...session, status: 'finished', endTime: Date.now() };

    // [TRACKING] Session Finished
    eventTracking.track(TrackingEvent.HITL_RESPONSE, {
      type: 'session_finished',
      exerciseCount: session.exercises.length,
      duration: finishedSession.endTime! - finishedSession.startTime
    });

    // 1. Calculate local stats immediately
    const stats = calculateWorkoutStats(session.exercises);
    // Fix: Subtract pausedDuration to get actual workout time (not including pauses)
    const durationMinutes = Math.floor((finishedSession.endTime! - finishedSession.startTime - finishedSession.pausedDuration) / 60000);

    console.log('[App] Stats calculated:', stats, 'duration:', durationMinutes);

    // 2. Detect training anomalies for personalized questions
    const trainingAnomalies = detectTrainingAnomalies(session.exercises);

    console.log('[App] Training anomalies:', trainingAnomalies);

    // 3. Build local SUMMARY_CARD data (for quick display while Agent processes)
    const localSummaryData = {
      startTime: session.startTime,
      endTime: finishedSession.endTime,
      pausedDuration: finishedSession.pausedDuration,
      stats: {
        totalVolume: stats.totalVolume,
        setsCount: stats.setsCount,
        durationMinutes,
        avgHr: stats.avgHr
      },
      exercises: session.exercises,  // raw sets preserved; useAICoach pre-formats via workoutSummary
      anomalies: trainingAnomalies
    };

    console.log('[App] localSummaryData:', localSummaryData);

    setHistory(prev => [finishedSession, ...prev]);
    setSession(finishedSession);

    // Close Settlement route to prevent z-index conflict with AICoachOverlay
    dispatchNav({ type: 'HOME' });

    // 4. [Phase 1] Session persistence is owned by useAICoach (openAiCoach →
    // workout_complete). It POSTs the pre-formatted payload (workoutSummary)
    // with the X-User-Id header — do NOT also POST here (double-persist bug).

    // 训练结束 → 锚点/历史变化 → 建议缓存失效（在线时后台自动重算）
    SuggestionService.invalidate().catch(console.error);

    // 5. [Phase 2] Trigger Agent analysis (Agent reads from DB via load_history)
    console.log('[App] Calling openAiCoach with:', {
      type: 'workout_complete',
      sessionId: session.id
    });

    openAiCoach({
      type: 'workout_complete',
      sessionId: session.id,
      data: localSummaryData
    });

    // [NEW] Set pending summary flag to resume if app closes
    setPendingSummary(true).catch(console.error);
  };

  const handleImportHistory = (importedSessions: Session[]) => {
      const historyMap = new Map<string, Session>();
      history.forEach(s => historyMap.set(s.id, s));
      let addedCount = 0;
      importedSessions.forEach(s => {
          if (s.id && !historyMap.has(s.id)) {
              historyMap.set(s.id, s);
              addedCount++;
          }
      });

      if (addedCount > 0) {
          const merged = Array.from(historyMap.values()).sort((a, b) => b.startTime - a.startTime);
          setHistory(merged);
          alert(`成功导入 ${addedCount} 条新记录！`);
      } else {
          alert("未发现新记录，所有记录已存在。");
      }
  };

  // --- AI Logic ---

  const handleOpenTutorial = (exId: string) => {
    setTutorialExerciseId(exId);
  };

  const handleAskAiFromTutorial = (attachment: any) => {
      setTutorialExerciseId(null);
      if (attachment) {
          // 以附件形式挂入 AI 教练输入区（不自动发送），用户直接输入/补充问题
          setAttachedContext(attachment);
      }
      openAiCoach();
  };

  // --- Renderers ---

  if (!isLoggedIn) {
    return (
      <LoginV2
        onLogin={(userId, serverUrl) => {
          // 使用 useLoginStatus 的 login 方法
          login(userId, serverUrl, serverUrl.replace('http://', '').replace('/api', '').split(':')[0]);
          // Reload to ensure all services use the new config
          window.location.reload();
        }}
      />
    );
  }

  if (currentRoute === AppRoute.SETTLEMENT) {
    return <SettlementV2
        session={session}
        onClose={() => {
            setSession({id: uuidv4(), startTime: 0, pausedDuration: 0, status: 'idle', exercises: []});
            dispatchNav({ type: 'HOME' });
            // [NEW] Clear pending summary flag
            setPendingSummary(false).catch(console.error);
        }}
    />;
  }

  const isSessionActive = session.status === 'active' || session.status === 'paused';

  return (
    <div className={`min-h-screen bg-star-white text-star-dark relative ${isAiOverlayOpen || currentRoute === AppRoute.HISTORY || currentRoute === AppRoute.SETTINGS || viewHistorySession ? 'h-screen overflow-hidden' : 'overflow-x-hidden'}`}>
      <motion.div
        onTouchStart={handleOverscrollTouchStart}
        onTouchMove={handleOverscrollTouchMove}
        onTouchEnd={handleOverscrollTouchEnd}
        animate={{
          filter: (isAiOverlayOpen || currentRoute === AppRoute.HISTORY || currentRoute === AppRoute.SETTINGS || viewHistorySession) ? 'blur(10px)' : 'none',
          opacity: (isAiOverlayOpen || currentRoute === AppRoute.HISTORY || currentRoute === AppRoute.SETTINGS || viewHistorySession || reorderMode) ? 0.6 : 1,
          scale: (isAiOverlayOpen || currentRoute === AppRoute.HISTORY || currentRoute === AppRoute.SETTINGS || viewHistorySession || reorderMode) ? 0.95 : 1,
        }}
        style={{
          y: overscrollY
        }}
        transition={{
          type: 'spring',
          stiffness: 400,
          damping: 38
        }}
        className="relative w-full"
      >
        <div className={`
          px-4 pb-48 max-w-md mx-auto
          ${session.exercises.length === 0 ? 'pt-0' : 'pt-48'} 
        `}>
          <div className="space-y-4">
              {session.exercises.map((ex, index) => (
                  <ExerciseCardV2
                      key={ex.id}
                      exercise={ex}
                      isPaused={session.status === 'paused'}
                      pauseStartTime={session.pauseStartTime}
                      loadAnchors={loadAnchors}
                      onUpdateSet={handleUpdateSet}
                      onOpenSettings={setShowSettingsId}
                      onOpenTutorial={handleOpenTutorial}
                      onDelete={handleDeleteExercise}
                      onLongPress={(exerciseId) => {
                          const exercise = session.exercises.find(e => e.id === exerciseId);
                          if (exercise) {
                              setReorderMode({
                                  exerciseId: exercise.id,
                                  exerciseName: exercise.name,
                                  currentIndex: index,
                                  currentPointer: { x: 0, y: 0 } // Initialize
                              });
                          }
                      }}
                      onDragStatusChange={(status, x, y) => {
                          if (status === 'start') {
                              // Initial position update - triggers render but ensures correct start pos
                              setIsDragEnded(false);
                              setReorderMode(prev => prev ? { ...prev, currentPointer: { x, y } } : null);
                          } else if (status === 'move') {
                              // Performance: Dispatch event instead of state update to avoid App re-render loop
                              window.dispatchEvent(new CustomEvent('reorder-drag-move', { detail: { x, y } }));
                          } else if (status === 'end') {
                              // Signal drop to ReorderMode
                              setIsDragEnded(true);
                              window.dispatchEvent(new CustomEvent('reorder-drag-end', { detail: { x, y } }));
                          }
                      }}
                  />
              ))}
          </div>

          {session.exercises.length > 0 && (
            <div className="mt-8 flex justify-center pb-8">
               <button
                 onClick={handleAddSingleExercise}
                 aria-label="添加动作"
                 className="flex items-center justify-center w-11 h-11 rounded-full bg-gray-200 text-blue-500 active:bg-gray-300 active:scale-95 transition-all group"
               >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4 group-hover:scale-110 transition-transform">
                     <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
               </button>
            </div>
          )}
        </div>
      </motion.div>

      {/* UI Chrome (Fixed Elements) - Separated to prevent drift while maintaining animation */}
      <motion.div
        animate={{
          opacity: (isAiOverlayOpen || currentRoute === AppRoute.HISTORY || currentRoute === AppRoute.SETTINGS || viewHistorySession || reorderMode) ? 0.6 : 1,
          scale: (isAiOverlayOpen || currentRoute === AppRoute.HISTORY || currentRoute === AppRoute.SETTINGS || viewHistorySession || reorderMode) ? 0.95 : 1,
        }}
        transition={{
          type: 'spring',
          stiffness: 600,
          damping: 20,
          mass: 0.6
        }}
        className="fixed inset-0 pointer-events-none z-40"
      >
        <div className="pointer-events-auto contents">
          {/* 设置入口已移至「运动记录」页导航栏 */}

          <TimerCapsule
            status={session.status}
            startTime={session.startTime}
            pausedDuration={session.pausedDuration}
            hasExercises={session.exercises.length > 0}
            onStart={handleStartSession}
            onPause={handlePauseSession}
            onResume={handleResumeSession}
            onOpenManual={() => setShowTimeEditor(true)}
            onEnd={() => handleEndSession()}
          />

          {session.exercises.length === 0 && (
            <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 mt-24 flex flex-col gap-4 items-center">
              {nextPlan && Array.isArray(nextPlan) && nextPlan.length > 0 && (
                <motion.button
                  onClick={handleImportNextPlan}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  whileTap={{ scale: 0.95 }}
                  className="relative group px-8 py-3 rounded-2xl bg-gray-50 hover:bg-gray-100 text-gray-400 hover:text-gray-600 border border-gray-100 overflow-hidden flex items-center gap-3 transition-all duration-300"
                 >
                   {/* Subtle AI Shimmer Effect */}
                   <motion.div
                     animate={{
                       left: ['-100%', '200%'],
                     }}
                     transition={{
                       duration: 4,
                       repeat: Infinity,
                       ease: "linear",
                       repeatDelay: 4
                     }}
                     className="absolute top-0 w-1/2 h-full bg-gradient-to-r from-transparent via-white/40 to-transparent skew-x-[-25deg] pointer-events-none"
                   />
                   
                   {/* AI Sparkle Icon */}
                   <svg className="w-3.5 h-3.5 text-star-accent/60 group-hover:text-star-accent group-hover:rotate-12 transition-all" viewBox="0 0 24 24" fill="currentColor">
                     <path d="M12 2L14.85 9.15L22 12L14.85 14.85L12 22L9.15 14.85L2 12L9.15 9.15L12 2Z" />
                   </svg>
                   
                   <span className="text-[10px] font-black uppercase tracking-[0.2em]">导入计划</span>
                   
                   {/* Arrow */}
                   <motion.svg 
                     xmlns="http://www.w3.org/2000/svg" 
                     fill="none" 
                     viewBox="0 0 24 24" 
                     strokeWidth={3} 
                     stroke="currentColor" 
                     className="w-3.5 h-3.5 opacity-40 group-hover:opacity-60 group-hover:translate-x-0.5 transition-all"
                   >
                     <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                   </motion.svg>
                 </motion.button>
               )}

            </div>
          )}

          <MainTabBar
              tab={mainTab}
              onSelect={handleTabSelect}
              hidden={(currentRoute as AppRoute) === AppRoute.SETTLEMENT || isAiOverlayOpen}
          />
        </div>
      </motion.div>

      <AnimatePresence>
        {(currentRoute === AppRoute.HISTORY || currentRoute === AppRoute.SETTINGS || viewHistorySession || isAiOverlayOpen || pendingExercise || (showSettingsId && session.exercises.find(e => e.id === showSettingsId))) && (
          <motion.div
            initial={{
              opacity: 0,
              scale: 0.9,
            }}
            animate={{
              opacity: 1,
              scale: 1,
            }}
            exit={{
              opacity: 0,
              scale: 0.9,
            }}
            style={{
              transformOrigin: transitionOrigin
                ? `${transitionOrigin.x}px ${transitionOrigin.y}px`
                : 'center bottom',
              willChange: 'transform, opacity',
              overscrollBehavior: 'none'
            }}
            drag={false}
            transition={{
              type: 'tween',
              duration: 0.3,
              ease: 'easeOut'
            }}
            className="fixed inset-0 z-[60] bg-white overflow-hidden"
          >
            {currentRoute === AppRoute.HISTORY && !viewHistorySession && (
              <History
                key="history"
                sessions={history}
                onClose={() => dispatchNav({ type: 'HOME' })}
                onSelect={(s) => dispatchNav({ type: 'OPEN_HISTORY_DETAIL', sessionId: s.id })}
                onImport={handleImportHistory}
                onDelete={handleDeleteSession}
                onOpenSettings={() => dispatchNav({ type: 'OPEN_SETTINGS' })}
              />
            )}

            {currentRoute === AppRoute.SETTINGS && (
              <SettingsPage
                key="settings"
                userId={userId || ''}
                onClose={() => dispatchNav({ type: 'BACK' })}
              />
            )}

            {viewHistorySession && (
              <SettlementV2
                key="settlement"
                session={viewHistorySession}
                onClose={() => dispatchNav({ type: 'BACK' })}
                onReuse={() => handleReuseSession(viewHistorySession)}
              />
            )}

            

            {isAiOverlayOpen && (
              <AICoachOverlay
                isOpen={isAiOverlayOpen}
                onClose={() => {
                  setIsAiOverlayOpen(false);
                  // [FIX] Reset plan mode when closing AI coach overlay
                  setIsPlanMode(false);
                  if (session.status === 'finished') {
                    setSession({ id: uuidv4(), startTime: 0, pausedDuration: 0, status: 'idle', exercises: [] });
                    dispatchNav({ type: 'HOME' });
                    setPendingSummary(false).catch(console.error);
                  }
                }}
                chatHistory={chatHistory}
                chatMessage={chatMessage}
                setChatMessage={setChatMessage}
                isLoading={isLoading}
                isPlanMode={isPlanMode}
                setIsPlanMode={setIsPlanMode}
                handleChatSubmit={handleChatSubmit}
                handleConfirmPlan={handleAiConfirmPlan}
                chatEndRef={chatEndRef}
                textareaRef={textareaRef}
                attachedContext={attachedContext}
                setAttachedContext={setAttachedContext}
                onRemoveAttachment={() => setAttachedContext(null)}
                onViewDetails={() => {
                  if (session.status === 'finished') {
                    dispatchNav({ type: 'OPEN_HISTORY_DETAIL', sessionId: session.id });
                  }
                }}
                sessionStatus={session.status}
                sessionSessionId={session.id}
                // [NEW] Thread management props
                threads={threads}
                currentThreadId={currentThreadId}
                showHistoryPanel={showHistoryPanel}
                setShowHistoryPanel={setShowHistoryPanel}
                onSwitchThread={switchToThread}
                onCreateNewThread={createNewThread}
                formatRelativeTime={formatRelativeTime}
              />
            )}

            {(pendingExercise || (showSettingsId && session.exercises.find(e => e.id === showSettingsId))) && (
              <ExerciseSettingsModal
                  exercise={convertToExerciseAction(pendingExercise || session.exercises.find(e => e.id === showSettingsId) as Exercise)}
                  isCreating={!!pendingExercise}
                  isLibraryOpen={isLibraryOpen}
                  onLibraryOpenChange={setIsLibraryOpen}
                  loadAnchors={loadAnchors}
                  userId={userId}
                  onCancelCreate={() => {
                      // User cancelled exercise selection from library
                      setPendingExercise(null);
                      setIsLibraryOpen(false);
                  }}
                  onClose={() => {
                      setShowSettingsId(null);
                      setPendingExercise(null);
                      setIsLibraryOpen(false);
                  }}
                  onSave={(id, updates) => {
                      if (pendingExercise) {
                          // Convert ExerciseAction updates back to Exercise
                          const actionUpdates = updates as Partial<ExerciseAction>;
                          // Use libraryId from metadata if available (nanoid from exercise library)
                          const exerciseId = actionUpdates.metadata?.libraryId || pendingExercise.id || uuidv4();
                          const finalizedEx: Exercise = {
                            ...pendingExercise,
                            id: exerciseId, // Use the libraryId (nanoid) instead of UUID
                            name: actionUpdates.metadata?.name || pendingExercise.name,
                            type: (actionUpdates.type as ExerciseType) || pendingExercise.type,
                            sets: actionUpdates.sets?.map((s, idx) => ({
                              ...pendingExercise.sets[idx] || { id: uuidv4() },
                              reps: s.reps,
                              weight: s.weight,
                              duration: s.duration,
                              distance: s.distance,
                              rpe: s.rpe,
                              completed: s.status === 'COMPLETED',
                              status: s.status
                            })) || pendingExercise.sets,
                            targetRpe: actionUpdates.metadata?.targetRpe,
                            referenceBodyweight: actionUpdates.metadata?.referenceBodyweight,
                            metadata: actionUpdates.metadata
                          };
                          setSession(prev => ({ ...prev, exercises: [...prev.exercises, finalizedEx] }));
                          setPendingExercise(null);
                          setIsLibraryOpen(false);
                          setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 100);
                      } else {
                          handleUpdateExerciseSettings(id, updates);
                      }
                  }}
                  onSaveComplete={() => {
                      // Close modal after save is complete
                      setShowSettingsId(null);
                      setPendingExercise(null);
                      setIsLibraryOpen(false);
                  }}
              />
            )}

          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {reorderMode && (
          <ReorderMode
              exerciseName={reorderMode.exerciseName}
              exerciseIndex={reorderMode.currentIndex}
              exercises={session.exercises}
              currentPointer={reorderMode.currentPointer}
              isDropping={reorderMode.isDropping}
              isDragEnded={isDragEnded}
              onDrop={handleReorderExercise}
              onCancel={() => setReorderMode(null)}
          />
        )}
      </AnimatePresence>

      {/* AICoachOverlay moved to AnimatePresence container */}

      {showTimeEditor && (
        <TimeEditor 
            currentDuration={Date.now() - session.startTime - session.pausedDuration}
            startTime={session.startTime}
            onConfirm={handleManualTimeConfirm}
            onCancel={() => setShowTimeEditor(false)}
        />
      )}

      {tutorialExerciseId && session.exercises.find(ex => ex.id === tutorialExerciseId) && (
        <ExerciseTutorialModal 
          exercise={session.exercises.find(ex => ex.id === tutorialExerciseId) as any}
          onClose={() => setTutorialExerciseId(null)}
          onAskAi={handleAskAiFromTutorial}
        />
      )}

      {/* Toast Notification */}
      <AnimatePresence>
        {toast.visible && (
          <motion.div
            initial={{ opacity: 0, y: 20, x: "-50%" }}
            animate={{ opacity: 1, y: 0, x: "-50%" }}
            exit={{ opacity: 0, y: 20, x: "-50%" }}
            className="fixed left-1/2 z-[200] px-6 py-3 liquid-glass-dark text-white text-sm font-bold rounded-2xl max-w-[85vw] text-center"
            style={{ bottom: 'calc(var(--safe-bottom) + 96px)' }}
          >
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
      
    </div>
  );
};

export default App;
