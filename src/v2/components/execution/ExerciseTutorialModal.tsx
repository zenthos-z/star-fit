import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import { ExerciseAction } from '../../types/protocol';
import { socketService } from '../../services/transport/WebSocketClient';
import { API_BASE } from '../../../services/geminiService';
import { VideoPlayerModal } from './VideoPlayerModal';
import { VideoAsset } from '../../../types/video';
import { MarkdownRenderer } from '../../../components/MarkdownRenderer';
import { setTabBarHidden } from '../../../lib/nativeTabBar';
import { transitions } from '../../lib/animations';
import { haptic } from '../../../lib/nativeHaptics';

interface ExerciseTutorialModalProps {
  exercise: ExerciseAction & { name?: string; targetRpe?: number; libraryId?: string };
  onClose: () => void;
  onAskAi: (attachment: any) => void;
}

/**
 * ExerciseTutorialModal — 动作教学 Sheet（iOS HIG 风格重写版）
 *
 * 视觉：灰阶为主，蓝色只留交互/强调；无装饰渐变（与执行页卡片基线一致）。
 * 交互：
 * - 底部 Sheet 弹簧滑入，头部拖拽下滑关闭（iOS sheet 标准）
 * - 封面/正文配图点击放大（弹簧缩放照片查看器）
 * - 视频走 VideoPlayerModal
 * - 「咨询教练」= 以附件形式挂入 AI 教练输入区（iMessage 附件 chip），不自动发送
 * 内容：MarkdownRenderer（GFM + 原生 HTML + KaTeX 公式）
 */
export const ExerciseTutorialModal: React.FC<ExerciseTutorialModalProps> = ({
  exercise,
  onClose,
  onAskAi
}) => {
  const [content, setContent] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [isAiGenerated, setIsAiGenerated] = useState(false);
  const [exerciseData, setExerciseData] = useState<any>(null);
  const [showVideoModal, setShowVideoModal] = useState(false);
  const [showAiButton, setShowAiButton] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  // UI States
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const dragControls = useDragControls();

  // Helper functions - defined first since they're used in TUTORIAL_CACHE_KEY
  const getExerciseName = (): string => {
    if ((exercise as any).name) return (exercise as any).name;
    if (!exercise.exerciseId) return '未知动作';
    if (exercise.exerciseId.startsWith('fit://library/exercise/')) {
      return exercise.exerciseId.replace('fit://library/exercise/', '');
    }
    return exercise.exerciseId;
  };

  const getExerciseId = (): string => {
    // Priority 1: libraryId from metadata (database ID)
    const libraryId = exercise.metadata?.libraryId || (exercise as any).libraryId;
    if (libraryId && typeof libraryId === 'string') {
      return libraryId;
    }

    // Priority 2: exerciseId from protocol
    if (!exercise.exerciseId) return '';
    if (exercise.exerciseId.startsWith('fit://library/exercise/')) {
      return exercise.exerciseId.replace('fit://library/exercise/', '');
    }
    if (exercise.exerciseId.startsWith('fit://')) return '';
    return exercise.exerciseId;
  };

  const TUTORIAL_CACHE_KEY = `tutorial_cache_${getExerciseId() || getExerciseName()}`;

  const getCachedTutorial = (): string | null => {
    try {
      const cached = localStorage.getItem(TUTORIAL_CACHE_KEY);
      if (cached) {
        const data = JSON.parse(cached);
        // 缓存永久有效，除非被后端内容覆盖或用户手动重新生成
        return data.content;
      }
    } catch (e) {
      console.warn('[ExerciseTutorialModal] Failed to read cache:', e);
    }
    return null;
  };

  const setCachedTutorial = (content: string) => {
    try {
      localStorage.setItem(TUTORIAL_CACHE_KEY, JSON.stringify({
        content,
        timestamp: Date.now()
      }));
    } catch (e) {
      console.warn('[ExerciseTutorialModal] Failed to write cache:', e);
    }
  };

  const clearCachedTutorial = () => {
    try {
      localStorage.removeItem(TUTORIAL_CACHE_KEY);
    } catch (e) {
      console.warn('[ExerciseTutorialModal] Failed to clear cache:', e);
    }
  };

  const hasVideo = () => {
    if (!exerciseData || !exerciseData.assets_json) return false;
    const assets = typeof exerciseData.assets_json === 'string'
      ? JSON.parse(exerciseData.assets_json)
      : exerciseData.assets_json;
    if (!assets.video) return false;
    return Array.isArray(assets.video) ? assets.video.length > 0 : true;
  };

  const getVideos = (): any[] => {
    if (!exerciseData || !exerciseData.assets_json) return [];
    const assets = typeof exerciseData.assets_json === 'string'
      ? JSON.parse(exerciseData.assets_json)
      : exerciseData.assets_json;
    if (!assets.video) return [];
    const videoList = Array.isArray(assets.video) ? assets.video : [assets.video];
    return videoList.map((v: VideoAsset) => ({
      url: v.originalVideoUrl || v.baseUrl + '/original.mp4',
      poster: v.posterUrl || (v.baseUrl ? v.baseUrl + '/poster.jpg' : ''),
      qualities: v.sources
    }));
  };

  // 关闭流程：先播滑出动画，动画完成后才真正卸载（等价 AnimatePresence exit）
  const requestClose = () => setIsClosing(true);

  // iOS sheet 规范：sheet 呈现时盖住原生 tab bar，关闭恢复
  useEffect(() => {
    setTabBarHidden(true);
    return () => setTabBarHidden(false);
  }, []);

  // 桌面端 Esc 关闭（移动端走拖拽/关闭钮）
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  useEffect(() => {
    let mounted = true;

    const loadTutorial = async () => {
      setIsLoading(true);
      const exerciseName = getExerciseName();
      const exerciseId = getExerciseId();

      if (!exerciseName || exerciseName === '未知动作') {
        console.warn('[ExerciseTutorialModal] 无法获取动作名称:', exercise);
        if (mounted) {
          setContent('**动作名称缺失**\n\n无法加载该动作的教学内容。');
          setIsLoading(false);
        }
        return;
      }

      try {
        let response: Response | null = null;

        if (exerciseId) {
          response = await fetch(`${API_BASE}/exercises/${encodeURIComponent(exerciseId)}`);
        }

        if (!response || !response.ok) {
          response = await fetch(`${API_BASE}/exercises/by-name/${encodeURIComponent(exerciseName)}`);
        }

        if (response.ok) {
          const data = await response.json();
          setExerciseData(data);

          const hasContent = data.content_html !== null && data.content_html !== undefined && data.content_html.trim() !== '';

          if (mounted && hasContent) {
            setContent(data.content_html);
            setIsAiGenerated(false);
            clearCachedTutorial();
            setIsLoading(false);
            return;
          }
        }

        const cachedContent = getCachedTutorial();
        if (cachedContent && mounted) {
          setContent(cachedContent);
          setIsAiGenerated(true);
          setShowAiButton(false);
          setIsLoading(false);
          return;
        }

        if (mounted) {
          setShowAiButton(true);
          setIsLoading(false);
        }
      } catch (error) {
        console.warn('[ExerciseTutorialModal] Failed to load tutorial:', error);
        if (mounted) {
          setContent('**加载失败**\n\n教学内容加载失败，请检查网络后重试。');
          setIsLoading(false);
        }
      }
    };

    loadTutorial();
    return () => { mounted = false; };
  }, [exercise.exerciseId, (exercise as any).name, exercise.type]);

  const handleGenerateAiTutorial = () => {
    const exerciseName = getExerciseName();
    const exerciseId = getExerciseId();

    setIsGenerating(true);
    clearCachedTutorial(); // 清除旧缓存，防止读取到过期内容

    socketService.send('tutor.generate_tutorial', {
      exerciseId: exercise.exerciseId || exerciseId || exerciseName,
      exerciseName: exerciseName,
      type: exercise.type
    });

    const targetExerciseId = exercise.exerciseId || exerciseId || exerciseName;

    const unsubscribe = socketService.subscribe('tutor.tutorial_result', (payload) => {
      if (payload.exerciseId === targetExerciseId) {
        setContent(payload.content_md);

        if (payload.isFinal) {
          // 只在生成完成且内容有效时更新缓存
          if (payload.content_md && payload.content_md.length > 50) {
            setCachedTutorial(payload.content_md);
          }

          setIsAiGenerated(true);
          setIsGenerating(false);
          setShowAiButton(false);
          unsubscribe();
        }
      }
    });

    const timeoutId = setTimeout(() => {
      setIsGenerating(false);
      if (!content || content.length < 10) {
        setShowAiButton(true);
        setContent("**生成超时**\n\n请求超时，请检查网络连接后重试。");
      }
      console.warn('[ExerciseTutorialModal] AI generation timeout after 60s');
      unsubscribe();
    }, 60000);
  };

  const handleAsk = () => {
    const exerciseName = getExerciseName();
    const attachment = {
      type: 'interaction_context',
      subType: 'action_onboarding',
      exerciseId: exercise.exerciseId || getExerciseId() || exerciseName,
      exerciseName,
      exerciseType: exercise.type,
      title: exerciseName,
      content: `用户正在查看动作「${exerciseName}」的教学，请结合该动作的要领与用户训练历史回答。`,
      metadata: {
        source: 'tutorial_modal',
        isAiGenerated
      }
    };

    onAskAi(attachment);
  };

  // Parsers - support both old format (top-level fields) and new format (attributes)
  const parseTargets = (data: any) => {
    if (!data) return { primary: [], secondary: [] };

    if (data.targets) {
      if (typeof data.targets === 'string') {
        try { return JSON.parse(data.targets); } catch { return { primary: [], secondary: [] }; }
      }
      return data.targets;
    }

    if (data.attributes?.targets) {
      if (typeof data.attributes.targets === 'string') {
        try { return JSON.parse(data.attributes.targets); } catch { return { primary: [], secondary: [] }; }
      }
      return data.attributes.targets;
    }

    return { primary: [], secondary: [] };
  };

  const parseEquipment = (data: any) => {
    if (!data) return [];

    if (data.equipment_required) {
      if (typeof data.equipment_required === 'string') {
        try { return JSON.parse(data.equipment_required); } catch { return []; }
      }
      return data.equipment_required;
    }

    if (data.attributes?.equipment_required) {
      if (typeof data.attributes.equipment_required === 'string') {
        try { return JSON.parse(data.attributes.equipment_required); } catch { return []; }
      }
      return data.attributes.equipment_required;
    }

    return [];
  };

  const parseAssets = (data: any) => {
    if (!data) return {};

    if (data.tutorials && (typeof data.tutorials === 'string' || Object.keys(data.tutorials).length > 0)) {
      if (typeof data.tutorials === 'string') {
        try { return JSON.parse(data.tutorials); } catch { return {}; }
      }
      return data.tutorials;
    }

    if (data.assets_json) {
      if (typeof data.assets_json === 'string') {
        try { return JSON.parse(data.assets_json); } catch { return {}; }
      }
      return data.assets_json;
    }

    return {};
  };

  const getFullUrl = (url: string) => {
    if (!url) return '';
    if (url.startsWith('http') || url.startsWith('blob:')) return url;
    const baseUrl = API_BASE.replace(/\/api\/?$/, '');
    return `${baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
  };

  const targets = exerciseData ? parseTargets(exerciseData) : { primary: [], secondary: [] };
  const equipment = exerciseData ? parseEquipment(exerciseData) : [];
  const assets = exerciseData ? parseAssets(exerciseData) : {};

  const typeNames: Record<string, string> = {
    'resistance': '常规负重', 'unilateral': '单侧训练', 'bodyweight': '自重训练',
    'assisted': '辅助器械', 'isometric': '静力/等长', 'cardio': '有氧运动',
    'flexibility': '柔韧性训练'
  };

  const difficultyNames: Record<string, string> = {
    'beginner': '初级', 'intermediate': '中级', 'advanced': '高级'
  };

  const hasMuscles = (targets.primary?.length ?? 0) > 0 || (targets.secondary?.length ?? 0) > 0;
  const hasMeta = exerciseData && (hasMuscles || equipment.length > 0 || exerciseData.exercise_type);

  return (
    <>
      {/* 背景遮罩：淡入淡出 */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: isClosing ? 0 : 1 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="fixed inset-0 z-[70] bg-black/40"
      />

      {/* Sheet：底部弹簧滑入，头部可拖拽下滑关闭 */}
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: isClosing ? '100%' : 0 }}
        transition={transitions.springGentle}
        onAnimationComplete={() => { if (isClosing) onClose(); }}
        drag="y"
        dragListener={false}
        dragControls={dragControls}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.55 }}
        onDragEnd={(_, info) => {
          if (info.offset.y > 120 || info.velocity.y > 800) {
            haptic('light');
            requestClose();
          }
        }}
        className="fixed inset-x-0 bottom-0 z-[80] bg-white rounded-t-[40px] shadow-[0_-8px_40px_rgba(0,0,0,0.18)] flex flex-col overflow-hidden h-[88vh] sm:h-[80vh] sm:max-w-lg sm:mx-auto sm:rounded-t-[40px]"
      >
        {/* Header — 拖拽把手区：左关闭 / 中标题 / 右占位 */}
        <div
          className="flex-shrink-0 flex items-center gap-3 px-4 pt-3 pb-2 touch-none"
          style={{ paddingTop: 'calc(var(--safe-top) + 12px)' }}
          onPointerDown={(e) => dragControls.start(e)}
        >
          <button
            onClick={() => { haptic('light'); requestClose(); }}
            className="w-11 h-11 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 active:bg-gray-200 active:scale-95 transition-all shrink-0"
            aria-label="关闭"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
            </svg>
          </button>
          <div className="flex-1 min-w-0 text-center">
            <div className="text-[17px] font-semibold text-gray-900 leading-tight truncate">
              {getExerciseName()}
            </div>
            <div className="text-[12px] text-gray-400 leading-tight mt-0.5">
              {isAiGenerated ? 'AI 生成教学' : '动作教学'}
              {exerciseData?.difficulty && ` · ${difficultyNames[exerciseData.difficulty] || ''}`}
            </div>
          </div>
          <div className="w-11 h-11 shrink-0" />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto overscroll-y-contain bg-white">
          {isLoading ? (
            <div className="px-5 pt-2 pb-8 animate-pulse">
              <div className="h-56 bg-gray-100 rounded-3xl" />
              <div className="h-4 bg-gray-100 rounded-full w-1/3 mt-6" />
              <div className="h-4 bg-gray-100 rounded-full w-full mt-3" />
              <div className="h-4 bg-gray-100 rounded-full w-full mt-3" />
              <div className="h-4 bg-gray-100 rounded-full w-3/4 mt-3" />
            </div>
          ) : (
            <div className="px-5 pb-8">
              {/* 封面配图：点击放大；无封面时灰阶字母占位（不裸露空白） */}
              {assets.cover ? (
                <div
                  className="relative mt-1 rounded-3xl overflow-hidden bg-gray-50 active:opacity-90 transition-opacity"
                  onClick={() => { haptic('light'); setPreviewImage(getFullUrl(assets.cover)); }}
                >
                  <img
                    src={getFullUrl(assets.cover)}
                    alt={getExerciseName()}
                    className="w-full h-56 object-cover"
                    onError={(e) => {
                      // 加载失败也回落到占位块，不留破图图标
                      const img = e.target as HTMLImageElement;
                      img.style.display = 'none';
                      const ph = img.nextElementSibling as HTMLElement | null;
                      if (ph) ph.style.display = 'flex';
                    }}
                  />
                  <div
                    className="hidden w-full h-56 flex-col items-center justify-center gap-2 bg-gray-50"
                    aria-hidden
                  >
                    <span className="text-5xl font-medium text-gray-200">{getExerciseName().charAt(0)}</span>
                  </div>
                  <div className="absolute bottom-3 right-3 w-8 h-8 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center text-white">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607zM10.5 7.5v6m3-3h-6" />
                    </svg>
                  </div>
                </div>
              ) : (
                <div className="mt-1 rounded-3xl overflow-hidden bg-gray-50 flex-col items-center justify-center gap-1 h-40 flex" aria-hidden>
                  <span className="text-[44px] leading-none font-medium text-gray-200">{getExerciseName().charAt(0)}</span>
                  <span className="text-[11px] text-gray-300">暂无配图</span>
                </div>
              )}

              {/* 元信息：灰阶 chips（类型标识一律灰阶，蓝色只留交互） */}
              {hasMeta && (
                <div className="mt-5">
                  {hasMuscles && (
                    <>
                      <div className="text-xs text-gray-400 font-medium mb-2">目标肌群</div>
                      <div className="flex flex-wrap gap-2 mb-4">
                        {targets.primary?.map((mg: string, i: number) => (
                          <span key={`p-${i}`} className="px-3 py-1.5 rounded-full bg-gray-100 text-gray-700 text-xs font-medium">
                            {mg}
                          </span>
                        ))}
                        {targets.secondary?.map((mg: string, i: number) => (
                          <span key={`s-${i}`} className="px-3 py-1.5 rounded-full bg-gray-50 text-gray-400 border border-gray-100 text-xs font-medium">
                            {mg}
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {exerciseData.difficulty && (
                      <span className="px-3 py-1.5 rounded-full bg-gray-100 text-gray-500 text-xs font-medium">
                        {difficultyNames[exerciseData.difficulty] || exerciseData.difficulty}
                      </span>
                    )}
                    {exerciseData.exercise_type && (
                      <span className="px-3 py-1.5 rounded-full bg-gray-100 text-gray-500 text-xs font-medium">
                        {typeNames[exerciseData.exercise_type] || exerciseData.exercise_type}
                      </span>
                    )}
                    {equipment.map((eq: string, i: number) => (
                      <span key={`eq-${i}`} className="px-3 py-1.5 rounded-full bg-gray-50 text-gray-400 border border-gray-100 text-xs font-medium">
                        {eq}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* 教学正文 */}
              <div className="mt-6">
                {isGenerating ? (
                  <div className="flex flex-col items-center justify-center py-16 gap-4">
                    <div className="w-10 h-10 border-[3px] border-gray-200 border-t-blue-500 rounded-full animate-spin" />
                    <div className="text-[15px] text-gray-500">AI 教练正在生成教学…</div>
                  </div>
                ) : showAiButton ? (
                  <div className="flex flex-col items-center text-center py-14 px-6">
                    <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 mb-4">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-7 h-7">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                      </svg>
                    </div>
                    <div className="text-[17px] font-semibold text-gray-900 mb-1.5">暂无教学内容</div>
                    <p className="text-[14px] text-gray-400 leading-relaxed mb-6 max-w-[260px]">
                      该动作还没有收录详细教学，可以让 AI 教练即时生成一份。
                    </p>
                    <button
                      onClick={() => { haptic('medium'); handleGenerateAiTutorial(); }}
                      className="px-6 py-3 bg-blue-500 text-white rounded-full text-[15px] font-semibold shadow-sm active:scale-95 transition-transform"
                    >
                      生成 AI 教程
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="prose prose-sm prose-slate max-w-none markdown-body">
                      <MarkdownRenderer content={content} onImageClick={url => setPreviewImage(url)} />
                    </div>
                    {isAiGenerated && (
                      <div className="mt-8 pt-5 border-t border-gray-100 text-center">
                        <button
                          onClick={() => { haptic('light'); handleGenerateAiTutorial(); }}
                          className="text-gray-400 active:text-gray-600 text-[13px] font-medium inline-flex items-center justify-center gap-1.5 mx-auto transition-colors px-4 py-2 rounded-full active:bg-gray-50"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                          </svg>
                          重新生成教程
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer — 次要灰胶囊 + 主操作蓝胶囊（统一 rounded-full） */}
        <div
          className="flex-shrink-0 px-5 pt-3 bg-white border-t border-gray-100"
          style={{ paddingBottom: 'calc(var(--safe-bottom) + 12px)' }}
        >
          {hasVideo() ? (
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => { haptic('light'); setShowVideoModal(true); }}
                className="flex items-center justify-center gap-2 px-4 py-3.5 bg-gray-100 text-gray-900 rounded-full font-semibold text-[15px] active:bg-gray-200 active:scale-95 transition-all"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-gray-500">
                  <path fillRule="evenodd" d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653z" clipRule="evenodd" />
                </svg>
                观看演示
              </button>
              <button
                onClick={() => { haptic('medium'); handleAsk(); }}
                className="flex items-center justify-center gap-2 px-4 py-3.5 bg-blue-500 text-white rounded-full font-semibold text-[15px] shadow-sm active:scale-95 transition-all"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 20.25c4.5 0 8.25-3.75 8.25-8.25S16.5 3.75 12 3.75 3.75 7.5 3.75 12c0 1.6.46 3.09 1.26 4.34L3.75 20.25l4.02-.98A8.22 8.22 0 0012 20.25z" />
                </svg>
                咨询教练
              </button>
            </div>
          ) : (
            <button
              onClick={() => { haptic('medium'); handleAsk(); }}
              className="w-full flex items-center justify-center gap-2 px-4 py-3.5 bg-blue-500 text-white rounded-full font-semibold text-[15px] shadow-sm active:scale-95 transition-all"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 20.25c4.5 0 8.25-3.75 8.25-8.25S16.5 3.75 12 3.75 3.75 7.5 3.75 12c0 1.6.46 3.09 1.26 4.34L3.75 20.25l4.02-.98A8.22 8.22 0 0012 20.25z" />
              </svg>
              咨询教练
            </button>
          )}
        </div>

        {/* Video Player Modal */}
        {hasVideo() && (
          <VideoPlayerModal
            isOpen={showVideoModal}
            onClose={() => setShowVideoModal(false)}
            videos={getVideos()}
          />
        )}
      </motion.div>

      {/* 照片查看器：点击任意处关闭，弹簧缩放 */}
      <AnimatePresence>
        {previewImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[200] bg-black flex items-center justify-center p-4"
            onClick={() => setPreviewImage(null)}
          >
            <motion.img
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              transition={transitions.springSmooth}
              src={previewImage}
              alt={getExerciseName()}
              className="max-w-full max-h-full object-contain"
              onClick={(e) => e.stopPropagation()}
            />
            <button
              className="absolute top-6 right-6 w-11 h-11 bg-white/10 text-white rounded-full flex items-center justify-center backdrop-blur-md active:bg-white/20 active:scale-95 transition-all"
              style={{ top: 'calc(var(--safe-top) + 16px)' }}
              onClick={(e) => {
                e.stopPropagation();
                setPreviewImage(null);
              }}
              aria-label="关闭大图"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
