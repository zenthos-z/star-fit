import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ExerciseSet, ExerciseType } from '../types';
import { ExerciseAction, LoadAnchors as LoadAnchorsType } from '../src/v2/types/protocol';
import { EXERCISE_TYPES_CONFIG, DEFAULT_BODYWEIGHT, RPE_ZONES } from '../constants';
import { v4 as uuidv4 } from 'uuid';
import { Timer, MapPin, Watch, Heart, Flame, Zap, Trophy, Gauge, Navigation } from 'lucide-react';
import ExerciseLibraryModal from './ExerciseLibraryModal';
import { predictMetrics } from '../services/geminiService';
import { guessCardioSubtype } from '../utils/exerciseLogic';
import { DeviationLogger } from '../src/v2/services/logging/DeviationLogger';

interface ExerciseSettingsModalProps {
  exercise: ExerciseAction;
  onClose: () => void;
  onSave: (exerciseId: string, updates: Partial<ExerciseAction>) => void;
  isCreating?: boolean;
  isLibraryOpen?: boolean;
  onLibraryOpenChange?: (open: boolean) => void;
  onCancelCreate?: () => void;
  isTransitioning?: boolean;
  loadAnchors?: LoadAnchorsType;
  userId?: string;
  onSaveComplete?: () => void;  // New callback to notify parent that save is complete
}

const CARDIO_ZONES = [
    { value: '1', label: "Zone 1", desc: "热身/恢复 (轻松对话)", rpe: "1-3", color: "bg-gray-100 text-gray-600 border-gray-200" },
    { value: '2', label: "Zone 2", desc: "燃脂/耐力 (略微气喘)", rpe: "4-5", color: "bg-blue-50 text-blue-600 border-blue-200" },
    { value: '3', label: "Zone 3", desc: "有氧提升 (呼吸急促)", rpe: "6-7", color: "bg-green-50 text-green-600 border-green-200" },
    { value: '4', label: "Zone 4", desc: "乳酸阈值 (非常吃力)", rpe: "8-9", color: "bg-orange-50 text-orange-600 border-orange-200" },
    { value: '5', label: "Zone 5", desc: "最大摄氧 (极限冲刺)", rpe: "10", color: "bg-red-50 text-red-600 border-red-200" }
];

// Configuration for Primary AI Suggestion Metric by Exercise Type
const METRIC_LABELS: Record<string, string> = {
    'weight': 'AI 推荐配重',
    'reps': 'AI 推荐次数',
    'duration': 'AI 推荐时长',
    'distance': 'AI 推荐距离'
};

// Deviation thresholds for significant changes
const DEVIATION_THRESHOLDS = {
    RPE: 1,                // RPE change >= 1
    WEIGHT_RESISTANCE: 5,  // Resistance weight +/- 5kg
    REPS_RESISTANCE: 2,    // Resistance reps +/- 2
    DURATION_CARDIO: 0.2,  // Cardio duration +/- 20%
    DISTANCE_CARDIO: 0.2,  // Cardio distance +/- 20%
} as const;

const ExerciseSettingsModal: React.FC<ExerciseSettingsModalProps> = ({
  exercise,
  onClose,
  onSave,
  isCreating = false,
  isLibraryOpen = false,
  onLibraryOpenChange = (_open: boolean) => {},
  onCancelCreate,
  isTransitioning = false,
  loadAnchors = {},
  userId = '',
  onSaveComplete
}) => {

  // Convert ExerciseAction type to ExerciseType (now unified lowercase, no conversion needed)
  const normalizeType = (actionType: string): ExerciseType => {
    // Since protocol now uses lowercase matching ExerciseType, validate directly
    const validTypes: ExerciseType[] = ['resistance', 'cardio', 'bodyweight', 'isometric', 'assisted', 'unilateral', 'weight_only', 'reps_only', 'outdoor'];
    if (validTypes.includes(actionType as ExerciseType)) {
      return actionType as ExerciseType;
    }
    // Fallback to originalType from metadata if available
    if (exercise.metadata?.originalType && validTypes.includes(exercise.metadata.originalType as ExerciseType)) {
      return exercise.metadata.originalType as ExerciseType;
    }
    return 'resistance'; // Ultimate fallback
  };

  // Original values tracking (for deviation detection)
  const [originalRpe, setOriginalRpe] = useState(exercise.metadata?.targetRpe || 7);
  const [originalSets, setOriginalSets] = useState<ExerciseSet[]>(exercise.sets.map((s, idx) => ({
    id: uuidv4(),
    reps: s.reps || 0,
    weight: s.weight || 0,
    duration: s.duration || 0,
    distance: s.distance || 0,
    targetDuration: s.duration || 0,
    targetDistance: s.distance || 0,
    completed: s.status === 'COMPLETED',
    status: s.status,
    rpe: s.rpe
  })));

  // Deviation Warning UI State
  const [showDeviationWarning, setShowDeviationWarning] = useState(false);
  const [deviationReason, setDeviationReason] = useState('');
  const [deviationField, setDeviationField] = useState<string>('');
  const [deviationValues, setDeviationValues] = useState<{original: number; current: number; fieldLabel: string}>({original: 0, current: 0, fieldLabel: ''});

  // Anchor check state
  const [hasAnchorData, setHasAnchorData] = useState(false);

  // Basic Info - from ExerciseAction
  const [name, setName] = useState(exercise.metadata?.name || (exercise as any).name || '');
  // Display name for UI - show placeholder text instead of UUID
  // When name is empty, show "选择动作..." to prompt user to select from library
  const displayName = name || '选择动作...';
  const [type, setType] = useState<ExerciseType>(normalizeType(exercise.type));
  const [referenceBodyweight, setReferenceBodyweight] = useState(exercise.metadata?.referenceBodyweight || DEFAULT_BODYWEIGHT);
  const [targetRpe, setTargetRpe] = useState(exercise.metadata?.targetRpe || 7);

  // UI States
  const [isTypeSelectorOpen, setIsTypeSelectorOpen] = useState(false);

  // AI & Smart Features
  const [aiSuggestion, setAiSuggestion] = useState<{ weight?: number; duration?: number; distance?: number; reps?: number } | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);

  // Deep copy sets for editing - convert ExerciseAction sets to ExerciseSet format
  const [sets, setSets] = useState<ExerciseSet[]>(exercise.sets.map((s, idx) => ({
    id: uuidv4(), // Generate id for internal use
    reps: s.reps || 0,
    weight: s.weight || 0,
    duration: s.duration || 0,
    distance: s.distance || 0,
    targetDuration: s.duration || 0,
    targetDistance: s.distance || 0,
    completed: s.status === 'COMPLETED',
    status: s.status,
    rpe: s.rpe
  })));

  // Cardio Specific State
  const [metadata, setMetadata] = useState<Record<string, any>>(exercise.metadata || {});
  const [cardioMode, setCardioMode] = useState<string>(exercise.metadata?.cardioMode || 'FREE_RUN');

  // Cardio Subtype: 'DISTANCE' (Running/Cycling/Rowing) vs 'GENERAL' (Jump Rope/HIIT/Boxing)
  const [cardioSubtype, setCardioSubtype] = useState<string>(
      exercise.metadata?.cardioSubtype || 'GENERAL'
  );
  const [isOutdoor, setIsOutdoor] = useState<boolean>(
      type === 'outdoor' || exercise.metadata?.isOutdoor || false
  );

  // Advanced Metadata for Backend Sync
  const [primaryMuscles, setPrimaryMuscles] = useState<string[]>(exercise.metadata?.primaryMuscles || []);
  const [equipment, setEquipment] = useState<string>(exercise.metadata?.equipment || '');
  const [bodyCategory, setBodyCategory] = useState<string>(exercise.metadata?.bodyCategory || '');

  // UI Flash Effect
  const [flash, setFlash] = useState(false);

  // Get deviation reasons based on exercise type
  const getDeviationReasons = (exerciseType: ExerciseType): string[] => {
    switch (exerciseType) {
      case 'resistance':
      case 'unilateral':
        return ['状态极佳', '感到疲劳', '负荷递增', '器械限制'];
      case 'bodyweight':
        return ['状态极佳', '感到疲劳', '进阶挑战', '难度调整'];
      case 'assisted':
        return ['状态极佳', '感到疲劳', '负荷递减', '器械限制'];
      case 'isometric':
        return ['状态极佳', '感到疲劳', '时长递增', '姿态调整'];
      case 'cardio':
      case 'outdoor':
        return ['状态极佳', '感到疲劳', '时长调整', '环境限制'];
      default:
        return ['状态极佳', '感到疲劳', '受伤预防', '器械限制'];
    }
  };

  // Check if current exercise has anchor data
  useEffect(() => {
    const exerciseName = (exercise as any).name || exercise.metadata?.name || exercise.id;
    const anchor = loadAnchors?.[exerciseName || ''];
    setHasAnchorData(!!anchor && Object.keys(anchor).some(key =>
      key !== 'last_updated' && key !== 'recommendations' &&
      (anchor as any)[key] !== undefined
    ));
  }, [exercise, loadAnchors]);

  // Auto-open library for new/empty exercises
  useEffect(() => {
    if (!name || name === "新动作 (New)") {
        onLibraryOpenChange(true);
    }
  }, []);

  // Default to 30 mins (1800s) if not set, convert to minutes for UI
  const [targetDurationMin, setTargetDurationMin] = useState<number>(
    exercise.metadata?.targetDurationSec ? Math.floor(exercise.metadata.targetDurationSec / 60) : 30
  );
  // Default to 5km (5000m) if not set, convert to km for UI
  const [targetDistanceKm, setTargetDistanceKm] = useState<number>(
    exercise.metadata?.targetDistanceMeters ? exercise.metadata.targetDistanceMeters / 1000 : 5
  );
  // Heart Rate Zone Target
  const [targetHeartRateZone, setTargetHeartRateZone] = useState<string>(
    exercise.metadata?.targetHeartRateZone || '2' // Default Zone 2
  );

  const config = EXERCISE_TYPES_CONFIG[type as keyof typeof EXERCISE_TYPES_CONFIG] || EXERCISE_TYPES_CONFIG['resistance'];
  // Fix for TS errors: cast units to allow access to dynamic properties guarded by fields check
  const units = config.units as any;

  // --- Smart RPE System ---
  useEffect(() => {
      // Debounce logic for AI prediction when RPE or Type changes
      const timer = setTimeout(async () => {
         setIsCalculating(true);
         const predicted = await predictMetrics(name, type, targetRpe);
         setAiSuggestion(predicted);
         setIsCalculating(false);
      }, 500);
      return () => clearTimeout(timer);
  }, [targetRpe, name, type]);

  const applyAiSuggestion = () => {
      if (aiSuggestion) {
          // Sync Cardio/Outdoor UI State
          if (type === 'cardio' || type === 'outdoor') {
              if (aiSuggestion.duration) setTargetDurationMin(aiSuggestion.duration);
              if (aiSuggestion.distance) setTargetDistanceKm(aiSuggestion.distance);
          }

          const newSets = sets.map(s => ({
              ...s,
              // Conditionally update fields if AI provided them
              ...(aiSuggestion.weight !== undefined && { weight: aiSuggestion.weight }),
              ...(aiSuggestion.duration !== undefined && { 
                  duration: aiSuggestion.duration,
                  targetDuration: aiSuggestion.duration // Sync to target for goal setting
              }),
              ...(aiSuggestion.distance !== undefined && { 
                  distance: aiSuggestion.distance,
                  targetDistance: aiSuggestion.distance // Sync to target for goal setting
              }),
              ...(aiSuggestion.reps !== undefined && { reps: aiSuggestion.reps }),
          }));
          setSets(newSets);
      }
  };

  // Helper to get RPE Zone Info
  const getCurrentZoneInfo = (rpe: number) => {
      if (type === 'cardio' || type === 'outdoor') {
          if (rpe <= 3.5) return CARDIO_ZONES[0];
          if (rpe <= 5.5) return CARDIO_ZONES[1];
          if (rpe <= 7.5) return CARDIO_ZONES[2];
          if (rpe <= 9.0) return CARDIO_ZONES[3];
          return CARDIO_ZONES[4];
      }

      // Simple range mapping for Resistance
      if (rpe < 7) return RPE_ZONES.find(z => z.value === 6)!;
      if (rpe < 8) return RPE_ZONES.find(z => z.value === 7)!;
      if (rpe < 9) return RPE_ZONES.find(z => z.value === 8)!;
      if (rpe < 9.5) return RPE_ZONES.find(z => z.value === 9)!;
      return RPE_ZONES.find(z => z.value === 10)!;
  };

  const currentZone = getCurrentZoneInfo(targetRpe);

  // Sync Cardio Zone with RPE
  useEffect(() => {
      if (type === 'cardio' || type === 'outdoor') {
          const zoneInfo = getCurrentZoneInfo(targetRpe);
          if (zoneInfo && zoneInfo.value) {
              setTargetHeartRateZone(zoneInfo.value.toString());
          }
      }
  }, [targetRpe, type]);

  // Auto-detect cardio/outdoor subtype when name changes
  useEffect(() => {
      if ((type === 'cardio' || type === 'outdoor') && name) {
          const detectedSubtype = guessCardioSubtype(name);
          // Only update if different to avoid unnecessary re-renders
          if (detectedSubtype !== cardioSubtype) {
              setCardioSubtype(detectedSubtype);
          }
          if (type === 'outdoor' && !isOutdoor) {
              setIsOutdoor(true);
          } else if (type === 'cardio' && isOutdoor) {
              setIsOutdoor(false);
          }
      }
  }, [name, type]);

  // Helper for AI Box Display
  const getAiBoxContent = () => {
      if (isCalculating) return <span className="text-sm font-bold text-gray-400 animate-pulse">计算中...</span>;
      if (!aiSuggestion) return <span className="text-xl font-black text-gray-300">--</span>;

      // Special handling for Cardio/Outdoor (Duration + Distance)
      if (type === 'cardio' || type === 'outdoor') {
          return (
             <div className="flex items-baseline gap-1">
                 <span className="text-xl font-black text-star-dark">{aiSuggestion.duration}</span>
                 <span className="text-xs font-bold text-gray-400 uppercase mr-2">{units.duration}</span>
                 {aiSuggestion.distance && (
                    <>
                        <span className="text-sm font-bold text-gray-300">/</span>
                        <span className="text-xl font-black text-star-dark ml-2">{aiSuggestion.distance}</span>
                        <span className="text-xs font-bold text-gray-400 uppercase">{units.distance}</span>
                    </>
                 )}
             </div>
          );
      }

      // [UPDATED] Combined Weight + Reps display for Resistance/Unilateral/Assisted
      // Only show if both are present and non-zero (to avoid showing 0kg for bodyweight if not needed)
      if (aiSuggestion.weight && aiSuggestion.reps) {
           return (
             <div className="flex items-baseline gap-3">
                 <div className="flex items-baseline gap-1">
                     <span className="text-xl font-black text-star-dark">{aiSuggestion.weight}</span>
                     <span className="text-xs font-bold text-gray-400 uppercase">KG</span>
                 </div>
                 <div className="flex items-baseline gap-1">
                     <span className="text-xl font-black text-star-dark">{aiSuggestion.reps}</span>
                     <span className="text-xs font-bold text-gray-400 uppercase">次</span>
                 </div>
             </div>
           );
      }

      // Determine primary metric based on type
      const field = config.primaryMetric as 'weight' | 'reps' | 'duration' | 'distance';
      const value = aiSuggestion[field];
      
      // Get unit from current exercise config or fallback
      const unit = units[field] || (field === 'weight' ? 'KG' : field === 'reps' ? '次' : 's');

      return (
         <div className="flex items-baseline gap-1">
             <span className="text-xl font-black text-star-dark">{value ?? '--'}</span>
             <span className="text-xs font-bold text-gray-400 uppercase">{unit}</span>
         </div>
      );
  };

  const getAiBoxTitle = () => {
      const field = config.primaryMetric as string;
      return METRIC_LABELS[field] || 'AI 推荐';
  };

  // Reset sets and config when type changes
  const resetSetsForType = (newType: ExerciseType) => {
      // 重置目标 RPE 为默认值
      setTargetRpe(7);
      // 重置参考体重为默认值
      setReferenceBodyweight(DEFAULT_BODYWEIGHT);
      
      const newConfig = EXERCISE_TYPES_CONFIG[newType as keyof typeof EXERCISE_TYPES_CONFIG] || EXERCISE_TYPES_CONFIG['resistance'];
      const defaults = newConfig.defaultValues as any;

      const newSets: ExerciseSet[] = [{
          id: uuidv4(),
          completed: false,
          weight: defaults.weight || 0,
          reps: defaults.reps || 0,
          duration: defaults.duration || 0,
          distance: defaults.distance || 0,
      }];
      setSets(newSets);
  };

  // --- Handlers ---

  const handleLibrarySelect = (newId: string, newName: string, newDefaultType?: string, newBodyCategory?: string, newMuscles?: string[], newEquipment?: string) => {
      setName(newName);
      const nextType = (newDefaultType as ExerciseType) || type;

      if (newDefaultType) {
          setType(nextType);
      }

      // Store the libraryId for later use (e.g., when opening tutorial)
      if (newId) {
          setMetadata(prev => ({
              ...prev,
              libraryId: newId,
              name: newName
          }));
      }

      // Auto-detect cardio/outdoor subtype if it's a cardio/outdoor exercise
      if (nextType === 'cardio' || nextType === 'outdoor') {
          const subtype = guessCardioSubtype(newName);
          setCardioSubtype(subtype);
          if (nextType === 'outdoor') {
              setIsOutdoor(true);
          }
      }

      if (newBodyCategory) setBodyCategory(newBodyCategory);
      if (newMuscles) setPrimaryMuscles(newMuscles);
      if (newEquipment) setEquipment(newEquipment);

      resetSetsForType(nextType);
      onLibraryOpenChange(false);
  };

  const handleAddSet = () => {
      const lastSet = sets[sets.length - 1];
      const defaults = config.defaultValues as any;

      const newSet: ExerciseSet = {
          id: uuidv4(),
          completed: false,
          weight: lastSet?.weight ?? defaults.weight,
          reps: lastSet?.reps ?? defaults.reps,
          duration: 0, // 实际时长始终初始为 0
          distance: 0, // 实际距离始终初始为 0
          targetDuration: lastSet?.targetDuration ?? defaults.duration,
          targetDistance: lastSet?.targetDistance ?? defaults.distance,
      };
      setSets([...sets, newSet]);
  };

  const handleRemoveSet = (index: number) => {
      if (sets.length <= 1) return;
      const newSets = [...sets];
      newSets.splice(index, 1);
      setSets(newSets);
  };

  const updateSet = (index: number, field: keyof ExerciseSet, value: number) => {
      const newSets = [...sets];
      // 如果是设置时长或距离，自动映射到目标字段
      let targetField = field;
      if (field === 'duration') targetField = 'targetDuration';
      if (field === 'distance') targetField = 'targetDistance';

      newSets[index] = { ...newSets[index], [targetField]: value };
      setSets(newSets);
  };

  // Detect significant changes for deviation warning
  const detectSignificantChanges = (): { hasChange: boolean; field: string; fieldLabel: string; original: number; current: number } => {
    // Check RPE change
    if (Math.abs(targetRpe - originalRpe) >= DEVIATION_THRESHOLDS.RPE) {
      return {
        hasChange: true,
        field: 'targetRpe',
        fieldLabel: '目标强度 (RPE)',
        original: originalRpe,
        current: targetRpe
      };
    }

    // Check sets changes based on exercise type
    for (let i = 0; i < sets.length && i < originalSets.length; i++) {
      const currentSet = sets[i];
      const originalSet = originalSets[i];

      // Resistance exercises: check weight and reps
      if (type === 'resistance' || type === 'unilateral' || type === 'bodyweight' || type === 'assisted') {
        if (Math.abs((currentSet.weight || 0) - (originalSet.weight || 0)) >= DEVIATION_THRESHOLDS.WEIGHT_RESISTANCE) {
          return {
            hasChange: true,
            field: 'weight',
            fieldLabel: '配重',
            original: originalSet.weight || 0,
            current: currentSet.weight || 0
          };
        }
        if (Math.abs((currentSet.reps || 0) - (originalSet.reps || 0)) >= DEVIATION_THRESHOLDS.REPS_RESISTANCE) {
          return {
            hasChange: true,
            field: 'reps',
            fieldLabel: '次数',
            original: originalSet.reps || 0,
            current: currentSet.reps || 0
          };
        }
      }

      // Isometric: check duration
      if (type === 'isometric') {
        const currentDuration = currentSet.targetDuration || currentSet.duration || 0;
        const originalDuration = originalSet.targetDuration || originalSet.duration || 0;
        if (Math.abs(currentDuration - originalDuration) / (originalDuration || 1) >= DEVIATION_THRESHOLDS.DURATION_CARDIO) {
          return {
            hasChange: true,
            field: 'duration',
            fieldLabel: '时长',
            original: originalDuration,
            current: currentDuration
          };
        }
      }

      // Cardio/Outdoor: check duration and distance
      if (type === 'cardio' || type === 'outdoor') {
        const currentDuration = currentSet.targetDuration || currentSet.duration || 0;
        const originalDuration = originalSet.targetDuration || originalSet.duration || 0;
        if (Math.abs(currentDuration - originalDuration) / (originalDuration || 1) >= DEVIATION_THRESHOLDS.DURATION_CARDIO) {
          return {
            hasChange: true,
            field: 'duration',
            fieldLabel: '时长',
            original: originalDuration,
            current: currentDuration
          };
        }
        const currentDistance = currentSet.targetDistance || currentSet.distance || 0;
        const originalDistance = originalSet.targetDistance || originalSet.distance || 0;
        if (Math.abs(currentDistance - originalDistance) / (originalDistance || 1) >= DEVIATION_THRESHOLDS.DISTANCE_CARDIO) {
          return {
            hasChange: true,
            field: 'distance',
            fieldLabel: '距离',
            original: originalDistance,
            current: currentDistance
          };
        }
      }
    }

    return { hasChange: false, field: '', fieldLabel: '', original: 0, current: 0 };
  };

  const handleSave = async (skipDeviationCheck = false) => {
    // Check for significant deviations unless skipping
    if (!skipDeviationCheck && !isCreating) {
      const changeDetection = detectSignificantChanges();
      if (changeDetection.hasChange) {
        setDeviationField(changeDetection.field);
        setDeviationValues({
          original: changeDetection.original,
          current: changeDetection.current,
          fieldLabel: changeDetection.fieldLabel
        });
        setShowDeviationWarning(true);
        return;
      }
    }

    let finalSets = sets;

    // 只有有氧/户外动作才添加有氧专属字段
    const isCardioOrOutdoor = type === 'cardio' || type === 'outdoor';

    let finalMetadata: any = {
      ...metadata,
      name,
      targetRpe,
      originalType: type,  // Dual insurance: preserve original type
      referenceBodyweight: (type === 'bodyweight' || type === 'assisted') ? referenceBodyweight : undefined,
      // 根据动作类型条件性添加有氧字段
      ...(isCardioOrOutdoor && {
        cardioMode,
        cardioSubtype,
        isOutdoor
      }),
      primaryMuscles,
      equipment,
      bodyCategory
    };

    if (type === 'cardio' || type === 'outdoor') {
        // Enforce single set for Cardio/Outdoor V2
        const singleSet = sets[0] || { id: uuidv4(), completed: false, weight: 0, reps: 0, duration: 0, distance: 0 };

        // Update set targets based on mode
        if (cardioMode === 'TIME_COUNTDOWN') {
            singleSet.targetDuration = targetDurationMin * 60;
            singleSet.duration = 0;
            singleSet.targetDistance = 0;
            singleSet.distance = 0;
            finalMetadata.targetDurationSec = targetDurationMin * 60;
            finalMetadata.targetDistanceMeters = 0; // Clear distance
        } else if (cardioMode === 'DISTANCE_TARGET') {
            singleSet.targetDistance = targetDistanceKm * 1000;
            singleSet.distance = 0;
            singleSet.targetDuration = 0;
            singleSet.duration = 0;
            finalMetadata.targetDistanceMeters = targetDistanceKm * 1000;
            finalMetadata.targetDurationSec = 0; // Clear duration
        } else {
            // Free run
            singleSet.targetDuration = 0;
            singleSet.duration = 0;
            singleSet.targetDistance = 0;
            singleSet.distance = 0;
            // Clear both
            finalMetadata.targetDurationSec = 0;
            finalMetadata.targetDistanceMeters = 0;
        }

        // Always save target heart rate zone for all cardio modes
        finalMetadata.targetHeartRateZone = targetHeartRateZone;

        finalSets = [singleSet];
    }

    // Log deviation if reason was provided
    if (deviationReason && deviationField && userId) {
      DeviationLogger.logDeviation(
        exercise.id || `fit://library/exercise/${name}`,
        deviationValues.original,
        deviationValues.current,
        deviationField
      );
    }

    // Backend Persistence for New Exercises
    if (isCreating) {
        try {
            // Map primaryMuscles to target muscle zones
            const targetMuscles: string[] = primaryMuscles.length > 0 ? primaryMuscles : ['胸部'];
            await fetch('/api/exercises', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: exercise.id,
                    name,
                    exercise_type: type as any,
                    targets: JSON.stringify({ primary: targetMuscles, secondary: [] }),
                    equipment_required: equipment ? [equipment] : [],
                    difficulty: 'beginner',
                    assets: {}
                })
            });
        } catch (e) {
            console.error("Failed to persist exercise to backend", e);
            // Continue anyway to save locally
        }
    }

    // Build ExerciseAction format (direct type mapping, no conversion needed)
    const exerciseActionUpdates: Partial<ExerciseAction> = {
      exerciseId: `fit://library/exercise/${name}`,
      type: type as any,  // Direct lowercase type, matching protocol
      sets: finalSets.map((s, idx) => ({
        index: idx,
        reps: s.reps || 0,
        weight: s.weight || 0,
        duration: s.duration || 0,
        distance: s.distance || 0,
        rpe: s.rpe,
        status: s.completed ? 'COMPLETED' : 'PLANNED'
      })),
      metadata: finalMetadata
    };

    // Reset deviation state
    setShowDeviationWarning(false);
    setDeviationReason('');
    setDeviationField('');

    onSave(exercise.id, exerciseActionUpdates);
    // Don't call onClose() here - let parent control when to close
    // This ensures onSave callback completes before state is cleared
    if (onSaveComplete) {
      onSaveComplete();
    }
  };

  // --- Calculation Helpers ---
  const calculateTotalVolume = () => {
      if (type === 'cardio' || type === 'outdoor') return 0;
      
      return sets.reduce((acc, set) => {
          const w = set.weight || 0;
          const r = set.reps || 0;
          const d = set.targetDuration || set.duration || 0;

          let setVol = 0;
          if (type === 'resistance') {
              setVol = w * r;
          } else if (type === 'unilateral') {
              setVol = w * r * 2;
          } else if (type === 'bodyweight') {
              setVol = (referenceBodyweight + w) * r;
          } else if (type === 'assisted') {
              setVol = Math.max(0, referenceBodyweight - w) * r;
          } else if (type === 'isometric') {
              setVol = (w > 0 ? w : referenceBodyweight) * d;
          }
          return acc + setVol;
      }, 0);
  };

  const totalVolume = calculateTotalVolume();

  // --- Compact Components ---

  // Compact Numeric Input - Clean number only
  const CompactNumericInput = ({ 
    val, 
    onChange, 
  }: { val: number, onChange: (v: number) => void }) => {
    const [tempValue, setTempValue] = useState(val.toString());

    useEffect(() => {
        setTempValue(val.toString());
    }, [val]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setTempValue(e.target.value);
        const num = parseFloat(e.target.value);
        if (!isNaN(num)) {
            onChange(num);
        }
    };

    const handleBlur = () => {
        setTempValue(val.toString());
    };

    return (
        <div className="flex items-center h-10 bg-gray-50 rounded-lg border border-gray-200 overflow-hidden w-full relative group hover:border-star-dark/30 transition-colors">
            <style>{`
                input[type=number]::-webkit-inner-spin-button, 
                input[type=number]::-webkit-outer-spin-button { 
                    -webkit-appearance: none; 
                    margin: 0; 
                }
                input[type=number] {
                    -moz-appearance: textfield;
                }
            `}</style>
            <input
                type="number"
                value={tempValue}
                onChange={handleChange}
                onBlur={handleBlur}
                className="w-full h-full text-center font-bold text-gray-800 text-lg bg-transparent outline-none appearance-none p-0 z-10"
            />
        </div>
    );
  };

  // Bodyweight Stepper (Large) with manual input support + Buttons (Retained)
  const BodyweightStepper = () => {
      const [tempValue, setTempValue] = useState(referenceBodyweight.toString());

      useEffect(() => {
        setTempValue(referenceBodyweight.toString());
      }, [referenceBodyweight]);

      const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setTempValue(e.target.value);
        const num = parseFloat(e.target.value);
        if (!isNaN(num)) {
            setReferenceBodyweight(num);
        }
      };

      const handleBlur = () => {
        setTempValue(referenceBodyweight.toString());
      };

      return (
        <div className="flex items-center h-14 bg-gray-50 rounded-xl border border-gray-200 overflow-hidden w-full">
            <style>{`
                input[type=number]::-webkit-inner-spin-button, 
                input[type=number]::-webkit-outer-spin-button { 
                    -webkit-appearance: none; 
                    margin: 0; 
                }
                input[type=number] {
                    -moz-appearance: textfield;
                }
            `}</style>
            <button 
                onClick={() => setReferenceBodyweight(Math.max(0, Number((referenceBodyweight - 0.5).toFixed(1))))}
                className="w-16 h-full flex items-center justify-center text-2xl text-gray-400 hover:bg-gray-100 hover:text-black active:bg-gray-200 transition-colors border-r border-gray-100 z-10"
            >
                -
            </button>
            <div className="flex-1 flex items-center justify-center gap-1 h-full bg-white relative">
                <input
                    type="number"
                    value={tempValue}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    className="w-full h-full text-center font-bold text-gray-800 text-2xl bg-transparent outline-none appearance-none p-0 z-20"
                />
                <span className="absolute right-4 text-xs font-bold text-gray-400 uppercase pointer-events-none z-0">KG</span>
            </div>
            <button 
                onClick={() => setReferenceBodyweight(Number((referenceBodyweight + 0.5).toFixed(1)))}
                className="w-16 h-full flex items-center justify-center text-2xl text-gray-400 hover:bg-gray-100 hover:text-black active:bg-gray-200 transition-colors border-l border-gray-100 z-10"
            >
                +
            </button>
        </div>
      );
  };

  return (
    <>
      {isLibraryOpen ? (
        <ExerciseLibraryModal
          key="library"
          onSelect={handleLibrarySelect}
          onClose={() => onLibraryOpenChange(false)}
          isCreatingMode={isCreating}
          onCancelCreate={onCancelCreate}
        />
      ) : (
        <motion.div
          key="settings"
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 50 }}
          transition={{
            type: 'tween',
            duration: 0.25,
            ease: 'easeOut'
          }}
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 backdrop-blur-sm"
          onClick={onClose}
        >
          <div className="bg-white w-full max-w-md rounded-t-3xl shadow-2xl overflow-hidden flex flex-col h-[92vh]"
            onClick={e => e.stopPropagation()}
          >
        
        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar pb-32">
            
            {/* Header / Name Edit */}
            <div className="px-6 pt-5 pb-2">
                <div className="flex items-center justify-between gap-4 mb-2">
                    <h1
                        className="text-2xl font-black text-gray-900 tracking-tight leading-tight truncate cursor-pointer hover:text-gray-700 transition-colors flex-1"
                        onClick={() => onLibraryOpenChange(true)}
                    >
                        {displayName || "未命名动作"}
                    </h1>
                    
                    <button 
                        onClick={() => onLibraryOpenChange(true)}
                        className="shrink-0 px-4 py-2 bg-gray-100 text-gray-500 rounded-lg hover:bg-gray-200 active:scale-95 transition-all flex items-center gap-2"
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" /></svg>
                        <span className="text-sm font-bold">动作库</span>
                    </button>
                </div>

                {/* Tags Row - Includes Smart Fill Trigger */}
                <div className="flex flex-wrap gap-2 mb-2 min-h-[20px] items-center">
                     {/* Type Tag & Selector */}
                     <div className="relative z-50">
                        <button 
                            onClick={(e) => { e.stopPropagation(); setIsTypeSelectorOpen(!isTypeSelectorOpen); }}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-colors duration-200 bg-gray-100 hover:bg-gray-200 text-gray-600`}
                        >
                            <div className={`w-1.5 h-1.5 rounded-full ${type === 'cardio' ? 'bg-orange-400' : 'bg-blue-400'}`} />
                            <span className="text-[10px] font-bold uppercase tracking-wide">{config.label}</span>
                            <svg className="w-3 h-3 text-gray-400 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                        </button>

                        {isTypeSelectorOpen && (
                            <>
                            <div className="fixed inset-0 z-40" onClick={() => setIsTypeSelectorOpen(false)} />
                            <div className="absolute top-full left-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-gray-100 p-2 z-50 grid grid-cols-1 gap-1 animate-in fade-in zoom-in-95 duration-200 max-h-[400px] overflow-y-auto custom-scrollbar">
                                {Object.entries(EXERCISE_TYPES_CONFIG).map(([key, conf]) => (
                                    <button
                                        key={key}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setType(key as ExerciseType);
                                            resetSetsForType(key as ExerciseType);
                                            setIsTypeSelectorOpen(false);
                                        }}
                                        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors ${type === key ? 'bg-blue-50 text-blue-600' : 'hover:bg-gray-50 text-gray-600'}`}
                                    >
                                        <div className={`w-2 h-2 rounded-full ${key === 'cardio' ? 'bg-orange-400' : 'bg-blue-400'}`} />
                                        <span className="text-xs font-bold">{conf.label}</span>
                                    </button>
                                ))}
                            </div>
                            </>
                        )}
                     </div>
                     
                     {/* Muscles Tag */}
                     {primaryMuscles.map(m => (
                         <div key={m} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-colors duration-500 bg-gray-100`}>
                             <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">{m}</span>
                         </div>
                     ))}
                     
                     {/* Equipment Tag */}
                     {equipment && (
                         <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-colors duration-500 bg-gray-100`}>
                             <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">{equipment}</span>
                         </div>
                     )}
                </div>
            </div>

            {/* Visual Divider - Reduced Margin */}
            <div className="h-px bg-gray-100 mb-6 mx-6" />

            {/* AI SMART RPE SYSTEM (Refactored) */}
            <div className="px-6 mb-8">
                {/* Clean Header - Section Level */}
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-lg font-black text-gray-900 flex items-center gap-2">
                        目标强度
                        <span className="text-[10px] font-bold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded uppercase tracking-wider">RPE</span>
                    </h2>
                    
                    <div className="flex items-baseline gap-1">
                        <span className="text-3xl font-black text-star-dark leading-none">@{targetRpe}</span>
                        <span className="text-sm font-bold text-gray-400">/ 10</span>
                    </div>
                </div>

                {/* Slider UI - Cleaned up */}
                <div className="mb-6 relative h-10 flex items-center px-1">
                   <div className="absolute inset-x-0 h-2 bg-gray-100 rounded-full overflow-hidden">
                       <div 
                           className="h-full bg-gradient-to-r from-gray-300 via-star-accent to-star-dark opacity-30" 
                           style={{ width: `${(targetRpe - ((type === 'cardio' || type === 'outdoor') ? 1 : 6)) / ((type === 'cardio' || type === 'outdoor') ? 9 : 4) * 100}%` }}
                       />
                   </div>
                   <input
                       type="range"
                       min={(type === 'cardio' || type === 'outdoor') ? "1" : "6"}
                       max="10"
                       step="0.5"
                       value={targetRpe}
                       onChange={e => setTargetRpe(Number(e.target.value))}
                       className="w-full h-10 bg-transparent appearance-none cursor-pointer z-10 relative [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-star-dark [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:active:scale-110"
                   />
                </div>

                {/* Dashboard Card - Unified */}
                <div className={`relative overflow-hidden rounded-2xl border transition-all duration-300 ${currentZone.color.replace('text-', 'border-').split(' ')[2] || 'border-gray-200'} bg-white shadow-sm`}>
                    {/* Background Tint */}
                    <div className={`absolute inset-0 opacity-[0.03] ${currentZone.color.replace('text-', 'bg-').split(' ')[0]}`} />

                    <div className="p-4 flex items-stretch justify-between gap-4 relative z-10">
                        {/* Left: Zone Info + Anchor Reminder */}
                        <div className="flex-1 flex flex-col justify-center">
                            <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase w-fit mb-1.5 ${currentZone.color.replace('text-', 'bg-').split(' ')[0]} bg-opacity-10 ${currentZone.color.split(' ')[1]}`}>
                                {currentZone.label}
                            </div>
                            <p className="text-xs font-bold text-gray-500 leading-snug mb-1">
                                {currentZone.desc}
                            </p>
                            {/* Show anchor reminder when no anchor data */}
                            {!hasAnchorData && !isCreating && (
                                <p className="text-[10px] font-medium text-amber-600 leading-snug">
                                    暂无历史训练锚点
                                </p>
                            )}
                        </div>

                        {/* Divider */}
                        <div className="w-px bg-gray-100 my-1" />

                        {/* Right: AI Action */}
                        <div className="flex flex-col items-end justify-center min-w-[100px]">
                             <div className="text-right mb-1">
                                <span className="text-[10px] font-bold text-gray-300 uppercase block mb-0.5">{getAiBoxTitle().replace('AI 推荐', '')}</span>
                                {getAiBoxContent()}
                             </div>

                             <button
                                onClick={applyAiSuggestion}
                                disabled={isCalculating || !aiSuggestion}
                                className="relative group overflow-hidden bg-star-dark text-white px-4 py-2 rounded-xl text-[10px] font-black shadow-md active:scale-90 hover:bg-black transition-all duration-200 flex items-center gap-1.5 disabled:opacity-30 disabled:pointer-events-none"
                             >
                                <span className="relative z-10">应用建议</span>
                                <div className="relative z-10 w-4 h-4 rounded-full bg-white/20 flex items-center justify-center group-hover:translate-y-0.5 transition-transform">
                                    <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 13.5L12 21m0 0l-7.5-7.5M12 21V3" /></svg>
                                </div>
                                {/* 内部光效动画 */}
                                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:animate-[shimmer_1.5s_infinite] transition-transform" />
                             </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Reference Bodyweight (Moved to Top) */}
            {(type === 'bodyweight' || type === 'assisted') && (
                <div className="px-6 mb-8 animate-in slide-in-from-bottom-2 duration-300">
                     <div className="flex items-center gap-2 mb-2">
                        <label className="text-sm font-bold text-black uppercase tracking-wider">参考体重</label>
                        {/* Removed Required badge for cleaner look */}
                     </div>
                     <div className="flex items-center">
                         <BodyweightStepper />
                     </div>
                </div>
            )}

            {/* CARDIO & OUTDOOR CONFIGURATION */}
            {(type === 'cardio' || type === 'outdoor') && (
                <div className="px-6 mb-8 animate-in slide-in-from-bottom-2 duration-300">
                    <div className="flex items-center justify-between mb-4">
                        <label className="text-sm font-bold text-black uppercase tracking-wider">
                            {type === 'outdoor' ? '户外模式设置' : '有氧模式设置'}
                        </label>
                        
                        {/* Subtype Switcher - Only for Cardio */}
                        {type === 'cardio' && (
                            <div className="flex bg-gray-100 p-0.5 rounded-lg">
                                <button 
                                    onClick={() => setCardioSubtype('DISTANCE')}
                                    className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${cardioSubtype === 'DISTANCE' ? 'bg-white text-star-dark shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                                >
                                    距离 (跑/骑)
                                </button>
                                <button 
                                    onClick={() => {
                                        setCardioSubtype('GENERAL');
                                        if (cardioMode === 'DISTANCE_TARGET') setCardioMode('TIME_COUNTDOWN');
                                        setIsOutdoor(false); 
                                    }}
                                    className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${cardioSubtype === 'GENERAL' ? 'bg-white text-star-dark shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                                >
                                    通用 (跳绳/HIIT)
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Mode Selector */}
                    <div className={`grid gap-2 mb-4 ${(cardioSubtype === 'DISTANCE' || type === 'outdoor') ? 'grid-cols-3' : 'grid-cols-2'}`}>
                        <button
                            onClick={() => setCardioMode('TIME_COUNTDOWN')}
                            className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all ${
                                cardioMode === 'TIME_COUNTDOWN' 
                                ? 'bg-blue-50 border-blue-500 text-blue-700 shadow-sm' 
                                : 'bg-white border-gray-200 text-gray-400 hover:border-gray-300'
                            }`}
                        >
                            <Timer className="w-6 h-6 mb-2" />
                            <span className="text-xs font-bold">倒计时</span>
                        </button>
                        
                        {(cardioSubtype === 'DISTANCE' || type === 'outdoor') && (
                            <button
                                onClick={() => setCardioMode('DISTANCE_TARGET')}
                                className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all ${
                                    cardioMode === 'DISTANCE_TARGET' 
                                    ? 'bg-emerald-50 border-emerald-500 text-emerald-700 shadow-sm' 
                                    : 'bg-white border-gray-200 text-gray-400 hover:border-gray-300'
                                }`}
                            >
                                <MapPin className="w-6 h-6 mb-2" />
                                <span className="text-xs font-bold">目标距离</span>
                            </button>
                        )}

                        <button
                            onClick={() => setCardioMode('FREE_RUN')}
                            className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all ${
                                cardioMode === 'FREE_RUN' 
                                ? 'bg-purple-50 border-purple-500 text-purple-700 shadow-sm' 
                                : 'bg-white border-gray-200 text-gray-400 hover:border-gray-300'
                            }`}
                        >
                            <Watch className="w-6 h-6 mb-2" />
                            <span className="text-xs font-bold">{(cardioSubtype === 'DISTANCE' || type === 'outdoor') ? '自由跑' : '自由练'}</span>
                        </button>
                    </div>

                    {/* Dynamic Inputs based on Mode */}
                    {cardioMode === 'TIME_COUNTDOWN' && (
                        <div className="bg-blue-50/50 rounded-xl p-4 border border-blue-100 mb-4">
                            <label className="text-xs font-bold text-blue-400 uppercase tracking-wider mb-2 block">目标时长 (分钟)</label>
                            <div className="flex items-center h-14 bg-white rounded-xl border border-blue-200 overflow-hidden w-full">
                                <input
                                    type="number"
                                    value={targetDurationMin}
                                    onChange={(e) => setTargetDurationMin(Number(e.target.value))}
                                    className="w-full h-full text-center font-bold text-gray-800 text-2xl bg-transparent outline-none appearance-none p-0"
                                />
                                <span className="pr-4 text-xs font-bold text-blue-300 uppercase">MIN</span>
                            </div>
                        </div>
                    )}

                    {cardioMode === 'DISTANCE_TARGET' && (
                        <div className="bg-emerald-50/50 rounded-xl p-4 border border-emerald-100 mb-4">
                            <label className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-2 block">目标距离 (公里)</label>
                            <div className="flex items-center h-14 bg-white rounded-xl border border-emerald-200 overflow-hidden w-full">
                                <input
                                    type="number"
                                    value={targetDistanceKm}
                                    onChange={(e) => setTargetDistanceKm(Number(e.target.value))}
                                    className="w-full h-full text-center font-bold text-gray-800 text-2xl bg-transparent outline-none appearance-none p-0"
                                />
                                <span className="pr-4 text-xs font-bold text-emerald-300 uppercase">KM</span>
                            </div>
                        </div>
                    )}
                    
                    {cardioMode === 'FREE_RUN' && (
                        <div className="bg-purple-50/50 rounded-xl p-4 border border-purple-100 flex items-center justify-center mb-4 py-6">
                            <p className="text-sm font-medium text-purple-600">记录您的自由训练数据</p>
                        </div>
                    )}

                    {/* Heart Rate Zone Display (Persistent for all cardio modes, synced with RPE) */}
                    <div className="bg-rose-50/50 rounded-xl p-4 border border-rose-100 flex justify-between items-center">
                        <div>
                            <label className="text-xs font-bold text-rose-400 uppercase tracking-wider mb-1 block">目标心率区间</label>
                            <div className="flex items-center gap-2">
                                <Heart className="w-5 h-5 text-rose-500 fill-rose-500/20" />
                                <span className="text-2xl font-black text-rose-600">Zone {targetHeartRateZone}</span>
                            </div>
                        </div>
                        <div className="text-right">
                            <p className="text-xs font-bold text-rose-600">
                                {targetHeartRateZone === '1' && '恢复/热身 (50-60%)'}
                                {targetHeartRateZone === '2' && '燃脂/耐力 (60-70%)'}
                                {targetHeartRateZone === '3' && '有氧提升 (70-80%)'}
                                {targetHeartRateZone === '4' && '乳酸阈值 (80-90%)'}
                                {targetHeartRateZone === '5' && '极限冲刺 (90-100%)'}
                            </p>
                            <p className="text-[10px] text-rose-400 mt-1 flex items-center justify-end gap-1">
                                <Zap className="w-3 h-3" />
                                由目标强度 (RPE) 自动匹配
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* COMPACT SETS EDITOR */}
            {type !== 'cardio' && type !== 'outdoor' && (
            <div className="px-6">
                 <div className="flex justify-between items-end mb-4 border-b border-gray-100 pb-2">
                    <label className="text-sm font-bold text-black uppercase tracking-wider">训练组安排</label>
                    {totalVolume > 0 && (
                        <span className="text-[10px] font-mono font-bold text-gray-400 bg-gray-50 px-2 py-0.5 rounded">
                            Vol: {totalVolume}kg
                        </span>
                    )}
                 </div>

                 {/* Table Header */}
                 <div className="flex gap-4 mb-2 px-1">
                     <div className="w-8 text-center text-[10px] font-bold text-gray-300 uppercase">组</div>
                     {config.fields.filter(f => ['weight', 'reps', 'duration', 'distance'].includes(f)).map(col => (
                         <div key={col} className="flex-1 text-center text-[10px] font-bold text-gray-300 uppercase">
                             {col === 'weight' && (units.weight?.includes('(+)') ? '负重' : units.weight?.includes('(-)') ? '辅助' : '配重')}
                             {col === 'reps' && '次数'}
                             {col === 'duration' && '时长'}
                             {col === 'distance' && '距离'}
                             <span className="ml-1 opacity-50">
                                {col === 'weight' && 'KG'}
                                {col === 'reps' && '次'}
                                {col === 'duration' && 's'}
                                {col === 'distance' && 'KM'}
                             </span>
                         </div>
                     ))}
                     <div className="w-8"></div>
                 </div>

                 <div className="space-y-2">
                    {sets.map((set, i) => (
                        <div key={set.id || i} className="flex items-center gap-3 animate-in slide-in-from-bottom-1 duration-300">
                            {/* Index */}
                            <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-500">
                                {i + 1}
                            </div>
                            
                            {/* Dynamic Inputs */}
                            {config.fields.filter(f => ['weight', 'reps', 'duration', 'distance'].includes(f)).map(col => {
                                // 在设置界面，时长和距离应该显示目标值，如果目标值不存在则显示当前值
                                let displayVal = set[col as keyof ExerciseSet] as number || 0;
                                if (col === 'duration' && set.targetDuration !== undefined) displayVal = set.targetDuration;
                                if (col === 'distance' && set.targetDistance !== undefined) displayVal = set.targetDistance;

                                return (
                                    <div key={col} className="flex-1">
                                        <CompactNumericInput 
                                            val={displayVal} 
                                            onChange={(v) => updateSet(i, col as keyof ExerciseSet, v)} 
                                        />
                                    </div>
                                );
                            })}

                            {/* Delete */}
                            <button 
                                onClick={() => handleRemoveSet(i)}
                                className="w-8 h-8 flex items-center justify-center text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
                            >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>
                    ))}
                 </div>
                 
                 {/* New Bottom Add Button */}
                 <button 
                    onClick={handleAddSet}
                    className="w-full mt-4 py-3 border-2 border-dashed border-gray-200 rounded-xl text-gray-400 font-bold hover:border-star-accent hover:text-star-accent hover:bg-blue-50 transition-all flex items-center justify-center gap-2"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-5 h-5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    添加一组
                </button>
            </div>
            )}

            {/* Removed Bottom Reference Bodyweight */}

        </div>

        {/* Footer */}
        <div className="p-6 pt-4 border-t border-gray-100 bg-white">
            <button
                onClick={() => handleSave(false)}
                className="w-full bg-star-dark text-white py-4 rounded-xl font-bold text-lg shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all"
            >
                {isCreating ? '确认添加动作' : '保存设置'}
            </button>
        </div>
      </div>
      </motion.div>
      )}

      {/* Deviation Warning Overlay */}
      {showDeviationWarning && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 50 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 50 }}
            transition={{
              type: 'tween',
              duration: 0.3,
              ease: 'easeOut'
            }}
            className="fixed inset-0 flex items-center justify-center p-6"
          >
            <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl p-8">
              {/* Warning Icon */}
              <div className="flex justify-center mb-6">
                <svg className="w-16 h-16 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
              </div>

              {/* Title */}
              <h2 className="text-2xl font-black text-gray-900 text-center mb-4">
                检测到显著参数调整
              </h2>

              {/* Change Details */}
              <div className="bg-gray-50 rounded-xl p-4 mb-6">
                <p className="text-sm font-bold text-gray-600 mb-2">
                  你正在将 <span className="text-star-dark">{deviationValues.fieldLabel}</span>
                </p>
                <div className="flex items-center justify-center gap-4">
                  <div className="text-center">
                    <p className="text-xs font-bold text-gray-400 uppercase">原值</p>
                    <p className="text-xl font-black text-gray-500">{deviationValues.original}</p>
                  </div>
                  <svg className="w-6 h-6 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                  <div className="text-center">
                    <p className="text-xs font-bold text-gray-400 uppercase">新值</p>
                    <p className="text-xl font-black text-star-accent">{deviationValues.current}</p>
                  </div>
                </div>
              </div>

              {/* Reason Selection */}
              <p className="text-sm font-bold text-gray-600 mb-3 text-center">
                调整原因 (可选)
              </p>
              <div className="space-y-2 mb-8">
                {getDeviationReasons(type).map((reason) => (
                  <button
                    key={reason}
                    onClick={() => setDeviationReason(reason)}
                    className={`w-full px-4 py-3 rounded-xl font-bold text-sm transition-all ${
                      deviationReason === reason
                        ? 'bg-star-dark text-white shadow-lg'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {reason}
                  </button>
                ))}
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowDeviationWarning(false);
                    setDeviationReason('');
                    setDeviationField('');
                  }}
                  className="flex-1 py-3 rounded-xl font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-all"
                >
                  返回修改
                </button>
                <button
                  onClick={() => handleSave(true)}
                  className="flex-1 py-3 rounded-xl font-bold text-white bg-star-dark hover:bg-black transition-all shadow-lg"
                >
                  确认并保存
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </>
  );
};

export default ExerciseSettingsModal;
