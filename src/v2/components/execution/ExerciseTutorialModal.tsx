import React, { useEffect, useState } from 'react';
import { ExerciseAction } from '../../types/protocol';
import { socketService } from '../../services/transport/WebSocketClient';
import { API_BASE } from '../../../services/geminiService';
import { VideoPlayerModal } from './VideoPlayerModal';
import DOMPurify from 'dompurify';
import { VideoAsset } from '../../../types/video';
import { MarkdownRenderer } from '../../../components/MarkdownRenderer';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Maximize2, Minimize2, ZoomIn } from 'lucide-react';

interface ExerciseTutorialModalProps {
  exercise: ExerciseAction & { name?: string; targetRpe?: number; libraryId?: string };
  onClose: () => void;
  onAskAi: (attachment: any) => void;
}

/**
 * ExerciseTutorialModal (V2) - Refactored UI
 * 
 * Features:
 * - Full screen mode support
 * - Click-to-zoom cover image
 * - Immersive UI design
 * - AI tutorial generation
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
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

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

  // DOMPurify 配置
  const purifyConfig = {
    ADD_TAGS: ['iframe'],
    ADD_ATTR: [
      'allow', 'allowfullscreen', 'src', 'loading', 'srcset', 'sizes'
    ],
    FORBID_TAGS: ['script', 'style', 'form', 'input', 'video', 'source', 'track'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
  };

  useEffect(() => {
    let mounted = true;

    const loadTutorial = async () => {
      setIsLoading(true);
      const exerciseName = getExerciseName();
      const exerciseId = getExerciseId();

      if (!exerciseName || exerciseName === '未知动作') {
        console.error('[ExerciseTutorialModal] 无法获取动作名称:', exercise);
        setContent('<p class="text-red-500">动作名称缺失，无法加载教学。</p>');
        setIsLoading(false);
        return;
      }

      try {
        let response: Response | null = null;

        if (exerciseId) {
          console.log('[ExerciseTutorialModal] Fetching exercise by id:', exerciseId);
          response = await fetch(`${API_BASE}/exercises/${encodeURIComponent(exerciseId)}`);
        }

        if (!response || !response.ok) {
          console.log('[ExerciseTutorialModal] Fetching exercise by name:', exerciseName);
          response = await fetch(`${API_BASE}/exercises/by-name/${encodeURIComponent(exerciseName)}`);
        }

        if (response.ok) {
          const data = await response.json();
          console.log('[ExerciseTutorialModal] Received data:', data);

          setExerciseData(data);

          const hasContent = data.content_html !== null && data.content_html !== undefined && data.content_html.trim() !== '';

          if (mounted && hasContent) {
            console.log('[ExerciseTutorialModal] Using existing content_html');
            setContent(data.content_html);
            setIsAiGenerated(false);
            clearCachedTutorial();
            setIsLoading(false);
            return;
          }
        }

        console.log('[ExerciseTutorialModal] No content_html found, checking cache');
        const cachedContent = getCachedTutorial();
        if (cachedContent && mounted) {
          console.log('[ExerciseTutorialModal] Using cached tutorial');
          setContent(cachedContent);
          setIsAiGenerated(true);
          setShowAiButton(false);
          setIsLoading(false);
          return;
        }

        console.log('[ExerciseTutorialModal] No content or cache found, showing AI button');
        if (mounted) {
          setShowAiButton(true);
          setIsLoading(false);
        }
      } catch (error) {
        console.error('[ExerciseTutorialModal] Failed to load tutorial:', error);
        if (mounted) {
          setContent('<p class="text-red-500">加载教学失败，请稍后重试。</p>');
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
    const promptName = exerciseName;

    console.log('[ExerciseTutorialModal] Generating AI tutorial:', promptName);
    setIsGenerating(true);
    clearCachedTutorial(); // 清除旧缓存，防止读取到过期内容

    socketService.send('tutor.generate_tutorial', {
      exerciseId: exercise.exerciseId || exerciseId || exerciseName,
      exerciseName: promptName,
      type: exercise.type
    });

    const targetExerciseId = exercise.exerciseId || exerciseId || exerciseName;

    const unsubscribe = socketService.subscribe('tutor.tutorial_result', (payload) => {
      if (payload.exerciseId === targetExerciseId) {
        console.log('[ExerciseTutorialModal] Received tutorial result:', {
          source: payload.source,
          isFinal: payload.isFinal,
          contentLength: payload.content_md?.length
        });

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
      // 如果超时且没有内容，显示 AI 按钮以便重试，或者显示错误信息
      if (!content || content.length < 10) {
        setShowAiButton(true);
        // 可以选择设置一个错误消息作为内容，或者使用 toast
        setContent("# ⚠️ 生成超时\n\n请求超时，请检查网络连接后重试。");
      }
      console.warn('[ExerciseTutorialModal] AI generation timeout after 60s');
      unsubscribe();
    }, 60000);

    const unsubscribeWithTimeout = () => {
      clearTimeout(timeoutId);
      unsubscribe();
    };
  };

  const handleAsk = () => {
    const exerciseName = getExerciseName();
    const attachment = {
      type: 'interaction_context',
      subType: 'action_onboarding',
      exerciseId: exercise.exerciseId || exerciseName,
      content: `I'm learning about ${exerciseName}. Can you give me more specific tips?`,
      metadata: {
        source: 'tutorial_modal',
        isAiGenerated
      }
    };

    onAskAi(attachment);
    onClose();
  };

  // Parsers - support both old format (top-level fields) and new format (attributes)
  const parseTargets = (data: any) => {
    if (!data) return { primary: [], secondary: [] };

    // Check top-level targets first (old format / SQL extracted)
    if (data.targets) {
      if (typeof data.targets === 'string') {
        try { return JSON.parse(data.targets); } catch { return { primary: [], secondary: [] }; }
      }
      return data.targets;
    }

    // Check attributes.targets (new format)
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

    // Check top-level equipment_required first (old format / SQL extracted)
    if (data.equipment_required) {
      if (typeof data.equipment_required === 'string') {
        try { return JSON.parse(data.equipment_required); } catch { return []; }
      }
      return data.equipment_required;
    }

    // Check attributes.equipment_required (new format)
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

    // Check tutorials first (preferred field name), but skip if empty object
    if (data.tutorials && (typeof data.tutorials === 'string' || Object.keys(data.tutorials).length > 0)) {
      if (typeof data.tutorials === 'string') {
        try { return JSON.parse(data.tutorials); } catch { return {}; }
      }
      return data.tutorials;
    }

    // Fall back to assets_json (legacy field name)
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

  // Dictionaries
  const typeNames: Record<string, string> = {
    'resistance': '常规负重', 'unilateral': '单侧训练', 'bodyweight': '自重训练',
    'assisted': '辅助器械', 'isometric': '静力/等长', 'cardio': '有氧运动',
    'flexibility': '柔韧性训练'
  };

  const difficultyNames: Record<string, string> = {
    'beginner': '初级', 'intermediate': '中级', 'advanced': '高级'
  };

  const difficultyColors: Record<string, string> = {
    'beginner': 'bg-emerald-100 text-emerald-700 border-emerald-200',
    'intermediate': 'bg-amber-100 text-amber-700 border-amber-200',
    'advanced': 'bg-rose-100 text-rose-700 border-rose-200'
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">

      {/* Zoomed Image Overlay */}
      <AnimatePresence>
        {previewImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black flex items-center justify-center p-4 cursor-zoom-out"
            onClick={() => setPreviewImage(null)}
          >
            <motion.img
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              src={previewImage}
              alt={getExerciseName()}
              className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
            <button
              className="absolute top-6 right-6 p-3 bg-white/10 text-white rounded-full hover:bg-white/20 transition-all backdrop-blur-md"
              onClick={(e) => {
                e.stopPropagation();
                setPreviewImage(null);
              }}
            >
              <X size={24} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        layout
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 25, stiffness: 200 }}
        className={`
          bg-white w-full shadow-2xl flex flex-col overflow-hidden transition-all duration-300 ease-in-out
          ${isFullScreen ? 'h-full rounded-none' : 'h-[85vh] sm:h-[80vh] rounded-t-[2rem] sm:rounded-2xl sm:max-w-lg'}
        `}
        onClick={e => e.stopPropagation()}
      >
        {/* Header with Cover Image */}
        <div className="flex-shrink-0 relative group">
          {/* Cover Image */}
          {assets.cover ? (
            <div
              className={`w-full bg-gray-100 relative overflow-hidden cursor-zoom-in ${isFullScreen ? 'h-64 sm:h-80' : 'h-56 sm:h-64'}`}
              onClick={(e) => {
                e.stopPropagation();
                setPreviewImage(getFullUrl(assets.cover));
              }}
            >
              <img
                src={getFullUrl(assets.cover)}
                alt={getExerciseName()}
                className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

              {/* Zoom Indicator */}
              <div className="absolute top-4 left-4 opacity-0 group-hover:opacity-100 transition-opacity bg-black/40 text-white p-2 rounded-full backdrop-blur-sm">
                <ZoomIn size={20} />
              </div>
            </div>
          ) : (
            <div className="w-full h-40 bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
              <span className="text-8xl font-black text-white/20">{getExerciseName().charAt(0)}</span>
            </div>
          )}

          {/* Title Overlay */}
          <div className="absolute bottom-0 left-0 right-0 p-6 text-white z-10">
            <div className="flex items-end justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2 py-0.5 rounded bg-white/20 backdrop-blur-md text-[10px] font-bold uppercase tracking-widest text-white border border-white/10">
                    {isAiGenerated ? 'AI TUTORIAL' : 'GUIDE'}
                  </span>
                  {exerciseData && (
                    <span className={`px-2 py-0.5 rounded backdrop-blur-md text-[10px] font-bold uppercase tracking-widest border border-white/10 ${exerciseData.difficulty === 'advanced' ? 'bg-rose-500/80' :
                      exerciseData.difficulty === 'intermediate' ? 'bg-amber-500/80' : 'bg-emerald-500/80'
                      }`}>
                      {difficultyNames[exerciseData?.difficulty] || 'Level'}
                    </span>
                  )}
                </div>
                <h1 className="text-3xl sm:text-4xl font-black text-white leading-none tracking-tight drop-shadow-sm">
                  {getExerciseName()}
                </h1>
              </div>

              <div className="flex gap-2 mb-1">
                <button
                  onClick={() => setIsFullScreen(!isFullScreen)}
                  className="p-2.5 text-white/90 hover:text-white bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-xl transition-all active:scale-95"
                  title={isFullScreen ? "Exit Fullscreen" : "Fullscreen"}
                >
                  {isFullScreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
                </button>
                <button
                  onClick={onClose}
                  className="p-2.5 text-white/90 hover:text-white bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-xl transition-all active:scale-95"
                >
                  <X size={20} />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto bg-white overscroll-y-contain">
          {isLoading ? (
            <div className="p-8 space-y-6 animate-pulse">
              <div className="flex gap-3">
                <div className="h-6 bg-gray-100 rounded-full w-20"></div>
                <div className="h-6 bg-gray-100 rounded-full w-24"></div>
              </div>
              <div className="space-y-3">
                <div className="h-4 bg-gray-100 rounded-lg w-full"></div>
                <div className="h-4 bg-gray-100 rounded-lg w-full"></div>
                <div className="h-4 bg-gray-100 rounded-lg w-3/4"></div>
              </div>
              <div className="h-48 bg-gray-50 rounded-2xl"></div>
            </div>
          ) : (
            <div className="flex flex-col min-h-full">
              {/* Action Attributes & Tags */}
              {exerciseData && (
                <div className="px-6 py-6 border-b border-gray-100 bg-white">
                  {/* Target Muscles */}
                  {(targets.primary?.length > 0 || targets.secondary?.length > 0) && (
                    <div className="mb-5">
                      <div className="text-xs text-gray-400 uppercase font-black tracking-widest mb-2.5 flex items-center gap-2">
                        <span className="w-1 h-1 rounded-full bg-blue-500"></span>
                        目标肌群 / Target Muscles
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {targets.primary?.map((mg: string, i: number) => (
                          <span key={`p-${i}`} className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold shadow-sm">
                            {mg}
                          </span>
                        ))}
                        {targets.secondary?.map((mg: string, i: number) => (
                          <span key={`s-${i}`} className="px-3 py-1.5 rounded-lg bg-blue-50 text-blue-600 text-xs font-bold">
                            {mg}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Equipment & Type */}
                  <div className="grid grid-cols-2 gap-4">
                    {equipment.length > 0 && (
                      <div>
                        <div className="text-xs text-gray-400 uppercase font-black tracking-widest mb-2.5 flex items-center gap-2">
                          <span className="w-1 h-1 rounded-full bg-gray-400"></span>
                          器械
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {equipment.map((eq: string, i: number) => (
                            <span key={i} className="text-xs font-medium text-gray-700 bg-gray-50 px-2 py-1 rounded border border-gray-100">
                              {eq}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div>
                      <div className="text-xs text-gray-400 uppercase font-black tracking-widest mb-2.5 flex items-center gap-2">
                        <span className="w-1 h-1 rounded-full bg-gray-400"></span>
                        类型
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span className="text-xs font-medium text-gray-700 bg-gray-50 px-2 py-1 rounded border border-gray-100">
                          {typeNames[exerciseData.exercise_type] || exerciseData.exercise_type}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Tutorial Content */}
              <div className="flex-1 p-6 sm:p-8">
                {isGenerating ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-4">
                    <div className="relative">
                      <div className="w-16 h-16 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin"></div>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-8 h-8 bg-blue-50 rounded-full animate-pulse"></div>
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-blue-600 font-bold text-lg mb-1">AI 教练正在生成</div>
                      <div className="text-gray-400 text-xs uppercase tracking-widest">Analyzing Biomechanics...</div>
                    </div>
                  </div>
                ) : showAiButton ? (
                  <div className="text-center py-12 bg-gray-50 rounded-3xl border-2 border-dashed border-gray-200">
                    <div className="w-16 h-16 bg-blue-50 text-blue-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                      </svg>
                    </div>
                    <h3 className="text-lg font-bold text-gray-900 mb-2">暂无教学内容</h3>
                    <p className="text-gray-500 text-sm mb-6 max-w-xs mx-auto">
                      还没收录该动作的详细教学。您可以让 AI 教练为您即时生成一份专业指南。
                    </p>
                    <button
                      onClick={handleGenerateAiTutorial}
                      className="group relative inline-flex items-center gap-2 px-8 py-3 bg-gray-900 text-white rounded-xl font-bold text-sm overflow-hidden shadow-lg shadow-gray-900/20 hover:shadow-gray-900/30 transition-all active:scale-95"
                    >
                      <div className="absolute inset-0 bg-gradient-to-r from-blue-600 to-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                      <span className="relative flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-blue-400 group-hover:text-white transition-colors">
                          <path fillRule="evenodd" d="M9 4.5a.75.75 0 01.721.544l.813 2.846a3.75 3.75 0 002.576 2.576l2.846.813a.75.75 0 010 1.442l-2.846.813a3.75 3.75 0 00-2.576 2.576l-.813 2.846a.75.75 0 01-1.442 0l-.813-2.846a3.75 3.75 0 00-2.576-2.576l-2.846-.813a.75.75 0 010-1.442l2.846-.813a3.75 3.75 0 002.576-2.576l.813-2.846A.75.75 0 019 4.5zM6 20.25a.75.75 0 01.75.75v.75h.75a.75.75 0 010 1.5h-.75v.75a.75.75 0 01-1.5 0v-.75h-.75a.75.75 0 010-1.5h.75v-.75a.75.75 0 01.75-.75zM6 2.25a.75.75 0 01.75.75v.75h.75a.75.75 0 010 1.5h-.75v.75a.75.75 0 01-1.5 0v-.75h-.75a.75.75 0 010-1.5h.75v-.75a.75.75 0 01.75-.75z" clipRule="evenodd" />
                        </svg>
                        立即生成教程
                      </span>
                    </button>
                  </div>
                ) : (
                  <div className="prose prose-sm prose-slate max-w-none prose-p:text-gray-600 prose-headings:text-gray-900 prose-strong:text-gray-900 prose-ul:list-disc prose-ol:list-decimal">
                    <MarkdownRenderer content={content} onImageClick={url => setPreviewImage(url)} />
                    {isAiGenerated && (
                      <div className="mt-8 pt-6 border-t border-gray-100 text-center not-prose">
                        <button
                          onClick={handleGenerateAiTutorial}
                          className="text-gray-400 hover:text-blue-600 text-xs font-medium flex items-center justify-center gap-1.5 mx-auto transition-colors px-4 py-2 rounded-lg hover:bg-blue-50"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                          </svg>
                          重新生成教程
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex-shrink-0 p-4 bg-white border-t border-gray-100 safe-area-pb">
          <div className="grid grid-cols-2 gap-3">
            {/* Video Button */}
            {hasVideo() ? (
              <button
                onClick={() => setShowVideoModal(true)}
                className="flex items-center justify-center gap-2 px-4 py-3.5 bg-gray-100 hover:bg-gray-200 text-gray-900 rounded-xl font-bold text-sm transition-all active:scale-95"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-gray-500">
                  <path fillRule="evenodd" d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653z" clipRule="evenodd" />
                </svg>
                观看演示
              </button>
            ) : (
              <div className="flex items-center justify-center gap-2 px-4 py-3.5 bg-gray-50 text-gray-400 rounded-xl font-bold text-sm border border-gray-100 cursor-not-allowed">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 opacity-50">
                  <path d="M4.5 4.5a3 3 0 00-3 3v9a3 3 0 003 3h8.25a3 3 0 003-3v-9a3 3 0 00-3-3H4.5zM19.94 18.75l-2.69-2.69V7.94l2.69-2.69c.944-.945 2.56-.276 2.56 1.06v11.38c0 1.336-1.616 2.005-2.56 1.06z" />
                </svg>
                暂无视频
              </div>
            )}

            {/* AI Ask Button */}
            <button
              onClick={handleAsk}
              className="flex items-center justify-center gap-2 px-4 py-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-sm shadow-lg shadow-blue-500/20 transition-all active:scale-95"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 text-blue-200">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
              </svg>
              咨询教练
            </button>
          </div>
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
    </div>
  );
};