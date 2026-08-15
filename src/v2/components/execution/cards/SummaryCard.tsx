import React, { useRef, useState } from 'react';
import { toPng } from 'html-to-image';

interface SummaryCardProps {
  uiHint: {
    type: 'summary_card';
    data: {
      stats: {
        totalVolume: number;
        setsCount: number;
        durationMinutes: number;
        avgHr?: number;
      };
      exercises: any[];
    };
  };
  onConfirm?: () => void;
}

/**
 * Helper function to format duration in seconds to readable string
 */
const formatDuration = (seconds?: number): string => {
  if (!seconds) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

/**
 * Helper function to format distance in meters to readable string
 */
const formatDistance = (meters?: number): string => {
  if (!meters) return '0.00 km';
  return (meters / 1000).toFixed(2) + ' km';
};

/**
 * Get display information for a set based on exercise type
 * Returns { primary, secondary, icon } for rendering
 */
const getSetDisplayInfo = (exercise: any, set: any) => {
  const type = exercise?.type || '';
  const metadata = exercise?.metadata || {};

  // Strength/Resistance training: weight × reps
  if (type === 'resistance' || type === 'bodyweight' ||
      type === 'assisted' || type === 'unilateral' || type === 'heavy_weight' || type === 'rep_training') {
    return {
      primary: `${set.weight || 0}kg × ${set.reps || 0}次`,
      secondary: set.rpe ? `RPE ${set.rpe}` : '',
      typeLabel: '力量训练'
    };
  }

  // Cardio training: duration + heart rate zone
  if (type === 'cardio') {
    const duration = formatDuration(set.duration);
    const targetHr = metadata.targetHeartRateZone;
    return {
      primary: duration,
      secondary: targetHr ? `目标心率 Zone ${targetHr}` : '有氧运动',
      typeLabel: '有氧训练'
    };
  }

  // Isometric training: duration + weight
  if (type === 'isometric') {
    return {
      primary: `${set.duration || 0} 秒`,
      secondary: set.weight ? `${set.weight} kg 配重` : '静力保持',
      typeLabel: '静力训练'
    };
  }

  // Outdoor training: distance + duration
  if (type === 'outdoor') {
    const dist = formatDistance(set.distance);
    const dur = formatDuration(set.duration);
    return {
      primary: `${dist} | ${dur}`,
      secondary: metadata.targetHeartRateZone ? `目标心率 Zone ${metadata.targetHeartRateZone}` : '户外运动',
      typeLabel: '户外运动'
    };
  }

  // Default fallback
  return {
    primary: '已完成',
    secondary: '',
    typeLabel: type || '训练'
  };
};

/**
 * Calculate completion status of an exercise based on its sets
 * @param exercise - Exercise object with sets array
 * @returns Object containing status label and color class
 */
const getExerciseCompletionStatus = (exercise: any): { label: string; colorClass: string } => {
  if (!exercise?.sets || !Array.isArray(exercise.sets) || exercise.sets.length === 0) {
    return { label: '未完成', colorClass: 'text-gray-400' };
  }

  const completedCount = exercise.sets.filter((set: any) => set.completed === true).length;
  const totalCount = exercise.sets.length;
  const completionPercentage = (completedCount / totalCount) * 100;

  if (completionPercentage === 0) {
    return { label: '未完成', colorClass: 'text-gray-400' };
  } else if (completionPercentage < 100) {
    return { label: '部分完成', colorClass: 'text-orange-400' };
  } else {
    return { label: '已完成', colorClass: 'text-star-accent' };
  }
};

/**
 * Calculate overall workout completion status
 * @param exercises - Array of exercises
 * @returns Object containing status label and color class
 */
const getOverallCompletionStatus = (exercises: any[]): { label: string; colorClass: string } => {
  if (!Array.isArray(exercises) || exercises.length === 0) {
    return { label: '未完成', colorClass: 'text-gray-400' };
  }

  let totalSets = 0;
  let completedSets = 0;

  exercises.forEach(ex => {
    if (ex?.sets && Array.isArray(ex.sets)) {
      totalSets += ex.sets.length;
      completedSets += ex.sets.filter((s: any) => s.completed === true).length;
    }
  });

  if (totalSets === 0) {
    return { label: '未完成', colorClass: 'text-gray-400' };
  }

  const completionPercentage = (completedSets / totalSets) * 100;

  if (completionPercentage === 0) {
    return { label: '未完成', colorClass: 'text-gray-400' };
  } else if (completionPercentage < 100) {
    return { label: '部分完成', colorClass: 'text-orange-400' };
  } else {
    return { label: '已完成', colorClass: 'text-star-accent' };
  }
};

/**
 * SummaryCard (SUMMARY_CARD) - Workout Data Review
 *
 * Implements "Polymorphic Display Layout".
 * Dynamically renders exercise info based on type (strength/cardio/isometric/outdoor).
 */
export const SummaryCard: React.FC<SummaryCardProps> = ({ uiHint, onConfirm }) => {
  const exportRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Defensive check for data and stats
  const data = uiHint?.data || { stats: {} as any, exercises: [] };
  const stats = data.stats || {
    totalVolume: 0,
    setsCount: 0,
    durationMinutes: 0,
    avgHr: undefined
  };
  const exercises = Array.isArray(data.exercises) ? data.exercises : [];
  const overallStatus = getOverallCompletionStatus(exercises);

  const handleSaveImage = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!exportRef.current || !scrollRef.current) return;
    
    try {
      setIsSaving(true);
      
      // Temporarily disable scroll and max-height to capture full list
      const originalMaxHeight = scrollRef.current.style.maxHeight;
      const originalOverflow = scrollRef.current.style.overflowY;
      
      scrollRef.current.style.maxHeight = 'none';
      scrollRef.current.style.overflowY = 'visible';

      const dataUrl = await toPng(exportRef.current, {
        cacheBust: true,
        backgroundColor: '#ffffff',
        pixelRatio: 3, // Higher quality for poster
        skipAutoScale: true, // Fix: Skip stylesheet processing that triggers CORS errors with CDN CSS
        style: {
          borderRadius: '0px',
        }
      });
      
      // Restore original styles
      scrollRef.current.style.maxHeight = originalMaxHeight;
      scrollRef.current.style.overflowY = originalOverflow;
      
      const link = document.createElement('a');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      link.download = `workout_summary_${timestamp}.png`;
      link.href = dataUrl;
      link.click();
    } catch (e: any) {
      console.error('Save image failed:', e);
      alert('保存海报失败，请重试');
    } finally {
      setIsSaving(false);
    }
  };

  const handleViewDetails = () => {
    (onConfirm as any)?.({ action: 'view_details' });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 1. Exportable Content Area */}
      <div 
        ref={exportRef}
        className="bg-white border border-gray-100 rounded-[2.5rem] overflow-hidden shadow-xl animate-in zoom-in-95 duration-300"
      >
        {/* 1.1 Sporty Header */}
        <div className="bg-star-dark p-6 pb-8 relative overflow-hidden rounded-t-[2.5rem]">
          {/* Decorative Background Pattern */}
          <div className="absolute top-0 right-0 opacity-10 pointer-events-none transform translate-x-1/4 -translate-y-1/4">
            <svg width="200" height="200" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="45" stroke="white" strokeWidth="1" fill="none" />
              <circle cx="50" cy="50" r="35" stroke="white" strokeWidth="0.5" fill="none" />
              <path d="M0 50 L100 50 M50 0 L50 100" stroke="white" strokeWidth="0.5" />
            </svg>
          </div>

          <div className="relative z-10">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-white text-3xl font-black italic tracking-tighter uppercase leading-[0.85]">
                  训练<br />
                  <span className="text-star-accent text-xl">总结报告</span>
                </h3>
                <p className="text-gray-500 text-[9px] font-mono mt-3 tracking-[0.3em] uppercase font-bold">
                  PROJECT STARFIT • MAS 认证
                </p>
              </div>
              <div className={`backdrop-blur-md border rounded-full px-2.5 py-0.5 shadow-[0_0_15px_rgba(188,254,47,0.15)] ${
                overallStatus.colorClass === 'text-star-accent'
                  ? 'bg-star-accent/10 border-star-accent/20'
                  : overallStatus.colorClass === 'text-orange-400'
                  ? 'bg-orange-400/10 border-orange-400/20'
                  : 'bg-gray-400/10 border-gray-400/20'
              }`}>
                <span className={`${overallStatus.colorClass} text-[9px] font-black italic uppercase tracking-widest`}>
                  {overallStatus.label}
                </span>
              </div>
            </div>

            {/* Core Stats Row - V1 Inspired Grid */}
            <div className="grid grid-cols-3 gap-4 mt-8">
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <div className="w-0.5 h-2 bg-star-accent rounded-full"></div>
                  <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest">总时长</span>
                </div>
                <div className="text-xl font-mono font-black text-white italic">
                  {stats.durationMinutes}<span className="text-[10px] text-gray-500 ml-0.5 not-italic font-bold">分</span>
                </div>
              </div>

              <div className="flex flex-col border-l border-white/10 pl-4">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <div className="w-0.5 h-2 bg-blue-500 rounded-full"></div>
                  <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest">总容量</span>
                </div>
                <div className="text-xl font-mono font-black text-white italic">
                  {stats.totalVolume}<span className="text-[10px] text-gray-500 ml-0.5 not-italic font-bold">kg</span>
                </div>
              </div>

              <div className="flex flex-col border-l border-white/10 pl-4">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <div className="w-0.5 h-2 bg-purple-500 rounded-full"></div>
                  <span className="text-[9px] font-bold text-gray-500 uppercase tracking-widest">总组数</span>
                </div>
                <div className="text-xl font-mono font-black text-white italic">
                  {stats.setsCount}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 1.2 Exercise List - V1 Timeline Style */}
        <div 
          ref={scrollRef}
          className="p-5 bg-white max-h-[320px] overflow-y-auto custom-scrollbar relative"
        >
          <div className="absolute left-7 top-6 bottom-6 w-px bg-gray-50"></div>
          
          <div className="space-y-6">
            {exercises.map((ex, idx) => {
              const displayInfo = ex?.sets && ex.sets.length > 0
                ? getSetDisplayInfo(ex, ex.sets[0])
                : { typeLabel: ex?.type || '训练' };
              const exStatus = getExerciseCompletionStatus(ex);

              return (
              <div key={idx} className="relative pl-8 group">
                {/* Timeline Node */}
                <div className="absolute left-[4px] top-1 w-2.5 h-2.5 rounded-full bg-white border-2 border-star-dark z-10 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <div className="w-0.5 h-0.5 rounded-full bg-star-accent"></div>
                </div>

                <div className="flex justify-between items-baseline mb-3 gap-4">
                  <h4 className="text-base font-black text-star-dark italic uppercase tracking-tighter leading-tight group-hover:text-black transition-colors">
                    {ex?.name || '未知动作'}
                  </h4>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[9px] font-mono text-gray-400 font-bold uppercase tracking-widest">
                      {displayInfo.typeLabel}
                    </span>
                    <span className="w-0.5 h-0.5 rounded-full bg-gray-200"></span>
                    <span className={`text-[9px] font-mono font-bold uppercase tracking-widest ${exStatus.colorClass}`}>
                      {exStatus.label}
                    </span>
                  </div>
                </div>

                {/* Detailed Sets Area */}
                {ex?.sets && Array.isArray(ex.sets) && ex.sets.length > 0 ? (
                  <div className="bg-white border border-gray-100 rounded-[1.25rem] p-3 space-y-1 shadow-sm">
                    {ex.sets.map((set: any, setIdx: number) => {
                      const setInfo = getSetDisplayInfo(ex, set);
                      return (
                        <div key={setIdx} className="flex justify-between items-center py-1.5 border-b border-gray-50 last:border-0">
                          <div className="flex items-center gap-3">
                            <span className="text-[10px] font-mono font-bold text-gray-400">第 {setIdx + 1} 组</span>
                            <div className="flex items-baseline gap-1.5">
                              <span className="text-sm font-mono font-black text-star-dark">{setInfo.primary}</span>
                            </div>
                          </div>
                          {setInfo.secondary && (
                            <div className="flex items-center gap-1 bg-star-primary/5 px-2 py-0.5 rounded-full">
                              <span className="text-[9px] font-bold text-gray-400 uppercase tracking-tighter">{setInfo.secondary}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );})}
          </div>
        </div>

        {/* 1.3 Footer Branding (Only visible in export or bottom of card) */}
        <div className="p-6 pt-0 bg-white rounded-b-[2.5rem]">
          <div className="border-t border-gray-100 pt-4 flex justify-between items-end opacity-40">
            <div className="space-y-1">
              <span className="text-[7px] font-black text-gray-400 uppercase tracking-[0.3em] block">REPORT DATA</span>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 bg-star-dark rounded flex items-center justify-center text-white text-[7px] font-black italic">SF</div>
                <span className="text-[9px] font-black italic tracking-tighter uppercase text-star-dark">Starfit MAS</span>
              </div>
            </div>
            <div className="flex gap-0.5 h-4 items-end">
              {[...Array(15)].map((_, i) => (
                <div key={i} className={`w-0.5 bg-star-dark ${i % 3 === 0 ? 'h-full' : 'h-2/3'}`}></div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 2. Non-exportable Action Area */}
      <div className="flex gap-3 px-1">
        <button 
          onClick={handleViewDetails}
          className="flex-1 group relative flex items-center justify-center gap-2 px-4 py-3.5 bg-white border border-gray-200 rounded-[1.5rem] shadow-sm hover:border-star-dark transition-all duration-300 active:scale-95"
        >
          <div className="w-7 h-7 rounded-xl bg-gray-50 flex items-center justify-center text-star-dark group-hover:bg-star-dark group-hover:text-white transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607zM10.5 7.5v6m3-3h-6" />
            </svg>
          </div>
          <span className="text-xs font-black text-star-dark italic uppercase tracking-widest">
            查看详情
          </span>
        </button>

        <button 
          onClick={handleSaveImage} 
          disabled={isSaving}
          className="flex-1 group relative flex items-center justify-center gap-2 px-4 py-3.5 bg-star-dark rounded-[1.5rem] shadow-lg shadow-gray-200 hover:scale-[1.02] transition-all duration-300 active:scale-95 disabled:opacity-70 disabled:scale-100 overflow-hidden"
        >
          {/* Shine effect */}
          <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000"></div>

          {isSaving ? (
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
          ) : (
            <div className="w-7 h-7 rounded-xl bg-white/10 flex items-center justify-center text-star-accent">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
            </div>
          )}
          <span className="text-xs font-black text-white italic uppercase tracking-widest">
            {isSaving ? '生成中...' : '保存海报'}
          </span>
        </button>
      </div>
    </div>
  );
};
