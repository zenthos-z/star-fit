import React from 'react';
import { ExerciseAction, LoadAnchors } from '../../types/protocol';
import { ResistanceCard } from './plugins/ResistanceCard';
import { CardioCard } from './plugins/CardioCard';
import { RunningCard } from './plugins/RunningCard';
// import { OutdoorRunningCard } from './plugins/OutdoorRunningCard';
const OutdoorExerciseCardV2 = React.lazy(() => import('./plugins/OutdoorExerciseCardV2').then(m => ({ default: m.OutdoorExerciseCardV2 })));
import { IsometricCard } from './plugins/IsometricCard';
import { PlanCard } from './cards/PlanCard';
import { SummaryCard } from './cards/SummaryCard';
import { SurveyCard } from './cards/SurveyCard';
import { SurveySuccessCard } from './cards/SurveySuccessCard';
import { AuditCompleteCard } from './cards/AuditCompleteCard';
import { HitlConfirmCard } from './cards/HitlConfirmCard';
import { StrategyConfirmCard } from './cards/StrategyConfirmCard';
import { FloatingAttachment, Attachment } from './FloatingAttachment';
import { useAttachments } from '../../hooks/useAttachments';

/**
 * Placeholder for Generic/Standard Card
 * [FIX] 去掉冗余的兜底展示，直接渲染实际内容或错误信息
 */
const StandardCard: React.FC<{
  exercise: ExerciseAction;
  uiHint?: any;
  onUpdate?: (updates: Partial<ExerciseAction>) => void;
  onConfirm?: (payload: any) => void;
  addAttachment?: (attachment: Omit<Attachment, 'id' | 'timestamp'>) => void;
}> = ({ exercise, uiHint }) => {
  // 优先展示 uiHint 中的原始数据，而不是兜底信息
  const displayData = uiHint?.data || exercise;

  return (
    <div className="p-4 border rounded-2xl shadow-sm bg-gray-50 border-gray-200">
      <div className="flex justify-between items-center mb-2">
        <h3 className="font-bold text-lg text-gray-700">{exercise.exerciseId}</h3>
        <span className="text-xs text-gray-400 uppercase font-bold tracking-widest">{exercise.type}</span>
      </div>
      <pre className="text-xs text-gray-600 whitespace-pre-wrap bg-gray-100 p-3 rounded-lg overflow-auto max-h-60">
        {JSON.stringify(displayData, null, 2)}
      </pre>
    </div>
  );
};

/**
 * Plugin Registry Mapping
 * Maps cardType (from uiHint or exercise.type) to specialized components.
 *
 * 统一标准：小写 + 下划线格式
 */
const PluginRegistry: Record<string, React.FC<any>> = {
  // 运动类型卡片
  'resistance_standard': ResistanceCard,
  'cardio_running': RunningCard,
  'running_gps': OutdoorExerciseCardV2,
  'outdoor_gps': OutdoorExerciseCardV2,
  'isometric_static': IsometricCard,
  'hiit_timer': CardioCard,

  // AI Coach 卡片 - 统一为新标准（小写 + 下划线）
  'plan_card': PlanCard,
  'survey_card': SurveyCard,
  'summary_card': SummaryCard,
  'survey_success': SurveySuccessCard,
  'audit_complete': AuditCompleteCard,
  'strategy_confirm': StrategyConfirmCard,
  'hitl_confirm': HitlConfirmCard,

  // 错误兜底
  'skeleton': StandardCard,
  'unknown': StandardCard,
};

interface ExerciseRendererProps {
  exercise?: ExerciseAction;
  isPaused?: boolean;
  pauseStartTime?: number;
  loadAnchors?: LoadAnchors;
  uiHint?: {
    type: string;
    data: any;
    cardType?: string;
  };
  onUpdate?: (updates: Partial<ExerciseAction>) => void;
  onSettingsClick?: () => void;
  onConfirm?: (payload: any) => void;
}

/**
 * ExerciseRenderer - The central dispatcher for exercise cards.
 * Implements the Plugin-based Execution Layer as per EXERCISE_EXECUTION_REFACTOR_GUIDE.md.
 * Now upgraded to support Polymorphic Cards (PLAN, SUMMARY, etc.) for AICoachOverlay.
 */
export const ExerciseRenderer: React.FC<ExerciseRendererProps> = ({
  exercise,
  isPaused = false,
  pauseStartTime,
  loadAnchors,
  uiHint,
  onUpdate,
  onSettingsClick,
  onConfirm
}) => {
  const { attachments, addAttachment, dismissAttachment } = useAttachments();

  // 1. Identification logic: prioritize uiHint.cardType/type, fallback to exercise.type
  const cardType = uiHint?.cardType || uiHint?.type || exercise?.uiHint?.cardType || exercise?.type || 'standard';

  // 2. Dispatch logic
  const SelectedPlugin = (PluginRegistry[cardType] || StandardCard) as React.FC<any>;

  // 3. Data normalization
  const data = exercise || uiHint?.data;

  if (!data && !uiHint) return null;

  return (
    <div className="exercise-renderer-wrapper group relative">
      <React.Suspense fallback={<div className="p-8 text-center text-gray-400 animate-pulse">正在加载运动插件...</div>}>
        <SelectedPlugin
          exercise={data}
          isPaused={isPaused}
          pauseStartTime={pauseStartTime}
          loadAnchors={loadAnchors}
          uiHint={uiHint}
          onUpdate={onUpdate}
          onConfirm={onConfirm}
          addAttachment={addAttachment}
        />
      </React.Suspense>

      {/* Non-blocking interaction gateway - only for execution context */}
      {exercise && (
        <FloatingAttachment
          attachments={attachments}
          onDismiss={dismissAttachment}
        />
      )}
    </div>
  );
};
