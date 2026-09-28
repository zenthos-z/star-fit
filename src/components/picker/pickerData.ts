/**
 * pickerData — A8+A9 动作选择器数据层（v3：全库 mock）
 *
 * 数据来源：pickerLibraryData.ts（生产库 exercises 表确定性导出，354 条），
 * 本文件负责派生：中文名/肌群中文标签/区域分组/类型归一/参数建议合成。
 * 派生全部为确定性纯函数（前端算术，无 LLM、无 API 调用）；对接后端时
 * 由动作库服务与建议服务下发对应字段，本层仅保留形状与展示映射。
 *
 * imageRefs 字段与 IMAGE_BASE 常量保留（对接批次仍消费动作库图片接口），
 * 但列表行首缩略图自 v4 起改用库3 R2 3D 解剖封面（thumbnail 字段），
 * 不再渲染真人照片。
 */

import { EQUIPMENT_LABELS_ZH } from 'shared/contracts';
import { BODY_PART_REGION, MUSCLE_REGION } from 'shared/contracts';
import type { SetType } from 'shared/contracts';
import { muscleLabelZh } from '../../lib/muscleMap';
import { PICKER_LIBRARY } from './pickerLibraryData';

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** 动作类型（legacy 9 类 + 库内 flexibility；对齐 src/types/legacy.ts 与协议枚举） */
export type PickerExerciseType =
  | 'resistance'
  | 'cardio'
  | 'bodyweight'
  | 'isometric'
  | 'assisted'
  | 'unilateral'
  | 'weight_only'
  | 'reps_only'
  | 'outdoor'
  | 'flexibility';

/** 区域分组（肌肉 Sheet 分组口径；cardio=有氧全身） */
export type PickerRegion = 'upper' | 'lower' | 'core' | 'cardio';

/**
 * 组类型标注（A31 契约扩展：真源 shared/contracts SetType，issue #31）。
 * 前端旧值 rampUp/rampDown 已随契约统一为 snake_case（ramp_up/ramp_down）；
 * 语义不变：热身/正式/递增/递减/AMRAP。
 */
export type PickerSetRole = SetType;

/** 生产库 exercises 行（pickerLibraryData.ts 同构形状） */
export interface PickerLibraryEntry {
  id: string;
  /** 库内英文原名 */
  name: string;
  /** 中文名（A6 回填，全量非空） */
  nameZh: string;
  exerciseType: string;
  bodyPart: string;
  /** 17 基准词表值（MuscleMap 数据源） */
  primaryMuscles: string[];
  secondaryMuscles: string[];
  /** 器械 slug（展示文案经 EQUIPMENT_LABELS_ZH） */
  equipment: string;
  difficulty: string;
  /** 库3 3D 解剖缩略图（R2 CDN，male 版；'' = 库内缺失） */
  thumbnail: string;
}

/** 选择器条目（由库条目派生；列表/清单/配置全流程消费的形状） */
export interface PickerExercise {
  id: string;
  /** 中文展示名（A6 口径：中文优先） */
  name: string;
  nameEn: string;
  exerciseType: PickerExerciseType;
  region: PickerRegion;
  /** 主肌群中文（列表分组键） */
  muscle: string;
  /** 主+次肌群中文（筛选用） */
  muscles: string[];
  /** 主发力肌群（17 词表原值，MuscleMap 数据源） */
  primaryMuscles: string[];
  /** 次发力肌群（17 词表原值） */
  secondaryMuscles: string[];
  /** 器械 slug（筛选键） */
  equipment: string;
  /** 器械中文（展示） */
  equipmentLabel: string;
  /** 难度（beginner/intermediate/advanced；批量创建载荷消费） */
  difficulty: string;
  /** 英文名小写（搜索兜底） */
  pinyin: string;
  /** 英文名首字母（搜索兜底；中文拼音索引待服务端下发） */
  pinyinInitials: string;
  /** 智能排序预置序（1 最高；导出顺序即 mock 排序，真源待服务端） */
  rank: number;
  /** 热门排序（新手态） */
  hotRank: number;
  /** 「为你推荐」徽标（mock 确定性布点） */
  isRecommended: boolean;
  /** 动作封面：库3 3D 解剖渲染图（R2 CDN，male 版）；缺失 '' → 列表回退类型图标 */
  thumbnail: string;
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

/** 动作类型展示名（类型 Sheet 卡片；flexibility=库内拉伸大类） */
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
  flexibility: '拉伸',
};

/** 类型卡片展示顺序（按其在库内出现与否过滤后即为 TYPE_SHEET_ORDER） */
const TYPE_DISPLAY_ORDER: PickerExerciseType[] = [
  'resistance',
  'bodyweight',
  'cardio',
  'flexibility',
  'isometric',
  'assisted',
  'unilateral',
  'weight_only',
  'reps_only',
  'outdoor',
];

export const REGION_LABELS: Record<PickerRegion, string> = {
  upper: '上肢',
  lower: '下肢',
  core: '核心',
  cardio: '有氧',
};

export const ROLE_LABELS: Record<PickerSetRole, string> = {
  warmup: '热身',
  working: '正式',
  ramp_up: '递增',
  ramp_down: '递减',
  amrap: 'AMRAP',
};

export const ROLE_ORDER: PickerSetRole[] = ['warmup', 'working', 'ramp_up', 'ramp_down', 'amrap'];

/** 组类型徽标配色（小面积点缀；AMRAP 用 star-accent 黄绿） */
export const ROLE_BADGE_CLASS: Record<PickerSetRole, string> = {
  warmup: 'bg-blue-50 text-blue-500',
  working: 'bg-gray-100 text-gray-500',
  ramp_up: 'bg-green-50 text-green-600',
  ramp_down: 'bg-orange-50 text-orange-500',
  amrap: 'bg-[#BCEF08] text-star-dark',
};

/** 单次训练建议上限（选满 9 个时出琥珀色软提示，不硬拦） */
export const SOFT_LIMIT_COUNT = 9;

// ---------------------------------------------------------------------------
// A10 入口/出口场景（issue #32）
// ---------------------------------------------------------------------------

/**
 * 进入 picker 的场景参数 → 交互模式状态机：
 * - single-replace  配置页内换动作：单选，确认=回填表单（购物车流程隐藏）
 * - batch           训练前/主页空状态挑选（计划编辑批量）：多选+清单页，确认=批量添加进会话
 * - append          训练中加动作：多选+清单页，确认=追加到当前队列队尾（保持清单顺序）
 */
export type PickerEntryMode = 'single-replace' | 'batch' | 'append';

/**
 * A10 模式 × 确认按钮文案对应表（行为与文案严格一致；空选择用通用文案并禁用）。
 * single-replace 文案带动作名（替换X），batch/append 带计数。
 */
export const PICKER_MODE_CONFIRM: Record<PickerEntryMode, { label: (count: number, name?: string) => string; emptyLabel: string }> = {
  'single-replace': { label: (_count, name) => `替换${name ?? ''}`, emptyLabel: '替换动作' },
  batch: { label: count => `添加${count}个`, emptyLabel: '添加动作' },
  append: { label: count => `追加${count}个到队尾`, emptyLabel: '追加到队尾' },
};

/** 新手态引导卡文案（无训练历史时的热门排序降级说明） */
export const NEWBIE_GUIDE = {
  title: '初次训练，从热门开始',
  desc: '系统已按最常被训练的热门动作排序，挑 3-5 个即可组成一次训练。',
} as const;

/** PickerExerciseType → ExerciseAction.type 协议枚举（weight_only/reps_only 走协议别名） */
export const PROTOCOL_TYPE: Record<PickerExerciseType, import('../../types/protocol').ExerciseAction['type']> = {
  resistance: 'resistance',
  cardio: 'cardio',
  bodyweight: 'bodyweight',
  isometric: 'isometric',
  assisted: 'assisted',
  unilateral: 'unilateral',
  weight_only: 'heavy_weight',
  reps_only: 'rep_training',
  outdoor: 'outdoor',
  flexibility: 'flexibility',
};

// ---------------------------------------------------------------------------
// 库条目 → 选择器条目派生（确定性纯函数）
// ---------------------------------------------------------------------------

const DB_TYPE_MAP: Record<string, PickerExerciseType> = {
  resistance: 'resistance',
  flexibility: 'flexibility',
  unilateral: 'unilateral',
  cardio: 'cardio',
  bodyweight: 'bodyweight',
  isometric: 'isometric',
  assisted: 'assisted',
  weight_only: 'weight_only',
  reps_only: 'reps_only',
  outdoor: 'outdoor',
};

const BODY_PART_REGION_MAP = BODY_PART_REGION as Record<string, PickerRegion>;

function initialsOfEn(name: string): string {
  return name
    .split(/[^A-Za-z]+/)
    .filter(Boolean)
    .map(w => w[0]!.toLowerCase())
    .join('');
}

/** 库3 3D 解剖封面准入：仅接受 R2 CDN 渲染图；库1 真人照片 URL（raw.githubusercontent）
 *  即便残留于 image_refs 也不准入（用户已拍板不要真人示意图） */
function sanitizeThumbnail(url: string): string {
  return url.includes('r2.dev/exercise-posters/') ? url : '';
}

/** 库条目 → 选择器条目（全量派生；顺序即导出顺序 = mock 的 rank/hotRank 真源） */
export function buildPickerExercises(library: PickerLibraryEntry[]): PickerExercise[] {
  return library.map((e, i) => {
    const type = DB_TYPE_MAP[e.exerciseType] ?? 'resistance';
    const primaryZh = e.primaryMuscles.map(muscleLabelZh);
    const musclesZh: string[] = [];
    for (const m of [...e.primaryMuscles, ...e.secondaryMuscles].map(muscleLabelZh)) {
      if (!musclesZh.includes(m)) musclesZh.push(m);
    }
    return {
      id: e.id,
      name: e.nameZh.trim() || e.name,
      nameEn: e.name,
      exerciseType: type,
      region: BODY_PART_REGION_MAP[e.bodyPart] ?? 'cardio',
      muscle: primaryZh[0] ?? '其他',
      muscles: musclesZh,
      primaryMuscles: e.primaryMuscles,
      secondaryMuscles: e.secondaryMuscles,
      equipment: e.equipment,
      equipmentLabel: (EQUIPMENT_LABELS_ZH as Record<string, string>)[e.equipment] ?? e.equipment,
      difficulty: e.difficulty,
      pinyin: e.name.toLowerCase(),
      pinyinInitials: initialsOfEn(e.name),
      rank: i + 1,
      hotRank: i + 1,
      isRecommended: i + 1 > 3 && (i + 1) % 17 === 0,
      thumbnail: sanitizeThumbnail(e.thumbnail),
    };
  });
}

// ---------------------------------------------------------------------------
// 全库派生常量（模块级一次性计算）
// ---------------------------------------------------------------------------

export const PICKER_EXERCISES: PickerExercise[] = buildPickerExercises(PICKER_LIBRARY);

/** 兼容别名（既有引用点/测试沿用 MOCK_EXERCISES 语义） */
export const MOCK_EXERCISES = PICKER_EXERCISES;

/** 类型 Sheet 卡片：库内实际出现的类型（固定展示顺序过滤） */
export const TYPE_SHEET_ORDER: PickerExerciseType[] =
  TYPE_DISPLAY_ORDER.filter(t => PICKER_EXERCISES.some(e => e.exerciseType === t));

/** 器械 Sheet 卡片：库内实际出现的器械 slug（按条目数降序） */
export const EQUIPMENT_SHEET_ORDER: string[] = [...PICKER_EXERCISES.reduce((m, e) => {
  m.set(e.equipment, (m.get(e.equipment) ?? 0) + 1);
  return m;
}, new Map<string, number>())]
  .sort((a, b) => b[1] - a[1])
  .map(([slug]) => slug);

/** 器械 slug → 中文（真源 shared/contracts EQUIPMENT_LABELS_ZH） */
export function equipmentLabelOf(slug: string): string {
  return (EQUIPMENT_LABELS_ZH as Record<string, string>)[slug] ?? slug;
}

/** 肌肉 Sheet 分组：肌群按自身区域归组，组内按主发力条目数降序
 *  （MUSCLE_REGION 真源已收口 shared/contracts——与后端近期分区判定共用一份映射） */
export const MUSCLE_SHEET_GROUPS: Array<{ label: string; muscles: string[] }> =
  (['upper', 'lower', 'core'] as PickerRegion[])
    .map(region => {
      const count = new Map<string, number>();
      const firstSeen = new Map<string, number>();
      for (const e of PICKER_EXERCISES) {
        const primaryEn = e.primaryMuscles[0];
        if (!primaryEn || MUSCLE_REGION[primaryEn] !== region) continue;
        const zh = e.muscle;
        count.set(zh, (count.get(zh) ?? 0) + 1);
        if (!firstSeen.has(zh)) firstSeen.set(zh, e.rank);
      }
      return {
        label: REGION_LABELS[region],
        muscles: [...count.entries()]
          .sort((a, b) => b[1] - a[1] || (firstSeen.get(a[0]) ?? 0) - (firstSeen.get(b[0]) ?? 0))
          .map(([zh]) => zh),
      };
    })
    .filter(g => g.muscles.length > 0);

/** 「近期的训练」mock：全库前 3 条模拟（接入后取真实最近训练去重列表） */
export const RECENT_IDS: string[] = PICKER_EXERCISES.slice(0, 3).map(e => e.id);
