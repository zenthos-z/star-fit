import React, { useState } from 'react';
import { getExerciseTypeLabel } from '../../../../utils/exerciseTypeLabels';

interface PlanCardProps {
  uiHint: {
    type: 'plan_card';
    data: any[];
    context?: 'post_finish' | 'default';
    diff?: {
      added: string[];
      modified: string[];
    };
  };
  onConfirm?: (payload: { mode: 'append' | 'replace'; plan: any[] }) => void;
}

/**
 * PlanCard (PLAN_CARD) - Training Plan Proposer
 * 
 * Implements "Coach Authority" principle. Displays incremental or full plans
 * with Diff highlighting. Supports Overwrite and Append modes.
 */
export const PlanCard: React.FC<PlanCardProps> = ({ uiHint, onConfirm }) => {
  // Defensive check for data
  const plan = Array.isArray(uiHint?.data) ? uiHint.data : [];
  const diff = uiHint?.diff || { added: [], modified: [] };
  const isPostFinish = uiHint?.context === 'post_finish';
  const [clickedMode, setClickedMode] = useState<'append' | 'replace' | null>(null);

  // [DEBUG] Log the plan data to verify exercise_type field
  React.useEffect(() => {
    console.log('[PlanCard] Received plan data:', plan.map(ex => ({
      id: ex?.id,
      name: ex?.name,
      exercise_type: ex?.exercise_type,
      type: ex?.type,
      sets: ex?.sets,
      reps: ex?.reps
    })));
  }, [plan]);

  const handleClick = (mode: 'append' | 'replace') => {
    setClickedMode(mode);
    onConfirm?.({ mode, plan });
  };

  return (
    <div className="bg-white border border-gray-100 rounded-[2.5rem] overflow-hidden shadow-xl">
      <div className="bg-star-dark px-5 py-4 flex items-center gap-3 rounded-t-[2.5rem]">
        <div className="w-1 h-6 bg-star-accent rounded-full"></div>
        <div>
          <span className="text-sm font-bold text-white uppercase tracking-wider">建议训练计划</span>
          <p className="text-[10px] text-gray-500 mt-0.5">根据您的训练数据智能生成</p>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {plan.map((item, idx) => {
          const isAdded = diff?.added?.includes(item?.exerciseId);
          const isModified = diff?.modified?.includes(item?.exerciseId);

          return (
            <div 
              key={idx} 
              className={`p-3 rounded-2xl border ${
                isAdded ? 'bg-emerald-50 border-emerald-100' : 
                isModified ? 'bg-amber-50 border-amber-100' : 
                'bg-gray-50 border-gray-100'
              }`}
            >
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2">
                  <h4 className="font-black text-sm text-star-dark italic uppercase tracking-tighter">
                    {item?.name || item?.exerciseId?.split('/').pop()?.replace(/_/g, ' ') || '未知动作'}
                  </h4>
                  {/* [NEW] Display exercise type label */}
                  {item?.exercise_type && (
                    <span className="text-[9px] px-2 py-0.5 bg-blue-50 text-blue-500 rounded-full font-bold uppercase tracking-wider border border-blue-100">
                      {getExerciseTypeLabel(item.exercise_type)}
                    </span>
                  )}
                </div>
                {isAdded && (
                  <span className="text-[10px] px-2 py-0.5 bg-emerald-500 text-white rounded-full font-bold uppercase tracking-wider">新增</span>
                )}
                {isModified && (
                  <span className="text-[10px] px-2 py-0.5 bg-amber-500 text-white rounded-full font-bold uppercase tracking-wider">已修改</span>
                )}
              </div>
              <div className="flex gap-4 text-xs text-gray-500 font-bold">
                <span className="flex items-center gap-1">
                  <span className="text-gray-400 uppercase text-[10px]">组</span>
                  <span className="text-star-dark font-black">{item?.sets || 0}</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="text-gray-400 uppercase text-[10px]">次</span>
                  <span className="text-star-dark font-black">{item?.reps || 0}</span>
                </span>
                {item?.weight && (
                  <span className="flex items-center gap-1">
                    <span className="text-gray-400 uppercase text-[10px]">kg</span>
                    <span className="text-star-dark font-black">{item.weight}</span>
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="p-5 pt-0 flex gap-3">
        {isPostFinish ? (
          <button
            onClick={() => handleClick('replace')}
            disabled={!!clickedMode}
            className="flex-1 group relative flex items-center justify-center gap-2 px-4 py-3.5 bg-star-dark rounded-[1.25rem] shadow-lg shadow-gray-200 hover:scale-[1.02] transition-all duration-300 active:scale-95 disabled:opacity-70 disabled:scale-100 overflow-hidden"
          >
            <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000"></div>
            <div className="w-7 h-7 rounded-xl bg-white/10 flex items-center justify-center text-star-accent">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <span className="text-xs font-black text-white italic uppercase tracking-widest">
              {clickedMode ? '已添加' : '明日训练'}
            </span>
          </button>
        ) : (
          <>
            <button
              onClick={() => handleClick('replace')}
              disabled={!!clickedMode}
              className="flex-1 group relative flex items-center justify-center gap-2 px-4 py-3.5 bg-star-dark rounded-[1.25rem] shadow-lg shadow-gray-200 hover:scale-[1.02] transition-all duration-300 active:scale-95 disabled:opacity-70 disabled:scale-100 overflow-hidden"
            >
              <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000"></div>
              <div className="w-7 h-7 rounded-xl bg-white/10 flex items-center justify-center text-star-accent">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                </svg>
              </div>
              <span className="text-xs font-black text-white italic uppercase tracking-widest">
                {clickedMode === 'replace' ? '已添加' : '完全覆盖'}
              </span>
            </button>
            <button
              onClick={() => handleClick('append')}
              disabled={!!clickedMode}
              className="flex-1 group relative flex items-center justify-center gap-2 px-4 py-3.5 bg-white border border-gray-200 rounded-[1.25rem] shadow-sm hover:border-star-dark transition-all duration-300 active:scale-95 disabled:opacity-70"
            >
              <div className="w-7 h-7 rounded-xl bg-gray-50 flex items-center justify-center text-star-dark group-hover:bg-star-dark group-hover:text-white transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              </div>
              <span className="text-xs font-black text-star-dark italic uppercase tracking-widest">
                {clickedMode === 'append' ? '已添加' : '追加到末尾'}
              </span>
            </button>
          </>
        )}
      </div>
    </div>
  );
};
