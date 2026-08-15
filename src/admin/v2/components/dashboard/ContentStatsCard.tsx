/**
 * Content Stats Card
 *
 * 显示内容库统计信息
 */

import React from 'react';
import { Card } from '../ui/Card';
import { BookOpen, Video, Image, Clock } from 'lucide-react';

interface ContentStatsCardProps {
  stats: {
    totalExercises: number;
    withVideo: number;
    pendingVideos: number;
  } | null;
}

export const ContentStatsCard: React.FC<ContentStatsCardProps> = ({ stats }) => {
  if (!stats) {
    return (
      <Card className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
          <div className="h-8 bg-gray-200 rounded w-1/3"></div>
        </div>
      </Card>
    );
  }

  const videoPercent = stats.totalExercises > 0
    ? Math.round((stats.withVideo / stats.totalExercises) * 100)
    : 0;

  return (
    <Card className="p-6">
      <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
        <BookOpen size={20} className="text-star-accent" />
        内容库状态
      </h3>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-gray-500">动作总数</span>
          <span className="text-2xl font-bold text-gray-900">{stats.totalExercises}</span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-gray-500 flex items-center gap-1">
            <Video size={14} className="text-purple-500" />
            有视频
          </span>
          <div className="text-right">
            <span className="text-lg font-semibold text-purple-600">{stats.withVideo}</span>
            <span className="text-sm text-gray-400 ml-1">({videoPercent}%)</span>
          </div>
        </div>

        {stats.pendingVideos > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-gray-500 flex items-center gap-1">
              <Clock size={14} className="text-orange-500" />
              待转码
            </span>
            <span className="text-lg font-semibold text-orange-600">{stats.pendingVideos}</span>
          </div>
        )}
      </div>
    </Card>
  );
};
