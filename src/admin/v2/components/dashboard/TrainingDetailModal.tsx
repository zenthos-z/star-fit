/**
 * Training Detail Modal
 *
 * 训练详情弹窗
 */

import React from 'react';
import { Button } from '../ui/Button';
import { X, Clock, Dumbbell } from 'lucide-react';

interface TrainingDetailModalProps {
  session: {
    id: string;
    userName: string;
    title: string;
    startTime: string;
    duration: number;
    exercises: any[];
    totalVolume: number;
  };
  isOpen: boolean;
  onClose: () => void;
}

export const TrainingDetailModal: React.FC<TrainingDetailModalProps> = ({
  session,
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null;

  const formatTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleString('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch (e) {
      return '--';
    }
  };

  const formatDuration = (seconds: number) => {
    if (!seconds) return '0分钟';
    const mins = Math.floor(seconds / 60);
    if (mins < 60) return `${mins}分钟`;
    const hrs = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return `${hrs}小时${remainingMins}分钟`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-bold">训练详情</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X size={20} />
          </button>
        </div>
        
        {/* Content */}
        <div className="p-4 space-y-4 overflow-y-auto">
        {/* 头部信息 */}
        <div className="border-b pb-4">
          <h3 className="font-bold text-lg">{session.title}</h3>
          <p className="text-gray-500 text-sm">用户: {session.userName}</p>
          <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
            <span className="flex items-center gap-1">
              <Clock size={14} />
              {formatTime(session.startTime)}
            </span>
            <span>时长: {formatDuration(session.duration)}</span>
          </div>
        </div>

        {/* 统计 */}
        <div className="flex gap-4">
          <div className="bg-gray-50 px-4 py-2 rounded-lg">
            <span className="text-gray-500 text-sm">总容量</span>
            <p className="font-bold text-lg">{(session.totalVolume / 1000).toFixed(1)}k kg</p>
          </div>
          <div className="bg-gray-50 px-4 py-2 rounded-lg">
            <span className="text-gray-500 text-sm">动作数</span>
            <p className="font-bold text-lg">{session.exercises.length} 个</p>
          </div>
        </div>

        {/* 动作详情 */}
        <div className="space-y-3">
          <h4 className="font-semibold flex items-center gap-2">
            <Dumbbell size={16} className="text-star-accent" />
            动作记录
          </h4>
          
          {session.exercises.map((ex: any, idx: number) => (
            <div key={idx} className="bg-gray-50 rounded-lg p-3">
              <div className="font-medium mb-2">{ex.name}</div>
              <div className="grid grid-cols-3 gap-2 text-sm">
                {ex.sets?.map((s: any, sIdx: number) => (
                  <div key={sIdx} className="bg-white rounded px-2 py-1 text-center">
                    <span className="text-gray-400 text-xs">第{s.index + 1}组</span>
                    <div className="font-medium">
                      {s.weight ? `${s.weight}kg × ` : ''}{s.reps || s.duration || '-'}
                    </div>
                    {s.rpe && <div className="text-xs text-gray-400">RPE {s.rpe}</div>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* 关闭按钮 */}
        <div className="flex justify-end pt-4 border-t">
          <Button variant="outline" onClick={onClose}>
            <X size={16} className="mr-1" />
            关闭
          </Button>
        </div>
        </div>
      </div>
    </div>
  );
};
