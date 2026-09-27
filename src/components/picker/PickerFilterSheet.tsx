/**
 * PickerFilterSheet — A8 筛选半模态 Sheet（交互结构照搬 LiftLab 参考案例，色彩走项目规范）
 *
 * 结构：拖动手柄 + 居中标题 + 双列卡片网格多选（肌肉维度带上肢/下肢/核心分组小标题）
 *       + 底部双按钮：左「清除筛选器」(灰底) + 右「显示 N 个结果」(blue-500 实心，
 *       结果计数内嵌 CTA、随选择实时变化)。Sheet 内为草稿态，点 CTA 才应用。
 * 维度：types（类型 · 覆盖 ExerciseType 9 类全集）/ muscles / equipment。
 */

import React from 'react';
import { motion } from 'framer-motion';
import {
  EQUIPMENT_SHEET_ORDER,
  MUSCLE_SHEET_GROUPS,
  TYPE_LABELS,
  TYPE_SHEET_ORDER,
  equipmentLabelOf,
} from './pickerData';

export type PickerFilterDim = 'types' | 'muscles' | 'equipment';

const DIM_TITLES: Record<PickerFilterDim, string> = {
  types: '类型',
  muscles: '肌肉群',
  equipment: '器械',
};

/** 卡片圆底线条图标（SF Symbols 风格，抽象占位；mock 阶段统一 1.8 描边） */
const ICON_PATHS: Record<string, string[]> = {
  // 类型
  resistance: ['M7 7v10', 'M17 7v10', 'M3.75 9.5v5', 'M20.25 9.5v5', 'M7 12h10'],
  weight_only: ['M7 7v10', 'M17 7v10', 'M3.75 9.5v5', 'M20.25 9.5v5', 'M7 12h10'],
  bodyweight: [
    'M12 6.75a1.75 1.75 0 100-3.5 1.75 1.75 0 000 3.5z',
    'M12 9v6', 'M12 11l-3.25 1.75', 'M12 11l3.25 1.75', 'M12 15l-2.5 5.5', 'M12 15l2.5 5.5',
  ],
  reps_only: [
    'M12 6.75a1.75 1.75 0 100-3.5 1.75 1.75 0 000 3.5z',
    'M12 9v6', 'M12 11l-3.25 1.75', 'M12 11l3.25 1.75', 'M12 15l-2.5 5.5', 'M12 15l2.5 5.5',
  ],
  cardio: ['M3 12h4l2.25-5.25L12.75 17l2.25-5H21'],
  isometric: ['M6 4v16', 'M18 4v16', 'M6 12h12'],
  assisted: ['M4.5 16.5c5-8.5 10-8.5 15-7.5', 'M16 6.5l3.5 2.5-2.5 3.5'],
  unilateral: ['M5 9v6', 'M9 7v10', 'M9 12h10'],
  outdoor: ['M3 18l6-9.5 4 6 2.5-3.5L21 18z'],
  flexibility: ['M3.75 12h16.5', 'M3.75 12l3-3', 'M3.75 12l3 3', 'M20.25 12l-3-3', 'M20.25 12l-3 3'],
  // 肌肉
  muscle: ['M12 3.75a8.25 8.25 0 100 16.5 8.25 8.25 0 000-16.5z', 'M8.5 9.5c1-2 2.5-2.5 3.5-2.5s2.5.5 3.5 2.5'],
  // 器械（v4 具象化：多部件写实线条，自绘开源风格，无 license 约束）
  barbell: [
    'M8 5.5v13', 'M16 5.5v13',                       // 内侧杠铃片
    'M5.25 7v10', 'M18.75 7v10',                     // 外侧大杠铃片
    'M2.75 9.75v4.5', 'M21.25 9.75v4.5',             // 杠端
    'M8 12h8',                                       // 杆
  ],
  dumbbell: [
    'M6 6.75v10.5', 'M18 6.75v10.5',                 // 两端片
    'M3.25 9v6', 'M20.75 9v6',                       // 外片
    'M6 12h12',                                      // 握杆
  ],
  plate: ['M12 4.5a7.5 7.5 0 100 15 7.5 7.5 0 000-15z', 'M12 9.25a2.75 2.75 0 100 5.5 2.75 2.75 0 000-5.5z', 'M12 3v1.5', 'M12 19.5V21'],
  cable: [
    'M4.5 4.5v15',                                                  // 立柱
    'M4.5 6h5',                                                     // 顶臂
    'M9.5 6c4.5 1.5 6 4.5 6 8.5',                                   // 钢缆
    'M13 16.5h5',                                                   // 握把横杆
    'M15.5 16.5v-2',                                                // 挂环
  ],
  machine: [
    'M4.5 4.5v15',                                                  // 框架
    'M4.5 8h7.5c2 0 3.5 1.5 3.5 3.5V16',                            // 座垫臂
    'M6.5 16.5h7',                                                  // 座面
    'M17.5 9v5',                                                    // 配重片
    'M16 20.5h3',                                                   // 底座
  ],
  band: ['M7.5 8h9a4 4 0 010 8H7.5a4 4 0 010-8z', 'M7.5 8c-1.75 0-3 1.25-3 2.75', 'M16.5 16c1.75 0 3-1.25 3-2.75'],
  free: [
    'M12 6.75a1.75 1.75 0 100-3.5 1.75 1.75 0 000 3.5z',
    'M12 9v6', 'M12 11l-3.25 1.75', 'M12 11l3.25 1.75', 'M12 15l-2.5 5.5', 'M12 15l2.5 5.5',
  ],
  kettlebell: [
    'M9.75 8.25a5 5 0 104.5 0',                                      // 球体
    'M9.75 8.25c0-2 0.75-3.5 2.25-3.5s2.25 1.5 2.25 3.5',            // 把手
    'M9 17.5c0-1.75 1.25-3 3-3s3 1.25 3 3',                          // 高光弧
  ],
  stability_ball: ['M12 4.5a7.5 7.5 0 100 15 7.5 7.5 0 000-15z', 'M6.75 11c1.5-2.25 4-3.25 5.25-3.25', 'M4 19.5h16'],
  medicine_ball: ['M12 5.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13z', 'M9.25 9.25h5.5', 'M9.25 14.75h5.5', 'M12 9.25v5.5'],
  weighted: ['M12 4.5a7.5 7.5 0 100 15 7.5 7.5 0 000-15z', 'M12 9.25a2.75 2.75 0 100 5.5 2.75 2.75 0 000-5.5z'],
  treadmill: ['M4.5 18h13a3 3 0 100-6H9.5', 'M7.5 5.5l3 6.5', 'M4.5 18v1.5'],
  rower: ['M4.5 16.5h13', 'M6 5.25c6.5 1 10 5.5 11.5 11.25', 'M14.75 5.25l3.5 2.5', 'M4.5 19h15'],
  other: ['M6.5 12h.01', 'M12 12h.01', 'M17.5 12h.01'],
};

function SheetCardIcon({ iconKey, selected }: { iconKey: string; selected: boolean }) {
  const paths = ICON_PATHS[iconKey] ?? ICON_PATHS.muscle;
  return (
    <span
      className={`w-12 h-12 shrink-0 rounded-full flex items-center justify-center ${
        selected ? 'bg-blue-50 text-blue-500' : 'bg-gray-100 text-gray-500'
      }`}
    >
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" className="w-6 h-6">
        {paths.map((d, i) => (
          <path key={i} strokeLinecap="round" strokeLinejoin="round" d={d} />
        ))}
      </svg>
    </span>
  );
}

interface FilterSheetProps {
  dim: PickerFilterDim;
  /** 该维度草稿选择（types 存 type 字符串，muscles 存肌群名，equipment 存器械名） */
  draft: string[];
  resultCount: number;
  onToggle: (value: string) => void;
  onClear: () => void;
  onApply: () => void;
  onClose: () => void;
}

/** 双列筛选卡片（选中=蓝边框 + 浅蓝底，参考案例口径映射 blue-500） */
function Card({
  value,
  label,
  iconKey,
  selected,
  onToggle,
}: {
  value: string;
  label: string;
  iconKey: string;
  selected: boolean;
  onToggle: (v: string) => void;
}) {
  return (
    <button
      onClick={() => onToggle(value)}
      aria-pressed={selected}
      className={`flex items-center gap-3 p-3 rounded-2xl bg-white shadow-sm border-2 text-left transition-colors ${
        selected ? 'border-blue-500 bg-blue-50' : 'border-transparent'
      }`}
    >
      <SheetCardIcon iconKey={iconKey} selected={selected} />
      <span className="text-[17px] font-medium text-star-dark">{label}</span>
    </button>
  );
}

const PickerFilterSheet: React.FC<FilterSheetProps> = ({
  dim,
  draft,
  resultCount,
  onToggle,
  onClear,
  onApply,
  onClose,
}) => {
  const selected = new Set(draft);

  const renderGrid = (items: Array<{ value: string; label: string; iconKey: string }>) => (
    <div className="grid grid-cols-2 gap-2.5">
      {items.map(item => (
        <Card
          key={item.value}
          value={item.value}
          label={item.label}
          iconKey={item.iconKey}
          selected={selected.has(item.value)}
          onToggle={onToggle}
        />
      ))}
    </div>
  );

  const body = () => {
    if (dim === 'types') {
      return renderGrid(
        TYPE_SHEET_ORDER.map(t => ({ value: t, label: TYPE_LABELS[t], iconKey: t })),
      );
    }
    if (dim === 'equipment') {
      return renderGrid(
        EQUIPMENT_SHEET_ORDER.map(e => ({ value: e, label: equipmentLabelOf(e), iconKey: e })),
      );
    }
    // 肌肉群：上肢/下肢/核心 分组小标题（参考案例 Upper/Lower 口径）
    return MUSCLE_SHEET_GROUPS.map(group => (
      <div key={group.label} className="mb-5">
        <p className="text-[20px] font-normal text-gray-400 px-1 pb-2.5">{group.label}</p>
        {renderGrid(group.muscles.map(m => ({ value: m, label: m, iconKey: 'muscle' })))}
      </div>
    ));
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[75] bg-black/40"
      onClick={onClose}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={DIM_TITLES[dim]}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'tween', duration: 0.28, ease: 'easeOut' }}
        className="absolute bottom-0 inset-x-0 bg-star-gray rounded-t-3xl shadow-2xl flex flex-col max-h-[78vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* 拖动手柄 + 居中标题 */}
        <div className="pt-2.5 pb-1 flex justify-center">
          <span className="w-9 h-1 rounded-full bg-gray-300" />
        </div>
        <p className="text-center text-[20px] font-semibold text-star-dark pb-3 border-b border-gray-200/70">
          {DIM_TITLES[dim]}
        </p>

        {/* 双列卡片网格 */}
        <div className="flex-1 overflow-y-auto px-4 pt-4 pb-3 custom-scrollbar">{body()}</div>

        {/* 底部双按钮：清除筛选器 + 显示 N 个结果（计数内嵌 CTA） */}
        <div
          className="px-4 pt-2 flex gap-3"
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }}
        >
          <button
            onClick={onClear}
            className="flex-1 h-12 rounded-xl bg-black/[0.06] text-star-dark text-[17px] font-semibold active:scale-[0.98] transition-transform"
          >
            清除筛选器
          </button>
          <button
            onClick={onApply}
            className="flex-1 h-12 rounded-xl bg-blue-500 active:bg-blue-600 text-white text-[17px] font-semibold active:scale-[0.98] transition-transform"
          >
            显示 {resultCount} 个结果
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default PickerFilterSheet;
