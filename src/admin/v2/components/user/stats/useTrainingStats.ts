import { useMemo } from 'react';
import { startOfWeek, subWeeks, format, isSameDay, addDays } from 'date-fns';
import { zhCN } from 'date-fns/locale';

export type MuscleGroup = 'chest' | 'back' | 'legs' | 'shoulders' | 'arms' | 'abs' | 'cardio' | 'other';

export interface TrainingStats {
    weeklyFrequency: { date: string; count: number; active: boolean }[];
    volumeTrend: { date: string; volume: number }[];
    typeDistribution: { name: string; value: number; color: string }[];
    muscleHeatmap: Record<MuscleGroup, number>; // 0-1 intensity
    highlights: {
        totalWorkoutsMonth: number;
        avgDuration: number;
        favMuscle: string;
    };
}

// Fallback logic to map various raw names to standard muscle groups
const mapMuscleGroup = (rawGroup: string): MuscleGroup => {
    const lower = rawGroup.toLowerCase();
    if (lower.includes('chest') || lower.includes('pec')) return 'chest';
    if (lower.includes('back') || lower.includes('lat') || lower.includes('trap')) return 'back';
    if (lower.includes('leg') || lower.includes('quad') || lower.includes('ham') || lower.includes('glute') || lower.includes('calf')) return 'legs';
    if (lower.includes('shoulder') || lower.includes('delt')) return 'shoulders';
    if (lower.includes('arm') || lower.includes('bicep') || lower.includes('tricep')) return 'arms';
    if (lower.includes('abs') || lower.includes('core')) return 'abs';
    if (lower.includes('cardio') || lower.includes('run')) return 'cardio';
    return 'other';
};

export const useTrainingStats = (sessions: any[]): TrainingStats => {
    return useMemo(() => {
        // 1. Weekly Frequency (Last 12 weeks)
        const frequencyMap = new Map<string, number>();
        const today = new Date();
        const weeksToShow = 5;

        // Initialize last 5 weeks
        /* 
           Actually, standard "Github Style" heatmap is usually days. 
           Let's stick to the user's design: "Bar chart of last 5 weeks frequency"
        */

        // Let's do Daily Frequency for the last 14 days for the "Training Overview" card
        // Or simpler: Weekly count for last 5 weeks.

        const weeklyCounts: Record<string, number> = {};
        const volumeData: { date: string; volume: number }[] = [];
        const typeCount: Record<string, number> = { Strength: 0, Cardio: 0, Other: 0 };
        const muscleIntensity: Record<string, number> = {};
        let totalDuration = 0;

        // Process Sessions
        sessions.forEach(session => {
            const startTime = session.start_time;
            if (!startTime) return;

            const date = new Date(startTime);
            if (isNaN(date.getTime())) return; // Skip invalid dates

            const weekKey = format(startOfWeek(date, { weekStartsOn: 1 }), 'MM-dd');

            // Frequency
            weeklyCounts[weekKey] = (weeklyCounts[weekKey] || 0) + 1;

            // Volume & Muscles
            let sessionVolume = 0;
            let hasStrength = false;
            let hasCardio = false;

            if (session.exercises) {
                session.exercises.forEach((ex: any) => {
                    // Type
                    const type = ex.exercise_type || 'unknown';
                    if (['resistance', 'strength', 'bodyweight'].some(t => type.includes(t))) hasStrength = true;
                    if (['cardio', 'run', 'cycling'].some(t => type.includes(t))) hasCardio = true;

                    // Volume
                    if (ex.sets) {
                        ex.sets.forEach((set: any) => {
                            const vol = (parseFloat(set.weight) || 0) * (parseFloat(set.reps) || 0);
                            sessionVolume += vol;
                        });
                    }

                    // Muscle Heatmap
                    // Looking for target_muscle or body_part or deriving from name
                    // Using a heuristic for now if muscle_groups is not strictly parsed
                    const group = mapMuscleGroup(ex.target_muscle || ex.name || '');
                    muscleIntensity[group] = (muscleIntensity[group] || 0) + (ex.sets?.length || 1);
                });
            }

            // Valid cardio session might have 0 strength volume but distance? 
            // For now track raw "tonnage"
            volumeData.push({
                date: format(date, 'MM/dd'),
                volume: Math.round(sessionVolume)
            });

            if (hasStrength) typeCount.Strength++;
            else if (hasCardio) typeCount.Cardio++;
            else typeCount.Other++;

            if (session.duration) totalDuration += session.duration;
        });

        // Format Weekly Frequency for Chart
        const weeklyFrequency = [];
        for (let i = weeksToShow - 1; i >= 0; i--) {
            const d = subWeeks(today, i);
            const key = format(startOfWeek(d, { weekStartsOn: 1 }), 'MM-dd');
            weeklyFrequency.push({
                date: key,
                count: weeklyCounts[key] || 0,
                active: i === 0 // Highlight current week
            });
        }

        // Format Type Distribution
        const typeDistribution = [
            { name: '力量', value: typeCount.Strength, color: '#3b82f6' }, // Blue
            { name: '有氧', value: typeCount.Cardio, color: '#f59e0b' }, // Amber
            { name: '其他', value: typeCount.Other, color: '#9ca3af' }, // Gray
        ].filter(d => d.value > 0);

        // Normalize Muscle Heatmap
        const maxIntensity = Math.max(...Object.values(muscleIntensity), 1);
        const normalizedHeatmap = Object.keys(muscleIntensity).reduce((acc, key) => {
            acc[key as MuscleGroup] = muscleIntensity[key] / maxIntensity;
            return acc;
        }, {} as Record<MuscleGroup, number>);

        return {
            weeklyFrequency,
            volumeTrend: volumeData.reverse().slice(0, 10), // Last 10 sessions
            typeDistribution,
            muscleHeatmap: normalizedHeatmap,
            highlights: {
                totalWorkoutsMonth: sessions.length, // Simplified
                avgDuration: Math.round(totalDuration / (sessions.length || 1) / 60),
                favMuscle: Object.entries(muscleIntensity).sort((a, b) => b[1] - a[1])[0]?.[0] || '全身'
            }
        };
    }, [sessions]);
};
