import React from 'react';
import { Exercise, ExerciseSet } from '../types';
import SwipeableRow from './SwipeableRow';

interface ExerciseCardProps {
  exercise: Exercise;
  onUpdateSet: (exerciseId: string, setId: string, updates: Partial<ExerciseSet>) => void;
  onOpenSettings: (exerciseId: string) => void;
  onOpenTutorial: (exerciseId: string) => void;
  onDelete: (exerciseId: string) => void;
}

const ExerciseCard: React.FC<ExerciseCardProps> = ({ exercise, onUpdateSet, onOpenSettings, onOpenTutorial, onDelete }) => {
  
  return (
    <SwipeableRow
        className="mb-4 rounded-2xl shadow-sm border border-gray-100 bg-white"
        actionWidth={80}
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
        <div className="bg-white p-5 h-full relative overflow-hidden">
            {/* Header Indicator */}
            <div className="absolute top-0 left-0 bottom-0 w-1.5 bg-star-accent opacity-0 group-hover:opacity-100 transition-opacity" />
            
            <div className="flex justify-between items-center mb-6 pl-2">
                <div>
                    <h3 className="text-lg font-bold text-gray-900 leading-tight">{exercise.name}</h3>
                    <div className="flex gap-1.5 mt-1">
                        {exercise.type === 'assisted' && <span className="text-[9px] font-black uppercase tracking-wider bg-blue-50 text-star-accent px-1.5 py-0.5 rounded-md">Assisted</span>}
                        {exercise.type === 'bodyweight' && <span className="text-[9px] font-black uppercase tracking-wider bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-md">Bodyweight</span>}
                    </div>
                </div>
                <div className="text-gray-300">
                     <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4 opacity-40">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                </div>
            </div>

            <div className="space-y-6">
                {exercise.sets.map((set, index) => (
                <div key={set.id} className="flex items-center group/set">
                    <button
                    onClick={() => onUpdateSet(exercise.id, set.id, { completed: !set.completed })}
                    className={`
                        w-8 h-8 rounded-full border-2 mr-5 flex items-center justify-center transition-all duration-200 flex-shrink-0
                        active:scale-90
                        ${set.completed 
                        ? 'bg-star-accent border-star-accent shadow-lg shadow-blue-100' 
                        : 'border-gray-200 hover:border-star-accent bg-gray-50'}
                    `}
                    >
                    {set.completed && (
                        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                    )}
                    </button>

                    <div className={`flex-1 flex items-center justify-between text-base transition-all duration-300 ${set.completed ? 'opacity-30 grayscale' : 'text-gray-900'}`}>
                    <span className="font-mono text-gray-300 font-black text-xs tracking-tighter w-6">{(index + 1).toString().padStart(2,'0')}</span>
                    
                    <div className="flex gap-8">
                        {(set.weight !== undefined && exercise.type !== 'cardio') && (
                            <div className="flex flex-col items-center min-w-[3rem]">
                                <span className="font-black text-xl tracking-tight">{set.weight}</span>
                                <span className="text-[9px] text-gray-400 font-black uppercase tracking-widest">
                                    {exercise.type === 'assisted' ? 'Asst' : (exercise.type === 'bodyweight' && set.weight > 0) ? '+Kg' : 'Kg'}
                                </span>
                            </div>
                        )}

                        <div className="flex flex-col items-center min-w-[3rem]">
                            <span className="font-black text-xl tracking-tight">
                                {exercise.type === 'cardio' || exercise.type === 'isometric' 
                                    ? (set.targetDuration || set.duration || 0)
                                    : set.reps}
                            </span>
                            <span className="text-[9px] text-gray-400 font-black uppercase tracking-widest">
                                {exercise.type === 'cardio' || exercise.type === 'isometric' ? 'Sec' : 'Reps'}
                            </span>
                        </div>
                    </div>

                    {set.rpe ? (
                        <span className="text-xs font-bold px-2 py-1 rounded-md text-white min-w-[2.5rem] text-center" style={{ backgroundColor: set.rpe > 8 ? '#ef4444' : set.rpe > 6 ? '#fb923c' : '#4ade80' }}>
                        @{set.rpe}
                        </span>
                    ) : (
                        <span className="w-10"></span>
                    )}
                    </div>
                </div>
                ))}
            </div>
        </div>
    </SwipeableRow>
  );
};

export default ExerciseCard;
