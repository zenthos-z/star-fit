/**
 * A8+A9 动作选择器 mock 数据（纯前端阶段）
 *
 * 本文件全部为 mock 常量，不含任何 API 调用；对接后端时：
 *  - 列表来源替换为动作库服务（ExerciseLibraryService），rank / hotRank / isRecommended
 *    由服务端排序接口下发（智能排序只呈现结果，前端不做解释文案）；
 *  - exerciseType 对齐 src/types/legacy.ts 的 ExerciseType 9 类全集
 *    （resistance/cardio/bodyweight/isometric/assisted/unilateral/weight_only/reps_only/outdoor），
 *    筛选体系（类型 Sheet）必须覆盖含 cardio 在内的全部 9 类；
 *  - suggestion 对应建议服务（SuggestionService）的解析结果；
 *  - imageRefs 为缩略图接口预留位（对应动作库 image_refs），mock 阶段为空 → 类型图标占位。
 */

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** 动作类型全集（对齐 src/types/legacy.ts ExerciseType 9 类） */
export type PickerExerciseType =
  | 'resistance'
  | 'cardio'
  | 'bodyweight'
  | 'isometric'
  | 'assisted'
  | 'unilateral'
  | 'weight_only'
  | 'reps_only'
  | 'outdoor';

/** 区域（肌肉 Sheet 的上肢/下肢/核心分组口径） */
export type PickerRegion = 'upper' | 'lower' | 'core';

/** 列表缩略示意图标类别（mock 视觉字段；image_refs 就位后由缩略图替代） */
export type PickerVisual = 'dumbbell' | 'bodyweight' | 'pulse' | 'stretch';

/** 组类型标注（协议扩展点：后端契约暂未收录 set_role，接入时以 shared/contracts 扩展为准） */
export type PickerSetRole = 'warmup' | 'working' | 'rampUp' | 'rampDown' | 'amrap';

/** 建议来源（与 ExerciseSettingsModal 的 SuggestionSource 徽标同口径） */
export type PickerSuggestionSource = 'hybrid' | 'formula' | 'cache' | 'heuristic';

/** 数据依据标签（与 ExerciseSettingsModal 的 DATA_BASIS_LABELS 同口径） */
export type PickerDataBasis = 'anchor' | 'history' | 'bodyweight_estimate' | 'type_default';

/** 单组推荐值（mock） */
export interface PickerSetPlan {
  role: PickerSetRole;
  /** kg；0 = 自重 */
  weight: number;
  /** 次数（按次数计的组） */
  reps: number;
  /** 秒（按时长计的组：有氧 / 拉伸 / 静态） */
  durationSec?: number;
}

/** 动作推荐参数（mock，来源口径复用 ExerciseSettingsModal 的建议徽标/数据依据标签） */
export interface PickerSuggestion {
  source: PickerSuggestionSource;
  dataBasis: PickerDataBasis;
  targetRpe: number;
  sets: PickerSetPlan[];
}

/** 动作库条目（mock 阶段的列表数据形状，对接后端时字段名向动作库契约对齐） */
export interface PickerExercise {
  id: string;
  /** 中文展示名（A6 口径：中文优先） */
  name: string;
  nameEn: string;
  exerciseType: PickerExerciseType;
  region: PickerRegion;
  /** 主肌群（中文） */
  muscle: string;
  muscles: string[];
  equipment: string;
  /** 全拼（搜索兜底用，对接后端后由服务端索引承担） */
  pinyin: string;
  /** 拼音首字母（搜索兜底用） */
  pinyinInitials: string;
  /** 智能排序预置序（1 最高，mock 已按序排列，前端只呈现不解释） */
  rank: number;
  /** 热门排序（新手态） */
  hotRank: number;
  /** 「为你推荐」徽标 */
  isRecommended: boolean;
  suggestion: PickerSuggestion;
  /** 列表缩略示意图标（mock 视觉字段） */
  visual: PickerVisual;
  /** 缩略图接口预留位；mock 阶段为空 → 类型图标占位 */
  imageRefs?: { thumb?: string };
}

/** 配置面板中可编辑的一组（清单页/配置页流转的草稿形态） */
export interface PickerDraftSet {
  id: string;
  role: PickerSetRole;
  weight: number;
  reps: number;
  /** 秒；非时长动作恒为 0 */
  durationSec: number;
}

/** 清单项：动作 + 已配置参数（顺序即训练顺序） */
export interface PickerSelectionItem {
  exercise: PickerExercise;
  sets: PickerDraftSet[];
  targetRpe: number;
}

// ---------------------------------------------------------------------------
// 标签常量
// ---------------------------------------------------------------------------

/** 9 类动作类型的展示名（类型 Sheet 卡片，覆盖含 cardio 在内的全集） */
export const TYPE_LABELS: Record<PickerExerciseType, string> = {
  resistance: '力量',
  bodyweight: '自重',
  cardio: '有氧',
  isometric: '静态',
  assisted: '辅助',
  unilateral: '单侧',
  weight_only: '负重',
  reps_only: '计次',
  outdoor: '户外',
};

/** 类型 Sheet 卡片顺序（力量体系在前，与参考案例的信息层级一致） */
export const TYPE_SHEET_ORDER: PickerExerciseType[] = [
  'resistance',
  'bodyweight',
  'cardio',
  'isometric',
  'assisted',
  'unilateral',
  'weight_only',
  'reps_only',
  'outdoor',
];

export const ROLE_LABELS: Record<PickerSetRole, string> = {
  warmup: '热身',
  working: '正式',
  rampUp: '递增',
  rampDown: '递减',
  amrap: 'AMRAP',
};

export const ROLE_ORDER: PickerSetRole[] = ['warmup', 'working', 'rampUp', 'rampDown', 'amrap'];

/** 组类型徽标配色（小面积点缀；AMRAP 用 star-accent 黄绿） */
export const ROLE_BADGE_CLASS: Record<PickerSetRole, string> = {
  warmup: 'bg-blue-50 text-blue-500',
  working: 'bg-gray-100 text-gray-500',
  rampUp: 'bg-green-50 text-green-600',
  rampDown: 'bg-orange-50 text-orange-500',
  amrap: 'bg-[#BCEF08] text-star-dark',
};

/** 建议来源/数据依据的展示文案已收敛到 src/components/ExerciseSettingsModal.tsx
 *  （SOURCE_LABELS 内部常量 + 导出的 DATA_BASIS_LABELS / SuggestionSourceBadge），
 *  picker 模块直接复用，不再各自定义。 */

/** 单次训练建议上限（选满 9 个时出琥珀色软提示，不硬拦） */
export const SOFT_LIMIT_COUNT = 9;

/** 肌肉 Sheet 分组（参考案例 Upper/Lower 分组口径的项目版） */
export const MUSCLE_SHEET_GROUPS: Array<{ label: string; muscles: string[] }> = [
  { label: '上肢', muscles: ['胸部', '背部', '肩部', '手臂'] },
  { label: '下肢', muscles: ['腿部'] },
  { label: '核心', muscles: ['腹肌'] },
];

/** 器械 Sheet 卡片（参考案例器械 9 类口径，取值对齐 mock 数据 equipment 字段） */
export const EQUIPMENT_SHEET_ORDER: string[] = [
  '徒手',
  '杠铃',
  '哑铃',
  '杠铃片',
  '绳索',
  '器械',
  '弹力带',
  '跑步机',
  '划船机',
];

/** 「近期的训练」mock（对接后端后取真实最近训练去重列表） */
export const RECENT_IDS: string[] = ['bench-press', 'barbell-squat', 'treadmill-jog'];

/** 新手态引导卡文案（无训练历史时的热门排序降级说明） */
export const NEWBIE_GUIDE = {
  title: '初次训练，从热门开始',
  desc: '系统已按最常被训练的热门动作排序，挑 3-5 个即可组成一次训练。',
} as const;

// ---------------------------------------------------------------------------
// Mock 数据（rank 即智能排序结果，前 3 位获得「常用」徽标）
// ---------------------------------------------------------------------------

/** 库1 图片外链前缀（与 backend normalizeSources 的 LIB1_IMAGE_BASE 同源；文件不落仓） */
const IMAGE_BASE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/';

/** 引用动作库真实素材（free-exercise-db）；条目对齐库内真实动作，nameEn 即库内原名 */
const img = (path: string) => ({ thumb: `${IMAGE_BASE}${path}` });

const plan = (role: PickerSetRole, weight: number, reps: number, durationSec?: number): PickerSetPlan => ({
  role,
  weight,
  reps,
  ...(durationSec !== undefined ? { durationSec } : {}),
});

export const MOCK_EXERCISES: PickerExercise[] = [
  // ---- 力量 · 上肢 ----
  {
    id: 'bench-press', name: '杠铃卧推', nameEn: 'Barbell Bench Press - Medium Grip',
    exerciseType: 'resistance', region: 'upper', muscle: '胸部', muscles: ['胸部', '手臂'],
    equipment: '杠铃', pinyin: 'ganglingwotui', pinyinInitials: 'glwt',
    rank: 1, hotRank: 2, isRecommended: false, visual: 'dumbbell',
    imageRefs: img('Barbell_Bench_Press_-_Medium_Grip/0.jpg'),
    suggestion: {
      source: 'hybrid', dataBasis: 'history', targetRpe: 7,
      sets: [plan('warmup', 60, 8), plan('working', 60, 8), plan('working', 60, 10), plan('amrap', 60, 10)],
    },
  },
  {
    id: 'pull-up', name: '反手引体向上', nameEn: 'Chin-Up',
    exerciseType: 'bodyweight', region: 'upper', muscle: '背部', muscles: ['背部', '手臂'],
    equipment: '徒手', pinyin: 'fanshouyintixiangshang', pinyinInitials: 'fsytxs',
    rank: 2, hotRank: 4, isRecommended: false, visual: 'bodyweight',
    imageRefs: img('Chin-Up/0.jpg'),
    suggestion: {
      source: 'formula', dataBasis: 'bodyweight_estimate', targetRpe: 8,
      sets: [plan('working', 0, 6), plan('working', 0, 6), plan('rampDown', 0, 4)],
    },
  },
  {
    id: 'shoulder-press', name: '哑铃肩推', nameEn: 'Dumbbell Shoulder Press',
    exerciseType: 'resistance', region: 'upper', muscle: '肩部', muscles: ['肩部', '手臂'],
    equipment: '哑铃', pinyin: 'yalingjiantui', pinyinInitials: 'yljt',
    rank: 4, hotRank: 8, isRecommended: false, visual: 'dumbbell',
    imageRefs: img('Dumbbell_Shoulder_Press/0.jpg'),
    suggestion: {
      source: 'formula', dataBasis: 'history', targetRpe: 7,
      sets: [plan('warmup', 8, 12), plan('working', 15, 10), plan('working', 15, 10), plan('working', 15, 8)],
    },
  },
  {
    id: 'barbell-row', name: '杠铃划船', nameEn: 'Bent Over Barbell Row',
    exerciseType: 'resistance', region: 'upper', muscle: '背部', muscles: ['背部'],
    equipment: '杠铃', pinyin: 'ganglinghuachuan', pinyinInitials: 'glhc',
    rank: 5, hotRank: 11, isRecommended: false, visual: 'dumbbell',
    imageRefs: img('Bent_Over_Barbell_Row/0.jpg'),
    suggestion: {
      source: 'formula', dataBasis: 'history', targetRpe: 7,
      sets: [plan('warmup', 30, 10), plan('working', 60, 8), plan('working', 60, 8), plan('working', 60, 8)],
    },
  },
  {
    id: 'incline-db-press', name: '上斜哑铃卧推', nameEn: 'Incline Dumbbell Press',
    exerciseType: 'resistance', region: 'upper', muscle: '胸部', muscles: ['胸部', '肩部'],
    equipment: '哑铃', pinyin: 'shangxieyalingwotui', pinyinInitials: 'sxylwt',
    rank: 6, hotRank: 13, isRecommended: false, visual: 'dumbbell',
    imageRefs: img('Incline_Dumbbell_Press/0.jpg'),
    suggestion: {
      source: 'formula', dataBasis: 'history', targetRpe: 7,
      sets: [plan('working', 18, 10), plan('working', 18, 10), plan('working', 18, 8)],
    },
  },
  {
    id: 'seated-row', name: '坐姿划船', nameEn: 'Seated Cable Rows',
    exerciseType: 'resistance', region: 'upper', muscle: '背部', muscles: ['背部', '手臂'],
    equipment: '绳索', pinyin: 'zuozihuachuan', pinyinInitials: 'zzhc',
    rank: 9, hotRank: 12, isRecommended: true, visual: 'dumbbell',
    imageRefs: img('Seated_Cable_Rows/0.jpg'),
    suggestion: {
      source: 'cache', dataBasis: 'history', targetRpe: 7,
      sets: [plan('working', 50, 10), plan('working', 50, 10), plan('working', 50, 10)],
    },
  },
  {
    id: 'lateral-raise', name: '侧平举', nameEn: 'Side Lateral Raise',
    exerciseType: 'resistance', region: 'upper', muscle: '肩部', muscles: ['肩部'],
    equipment: '哑铃', pinyin: 'cepingju', pinyinInitials: 'cpj',
    rank: 12, hotRank: 15, isRecommended: true, visual: 'dumbbell',
    imageRefs: img('Side_Lateral_Raise/0.jpg'),
    suggestion: {
      source: 'formula', dataBasis: 'type_default', targetRpe: 8,
      sets: [plan('working', 8, 12), plan('working', 8, 12), plan('working', 8, 12)],
    },
  },
  {
    id: 'barbell-curl', name: '杠铃弯举', nameEn: 'Barbell Curl',
    exerciseType: 'resistance', region: 'upper', muscle: '手臂', muscles: ['手臂'],
    equipment: '杠铃', pinyin: 'ganglingwanju', pinyinInitials: 'glwj',
    rank: 15, hotRank: 16, isRecommended: false, visual: 'dumbbell',
    imageRefs: img('Barbell_Curl/0.jpg'),
    suggestion: {
      source: 'formula', dataBasis: 'history', targetRpe: 8,
      sets: [plan('working', 25, 10), plan('working', 25, 10), plan('working', 25, 8)],
    },
  },
  {
    id: 'cable-pushdown', name: '绳索下压', nameEn: 'Triceps Pushdown',
    exerciseType: 'resistance', region: 'upper', muscle: '手臂', muscles: ['手臂'],
    equipment: '绳索', pinyin: 'shengsuoxiaya', pinyinInitials: 'hsxy',
    rank: 18, hotRank: 18, isRecommended: false, visual: 'dumbbell',
    imageRefs: img('Triceps_Pushdown/0.jpg'),
    suggestion: {
      source: 'formula', dataBasis: 'type_default', targetRpe: 8,
      sets: [plan('working', 30, 12), plan('working', 30, 12), plan('working', 30, 10)],
    },
  },
  {
    id: 'weighted-pushup', name: '负重引体向上', nameEn: 'Weighted Pull Ups',
    exerciseType: 'weight_only', region: 'upper', muscle: '背部', muscles: ['背部', '手臂'],
    equipment: '杠铃片', pinyin: 'fuzhongyintixiangshang', pinyinInitials: 'fzytxs',
    rank: 25, hotRank: 27, isRecommended: false, visual: 'bodyweight',
    imageRefs: img('Weighted_Pull_Ups/0.jpg'),
    suggestion: {
      source: 'formula', dataBasis: 'bodyweight_estimate', targetRpe: 7,
      sets: [plan('working', 20, 10), plan('working', 20, 10), plan('working', 20, 8)],
    },
  },
  {
    id: 'assisted-pull-up', name: '弹力带辅助引体向上', nameEn: 'Band Assisted Pull-Up',
    exerciseType: 'assisted', region: 'upper', muscle: '背部', muscles: ['背部', '手臂'],
    equipment: '弹力带', pinyin: 'tanlidaifuzhuyintixiangshang', pinyinInitials: 'tldfzytxs',
    rank: 31, hotRank: 34, isRecommended: false, visual: 'bodyweight',
    imageRefs: img('Band_Assisted_Pull-Up/0.jpg'),
    suggestion: {
      source: 'heuristic', dataBasis: 'bodyweight_estimate', targetRpe: 7,
      sets: [plan('working', 20, 8), plan('working', 20, 8), plan('working', 20, 8)],
    },
  },

  // ---- 力量 · 下肢 ----
  {
    id: 'barbell-squat', name: '杠铃深蹲', nameEn: 'Barbell Squat',
    exerciseType: 'resistance', region: 'lower', muscle: '腿部', muscles: ['腿部', '腹肌'],
    equipment: '杠铃', pinyin: 'ganglingshendun', pinyinInitials: 'glsd',
    rank: 3, hotRank: 1, isRecommended: false, visual: 'dumbbell',
    imageRefs: img('Barbell_Squat/0.jpg'),
    suggestion: {
      source: 'hybrid', dataBasis: 'anchor', targetRpe: 8,
      sets: [plan('warmup', 40, 10), plan('rampUp', 80, 6), plan('working', 100, 5), plan('working', 100, 5)],
    },
  },
  {
    id: 'romanian-deadlift', name: '罗马尼亚硬拉', nameEn: 'Romanian Deadlift',
    exerciseType: 'resistance', region: 'lower', muscle: '腿部', muscles: ['腿部', '背部'],
    equipment: '杠铃', pinyin: 'luomaniyayingla', pinyinInitials: 'rmnyhl',
    rank: 7, hotRank: 14, isRecommended: true, visual: 'dumbbell',
    imageRefs: img('Romanian_Deadlift/0.jpg'),
    suggestion: {
      source: 'formula', dataBasis: 'history', targetRpe: 7,
      sets: [plan('warmup', 40, 10), plan('working', 70, 8), plan('working', 70, 8), plan('rampUp', 80, 6)],
    },
  },
  {
    id: 'leg-press', name: '腿举', nameEn: 'Leg Press',
    exerciseType: 'resistance', region: 'lower', muscle: '腿部', muscles: ['腿部'],
    equipment: '器械', pinyin: 'tuiju', pinyinInitials: 'tj',
    rank: 8, hotRank: 7, isRecommended: false, visual: 'dumbbell',
    imageRefs: img('Leg_Press/0.jpg'),
    suggestion: {
      source: 'cache', dataBasis: 'history', targetRpe: 7,
      sets: [plan('working', 120, 10), plan('working', 120, 10), plan('working', 120, 10), plan('working', 120, 10)],
    },
  },
  {
    id: 'bulgarian-split-squat', name: '哑铃分腿蹲', nameEn: 'Split Squat with Dumbbells',
    exerciseType: 'unilateral', region: 'lower', muscle: '腿部', muscles: ['腿部'],
    equipment: '哑铃', pinyin: 'yalingfentuidun', pinyinInitials: 'ylftd',
    rank: 34, hotRank: 35, isRecommended: false, visual: 'dumbbell',
    imageRefs: img('Split_Squat_with_Dumbbells/0.jpg'),
    suggestion: {
      source: 'formula', dataBasis: 'history', targetRpe: 8,
      sets: [plan('working', 16, 10), plan('working', 16, 10), plan('working', 16, 10)],
    },
  },
  {
    id: 'glute-bridge', name: '单腿臀桥', nameEn: 'Single Leg Glute Bridge',
    exerciseType: 'bodyweight', region: 'lower', muscle: '腿部', muscles: ['腿部'],
    equipment: '徒手', pinyin: 'dantuitunqiao', pinyinInitials: 'dttq',
    rank: 16, hotRank: 19, isRecommended: true, visual: 'bodyweight',
    imageRefs: img('Single_Leg_Glute_Bridge/0.jpg'),
    suggestion: {
      source: 'heuristic', dataBasis: 'bodyweight_estimate', targetRpe: 6,
      sets: [plan('working', 0, 15), plan('working', 0, 15), plan('working', 0, 12)],
    },
  },
  {
    id: 'leg-curl', name: '俯卧腿弯举', nameEn: 'Lying Leg Curls',
    exerciseType: 'resistance', region: 'lower', muscle: '腿部', muscles: ['腿部'],
    equipment: '器械', pinyin: 'fuwotuiwanju', pinyinInitials: 'fwtj',
    rank: 20, hotRank: 22, isRecommended: false, visual: 'dumbbell',
    imageRefs: img('Lying_Leg_Curls/0.jpg'),
    suggestion: {
      source: 'formula', dataBasis: 'type_default', targetRpe: 8,
      sets: [plan('working', 35, 12), plan('working', 35, 12), plan('working', 35, 10)],
    },
  },
  {
    id: 'leg-extension', name: '腿屈伸', nameEn: 'Leg Extensions',
    exerciseType: 'resistance', region: 'lower', muscle: '腿部', muscles: ['腿部'],
    equipment: '器械', pinyin: 'tuqushen', pinyinInitials: 'tqs',
    rank: 21, hotRank: 23, isRecommended: false, visual: 'dumbbell',
    imageRefs: img('Leg_Extensions/0.jpg'),
    suggestion: {
      source: 'formula', dataBasis: 'type_default', targetRpe: 8,
      sets: [plan('working', 40, 12), plan('working', 40, 12), plan('working', 40, 10)],
    },
  },
  {
    id: 'standing-calf-raise', name: '站姿提踵', nameEn: 'Standing Calf Raises',
    exerciseType: 'resistance', region: 'lower', muscle: '腿部', muscles: ['腿部'],
    equipment: '器械', pinyin: 'zhanzitizhong', pinyinInitials: 'zztz',
    rank: 24, hotRank: 26, isRecommended: false, visual: 'dumbbell',
    imageRefs: img('Standing_Calf_Raises/0.jpg'),
    suggestion: {
      source: 'formula', dataBasis: 'type_default', targetRpe: 8,
      sets: [plan('working', 50, 15), plan('working', 50, 15), plan('working', 50, 12)],
    },
  },

  // ---- 力量 · 核心 ----
  {
    id: 'plank', name: '平板支撑', nameEn: 'Plank',
    exerciseType: 'isometric', region: 'core', muscle: '腹肌', muscles: ['腹肌'],
    equipment: '徒手', pinyin: 'pingbanzhicheng', pinyinInitials: 'pbzc',
    rank: 10, hotRank: 5, isRecommended: false, visual: 'bodyweight',
    imageRefs: img('Plank/0.jpg'),
    suggestion: {
      source: 'formula', dataBasis: 'bodyweight_estimate', targetRpe: 6,
      sets: [plan('working', 0, 0, 45), plan('working', 0, 0, 45), plan('working', 0, 0, 45)],
    },
  },
  {
    id: 'crunch', name: '绳索卷腹', nameEn: 'Cable Crunch',
    exerciseType: 'bodyweight', region: 'core', muscle: '腹肌', muscles: ['腹肌'],
    equipment: '绳索', pinyin: 'shengsuojuanfu', pinyinInitials: 'ssjf',
    rank: 14, hotRank: 10, isRecommended: false, visual: 'bodyweight',
    imageRefs: img('Cable_Crunch/0.jpg'),
    suggestion: {
      source: 'heuristic', dataBasis: 'bodyweight_estimate', targetRpe: 6,
      sets: [plan('working', 0, 15), plan('working', 0, 15), plan('working', 0, 12)],
    },
  },
  {
    id: 'russian-twist', name: '俄罗斯转体', nameEn: 'Russian Twist',
    exerciseType: 'reps_only', region: 'core', muscle: '腹肌', muscles: ['腹肌'],
    equipment: '徒手', pinyin: 'eluosizhuanti', pinyinInitials: 'elszt',
    rank: 23, hotRank: 24, isRecommended: false, visual: 'bodyweight',
    imageRefs: img('Russian_Twist/0.jpg'),
    suggestion: {
      source: 'heuristic', dataBasis: 'bodyweight_estimate', targetRpe: 7,
      sets: [plan('working', 0, 20), plan('working', 0, 20)],
    },
  },
  {
    id: 'hanging-leg-raise', name: '悬垂举腿', nameEn: 'Hanging Leg Raise',
    exerciseType: 'bodyweight', region: 'core', muscle: '腹肌', muscles: ['腹肌', '腿部'],
    equipment: '徒手', pinyin: 'xuanchuijutui', pinyinInitials: 'xcjt',
    rank: 19, hotRank: 21, isRecommended: true, visual: 'bodyweight',
    imageRefs: img('Hanging_Leg_Raise/0.jpg'),
    suggestion: {
      source: 'formula', dataBasis: 'bodyweight_estimate', targetRpe: 8,
      sets: [plan('working', 0, 10), plan('working', 0, 10), plan('rampDown', 0, 8)],
    },
  },
  {
    id: 'dead-bug', name: '死虫式', nameEn: 'Dead Bug',
    exerciseType: 'bodyweight', region: 'core', muscle: '腹肌', muscles: ['腹肌'],
    equipment: '徒手', pinyin: 'sichongshi', pinyinInitials: 'scs',
    rank: 26, hotRank: 28, isRecommended: false, visual: 'bodyweight',
    imageRefs: img('Dead_Bug/0.jpg'),
    suggestion: {
      source: 'heuristic', dataBasis: 'bodyweight_estimate', targetRpe: 5,
      sets: [plan('working', 0, 10), plan('working', 0, 10)],
    },
  },

  // ---- 拉伸（ExerciseType 归入自重，按时长计） ----
  {
    id: 'cat-cow', name: '猫式伸展', nameEn: 'Cat Stretch',
    exerciseType: 'bodyweight', region: 'upper', muscle: '背部', muscles: ['背部'],
    equipment: '徒手', pinyin: 'maoshizhanshen', pinyinInitials: 'mszs',
    rank: 27, hotRank: 27, isRecommended: false, visual: 'stretch',
    imageRefs: img('Cat_Stretch/0.jpg'),
    suggestion: {
      source: 'heuristic', dataBasis: 'type_default', targetRpe: 4,
      sets: [plan('working', 0, 0, 30), plan('working', 0, 0, 30)],
    },
  },
  {
    id: 'standing-forward-fold', name: '腘绳肌拉伸', nameEn: 'Hamstring Stretch',
    exerciseType: 'bodyweight', region: 'lower', muscle: '腿部', muscles: ['腿部'],
    equipment: '徒手', pinyin: 'guoshengjilashen', pinyinInitials: 'gsjls',
    rank: 28, hotRank: 29, isRecommended: false, visual: 'stretch',
    imageRefs: img('Hamstring_Stretch/0.jpg'),
    suggestion: {
      source: 'heuristic', dataBasis: 'type_default', targetRpe: 4,
      sets: [plan('working', 0, 0, 30), plan('working', 0, 0, 30)],
    },
  },
  {
    id: 'pigeon-pose', name: '跪姿股四头肌拉伸', nameEn: 'All Fours Quad Stretch',
    exerciseType: 'bodyweight', region: 'lower', muscle: '腿部', muscles: ['腿部'],
    equipment: '徒手', pinyin: 'guizisitoujilashen', pinyinInitials: 'gzstjls',
    rank: 29, hotRank: 31, isRecommended: false, visual: 'stretch',
    imageRefs: img('All_Fours_Quad_Stretch/0.jpg'),
    suggestion: {
      source: 'heuristic', dataBasis: 'type_default', targetRpe: 4,
      sets: [plan('working', 0, 0, 45), plan('working', 0, 0, 45)],
    },
  },
  {
    id: 'doorway-chest-stretch', name: '头后胸部拉伸', nameEn: 'Behind Head Chest Stretch',
    exerciseType: 'bodyweight', region: 'upper', muscle: '胸部', muscles: ['胸部'],
    equipment: '徒手', pinyin: 'touhouxiongbulashen', pinyinInitials: 'thxbls',
    rank: 30, hotRank: 30, isRecommended: false, visual: 'stretch',
    imageRefs: img('Behind_Head_Chest_Stretch/0.jpg'),
    suggestion: {
      source: 'heuristic', dataBasis: 'type_default', targetRpe: 4,
      sets: [plan('working', 0, 0, 30), plan('working', 0, 0, 30)],
    },
  },
  {
    id: 'cross-body-shoulder-stretch', name: '肩部拉伸', nameEn: 'Shoulder Stretch',
    exerciseType: 'bodyweight', region: 'upper', muscle: '肩部', muscles: ['肩部'],
    equipment: '徒手', pinyin: 'jianbulashen', pinyinInitials: 'jbls',
    rank: 32, hotRank: 32, isRecommended: false, visual: 'stretch',
    imageRefs: img('Shoulder_Stretch/0.jpg'),
    suggestion: {
      source: 'heuristic', dataBasis: 'type_default', targetRpe: 4,
      sets: [plan('working', 0, 0, 30), plan('working', 0, 0, 30)],
    },
  },
  {
    id: 'childs-pose', name: '婴儿式', nameEn: "Child's Pose",
    exerciseType: 'bodyweight', region: 'upper', muscle: '背部', muscles: ['背部'],
    equipment: '徒手', pinyin: 'yingershi', pinyinInitials: 'yes',
    rank: 33, hotRank: 33, isRecommended: false, visual: 'stretch',
    imageRefs: img('Childs_Pose/0.jpg'),
    suggestion: {
      source: 'heuristic', dataBasis: 'type_default', targetRpe: 3,
      sets: [plan('working', 0, 0, 45), plan('working', 0, 0, 45)],
    },
  },

  // ---- 有氧 / 户外 ----
  {
    id: 'rowing-machine', name: '划船机', nameEn: 'Rowing Machine',
    exerciseType: 'cardio', region: 'upper', muscle: '背部', muscles: ['背部', '腿部'],
    equipment: '划船机', pinyin: 'huachuanji', pinyinInitials: 'hcj',
    rank: 11, hotRank: 9, isRecommended: true, visual: 'pulse',
    suggestion: {
      source: 'formula', dataBasis: 'type_default', targetRpe: 6,
      sets: [plan('working', 0, 0, 600)],
    },
  },
  {
    id: 'treadmill-jog', name: '跑步机慢跑', nameEn: 'Treadmill Jog',
    exerciseType: 'cardio', region: 'lower', muscle: '腿部', muscles: ['腿部'],
    equipment: '跑步机', pinyin: 'paobujimanpao', pinyinInitials: 'pbjmp',
    rank: 13, hotRank: 3, isRecommended: false, visual: 'pulse',
    suggestion: {
      source: 'hybrid', dataBasis: 'history', targetRpe: 5,
      sets: [plan('working', 0, 0, 1200)],
    },
  },
  {
    id: 'jump-rope', name: '跳绳', nameEn: 'Jump Rope',
    exerciseType: 'cardio', region: 'lower', muscle: '腿部', muscles: ['腿部', '腹肌'],
    equipment: '徒手', pinyin: 'tiaosheng', pinyinInitials: 'ts',
    rank: 17, hotRank: 6, isRecommended: false, visual: 'pulse',
    suggestion: {
      source: 'heuristic', dataBasis: 'type_default', targetRpe: 7,
      sets: [plan('working', 0, 0, 180), plan('working', 0, 0, 180), plan('working', 0, 0, 180)],
    },
  },
  {
    id: 'mountain-climbers', name: '登山者', nameEn: 'Mountain Climbers',
    exerciseType: 'cardio', region: 'core', muscle: '腹肌', muscles: ['腹肌'],
    equipment: '徒手', pinyin: 'dengshanzhe', pinyinInitials: 'dsz',
    rank: 22, hotRank: 25, isRecommended: false, visual: 'pulse',
    imageRefs: img('Mountain_Climbers/0.jpg'),
    suggestion: {
      source: 'heuristic', dataBasis: 'bodyweight_estimate', targetRpe: 8,
      sets: [plan('working', 0, 0, 45), plan('working', 0, 0, 45), plan('working', 0, 0, 45)],
    },
  },
  {
    id: 'outdoor-jog', name: '户外慢跑', nameEn: 'Outdoor Jog',
    exerciseType: 'outdoor', region: 'lower', muscle: '腿部', muscles: ['腿部'],
    equipment: '徒手', pinyin: 'huwaimanpao', pinyinInitials: 'hwmp',
    rank: 35, hotRank: 36, isRecommended: false, visual: 'pulse',
    suggestion: {
      source: 'heuristic', dataBasis: 'type_default', targetRpe: 5,
      sets: [plan('working', 0, 0, 1500)],
    },
  },
];
