import React, { useState, useEffect } from 'react';
import { ExerciseAction } from '../../types/protocol';
import { deviationBuffer } from '../../services/DeviationBuffer';
import { DeviationWarningModal } from '../DeviationWarningModal';
import { BatchOps, PatchOp } from '../../services/protocol/BatchOps';
import { socketService } from '../../services/transport/WebSocketClient';
import { EXERCISE_TYPES_CONFIG, RPE_ZONES } from '../../../../constants';
import { predictMetrics } from '../../../services/geminiService';

interface ExerciseSettingsModalProps {
  exercise: ExerciseAction;
  onClose: () => void;
  onSave: (exerciseId: string, updates: Partial<ExerciseAction>) => void;
  exerciseIndex: number;
}

/**
 * ExerciseSettingsModal (V2)
 * 
 * Upgraded version of the settings modal with:
 * 1. DeviationLogger integration for tracking significant intent changes.
 * 2. BatchOps protocol support for atomic state synchronization.
 * 3. L1-L3 Context alignment.
 */
export const ExerciseSettingsModal: React.FC<ExerciseSettingsModalProps> = ({ 
  exercise, 
  onClose, 
  onSave,
  exerciseIndex
}) => {
  // Basic Info (L1 State)
  const [name] = useState(exercise.exerciseId.replace('fit://library/exercise/', ''));
  const [type] = useState(exercise.type);
  const [targetRpe, setTargetRpe] = useState(exercise.metadata?.targetRpe || 7);
  const [originalRpe] = useState(exercise.metadata?.targetRpe || 7);
  const [isCustomAction] = useState(!exercise.exerciseId.startsWith('fit://library/exercise/'));

  // UI States
  const [isCalculating, setIsCalculating] = useState(false);
  const [showDeviationWarning, setShowDeviationWarning] = useState(false);
  const [deviationReason, setDeviationReason] = useState('');

  // Sets (L1 State)
  const [sets, setSets] = useState([...exercise.sets]);
  const [maxHrHeuristic, setMaxHrHeuristic] = useState<number | null>(null);
  const [oneRepMaxHeuristic, setOneRepMaxHeuristic] = useState<number | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState<any>(null);
  const [editingValues, setEditingValues] = useState<Record<string, string>>({});

  // 1. Context Warm-up (Section 2.3.4 of Refactor Guide)
  useEffect(() => {
    socketService.send('architect.warmup', {
      exerciseId: exercise.exerciseId,
      timestamp: Date.now(),
      context: {
        scene: 'exercise_settings',
        type: exercise.type
      }
    });

    // 2. Subscribe to Asynchronous Shadow Analyst (Section 2.3.3)
    const unsubscribe = socketService.subscribe('architect.prediction', (payload) => {
      console.log('[Shadow Analyst] Received prediction:', payload);
      setAiSuggestion(payload);
      setIsCalculating(false);
    });

    return () => unsubscribe();
  }, [exercise.exerciseId, exercise.type]);

  // AI Prediction Logic (Legacy Bridge & L1 Heuristics)
  useEffect(() => {
    const timer = setTimeout(async () => {
      setIsCalculating(true);
      try {
        // [HEURISTIC_VALIDATION] Tanaka Max HR Heuristic (Edge L1)
        if (type === 'cardio') {
          const age = 30; // Default or from context
          const maxHr = Math.round(208 - (0.7 * age));
          setMaxHrHeuristic(maxHr);
        }

        // [HEURISTIC_VALIDATION] 1RM Safety Boundary (Edge L1)
        if (type === 'resistance' || type === 'bodyweight' || type === 'assisted' || type === 'unilateral') {
           // Simple 1RM estimate from current sets (Brzycki formula)
           const maxEst = Math.max(...sets.map(s => s.weight / (1.0278 - 0.0278 * s.reps)));
           setOneRepMaxHeuristic(Math.round(maxEst * 10) / 10);
        }

        // 3. Config-Stream Backpressure (Section 2.3.2)
        // Instead of pure HTTP, we notify MAS of the current "intent" state
        socketService.send('architect.intent_update', {
          exerciseId: exercise.exerciseId,
          targetRpe,
          sets: sets.map(s => ({ weight: s.weight, reps: s.reps })),
          timestamp: Date.now()
        });

        // Fallback to legacy prediction if WS not responding (Shadow Mode)
        const predicted = await predictMetrics(name, type.toLowerCase() as any, targetRpe);
        if (!aiSuggestion) setAiSuggestion(predicted);
      } catch (e) {
        console.error("AI Prediction failed", e);
      } finally {
        setIsCalculating(false);
      }
    }, 500); // 500ms Backpressure Window
    return () => clearTimeout(timer);
  }, [targetRpe, name, type, sets]);

  const handleSave = () => {
    // 1. Check for significant deviation if not already confirmed
    if (Math.abs(targetRpe - originalRpe) >= 1 && !showDeviationWarning) {
      setShowDeviationWarning(true);
      return;
    }

    setIsCalculating(true);
    const ops: PatchOp[] = [];
    
    // 2. Log Deviation if RPE changed significantly (Intent Tracking)
    if (Math.abs(targetRpe - originalRpe) >= 1) {
      const recordIndex = deviationBuffer.addDeviation(
        exercise.exerciseId,
        name,
        exerciseIndex,
        null,
        'targetRpe',
        originalRpe,
        targetRpe
      );
      if (deviationReason) {
        deviationBuffer.updateReason(recordIndex, deviationReason);
      }
      
      // Update all sets via BatchOps
      sets.forEach((_, idx) => {
        ops.push(BatchOps.replaceSetField(exerciseIndex, idx, 'rpe', targetRpe));
      });
    }

    // 3. New Action Onboarding Flow
    if (isCustomAction) {
       console.log(`[Onboarding] Custom action detected: ${name}. Temporary metadata will be synced at session end.`);
       // We can add a patch to mark this as a custom action for the analyst
       ops.push({
           op: 'add',
           path: `/workout/exercises/${exerciseIndex}/metadata/isCustom`,
           value: true
       });
    }

    // 4. Generate granular patches for structural changes
    if (sets.length !== exercise.sets.length) {
       ops.push({
           op: 'replace',
           path: `/workout/exercises/${exerciseIndex}/sets`,
           value: sets
       });
    } else {
       sets.forEach((set, idx) => {
           const originalSet = exercise.sets[idx];
           if (set.weight !== originalSet.weight) {
               ops.push(BatchOps.replaceSetField(exerciseIndex, idx, 'weight', set.weight));
           }
           if (set.reps !== originalSet.reps) {
               ops.push(BatchOps.replaceSetField(exerciseIndex, idx, 'reps', set.reps));
           }
           if (set.duration !== originalSet.duration) {
               ops.push(BatchOps.replaceSetField(exerciseIndex, idx, 'duration', set.duration));
           }
           if (set.distance !== originalSet.distance) {
               ops.push(BatchOps.replaceSetField(exerciseIndex, idx, 'distance', set.distance));
           }
       });
    }

    // 5. Dispatch BatchOps via Socket for atomic L3 sync
    if (ops.length > 0) {
      const batchRequest = BatchOps.createRequest(ops, Date.now(), 'fluid');
      socketService.send('architect.applyBatchOps', batchRequest.params);
      
      // Local callback for immediate L1 update
      onSave(exercise.exerciseId, { 
        metadata: { ...exercise.metadata, targetRpe, isCustom: isCustomAction },
        sets 
      });
    }
    
    onClose();
  };

  const getCurrentZoneInfo = (rpe: number) => {
    const zones = RPE_ZONES as any[];
    if (rpe < 7) return zones.find(z => z.value === 6)!;
    if (rpe < 8) return zones.find(z => z.value === 7)!;
    if (rpe < 9) return zones.find(z => z.value === 8)!;
    if (rpe < 9.5) return zones.find(z => z.value === 9)!;
    return zones.find(z => z.value === 10)!;
  };

  const config = EXERCISE_TYPES_CONFIG[type as keyof typeof EXERCISE_TYPES_CONFIG] || EXERCISE_TYPES_CONFIG['resistance'];
  const units = config.units as any;
  const fields = config.fields || ['weight', 'reps'];

  const updateSet = (index: number, field: string, value: number) => {
    const newSets = [...sets];
    const currentSet = { ...newSets[index] };
    
    (currentSet as any)[field] = value;
    
    newSets[index] = currentSet;
    setSets(newSets);
  };

  const applyAiSuggestion = () => {
    if (aiSuggestion) {
      const newSets = sets.map(s => ({
        ...s,
        ...(aiSuggestion.weight !== undefined && { weight: aiSuggestion.weight }),
        ...(aiSuggestion.duration !== undefined && { 
          duration: aiSuggestion.duration,
          targetDuration: aiSuggestion.duration 
        }),
        ...(aiSuggestion.distance !== undefined && { 
          distance: aiSuggestion.distance,
          targetDistance: aiSuggestion.distance 
        }),
        ...(aiSuggestion.reps !== undefined && { reps: aiSuggestion.reps }),
        ...(aiSuggestion.targetRpe !== undefined && { rpe: aiSuggestion.targetRpe })
      }));
      setSets(newSets);
      if (aiSuggestion.targetRpe !== undefined) {
        setTargetRpe(aiSuggestion.targetRpe);
      }
    }
  };

  const currentZone = getCurrentZoneInfo(targetRpe);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white w-full max-w-md rounded-t-2xl shadow-2xl overflow-hidden flex flex-col h-[90vh]" onClick={e => e.stopPropagation()}>
        <div className="p-6 overflow-y-auto pb-32">
          {showDeviationWarning ? (
            <DeviationWarningModal
              isOpen={showDeviationWarning}
              onClose={() => setShowDeviationWarning(false)}
              onConfirm={() => handleSave()}
              context={{
                exerciseName: name,
                field: 'targetRpe',
                original: originalRpe,
                current: targetRpe
              }}
            />
          ) : (
            <>
              <div className="mb-6">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 block">动作</label>
            <h1 className="text-2xl font-black text-gray-900">{name}</h1>
          </div>

          {/* RPE Selector */}
          <div className="mb-8 bg-gray-50 p-4 rounded-2xl border border-gray-100">
            <div className="flex justify-between items-center mb-4">
              <span className="text-sm font-bold text-gray-600 uppercase tracking-widest">目标强度 (RPE)</span>
              <span className="text-2xl font-black text-blue-600">@{targetRpe}</span>
            </div>
            <input 
              type="range" min="6" max="10" step="0.5"
              value={targetRpe}
              onChange={e => setTargetRpe(Number(e.target.value))}
              className="w-full h-2 bg-gray-200 rounded-full appearance-none cursor-pointer accent-blue-600 mb-4"
            />
            <div className={`p-3 rounded-2xl border-l-4 ${currentZone.color.replace('text-', 'border-').split(' ')[2] || 'border-gray-300'} bg-white text-xs shadow-sm`}>
              <div className="font-bold mb-1">{currentZone.label}</div>
              <div className="text-gray-500">{currentZone.desc}</div>
              {maxHrHeuristic && (
                <div className="mt-2 pt-2 border-t border-gray-100 flex justify-between items-center text-[10px]">
                  <span className="text-gray-400 font-bold uppercase tracking-widest">Tanaka Max HR</span>
                  <span className="text-rose-500 font-black">{maxHrHeuristic} BPM</span>
                </div>
              )}
            </div>
          </div>

          {/* AI Suggestion Box */}
          {(aiSuggestion || isCalculating) && (
            <div className="mb-8 p-4 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl border border-blue-100 flex items-center justify-between animate-in fade-in slide-in-from-top-2">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm">
                  <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">AI 智能推荐</div>
                  <div className="flex items-baseline gap-2">
                    {isCalculating ? (
                      <span className="text-lg font-black text-blue-300 animate-pulse">分析中...</span>
                    ) : (
                      <>
                        <span className="text-xl font-black text-blue-900">
                          {aiSuggestion.weight !== undefined && `${aiSuggestion.weight}kg`}
                          {aiSuggestion.reps !== undefined && ` × ${aiSuggestion.reps}次`}
                          {aiSuggestion.duration !== undefined && `${aiSuggestion.duration}s`}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <button 
                onClick={applyAiSuggestion}
                disabled={isCalculating}
                className="relative group overflow-hidden bg-blue-600 text-white px-5 py-2.5 rounded-xl text-[10px] font-black shadow-lg shadow-blue-200 active:scale-95 hover:bg-blue-700 hover:shadow-blue-300 transition-all duration-200 flex items-center gap-2 uppercase tracking-widest"
              >
                <span className="relative z-10">应用建议</span>
                <svg className="w-3.5 h-3.5 relative z-10 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
                {/* 内部光效动画 */}
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:animate-[shimmer_1.5s_infinite] transition-transform" />
              </button>
            </div>
          )}

          {/* Sets Editor */}
          <div className="mb-6">
             <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-gray-800 uppercase text-sm tracking-widest">训练组安排</h3>
                <button 
                  onClick={() => setSets([...sets, { ...sets[sets.length-1], index: sets.length + 1, status: 'PLANNED' }])}
                  className="text-[10px] font-black text-blue-600 bg-blue-50 px-4 py-2 rounded-xl active:scale-95 transition-all uppercase tracking-widest"
                >
                  + 添加组
                </button>
             </div>
             <div className="space-y-2">
                {sets.map((set, idx) => (
                  <div key={idx} className="flex items-center gap-3 bg-gray-50 p-2 rounded-lg border border-gray-100">
                    <span className="w-6 text-xs font-black text-gray-300">{(idx + 1).toString().padStart(2, '0')}</span>
                    <div className={`flex-1 grid gap-2 ${fields.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                      {fields.filter(f => f !== 'rpe').map(field => (
                        <div key={field} className="flex items-center gap-1">
                          <input 
                            type="number" 
                            value={editingValues[`${idx}-${field}`] ?? String((set as any)[field] ?? 0)}
                            onChange={e => setEditingValues(prev => ({ ...prev, [`${idx}-${field}`]: e.target.value }))}
                            onBlur={() => {
                              const rawValue = editingValues[`${idx}-${field}`];
                              const finalValue = rawValue === '' ? 0 : parseFloat(rawValue);
                              updateSet(idx, field, finalValue);
                              setEditingValues(prev => { const next = { ...prev }; delete next[`${idx}-${field}`]; return next; });
                            }}
                            className="w-full p-1 text-center font-bold border rounded bg-white"
                          />
                          <span className="text-[10px] text-gray-400 font-bold uppercase">{units[field] || field}</span>
                        </div>
                      ))}
                    </div>
                    <button 
                      onClick={() => setSets(sets.filter((_, i) => i !== idx))}
                      className="text-red-400 p-1"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                ))}
             </div>
          </div>
          </>
          )}
        </div>

        {!showDeviationWarning && (
          <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-white via-white to-white/80 border-t border-gray-100">
            <div className="flex gap-4">
              <button 
                onClick={onClose}
                className="flex-1 py-4 font-black text-gray-400 bg-gray-50 rounded-2xl transition-all hover:bg-gray-100 active:scale-95 uppercase tracking-widest"
              >
                取消
              </button>
              <button 
                onClick={handleSave}
                disabled={isCalculating}
                className={`flex-[2] py-4 font-black text-white rounded-2xl shadow-lg transition-all active:scale-95 uppercase tracking-widest ${
                  isCalculating ? 'bg-blue-300' : 'bg-blue-600 shadow-blue-200 hover:bg-blue-700'
                }`}
              >
                {isCalculating ? '计算中...' : '保存更新'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
