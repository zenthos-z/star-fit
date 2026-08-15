import React, { useState, useEffect, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { Exercise, ExerciseSet, ExerciseType, Session, AppRoute, AiConfig, AiScenario } from './types';
import { LoadAnchors } from './src/v2/types/protocol';
import TimerCapsule from './components/TimerCapsule';
import { ParticleBackground } from './src/components/ParticleBackground';
import { ExerciseCardV2 } from './src/v2/components/execution/ExerciseCardV2';
import ReorderMode from './src/v2/components/execution/ReorderMode';
import SettlementV2 from './src/v2/components/settlement/SettlementV2';
import History from './components/History';
import TimeEditor from './components/TimeEditor';
import ActionSlider, { SliderOption } from './components/ActionSlider';
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
  const [currentRoute, setCurrentRoute] = useState<AppRoute>(AppRoute.HOME);
  const [transitionOrigin, setTransitionOrigin] = useState<{ x: number, y: number } | null>(null);
  
  // Viewer State for History Detail
  const [viewHistorySession, setViewHistorySession] = useState<Session | null>(null);

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

  // Overscroll Elasticity (Elastic Band Effect)
  const overscrollY = useMotionValue(0);
  const overscrollSpring = useSpring(overscrollY, { stiffness: 200, damping: 25 });
  const scaleY = useTransform(overscrollSpring, [-200, 0, 200], [1.08, 1, 1.08]);
  const translateY = useTransform(overscrollSpring, (v) => v * 0.2);
  const overscrollOrigin = useTransform(overscrollSpring, (v) => v > 0 ? "top" : "bottom");

  const startTouchY = useRef(0);
  const isAtTop = useRef(false);
  const isAtBottom = useRef(false);

  const handleOverscrollTouchStart = (e: React.TouchEvent) => {
    if (currentRoute !== AppRoute.HOME || isAiOverlayOpen || showSettingsId || tutorialExerciseId || reorderMode) return;
    const scrollTop = window.scrollY;
    const scrollHeight = document.documentElement.scrollHeight;
    const clientHeight = window.innerHeight;
    isAtTop.current = scrollTop <= 2;
    isAtBottom.current = scrollTop + clientHeight >= scrollHeight - 10;
    startTouchY.current = e.touches[0].pageY;
  };

  const handleOverscrollTouchMove = (e: React.TouchEvent) => {
    if (currentRoute !== AppRoute.HOME || isAiOverlayOpen || showSettingsId || tutorialExerciseId || reorderMode) return;
    const currentY = e.touches[0].pageY;
    const deltaY = currentY - startTouchY.current;
    if ((isAtTop.current && deltaY > 0) || (isAtBottom.current && deltaY < 0)) {
      overscrollY.set(deltaY);
    } else {
      overscrollY.set(0);
    }
  };

  const handleOverscrollTouchEnd = () => {
    overscrollY.set(0);
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
            setCurrentRoute(AppRoute.HOME);
            setPendingSummary(false).catch(console.error);
        }
      } else if (showTimeEditor) {
        setShowTimeEditor(false);
      } else if (viewHistorySession) {
        setViewHistorySession(null);
      } else if (currentRoute !== AppRoute.HOME) {
        setCurrentRoute(AppRoute.HOME);
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
      if (navigator.vibrate) navigator.vibrate(50);
    }
  };

  const handlePauseSession = () => {
    if (session.status === 'active') {
        const now = Date.now();
        setSession(prev => ({ ...prev, status: 'paused', pauseStartTime: now }));
        if (navigator.vibrate) navigator.vibrate(20);
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

      setViewHistorySession(null);
      setCurrentRoute(AppRoute.HOME);
      showToast("已复用训练计划");
  };

  /**
   * Calculate workout statistics from exercises
   * Returns total volume (kg), completed sets count, and optional average heart rate
   */
  const calculateWorkoutStats = (exercises: Exercise[]): {
    totalVolume: number;
    setsCount: number;
    avgHr?: number;
  } => {
    let totalVolume = 0;
    let setsCount = 0;

    exercises.forEach(ex => {
      // [DEFENSIVE] Ensure ex.sets is an array
      const sets = Array.isArray(ex.sets) ? ex.sets : [];
      
      // Determine exercise type for appropriate stats calculation
      const isCardioOrOutdoor = ex.type === 'cardio' || ex.type === 'outdoor' || ex.metadata?.isOutdoor;
      
      sets.forEach((set: any) => {
        if (set.completed) {
          if (isCardioOrOutdoor) {
            // For cardio/outdoor exercises, calculate volume based on duration or distance
            // Duration-based: weight * duration (like isometric) or just track duration
            if (ex.type === 'isometric') {
              const weight = set.weight || 0;
              const duration = set.duration || 0;
              totalVolume += (weight > 0 ? weight : 75) * duration;
            } else {
              // For regular cardio (running, cycling, etc.), volume is not applicable
              // We track duration and distance separately
              totalVolume += 0; // No traditional volume for cardio
            }
          } else {
            // For resistance exercises: weight * reps
            totalVolume += (set.weight || 0) * (set.reps || 0);
          }
          setsCount++;
        }
      });
    });

    return { totalVolume, setsCount };
  };

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
      stats: {
        totalVolume: stats.totalVolume,
        setsCount: stats.setsCount,
        durationMinutes,
        avgHr: stats.avgHr
      },
      exercises: session.exercises.map(ex => ({
        name: ex.name,
        type: ex.type,
        sets: ex.sets,
        metadata: ex.metadata  // ✅ Include metadata for SummaryCard display
      })),
      anomalies: trainingAnomalies
    };

    console.log('[App] localSummaryData:', localSummaryData);

    setHistory(prev => [finishedSession, ...prev]);
    setSession(finishedSession);

    // Close Settlement route to prevent z-index conflict with AICoachOverlay
    setCurrentRoute(AppRoute.HOME);

    // 4. [Phase 1] Persist session to DB first via POST /api/sessions
    const persistSession = async () => {
      try {
        const userId = localStorage.getItem('starfit_user_id') || 'global';
        const response = await fetch('/api/sessions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-User-Id': userId  // 必须传入，否则后端取到 'global'
          },
          body: JSON.stringify({
            sessionId: session.id,
            startTime: session.startTime,
            endTime: finishedSession.endTime,
            exercises: session.exercises.map(ex => ({
              name: ex.name,
              type: ex.type,
              sets: ex.sets,
              reps: undefined, // reps handled per-set in metadata
              weight: undefined,
              metadata: ex.metadata
            })),
            stats: localSummaryData.stats
          })
        });

        if (!response.ok) {
          console.error('[App] Failed to persist session:', await response.text());
        } else {
          const result = await response.json();
          console.log('[App] Session persisted:', result);
        }
      } catch (err) {
        console.error('[App] Session persistence error:', err);
        // Non-fatal: Agent can still read local data
      }
    };
    persistSession();

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
      if (attachment?.content) {
          openAiCoach({ question: attachment.content });
      }
      if (attachment) {
          setAttachedContext(attachment);
      }
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
            setCurrentRoute(AppRoute.HOME);
            // [NEW] Clear pending summary flag
            setPendingSummary(false).catch(console.error);
        }}
    />;
  }

  const isSessionActive = session.status === 'active' || session.status === 'paused';

  const leftAction: SliderOption = isSessionActive 
    ? { 
        label: '结束', 
        icon: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-full h-full"><path strokeLinecap="round" strokeLinejoin="round" d="M3 3v1.5M3 21v-6m0 0 2.77-.693a9 9 0 016.208.682l.108.054a9 9 0 006.086.71l3.114-.732a48.524 48.524 0 01-.005-10.499l-3.11.732a9 9 0 01-6.085-.711l-.108-.054a9 9 0 00-6.208-.682L3 4.5M3 15V4.5" /></svg>,
        action: (e) => handleEndSession(),
        variant: 'danger'
      }
    : { 
        label: '历史', 
        icon: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-full h-full"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" /></svg>,
        action: (e) => {
          setTransitionOrigin({ x: e.clientX, y: e.clientY });
          setCurrentRoute(AppRoute.HISTORY);
        },
        variant: 'default'
      };

  const rightAction: SliderOption = {
    label: 'AI Agent',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-full h-full">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
      </svg>
    ),
    action: (e) => {
      setTransitionOrigin({ x: e.clientX, y: e.clientY });
      openAiCoach();
    },
    variant: 'accent'
  };

  return (
    <div className={`min-h-screen bg-star-white text-star-dark relative ${isAiOverlayOpen || currentRoute === AppRoute.HISTORY || currentRoute === AppRoute.SETTINGS || viewHistorySession ? 'h-screen overflow-hidden' : 'overflow-x-hidden'}`}>
      <ParticleBackground isActive={session.status === 'active'} className="z-0" />
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
          y: translateY,
          scaleY,
          transformOrigin: overscrollOrigin
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
                 className="flex items-center gap-2 px-6 py-3.5 rounded-2xl bg-white border border-dashed border-gray-300 text-gray-400 hover:text-star-accent hover:border-star-accent active:scale-95 transition-all group"
               >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4 group-hover:scale-110 transition-transform">
                     <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  <span className="text-sm font-black uppercase tracking-wider">添加动作</span>
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
          {/* Settings Button - Top Right */}
          {!(isAiOverlayOpen || currentRoute === AppRoute.HISTORY || currentRoute === AppRoute.SETTINGS || viewHistorySession || reorderMode) && (
            <button
              onClick={() => setCurrentRoute(AppRoute.SETTINGS)}
              className="fixed top-4 right-4 z-50 p-3 rounded-full bg-white/80 backdrop-blur-md shadow-lg border border-gray-100 text-gray-600 hover:text-star-primary hover:bg-white transition-all active:scale-95"
              aria-label="打开设置"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.212 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.063-.374-.313-.686-.645-.87a6.519 6.519 0 01-.22-.127c-.324-.196-.72-.257-1.075-.124l-1.217.456a1.125 1.125 0 01-1.37-.49l-1.296-2.247a1.125 1.125 0 01.26-1.431l1.003-.827c.293-.24.438-.613.431-.992a6.75 6.75 0 010-.255c.007-.378-.138-.75-.43-.99l-1.005-.828a1.125 1.125 0 01-.26-1.43l1.298-2.247a1.125 1.125 0 011.369-.491l1.217.456c.355.133.75.072 1.076-.124.073-.044.146-.087.22-.128c.332-.184.582-.496.644-.87l.212-1.281z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          )}

          <TimerCapsule
            status={session.status}
            startTime={session.startTime}
            pausedDuration={session.pausedDuration}
            hasExercises={session.exercises.length > 0}
            onStart={handleStartSession}
            onPause={handlePauseSession}
            onResume={handleResumeSession}
            onOpenManual={() => setShowTimeEditor(true)}
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

          {!(isAiOverlayOpen || currentRoute === AppRoute.HISTORY || currentRoute === AppRoute.SETTINGS || viewHistorySession) && (
            <ActionSlider
                isLoading={isLoading}
                left={leftAction}
                right={rightAction}
            />
          )}
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
                onClose={() => setCurrentRoute(AppRoute.HOME)}
                onSelect={(s) => setViewHistorySession(s)}
                onImport={handleImportHistory}
                onDelete={handleDeleteSession}
              />
            )}

            {currentRoute === AppRoute.SETTINGS && (
              <SettingsPage
                key="settings"
                userId={userId || ''}
                onClose={() => setCurrentRoute(AppRoute.HOME)}
              />
            )}

            {viewHistorySession && (
              <SettlementV2
                key="settlement"
                session={viewHistorySession}
                onClose={() => setViewHistorySession(null)}
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
                    setCurrentRoute(AppRoute.HOME);
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
                onRemoveAttachment={() => setAttachedContext(null)}
                onViewDetails={() => {
                  if (session.status === 'finished') {
                    setViewHistorySession(session);
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
            className="fixed bottom-24 left-1/2 z-[200] px-6 py-3 bg-star-dark/90 text-white text-sm font-bold rounded-2xl shadow-2xl backdrop-blur-md max-w-[85vw] text-center border border-white/10"
          >
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
      
    </div>
  );
};

export default App;
