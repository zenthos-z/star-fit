/**
 * PickerConfigSheet — A9 参数配置面板（mock 阶段，纯前端）
 *
 * 形态复用 src/components/ExerciseSettingsModal.tsx 的权威结构：
 *   逐组 weight/reps 数字输入（CompactNumericInput 形态）、目标强度 RPE 滑杆、
 *   建议来源徽标、数据依据标签 —— 本文件仅重写实现，不改动原文件。
 * 新增：①「智能填充」开关（开=全推荐值自动填入，关=手动）
 *       ②组类型标注（热身/正式/递增/递减/AMRAP）
 * 红线：不出现「每组同配 / 每组各自调」类二分切换，逐组独立编辑。
 *
 * 协议扩展点：组类型（set_role）为前端 mock 字段，后端契约暂未收录，
 * 接入时以 shared/contracts 扩展为准。
 */

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  DATA_BASIS_LABELS,
  KIND_LABELS,
  ROLE_BADGE_CLASS,
  ROLE_LABELS,
  ROLE_ORDER,
  SOURCE_LABELS,
  type PickerDraftSet,
  type PickerSelectionItem,
  type PickerSetRole,
} from './pickerData';
import { createDraftId, planToDraftSets } from './pickerLogic';

interface PickerConfigSheetProps {
  item: PickerSelectionItem;
  /** 确认时回写清单（保留配置草稿） */
  onChange: (next: PickerSelectionItem) => void;
  onClose: () => void;
}

/** 建议来源徽标 — 与 ExerciseSettingsModal 的 SuggestionSourceBadge 同形态 */
function SourceBadge({ source }: { source: PickerSelectionItem['exercise']['suggestion']['source'] }) {
  const isCloud = source === 'formula' || source === 'hybrid';
  const isHeuristic = source === 'heuristic';
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold ${
        isCloud ? 'bg-blue-50 text-blue-500' : isHeuristic ? 'bg-amber-50 text-amber-500' : 'bg-gray-100 text-gray-400'
      }`}
    >
      <span className={`w-1 h-1 rounded-full ${isCloud ? 'bg-blue-400' : isHeuristic ? 'bg-amber-400' : 'bg-gray-300'}`} />
      {SOURCE_LABELS[source]}
    </span>
  );
}

/** 数字输入 — CompactNumericInput 同形态（数字居中、无步进器） */
const CompactNumericInput: React.FC<{
  val: number;
  /** 无障碍标签（如「第 1 组配重」） */
  label: string;
  onChange: (v: number) => void;
}> = ({ val, label, onChange }) => {
  const [tempValue, setTempValue] = useState(val.toString());

  React.useEffect(() => {
    setTempValue(val.toString());
  }, [val]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTempValue(e.target.value);
    const num = parseFloat(e.target.value);
    if (!isNaN(num)) onChange(num);
  };

  const handleBlur = () => setTempValue(val.toString());

  return (
    <div className="flex items-center h-10 bg-gray-50 rounded-lg border border-gray-200 overflow-hidden w-full relative hover:border-star-dark/30 transition-colors">
      <style>{`
        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
        input[type=number] { -moz-appearance: textfield; }
      `}</style>
      <input
        type="number"
        aria-label={label}
        value={tempValue}
        onChange={handleChange}
        onBlur={handleBlur}
        className="w-full h-full text-center font-bold text-gray-800 text-lg bg-transparent outline-none appearance-none p-0 z-10"
      />
    </div>
  );
};

const PickerConfigSheet: React.FC<PickerConfigSheetProps> = ({ item, onChange, onClose }) => {
  const { exercise } = item;
  const isStrength = exercise.kind === 'strength';
  /** 时长列展示单位：有氧按分钟，拉伸按秒 */
  const durationUnit = exercise.kind === 'cardio' ? '分' : '秒';

  const [sets, setSets] = useState<PickerDraftSet[]>(item.sets);
  const [targetRpe, setTargetRpe] = useState(item.targetRpe);
  /** 智能填充：默认开（mock 建议已自动填入清单初始值） */
  const [smartFill, setSmartFill] = useState(true);
  /** 正在编辑组类型的行下标 */
  const [roleEditorIdx, setRoleEditorIdx] = useState<number | null>(null);

  const applySuggestion = () => {
    setSets(planToDraftSets(exercise.suggestion.sets));
    setTargetRpe(exercise.suggestion.targetRpe);
  };

  const toggleSmartFill = () => {
    const next = !smartFill;
    setSmartFill(next);
    // 开=全推荐值自动填入；关=手动（已填值保留，不再自动覆盖）
    if (next) applySuggestion();
  };

  const updateSet = (idx: number, patch: Partial<PickerDraftSet>) => {
    setSets(prev => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const removeSet = (idx: number) => {
    if (sets.length <= 1) return;
    setSets(prev => prev.filter((_, i) => i !== idx));
  };

  const addSet = () => {
    const last = sets[sets.length - 1];
    setSets(prev => [
      ...prev,
      {
        id: createDraftId(),
        role: 'working',
        weight: last?.weight ?? 0,
        reps: last?.reps ?? 8,
        durationSec: last?.durationSec ?? 0,
      },
    ]);
  };

  const handleConfirm = () => {
    onChange({ ...item, sets, targetRpe });
    onClose();
  };

  /** 建议数值瓦片（SuggestionInfoWindow「建议数值」网格同形态） */
  const sug = exercise.suggestion;
  const sugWeights = sug.sets.map(s => s.weight).filter(v => v > 0);
  const sugReps = sug.sets.map(s => s.reps).filter(v => v > 0);
  const sugDur = sug.sets.map(s => s.durationSec ?? 0).filter(v => v > 0);
  const sugTiles: Array<[string, string]> = [
    ['组数', `${sug.sets.length}`],
    [sugWeights.length ? '负荷' : '方式', sugWeights.length ? `${Math.max(...sugWeights)}kg` : '自重'],
    [
      sugDur.length ? '时长' : '次数',
      sugDur.length
        ? `${sugDur[0] >= 120 ? `${+(sugDur[0] / 60).toFixed(1)}分` : `${sugDur[0]}秒`}${sugDur.length > 1 ? `×${sugDur.length}` : ''}`
        : sugReps.length
          ? `${Math.max(...sugReps)}次`
          : '—',
    ],
    ['目标 RPE', `${sug.targetRpe}`],
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-md rounded-t-3xl shadow-2xl overflow-hidden flex flex-col h-[92vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar pb-32">
          {/* Header / Name（ExerciseSettingsModal 头部同形态） */}
          <div className="px-6 pt-5 pb-2">
            <div className="flex items-center justify-between gap-4 mb-2">
              <h1 className="text-2xl font-black text-gray-900 tracking-tight leading-tight truncate flex-1">
                {exercise.name}
              </h1>
              <div className="shrink-0 flex items-center gap-2.5">
                <button
                  onClick={onClose}
                  aria-label="关闭配置"
                  className="w-10 h-10 bg-gray-100 text-gray-500 rounded-full flex items-center justify-center active:scale-90 transition-all"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                <button
                  onClick={handleConfirm}
                  aria-label="保存配置"
                  className="w-10 h-10 bg-star-dark text-white rounded-full flex items-center justify-center shadow-md hover:scale-105 active:scale-95 transition-all"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Tags Row（种类/肌群/器械 只读标签） */}
            <div className="flex flex-wrap gap-2 mb-2 min-h-[20px] items-center">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-gray-100">
                <span className={`w-1.5 h-1.5 rounded-full ${exercise.kind === 'cardio' ? 'bg-orange-400' : 'bg-blue-400'}`} />
                <span className="text-[10px] font-bold text-gray-600 uppercase tracking-wide">{KIND_LABELS[exercise.kind]}</span>
              </span>
              {exercise.muscles.map(m => (
                <span key={m} className="inline-flex items-center px-2.5 py-1 rounded-md bg-gray-100">
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">{m}</span>
                </span>
              ))}
              <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-gray-100">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">{exercise.equipment}</span>
              </span>
            </div>
          </div>

          <div className="h-px bg-gray-100 mb-6 mx-6" />

          {/* 智能填充卡（新增①：开关 + 建议来源徽标 + 建议数值 + 数据依据标签） */}
          <div className="px-6 mb-8">
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              <div className="p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[17px] font-semibold text-star-dark">智能填充</span>
                    <SourceBadge source={sug.source} />
                  </div>
                  <p className="text-xs font-medium text-gray-400 leading-snug">
                    {smartFill ? '推荐值已自动填入下方组安排' : '手动模式，推荐值不再自动覆盖'}
                  </p>
                </div>
                {/* iOS 开关 */}
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

              {/* 建议数值 + 数据依据 */}
              <div className="px-4 pb-4">
                <div className="grid grid-cols-4 gap-2 mb-3">
                  {sugTiles.map(([label, value]) => (
                    <div key={label} className="rounded-xl bg-gray-50 p-2 text-center">
                      <p className="text-sm font-black text-star-dark leading-tight">{value}</p>
                      <p className="text-[9px] font-bold text-gray-400 mt-0.5">{label}</p>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500 font-medium">数据依据</span>
                  <span className="font-bold text-star-dark">{DATA_BASIS_LABELS[sug.dataBasis]}</span>
                </div>
              </div>
            </div>
          </div>

          {/* 目标强度 RPE（ExerciseSettingsModal 滑杆同形态） */}
          <div className="px-6 mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-black text-gray-900 flex items-center gap-2">
                目标强度
                <span className="text-[10px] font-bold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded uppercase tracking-wider">RPE</span>
              </h2>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-black text-star-dark leading-none">@{targetRpe}</span>
                <span className="text-sm font-bold text-gray-400">/ 10</span>
              </div>
            </div>
            <div className="relative h-10 flex items-center px-1">
              <div className="absolute inset-x-0 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-gray-300 via-star-accent to-star-dark opacity-30"
                  style={{ width: `${((targetRpe - (isStrength ? 6 : 1)) / (isStrength ? 4 : 9)) * 100}%` }}
                />
              </div>
              <input
                type="range"
                min={isStrength ? 6 : 1}
                max={10}
                step={0.5}
                value={targetRpe}
                onChange={e => setTargetRpe(Number(e.target.value))}
                aria-label="目标强度 RPE"
                className="w-full h-10 bg-transparent appearance-none cursor-pointer z-10 relative [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-star-dark [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:active:scale-110"
              />
            </div>
          </div>

          {/* 训练组安排（逐组编辑 + 组类型标注，新增②） */}
          <div className="px-6">
            <div className="flex justify-between items-end mb-4 border-b border-gray-100 pb-2">
              <label className="text-sm font-bold text-black uppercase tracking-wider">训练组安排</label>
              <span className="text-[10px] font-bold text-gray-400 bg-gray-50 px-2 py-0.5 rounded">共 {sets.length} 组</span>
            </div>

            {/* Table Header */}
            <div className="flex gap-2.5 mb-2 px-1">
              <div className="w-8 text-center text-[10px] font-bold text-gray-300 uppercase">组</div>
              <div className="w-[52px] text-center text-[10px] font-bold text-gray-300 uppercase">类型</div>
              {isStrength ? (
                <>
                  <div className="flex-1 text-center text-[10px] font-bold text-gray-300 uppercase">配重 <span className="ml-0.5 opacity-50">KG</span></div>
                  <div className="flex-1 text-center text-[10px] font-bold text-gray-300 uppercase">次数 <span className="ml-0.5 opacity-50">次</span></div>
                </>
              ) : (
                <div className="flex-1 text-center text-[10px] font-bold text-gray-300 uppercase">
                  时长 <span className="ml-0.5 opacity-50">{durationUnit}</span>
                </div>
              )}
              <div className="w-8" />
            </div>

            <div className="space-y-2">
              {sets.map((set, i) => (
                <div key={set.id}>
                  <div className="flex items-center gap-2.5">
                    {/* Index */}
                    <div className="w-8 h-8 shrink-0 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-500">
                      {i + 1}
                    </div>
                    {/* 组类型标注 chip（点按展开选择条） */}
                    <button
                      onClick={() => setRoleEditorIdx(roleEditorIdx === i ? null : i)}
                      aria-label={`第 ${i + 1} 组类型：${ROLE_LABELS[set.role]}`}
                      className={`w-[52px] shrink-0 px-1 py-1.5 rounded-md text-[10px] font-bold text-center transition-colors ${ROLE_BADGE_CLASS[set.role]}`}
                    >
                      {ROLE_LABELS[set.role]}
                    </button>
                    {/* Inputs */}
                    {isStrength ? (
                      <>
                        <div className="flex-1 min-w-0">
                          <CompactNumericInput val={set.weight} label={`第 ${i + 1} 组配重`} onChange={v => updateSet(i, { weight: v })} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <CompactNumericInput val={set.reps} label={`第 ${i + 1} 组次数`} onChange={v => updateSet(i, { reps: v })} />
                        </div>
                      </>
                    ) : (
                      <div className="flex-1 min-w-0">
                        <CompactNumericInput
                          val={exercise.kind === 'cardio' ? Math.round((set.durationSec / 60) * 10) / 10 : set.durationSec}
                          label={`第 ${i + 1} 组时长`}
                          onChange={v => updateSet(i, { durationSec: exercise.kind === 'cardio' ? Math.round(v * 60) : v })}
                        />
                      </div>
                    )}
                    {/* Delete */}
                    <button
                      onClick={() => removeSet(i)}
                      aria-label={`删除第 ${i + 1} 组`}
                      className="w-8 h-8 shrink-0 flex items-center justify-center text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  {/* 组类型选择条 */}
                  {roleEditorIdx === i && (
                    <div className="grid grid-cols-5 gap-1 mt-2 pl-[42px]">
                      {ROLE_ORDER.map(role => (
                        <button
                          key={role}
                          onClick={() => {
                            updateSet(i, { role: role as PickerSetRole });
                            setRoleEditorIdx(null);
                          }}
                          className={`py-1.5 rounded-md text-[10px] font-bold transition-colors ${
                            set.role === role ? 'bg-star-dark text-white' : 'bg-gray-100 text-gray-500'
                          }`}
                        >
                          {ROLE_LABELS[role]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* 添加一组 */}
            <button
              onClick={addSet}
              className="w-full mt-4 py-3 border-2 border-dashed border-gray-200 rounded-xl text-gray-400 font-bold hover:border-star-accent hover:text-star-accent hover:bg-blue-50 transition-all flex items-center justify-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              添加一组
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default PickerConfigSheet;
