/**
 * User Stats Card
 *
 * 显示用户统计信息
 */

import React from 'react';
import { Card } from '../ui/Card';
import { Users, TrendingUp, UserPlus } from 'lucide-react';

interface UserStatsCardProps {
  stats: {
    total: number;
    todayActive: number;
    newToday: number;
  } | null;
}

export const UserStatsCard: React.FC<UserStatsCardProps> = ({ stats }) => {
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

  return (
    <Card className="p-6">
      <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
        <Users size={20} className="text-star-accent" />
        用户概览
      </h3>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-gray-500">总用户数</span>
          <span className="text-2xl font-bold text-gray-900">{stats.total}</span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-gray-500 flex items-center gap-1">
            <TrendingUp size={14} className="text-blue-500" />
            今日活跃
          </span>
          <span className="text-lg font-semibold text-blue-600">{stats.todayActive}</span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-gray-500 flex items-center gap-1">
            <UserPlus size={14} className="text-green-500" />
            今日新增
          </span>
          <span className="text-lg font-semibold text-green-600">{stats.newToday}</span>
        </div>
      </div>
    </Card>
  );
};
