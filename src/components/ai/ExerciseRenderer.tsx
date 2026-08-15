import React from 'react';
import { v4 as uuidv4 } from 'uuid';
import { eventTracking, TrackingEvent } from '../../../services/eventTracking';

interface ExerciseRendererProps {
  uiHint: any;
  onConfirm: (payload: any) => void;
  onCancel?: () => void;
}

const ExerciseRenderer: React.FC<ExerciseRendererProps> = ({ uiHint, onConfirm, onCancel }) => {
  if (!uiHint) return null;

  const { type, data } = uiHint;

  const handleConfirm = (payload: any) => {
    // Track the interaction
    if (type === 'workout_plan') {
      eventTracking.track(TrackingEvent.AI_PLAN_CONFIRMED, { 
        mode: payload.mode, 
        exerciseCount: data.length 
      });
    } else {
      eventTracking.track(TrackingEvent.HITL_RESPONSE, { 
        type, 
        action: payload.action,
        data: data
      });
    }
    onConfirm(payload);
  };

  switch (type) {
    case 'workout_plan':
      return (
        <div className="bg-slate-800 rounded-xl p-4 my-2 border border-blue-500/30">
          <h3 className="text-blue-400 font-bold mb-3 flex items-center">
            <span className="mr-2">📋</span> 建议训练计划
          </h3>
          <div className="space-y-3">
            {data.map((ex: any, idx: number) => (
              <div key={idx} className="bg-slate-700/50 p-3 rounded-lg border border-slate-600">
                <div className="flex justify-between items-center mb-1">
                  <span className="font-medium text-slate-100">{ex.name}</span>
                  <span className="text-xs text-slate-400">{ex.type === 'resistance' ? '抗阻训练' : '有氧训练'}</span>
                </div>
                <div className="text-sm text-slate-400">
                  {ex.sets?.length} 组 · {ex.sets?.[0]?.reps} 次 · {ex.sets?.[0]?.weight}kg
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-4">
            <button 
              onClick={() => handleConfirm({ mode: 'replace' })}
              className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-2 rounded-lg text-sm font-medium transition-colors"
            >
              覆盖当前计划
            </button>
            <button 
              onClick={() => handleConfirm({ mode: 'append' })}
              className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-2 rounded-lg text-sm font-medium transition-colors"
            >
              追加到后面
            </button>
          </div>
        </div>
      );

    case 'hitl_confirm':
      return (
        <div className="bg-amber-900/20 rounded-xl p-4 my-2 border border-amber-500/30">
          <h3 className="text-amber-400 font-bold mb-2 flex items-center">
            <span className="mr-2">⚠️</span> 安全确认
          </h3>
          <p className="text-sm text-slate-300 mb-4">{data.message || '系统检测到潜在风险，请确认。'}</p>
          <div className="flex gap-2">
            <button 
              onClick={() => handleConfirm({ action: 'accept' })}
              className="flex-1 bg-amber-600 hover:bg-amber-500 text-white py-2 rounded-lg text-sm font-medium transition-colors"
            >
              确认并继续
            </button>
            <button 
              onClick={() => handleConfirm({ action: 'reject' })}
              className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-2 rounded-lg text-sm font-medium transition-colors"
            >
              放弃该动作
            </button>
          </div>
        </div>
      );

    case 'strength_adjust':
      return (
        <div className="bg-indigo-900/20 rounded-xl p-4 my-2 border border-indigo-500/30">
          <h3 className="text-indigo-400 font-bold mb-2 flex items-center">
            <span className="mr-2">⚡</span> 强度调整建议
          </h3>
          <p className="text-sm text-slate-300 mb-2">{data.reason}</p>
          <div className="bg-slate-800/50 p-3 rounded-lg mb-4 flex items-center justify-between">
            <div className="text-center flex-1">
              <div className="text-xs text-slate-500">当前</div>
              <div className="text-lg font-bold text-slate-300 line-through">{data.oldWeight}kg</div>
            </div>
            <div className="text-indigo-400 mx-2">➡️</div>
            <div className="text-center flex-1">
              <div className="text-xs text-indigo-400 font-bold">建议</div>
              <div className="text-lg font-bold text-indigo-400">{data.newWeight}kg</div>
            </div>
          </div>
          <div className="flex gap-2">
            <button 
              onClick={() => handleConfirm({ action: 'accept' })}
              className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white py-2 rounded-lg text-sm font-medium transition-colors"
            >
              接受调整
            </button>
            <button 
              onClick={() => handleConfirm({ action: 'reject' })}
              className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-2 rounded-lg text-sm font-medium transition-colors"
            >
              维持原样
            </button>
          </div>
        </div>
      );

    default:
      // [FIX] 直接展示原始数据，移除冗余的兜底提示
      return (
        <div className="bg-slate-800 rounded-xl p-3 my-2 border border-slate-700">
          <div className="text-xs text-slate-500 mb-2">未知类型: {type}</div>
          <pre className="text-xs text-slate-400 whitespace-pre-wrap bg-slate-900/50 p-2 rounded overflow-auto max-h-40">
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      );
  }
};

export default ExerciseRenderer;
