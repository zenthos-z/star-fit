import React, { useMemo } from 'react';
import { ExerciseRenderer } from './ExerciseRenderer';
import { ExerciseAction, LoadAnchors } from '../../types/protocol';
import SwipeableRow from '../../../../components/SwipeableRow';

interface ExerciseCardV2Props {
  exercise: any;
  onUpdateSet: (exId: string, setId: string, updates: any) => void;
  onOpenSettings: (exId: string) => void;
  onOpenTutorial: (exId: string) => void;
  onDelete: (exId: string) => void;
  isPaused?: boolean;
  pauseStartTime?: number;
  loadAnchors?: LoadAnchors;
  onLongPress?: (exerciseId: string) => void;
  onDragStatusChange?: (status: 'start' | 'move' | 'end', x: number, y: number) => void;
}

/**
 * ExerciseCardV2 - Bridge component between legacy training flow and V2 Plugin architecture.
 * Wraps ExerciseRenderer with SwipeableRow for standard training list integration.
 */
export const ExerciseCardV2: React.FC<ExerciseCardV2Props> = ({
  exercise,
  onUpdateSet,
  onOpenSettings,
  onOpenTutorial,
  onDelete,
  isPaused,
  pauseStartTime,
  loadAnchors,
  onLongPress,
  onDragStatusChange
}) => {

  const v2Exercise = useMemo(() => {
    // Card type mapping for uiHint (unchanged)
    const cardTypeMap: Record<string, any> = {
      'resistance': 'resistance_standard',
      'cardio': 'cardio_running',
      'outdoor': 'outdoor_gps', // Default card for outdoor type
      'isometric': 'isometric_static',
      'bodyweight': 'resistance_standard',
      'assisted': 'resistance_standard',
      // Additional type mappings
      'unilateral': 'resistance_standard',
      'heavy_weight': 'resistance_standard',
      'rep_training': 'resistance_standard',
    };

    return {
      protocol_version: '2.0.0' as const,
      id: exercise.id,
      exerciseId: exercise.id,  // Use NanoID format
      type: exercise.type as any,  // Direct type mapping, no conversion needed
      sets: (Array.isArray(exercise.sets) ? exercise.sets : []).map((s: any, idx: number) => ({
        index: idx,
        reps: s.reps,
        weight: s.weight,
        duration: s.duration,
        status: s.completed ? 'COMPLETED' : 'PLANNED',
        rpe: s.rpe,
        restEndTime: s.restEndTime
      })),
      uiHint: {
        cardType: (exercise.type === 'outdoor' || exercise.metadata?.isOutdoor) ? 'outdoor_gps' : (cardTypeMap[exercise.type] || 'resistance_standard')
      },
      metadata: {
        name: exercise.name,
        targetRpe: exercise.targetRpe,
        cardioMode: exercise.metadata?.cardioMode,
        cardioSubtype: exercise.metadata?.cardioSubtype,
        targetDurationSec: exercise.metadata?.targetDurationSec,
        targetDistanceMeters: exercise.metadata?.targetDistanceMeters,
        targetHeartRateZone: exercise.metadata?.targetHeartRateZone,
        isOutdoor: exercise.metadata?.isOutdoor
      }
    };
  }, [exercise]);

  const handleUpdate = (updates: Partial<ExerciseAction>) => {
    if (updates.sets) {
        updates.sets.forEach((s: any) => {
            const oldSet = exercise.sets[s.index];
            if (oldSet) {
                const statusChanged = (s.status === 'COMPLETED') !== oldSet.completed;
                const durationChanged = s.duration !== undefined && s.duration !== oldSet.duration;
                const distanceChanged = s.distance !== undefined && s.distance !== oldSet.distance;
                
                // 只要有任何显式更新（包括状态、时长、距离等），就触发父组件更新
                // 这对于触发 App.tsx 中的 session 自动恢复至关重要
                if (statusChanged || durationChanged || distanceChanged || 
                    s.reps !== oldSet.reps || s.weight !== oldSet.weight || 
                    s.restEndTime !== oldSet.restEndTime || s.status !== undefined) {
                    onUpdateSet(exercise.id, oldSet.id, {
                        completed: s.status === 'COMPLETED',
                        reps: s.reps,
                        weight: s.weight,
                        duration: s.duration,
                        distance: s.distance,
                        rpe: s.rpe,
                        restEndTime: s.restEndTime
                    });
                }
            }
        });
    }
  };

  return (
    <SwipeableRow
        className="mb-4 rounded-2xl shadow-sm border border-gray-100 bg-white"
        actionWidth={80}
        onLongPress={() => onLongPress?.(exercise.id)}
        onDragStatusChange={onDragStatusChange}
        leftActions={[
            {
                label: '删除',
                icon: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>,
                color: 'bg-rose-500',
                onClick: () => onDelete(exercise.id)
            }
        ]}
        rightActions={[
            {
                label: '教学',
                icon: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" /></svg>,
                color: 'bg-star-accent',
                onClick: () => onOpenTutorial(exercise.id)
            },
            {
                label: '设置',
                icon: <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 110-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 01-1.44-4.282m3.102.069a18.03 18.03 0 01-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 018.835 2.535M10.34 6.66a23.847 23.847 0 008.835-2.535m0 0A23.74 23.74 0 0018.795 3m.38 1.125a23.91 23.91 0 011.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 001.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73m0-3.46a24.42 24.42 0 010 3.46" /></svg>,
                color: 'bg-star-dark',
                onClick: () => onOpenSettings(exercise.id)
            }
        ]}
    >
        <div className="bg-white">
            <ExerciseRenderer
                exercise={v2Exercise}
                isPaused={isPaused}
                pauseStartTime={pauseStartTime}
                loadAnchors={loadAnchors}
                onUpdate={handleUpdate}
                onSettingsClick={() => onOpenSettings(exercise.id)}
            />
        </div>
    </SwipeableRow>
  );
};
