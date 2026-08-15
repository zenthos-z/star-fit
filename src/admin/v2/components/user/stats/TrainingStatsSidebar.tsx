import React from 'react';
import {
    BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, AreaChart, Area
} from 'recharts';
import { Activity, Dumbbell, Calendar, Flame } from 'lucide-react';
import { useTrainingStats } from './useTrainingStats';
import { MuscleHeatmap } from './MuscleHeatmap';

export const TrainingStatsSidebar = ({ sessions, visibleBlocks = ['highlights', 'frequency', 'volumeTrend'] }: { sessions: any[], visibleBlocks?: string[] }) => {
    const { weeklyFrequency, volumeTrend, typeDistribution, muscleHeatmap, highlights } = useTrainingStats(sessions);

    // If no data
    if (sessions.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                <Activity size={48} className="mb-2 opacity-20" />
                <p className="text-xs">开始训练以查看统计数据</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-right-4 duration-500">

            {/* 1. Highlights Grid */}
            {visibleBlocks.includes('highlights') && (
                <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white p-3 rounded-xl border border-gray-100 shadow-sm">
                        <div className="flex items-center gap-2 text-gray-400 mb-1">
                            <Dumbbell size={14} />
                            <span className="text-[10px]">本月训练</span>
                        </div>
                        <div className="text-xl font-bold text-gray-900">{highlights.totalWorkoutsMonth} <span className="text-xs font-normal text-gray-400">次</span></div>
                    </div>
                    <div className="bg-white p-3 rounded-xl border border-gray-100 shadow-sm">
                        <div className="flex items-center gap-2 text-gray-400 mb-1">
                            <Flame size={14} />
                            <span className="text-[10px]">最爱练</span>
                        </div>
                        <div className="text-lg font-bold text-gray-900 truncate">
                            {['chest', 'back', 'legs', 'shoulders', 'arms', 'abs', 'cardio', 'other'].find(k => k === highlights.favMuscle) === 'chest' ? '胸部' :
                                ['chest', 'back', 'legs', 'shoulders', 'arms', 'abs', 'cardio', 'other'].find(k => k === highlights.favMuscle) === 'back' ? '背部' :
                                    ['chest', 'back', 'legs', 'shoulders', 'arms', 'abs', 'cardio', 'other'].find(k => k === highlights.favMuscle) === 'legs' ? '腿部' :
                                        highlights.favMuscle}
                        </div>
                    </div>
                </div>
            )}

            {/* 2. Frequency Chart */}
            {visibleBlocks.includes('frequency') && (
                <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                            <Calendar size={14} className="text-blue-500" />
                            训练频率
                        </h3>
                        <span className="text-[10px] text-gray-400">过去5周</span>
                    </div>
                    <div className="h-24 w-full min-h-[96px]">
                        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                            <BarChart data={weeklyFrequency}>
                                <XAxis
                                    dataKey="date"
                                    tick={{ fontSize: 10, fill: '#9ca3af' }}
                                    axisLine={false}
                                    tickLine={false}
                                />
                                <Tooltip
                                    cursor={{ fill: '#f3f4f6' }}
                                    contentStyle={{ fontSize: '12px', border: 'none', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                />
                                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                                    {weeklyFrequency.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.active ? '#3b82f6' : '#e5e7eb'} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            {/* 3. Muscle Heatmap */}
            {visibleBlocks.includes('muscleHeatmap') && (
                <MuscleHeatmap data={muscleHeatmap} />
            )}

            {/* 4. Volume Trend */}
            {visibleBlocks.includes('volumeTrend') && (
                <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                    <h3 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
                        <Activity size={14} className="text-green-500" />
                        容量趋势 (kg)
                    </h3>
                    <div className="h-32 w-full min-h-[128px]">
                        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                            <AreaChart data={volumeTrend}>
                                <defs>
                                    <linearGradient id="colorVolume" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.1} />
                                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <XAxis hide dataKey="date" />
                                <Tooltip
                                    contentStyle={{ fontSize: '12px', border: 'none', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                />
                                <Area
                                    type="monotone"
                                    dataKey="volume"
                                    stroke="#10b981"
                                    strokeWidth={2}
                                    fillOpacity={1}
                                    fill="url(#colorVolume)"
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

        </div>
    );
};
