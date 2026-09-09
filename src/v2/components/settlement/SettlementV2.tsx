import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Session } from '../../../../types';
import { WorkoutSession } from '../../types/protocol';
import { APP_NAME } from '../../../../constants';
import { toPng } from 'html-to-image';
import { PosterPromptGeneratorV2 } from '../poster/PosterPromptGeneratorV2';
import { convertSessionToWorkoutSession } from '../../utils/typeBridge';
import { calculateExerciseVolume } from '../../lib/settlementSummary';
import { buttonPress, tapScale, staggerContainer, staggerItem, transitions } from '../../lib/animations';
import { setTabBarHidden } from '../../../lib/nativeTabBar';

interface SettlementV2Props {
  session: Session;
  onClose: () => void;
  onReuse?: () => void;
}

const SettlementV2: React.FC<SettlementV2Props> = ({ session, onClose, onReuse }) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showPosterGenerator, setShowPosterGenerator] = useState(false);

  const workoutSession = convertSessionToWorkoutSession(session);

  // iOS sheet 规范：训练战报是结算 sheet，呈现时盖住原生 tab bar，关闭恢复
  useEffect(() => {
    setTabBarHidden(true);
    return () => setTabBarHidden(false);
  }, []);
  const endTime = session.endTime || Date.now();
  const durationMinutes = Math.floor((endTime - session.startTime - session.pausedDuration) / 1000 / 60);

  // 容量计算已抽取为纯函数 src/v2/lib/settlementSummary.ts（有单测钉死口径）
  const totalVolume = session.exercises.reduce((acc, ex) => acc + calculateExerciseVolume(ex), 0);
  const totalSets = session.exercises.reduce((acc, ex) => acc + ex.sets.filter(s => s.completed).length, 0);

  const getExerciseStats = (ex: any) => {
    const completedSets = ex.sets.filter((s: any) => s.completed);
    const setNum = completedSets.length;
    
    const weights = completedSets.map((s: any) => s.weight || 0);
    const maxWeight = weights.length > 0 ? Math.max(...weights) : 0;
    const totalReps = completedSets.reduce((acc: number, s: any) => acc + (s.reps || 0), 0);
    const totalVolume = completedSets.reduce((acc: number, s: any) => acc + (s.weight || 0) * (s.reps || 0), 0);

    return { setNum, maxWeight, totalReps, totalVolume };
  };

  const dateObj = new Date(session.startTime);
  const dateStr = dateObj.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
  const timeStr = dateObj.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  const dateSlug = dateObj.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
  const timeSlug = timeStr.replace(/:/g, '-');
  const trainingName = (session.exercises.map(e => e.name).slice(0, 3).join('_')) || '训练';
  const trainingSlug = trainingName.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9\u4e00-\u9fa5-_]/g, '');

  const handleAiGen = () => {
    setShowPosterGenerator(true);
  };

  const handleSaveCard = async () => {
    if (!cardRef.current) return;
    try {
      setIsSaving(true);
      const dataUrl = await toPng(cardRef.current, {
        cacheBust: true,
        backgroundColor: '#ffffff',
        pixelRatio: 2
      });
      const link = document.createElement('a');
      link.download = `${trainingSlug}_${dateSlug}_${timeSlug}.png`;
      link.href = dataUrl;
      link.click();
    } catch (e: any) {
      console.error('Save image failed:', e);
      alert('保存图片失败，请重试或使用截屏保存。');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95, y: 30 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: 20 }}
      transition={transitions.spring}
      className="fixed inset-0 bg-star-gray z-[100] overflow-y-auto overflow-x-hidden"
      style={{ WebkitOverflowScrolling: 'touch' }}
    >
      <motion.div
        variants={staggerContainer}
        initial="initial"
        animate="animate"
        className="min-h-full flex flex-col items-center px-4 pt-8 pb-60"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)',
          paddingLeft: 'max(16px, env(safe-area-inset-left, 0px))',
          paddingRight: 'max(16px, env(safe-area-inset-right, 0px))'
        }}
      >

        {/* Header Navigation —— iOS 规范：返回/关闭按钮在左侧 */}
        <motion.div variants={staggerItem} className="w-full max-w-md flex items-center gap-3 mb-8 px-2">
          <button
            onClick={onClose}
            aria-label="返回"
            className="flex-shrink-0 w-11 h-11 rounded-full bg-white shadow-sm text-star-dark flex items-center justify-center border border-gray-100 active:bg-gray-100 active:scale-95 transition-all"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-lg font-black text-gray-900 tracking-tighter leading-none">训练战报</h1>
          </div>
        </motion.div>

        {/* Main Summary Bubble (Card) */}
        <motion.div
          variants={staggerItem}
          ref={cardRef}
          id="share-card"
          className="w-full max-w-md bg-white text-star-dark shadow-2xl rounded-[2.5rem] relative flex flex-col overflow-hidden border border-gray-100"
        >
          {/* 1. Sporty Header Area */}
          <div className="bg-star-dark p-6 pb-8 relative overflow-hidden rounded-t-[40px]">
            {/* Decorative Patterns */}
            <div className="absolute top-0 right-0 opacity-10 pointer-events-none transform translate-x-1/4 -translate-y-1/4">
              <svg width="200" height="200" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="45" stroke="white" strokeWidth="1" fill="none" />
                <circle cx="50" cy="50" r="35" stroke="white" strokeWidth="0.5" fill="none" />
                <path d="M0 50 L100 50 M50 0 L50 100" stroke="white" strokeWidth="0.5" />
              </svg>
            </div>

            <div className="relative z-10">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h1 className="text-4xl font-black italic tracking-tighter text-white uppercase leading-[0.85]">
                    {APP_NAME}<br />
                    <span className="text-star-accent text-2xl">训练总结</span>
                  </h1>
                  <div className="mt-3 flex items-center gap-2">
                    <span className="text-[9px] font-mono text-gray-400 uppercase tracking-[0.3em] font-bold">数字日志</span>
                    <span className="w-1 h-1 rounded-full bg-star-accent"></span>
                    <span className="text-[9px] font-mono text-gray-400 uppercase tracking-[0.3em] font-bold">官方认证</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="inline-block bg-star-accent text-star-dark text-[9px] font-black italic px-2.5 py-0.5 rounded-full mb-1.5 uppercase tracking-widest shadow-[0_0_15px_rgba(188,254,47,0.3)]">
                    {session.status === 'finished' ? '已完成' : '进行中'}
                  </div>
                  <p className="text-[10px] font-mono text-gray-400 font-bold">{dateStr}</p>
                  <p className="text-[10px] font-mono text-gray-400">{timeStr}</p>
                </div>
              </div>

              {/* Metrics Grid */}
              <div className="grid grid-cols-3 gap-4">
                <div className="flex flex-col">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <div className="w-0.5 h-2.5 bg-star-accent rounded-full"></div>
                    <span className="text-[9px] text-gray-500 font-black uppercase tracking-widest">总时长</span>
                  </div>
                  <div className="text-2xl font-mono font-black text-white italic">
                    {durationMinutes}<span className="text-xs text-gray-500 ml-0.5 not-italic font-bold">分</span>
                  </div>
                </div>
                <div className="flex flex-col border-l border-white/10 pl-4">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <div className="w-0.5 h-2.5 bg-blue-500 rounded-full"></div>
                    <span className="text-[9px] text-gray-500 font-black uppercase tracking-widest">总容量</span>
                  </div>
                  <div className="text-2xl font-mono font-black text-white italic">
                    {totalVolume}<span className="text-xs text-gray-500 ml-0.5 not-italic font-bold">kg</span>
                  </div>
                </div>
                <div className="flex flex-col border-l border-white/10 pl-4">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <div className="w-0.5 h-2.5 bg-purple-500 rounded-full"></div>
                    <span className="text-[9px] text-gray-500 font-black uppercase tracking-widest">总组数</span>
                  </div>
                  <div className="text-2xl font-mono font-black text-white italic">
                    {totalSets}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 2. Exercise List Area */}
          <div className="p-5 pt-6 space-y-5 bg-white relative z-10 min-h-[200px]">
            <div className="absolute left-7 top-6 bottom-6 w-px bg-gray-50"></div>
            
            {session.exercises.map((ex, i) => {
              const stats = getExerciseStats(ex);
              const hasCompletedSets = (stats?.setNum || 0) > 0;

              return (
                <div key={ex.id || i} className="relative pl-8 group">
                  {/* Timeline Node */}
                  <div className="absolute left-[4px] top-1 w-2.5 h-2.5 rounded-full bg-white border-2 border-star-dark z-10 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <div className={`w-0.5 h-0.5 rounded-full ${hasCompletedSets ? 'bg-star-accent' : 'bg-gray-300'}`}></div>
                  </div>

                  <div className="flex justify-between items-baseline mb-3 gap-4">
                    <h3 className={`font-black text-xl leading-none italic uppercase tracking-tighter transition-colors ${hasCompletedSets ? 'text-star-dark group-hover:text-black' : 'text-gray-400'}`}>
                      {ex.name}
                    </h3>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] font-mono text-gray-400 font-bold uppercase tracking-widest">#{String(i + 1).padStart(2, '0')}</span>
                      <span className="w-0.5 h-0.5 rounded-full bg-gray-200"></span>
                      <span className={`text-[10px] font-mono font-black uppercase tracking-widest ${hasCompletedSets ? 'text-star-primary' : 'text-gray-300'}`}>
                        {ex.type === 'resistance' ? '力量训练' : ex.type === 'cardio' ? '有氧训练' : '训练'}
                      </span>
                    </div>
                  </div>

                  {/* Detailed Sets Area */}
                  <div className="bg-white border border-gray-100 rounded-[1.25rem] p-3 space-y-1 shadow-sm">
                    {ex.sets.map((set: any, idx: number) => (
                      <div key={set.id || idx} className={`flex justify-between items-center py-1.5 border-b border-gray-50 last:border-0 ${set.completed ? 'opacity-100' : 'opacity-40'}`}>
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] font-mono font-bold text-gray-400">第 {idx + 1} 组</span>
                          <div className="flex items-baseline gap-1.5">
                            <span className="text-base font-mono font-black text-star-dark">{set.weight || 0}</span>
                            <span className="text-[10px] font-bold text-gray-400 uppercase">kg</span>
                            <span className="text-sm text-gray-300 mx-0.5 font-bold">×</span>
                            <span className="text-base font-mono font-black text-star-dark">{set.reps || 0}</span>
                            <span className="text-[10px] font-bold text-gray-400 uppercase">次</span>
                          </div>
                        </div>
                        {set.completed ? (
                          set.rpe && (
                            <div className="flex items-center gap-1 bg-star-primary/5 px-2 py-0.5 rounded-full">
                              <span className="text-[9px] font-bold text-gray-400 uppercase tracking-tighter">RPE</span>
                              <span className="text-xs font-mono font-black text-star-primary">{set.rpe}</span>
                            </div>
                          )
                        ) : (
                          <span className="text-[9px] font-bold text-gray-300 uppercase tracking-tighter">未完成</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 3. Footer Area */}
          <div className="p-8 bg-white border-t border-gray-50 relative z-10 rounded-b-[2.5rem]">
            <div className="flex justify-between items-end opacity-50">
              <div className="space-y-1.5">
                <p className="text-[8px] font-black text-gray-400 uppercase tracking-[0.3em]">报告生成</p>
                <div className="flex items-center gap-1.5">
                  <div className="w-4 h-4 bg-star-dark rounded flex items-center justify-center text-white text-[9px] font-black italic">SF</div>
                  <span className="text-xs font-black italic tracking-tighter uppercase text-star-dark">Project Starfit</span>
                </div>
              </div>

              <div className="flex flex-col items-end gap-1.5">
                <div className="flex gap-0.5 h-6 items-end">
                  {[...Array(20)].map((_, i) => (
                    <div key={i} className={`w-0.5 bg-star-dark ${i % 3 === 0 ? 'h-full' : i % 2 === 0 ? 'h-2/3' : 'h-1/2'} ${Math.random() > 0.3 ? 'opacity-100' : 'opacity-20'}`}></div>
                  ))}
                </div>
                <span className="text-[8px] font-mono text-gray-400 font-bold tracking-widest uppercase">ID_{session.id.slice(0, 8).toUpperCase()}</span>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>

      {/* Floating Action Buttons */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.3 }}
        className="fixed left-0 right-0 flex justify-center gap-4 z-[110] px-6"
        style={{ bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))' }}
      >
        <motion.button
          {...buttonPress}
          onClick={handleAiGen}
          className="liquid-glass flex-1 h-[50px] text-gray-900 font-semibold text-[17px] rounded-full flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform"
        >
          <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
          </svg>
          <span>AI 海报</span>
        </motion.button>

        <motion.button
          {...tapScale}
          onClick={handleSaveCard}
          disabled={isSaving}
          className="liquid-glass-dark flex-1 h-[50px] text-white font-semibold text-[17px] rounded-full flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform disabled:opacity-60"
        >
          {isSaving ? (
            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
          ) : (
            <>
              <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              <span>保存海报</span>
            </>
          )}
        </motion.button>
      </motion.div>

      <AnimatePresence>
        {showPosterGenerator && (
          <PosterPromptGeneratorV2
            session={workoutSession}
            onClose={() => setShowPosterGenerator(false)}
          />
        )}
      </AnimatePresence>

    </motion.div>
  );
};

export default SettlementV2;
