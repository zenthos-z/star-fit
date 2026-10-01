import React from 'react';
import { ExerciseAction, LoadAnchors } from '../../types/protocol';
import { FloatingAttachment, Attachment } from './FloatingAttachment';
import { useAttachments } from '../../hooks/useAttachments';
// #88 分册3：cardType → 组件映射 = 注册表装配（原硬编码 PluginRegistry 已删）
import './registry/assembleCards';
import { resolveCard } from './registry/cardRegistry';

/**
 * 未注册 cardType 的显式错误卡（红线2「不兜底」）。
 * 可见失败 + 修复指引，替代迁移前的静默 StandardCard JSON 兜底。
 */
const UnregisteredCardError: React.FC<{ cardType: string | undefined }> = ({ cardType }) => (
  <div
    role="alert"
    data-testid="unregistered-card-error"
    className="p-4 border rounded-2xl shadow-sm bg-rose-50 border-rose-200"
  >
    <div className="flex justify-between items-center mb-2">
      <h3 className="font-bold text-base text-rose-700">
        卡片渲染失败：未注册的 cardType{cardType ? `「${cardType}」` : '（空）'}
      </h3>
    </div>
    <p className="text-xs text-rose-600 leading-relaxed">
      该类型未注册渲染组件，已按「不兜底」红线停止渲染（禁静默降级）。
      注册方式：register(&#123;cardType&#125;, Component, spec) →
      src/components/execution/registry/assembleCards.ts（新键需先进
      shared/contracts card-types 真源；AI 卡见 cardSpec.ts AI_CARD_TYPES）。
    </p>
  </div>
);

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
  /** #98 全部组完成态的「感受」入口（ResistanceCard 接入）——打开动作级聚合感受表单 */
  onFeelEntry?: () => void;
  onSettingsClick?: () => void;
  onConfirm?: (payload: any) => void;
}

/**
 * ExerciseRenderer - The central dispatcher for exercise cards.
 * Implements the Plugin-based Execution Layer as per EXERCISE_EXECUTION_REFACTOR_GUIDE.md.
 * Now upgraded to support Polymorphic Cards (PLAN, SUMMARY, etc.) for AICoachOverlay.
 *
 * #88 分册3：分发链切换到插件注册表（registry/assembleCards.ts 装配，
 * register(cardType, component, spec) 开放注册）。未注册 cardType = 显式
 * 错误卡（不兜底）；对外 props 接口不变，调用方无感。
 */
export const ExerciseRenderer: React.FC<ExerciseRendererProps> = ({
  exercise,
  isPaused = false,
  pauseStartTime,
  loadAnchors,
  uiHint,
  onUpdate,
  onFeelEntry,
  onSettingsClick,
  onConfirm
}) => {
  const { attachments, addAttachment, dismissAttachment } = useAttachments();

  // 1. Identification logic: prioritize uiHint.cardType/type, fallback to exercise.type
  //    （优先级与迁移前一致；exercise.type 细类裸值由注册表按真源映射派生标准卡）
  const rawCardType = uiHint?.cardType || uiHint?.type || exercise?.uiHint?.cardType || exercise?.type;

  // 2. Data normalization
  const data = exercise || uiHint?.data;

  if (!data && !uiHint) return null;

  // 3. Dispatch logic（注册表）：未注册 = undefined → 显式错误卡，禁静默兜底
  const entry = resolveCard(rawCardType);
  if (!entry) {
    console.error(
      `[ExerciseRenderer] 未注册的 cardType "${rawCardType ?? '(空)'}"——去注册：register(cardType, component, spec)` +
        `，装配文件 src/components/execution/registry/assembleCards.ts（#88 分册3；不设静默兜底）`,
    );
    return <UnregisteredCardError cardType={rawCardType} />;
  }
  const SelectedPlugin = entry.component as React.FC<any>;

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
          onFeelEntry={onFeelEntry}
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
