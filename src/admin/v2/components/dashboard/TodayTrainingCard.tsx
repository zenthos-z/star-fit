/**
 * Today Training Card
 *
 * 显示今日最近的训练记录
 */

import React from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Dumbbell, Clock, User, FileText, Calendar } from 'lucide-react';

interface TodayTrainingCardProps {
  training: {
    hasTraining: boolean;
    session?: {
      id: string;
      userId: string;
      userName: string;
      title: string;
      startTime: string;
      duration: number;
      exercises: any[];
      totalVolume: number;
      hasAudit: boolean;
      auditText?: string;
    };
    todayStats: {
      inProgress: number;
      completed: number;
      totalVolume: number;
    };
  } | null;
  onViewDetail: (session: any) => void;
  onViewAudit: (session: any) => void;
}

export const TodayTrainingCard: React.FC<TodayTrainingCardProps> = ({
  training,
  onViewDetail,
  onViewAudit,
}) => {
  if (!training?.hasTraining || !training.session) {
    return (
      <Card className="p-6">
        <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
          <Dumbbell size={20} className="text-star-accent" />
          今日训练动态
        </h3>
        <div className="text-center py-8 text-gray-500 bg-gray-50 rounded-lg">
          <Calendar size={48} className="mx-auto mb-3 text-gray-300" />
          <p>今日暂无训练记录</p>
          <p className="text-sm text-gray-400 mt-1">
            {new Date().toLocaleDateString('zh-CN', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              weekday: 'long'
            })}
          </p>
        </div>
      </Card>
    );
  }

  const { session, todayStats } = training;

  // 格式化 ISO 8601 时间
  const formatTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
    } catch (e) {
      return '--:--';
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
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-gray-900 flex items-center gap-2">
          <Dumbbell size={20} className="text-star-accent" />
          今日训练动态
        </h3>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-blue-600 bg-blue-50 px-2 py-1 rounded-full">
            进行中 {todayStats.inProgress}
          </span>
          <span className="text-green-600 bg-green-50 px-2 py-1 rounded-full">
            已完成 {todayStats.completed}
          </span>
        </div>
      </div>

      <div className="bg-gradient-to-br from-gray-50 to-white rounded-xl p-5 border border-gray-100">
        {/* 训练头部信息 */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-star-accent/10 flex items-center justify-center">
              <User size={24} className="text-star-accent" />
            </div>
            <div>
              <div className="font-bold text-gray-900 text-lg">{session.userName}</div>
              <div className="text-sm text-gray-500">{session.title}</div>
            </div>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-1 text-gray-600 font-medium">
              <Clock size={16} />
              {formatTime(session.startTime)}
            </div>
            <div className="text-sm text-gray-400 mt-1">
              时长 {formatDuration(session.duration)}
            </div>
          </div>
        </div>

        {/* 统计信息 */}
        <div className="flex gap-4 mb-4 text-sm">
          <div className="bg-white px-3 py-2 rounded-lg border border-gray-100">
            <span className="text-gray-400">总容量</span>
            <span className="ml-2 font-bold text-gray-900">
              {(session.totalVolume / 1000).toFixed(1)}k kg
            </span>
          </div>
          <div className="bg-white px-3 py-2 rounded-lg border border-gray-100">
            <span className="text-gray-400">动作数</span>
            <span className="ml-2 font-bold text-gray-900">
              {session.exercises.length} 个
            </span>
          </div>
        </div>

        {/* 动作概览 */}
        <div className="space-y-2 mb-4">
          {session.exercises.slice(0, 3).map((ex: any, idx: number) => (
            <div key={idx} className="flex items-center gap-3 text-sm bg-white p-2 rounded-lg">
              <span className="text-star-accent font-medium">• {ex.name}</span>
              <span className="text-gray-400 text-xs">
                {ex.sets?.slice(0, 3).map((s: any) => (
                  <span key={s.index} className="mr-2">
                    {s.weight ? `${s.weight}kg×` : ''}{s.reps || s.duration || '-'}
                  </span>
                ))}
                {ex.sets?.length > 3 && `+${ex.sets.length - 3}组`}
              </span>
            </div>
          ))}
          {session.exercises.length > 3 && (
            <div className="text-sm text-gray-400 pl-2">
              +{session.exercises.length - 3} 个动作
            </div>
          )}
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onViewDetail(session)}
          >
            查看完整记录
          </Button>
          {session.hasAudit && (
            <Button
              variant="outline"
              size="sm"
              className="text-emerald-600 border-emerald-200 hover:bg-emerald-50"
              onClick={() => onViewAudit(session)}
            >
              <FileText size={16} className="mr-1" />
              查看AI审计
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
};
