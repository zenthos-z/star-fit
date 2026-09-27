/**
 * PickerConfigSheet — A9 参数配置面板（真组件复用 + v4 UI 重审）
 *
 * 参数配置主体 = 真实 src/components/ExerciseSettingsModal.tsx 组件本体
 * （逐组编辑 / RPE / 建议徽标 / 数据依据 / 应用建议全部为现有组件原逻辑）。
 * 本文件只承载两个增量点的挂载：
 *   ① 组类型标注（热身/正式/递增/递减/AMRAP）——chip 经 renderSetExtras 注入
 *      每组行内；点按在该组行正下方展开 inline 选择条（renderSetFootnote，
 *      v4 由底部选择条改为行内切换，路径更短、上下文更近）；
 *   ② 智能填充开关——经 smartFillSlot 注入「训练组安排」上方；
 *      开启时经 externalApiRef 触发面板内部「应用建议」同款逻辑。
 * 协议扩展点：组类型（set_role）为前端 mock 字段，后端契约暂未收录，
 * 接入时以 shared/contracts 扩展为准。
 *
 * 层级说明：ExerciseSettingsModal 根节点为 fixed z-[60]，而选择器弹层为 z-[70]；
 * 本包装层以 z-[80] 建立独立层叠上下文，让内部 z-[60] 的真实面板整体浮于选择器之上。
 */

import React, { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import ExerciseSettingsModal, { SuggestionSourceBadge } from '../ExerciseSettingsModal';
import type { ExerciseAction } from '../../types/protocol';
import { haptic } from '../../lib/nativeHaptics';
import {
  PROTOCOL_TYPE,
  ROLE_BADGE_CLASS,
  ROLE_LABELS,
  ROLE_ORDER,
  type PickerDraftSet,
  type PickerSelectionItem,
  type PickerSetRole,
} from './pickerData';
import { createDraftId } from './pickerLogic';

interface PickerConfigSheetProps {
  item: PickerSelectionItem;
  /** 确认时回写清单（保留配置草稿） */
  onChange: (next: PickerSelectionItem) => void;
  onClose: () => void;
}

/** 清单项 → ExerciseAction（对齐 src/types/bridge.ts convertExerciseToAction 的字段口径） */
function toExerciseAction(item: PickerSelectionItem): ExerciseAction {
  const { exercise, sets, targetRpe } = item;
  return {
    protocol_version: '2.0.0',
    id: exercise.id,
    exerciseId: `fit://library/exercise/${exercise.id}`,
    type: PROTOCOL_TYPE[exercise.exerciseType],
    sets: sets.map((s, idx) => ({
      index: idx,
      reps: s.reps,
      weight: s.weight,
      duration: s.durationSec,
      status: 'PLANNED' as const,
    })),
    metadata: {
      name: exercise.name,
      nameEn: exercise.nameEn,
      libraryId: exercise.id,
      targetRpe,
      originalType: exercise.exerciseType, // legacy 9 类口径（normalizeType 兜底用）
      primaryMuscles: exercise.muscles,
      equipment: exercise.equipmentLabel, // 展示口径：真实面板标签行直读该值
      bodyCategory: exercise.muscle,
    },
  };
}

const PickerConfigSheet: React.FC<PickerConfigSheetProps> = ({ item, onChange, onClose }) => {
  const { exercise } = item;
  /** 组类型标注（增量点①）：与清单草稿逐组对齐，真实面板增删组后按序补齐 */
  const [roles, setRoles] = useState<PickerSetRole[]>(item.sets.map(s => s.role));
  /** 智能填充（增量点②）：默认开——清单初始值即推荐值 */
  const [smartFill, setSmartFill] = useState(true);
  /** 正在展开行内选择条的组下标 */
  const [roleEditorIdx, setRoleEditorIdx] = useState<number | null>(null);
  const apiRef = useRef<{ applySuggestion?: () => void } | null>(null);

  const roleOf = (i: number): PickerSetRole => roles[i] ?? 'working';

  const assignRole = (i: number, role: PickerSetRole) => {
    haptic('light');
    setRoles(prev => {
      const next = [...prev];
      while (next.length <= i) next.push('working');
      next[i] = role;
      return next;
    });
    setRoleEditorIdx(null);
  };

  const toggleSmartFill = () => {
    const next = !smartFill;
    setSmartFill(next);
    // 开=全推荐值自动填入（触发真实面板的「应用建议」同款逻辑）；关=手动，不再自动覆盖
    if (next) {
      haptic('medium');
      apiRef.current?.applySuggestion();
    }
  };

  /** 真实面板保存回调 → 回写清单草稿 */
  const handleSave = (_exerciseId: string, updates: Partial<ExerciseAction>) => {
    const saved = updates.sets ?? [];
    const meta = (updates.metadata ?? {}) as Record<string, unknown>;
    const nextSets: PickerDraftSet[] = saved.map((s, idx) => ({
      id: createDraftId(),
      role: roleOf(idx),
      weight: s.weight || 0,
      reps: s.reps || 0,
      durationSec: s.duration || 0,
    }));
    // 有氧/户外：真实面板把目标时长写入 metadata.targetDurationSec（sets.duration 置 0）
    const cardioTargetSec = meta.targetDurationSec as number | undefined;
    if (cardioTargetSec && nextSets[0]) {
      nextSets[0] = { ...nextSets[0], durationSec: cardioTargetSec };
    }
    onChange({
      exercise: item.exercise,
      sets: nextSets,
      targetRpe: (meta.targetRpe as number | undefined) ?? item.targetRpe,
    });
    onClose();
  };

  /** 增量点①：逐组行内的组类型 chip（点按展开行下 inline 选择条） */
  const renderSetExtras = (i: number) => (
    <button
      onClick={() => {
        haptic('light');
        setRoleEditorIdx(cur => (cur === i ? null : i));
      }}
      aria-label={`第 ${i + 1} 组类型：${ROLE_LABELS[roleOf(i)]}`}
      className={`w-[52px] shrink-0 px-1 py-1.5 rounded-md text-[10px] font-bold text-center transition-colors ${ROLE_BADGE_CLASS[roleOf(i)]}`}
    >
      {ROLE_LABELS[roleOf(i)]}
    </button>
  );

  /** 增量点①（v4）：行内选择条——在该组行正下方展开，无需跳转到底部选择条 */
  const renderSetFootnote = (i: number) => {
    if (roleEditorIdx !== i) return null;
    return (
      <div className="grid grid-cols-5 gap-1 mt-2 pl-[42px]" role="group" aria-label={`第 ${i + 1} 组类型选择`}>
        {ROLE_ORDER.map(role => (
          <button
            key={role}
            onClick={() => assignRole(i, role)}
            className={`py-1.5 rounded-md text-[10px] font-bold transition-colors ${
              roleOf(i) === role ? 'bg-star-dark text-white' : 'bg-gray-100 text-gray-500'
            }`}
          >
            {ROLE_LABELS[role]}
          </button>
        ))}
      </div>
    );
  };

  /** 增量点②：智能填充开关卡（建议来源徽标/数据依据/建议数值均由真实面板原生呈现） */
  const smartFillSlot = (
    <div className="px-6 mb-6">
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[17px] font-semibold text-star-dark">智能填充</span>
            <SuggestionSourceBadge source={exercise.suggestion.source} />
          </div>
          <p className="text-xs font-medium text-gray-400 leading-snug">
            {smartFill ? '推荐值已自动填入；重新开启将再次应用' : '手动模式，推荐值不再自动覆盖'}
          </p>
        </div>
        <button
          role="switch"
          aria-checked={smartFill}
          aria-label="智能填充"
          onClick={toggleSmartFill}
          className={`shrink-0 w-[51px] h-[31px] rounded-full p-[2px] transition-colors duration-200 ${
            smartFill ? 'bg-blue-500' : 'bg-gray-200'
          }`}
        >
          <span
            className={`block w-[27px] h-[27px] bg-white rounded-full shadow transition-transform duration-200 ${
              smartFill ? 'translate-x-[20px]' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[80]"
    >
      {/* 参数配置主体：现有 ExerciseSettingsModal 组件本体（非模仿重写）。
          isCreating=true 走「新增动作」语义（跳过偏离确认）；动作库切换入口在本流程停用。 */}
      <ExerciseSettingsModal
        exercise={toExerciseAction(item)}
        isCreating
        onClose={onClose}
        onSave={handleSave}
        isLibraryOpen={false}
        onLibraryOpenChange={() => {}}
        renderSetExtras={renderSetExtras}
        renderSetFootnote={renderSetFootnote}
        smartFillSlot={smartFillSlot}
        externalApiRef={apiRef}
      />
    </motion.div>
  );
};

export default PickerConfigSheet;
