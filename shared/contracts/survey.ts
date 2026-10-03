/**
 * Survey Contracts — 问卷契约单一真源（issue #114 契约批 B5a）
 *
 * 迁移自 backend/src/services/agent/schemas/uiHintSchemas.ts（SURVEY_CARD 段），
 * 并按 docs/specs/survey-redesign-v2.md §2.5 做「全部 optional」的增量扩展：
 * children 二级菜单 / inputType 扩枚举（select、textarea）/ section / hint /
 * unit / min / max / maxLength / condition / childKey / purpose。
 * 七卡型枚举（UIHintTypeEnum）不动，旧卡 / 旧持久化 uiHint 原样通过校验
 * （新字段全 optional，Zod 对旧卡未知键本就 strip）。
 *
 * 本文件同时承载共享题库 PROFILE_INTAKE_QUESTIONS（spec §2.2/§2.3）：
 * 前端首用问卷、Agent 缺口补全卡、写库映射三方同源；题 id = 答案键 =
 * 写库目标（value 即契约枚举值，零文本换算）。器材二级菜单子选项 value
 * 直接取 EXERCISE_EQUIPMENT 枚举值（exercise-library.ts 单一真源），
 * 与 find_exercises 的 equipment 过滤轴零转换。
 *
 * @version 1.0.0
 * @created 2026-10-03
 */

import { z } from 'zod';
import type { ExerciseEquipment } from './exercise-library.js';

// ============================================================================
// Survey Question Option（选项级）
// ============================================================================

/**
 * 问卷选项。`children` 为二级菜单子选项（#114 缺口 5：此前契约不可表达，
 * Zod 默认 strip 未知键，Agent 即使输出了也到不了前端）。
 * 渲染语义（spec §2.5）：单选题选中带 children 的父选项后展开多选 chips，
 * 父值写 answers[id]、children 勾选结果（string[]）写 answers[childKey]。
 * 递归结构需显式接口类型（否则 TS 循环推断报错）。
 */
export interface SurveyQuestionOption {
  label: string;
  value: string;
  /** 二级选项（如器材：场地 → 具体器材多选） */
  children?: SurveyQuestionOption[];
}

export const SurveyQuestionOptionSchema: z.ZodType<SurveyQuestionOption> =
  z.object({
    label: z.string().min(1, "Option label cannot be empty"),
    value: z.string().min(1, "Option value cannot be empty"),
    children: z.lazy(() => z.array(SurveyQuestionOptionSchema)).optional(),
  });

// ============================================================================
// Survey Question（题目级）
// ============================================================================

/**
 * 问卷题目。
 *
 * IMPORTANT: questions must be an array of objects, NOT strings!
 * This is a common error where LLM returns strings instead of objects.
 *
 * inputType 枚举 = text / number / checkbox / select / textarea：
 * - checkbox  = 多选题（提交值 string[]），2026-09-17 先例
 * - select    = 单选题（#114 扩：与前端渲染组件本地枚举对齐，消除漂移）
 * - textarea  = 自由文本补充框（#114 缺口 6：此前校验回路打回）
 */
export const SurveyQuestionSchema = z.object({
  id: z.string().min(1, "Question ID cannot be empty"),
  question: z.string().min(1, "Question text cannot be empty"),
  /** 必填项标记（必答星号 + 提交闸门联动） */
  required: z.boolean().default(false),
  placeholder: z.string().optional(),
  options: z.array(SurveyQuestionOptionSchema).optional(),
  inputType: z
    .enum(["text", "number", "checkbox", "select", "textarea"])
    .optional(),
  /** 分组标题（如「必答」/「补充信息（可选）」） */
  section: z.string().optional(),
  /** 题干辅助说明（如体重用途） */
  hint: z.string().optional(),
  /** number 单位后缀（"kg"/"cm"） */
  unit: z.string().optional(),
  /** number 范围下界（如 weight_kg 30） */
  min: z.number().optional(),
  /** number 范围上界（如 weight_kg 250） */
  max: z.number().optional(),
  /** textarea 最大字符数（如 notes 500，驱动计数器「n/500」） */
  maxLength: z.number().int().positive().optional(),
  /**
   * 条件显示：被引用题（questionId）的当前选中值 ∈ equals 时本题才渲染，
   * 并参与 required 校验；不满足则不渲染且不参与（spec §2.5 condition 语义）。
   */
  condition: z
    .object({
      questionId: z.string(),
      equals: z.union([z.string(), z.array(z.string())]),
    })
    .optional(),
  /**
   * children 勾选结果写入 answers 的键（如 equipment_venue 的
   * childKey = 'equipment_items'）。设了 childKey 且选中父选项带 children
   * → children 至少勾 1 项才允许提交（required 联动）。
   */
  childKey: z.string().optional(),
});

export type SurveyQuestion = z.infer<typeof SurveyQuestionSchema>;

// ============================================================================
// Survey Card Data（卡级）
// ============================================================================

/**
 * 问卷卡用途枚举（spec §2.4）：区分首用画像调研 / 练后反馈 / 缺口补全，
 * 不新增卡型（UIHintTypeEnum 七卡型不动）。
 */
export const PURPOSE_ENUM = [
  'profile_intake',
  'workout_feedback',
  'plan_gap',
] as const;

export type SurveyPurpose = (typeof PURPOSE_ENUM)[number];

/**
 * Survey Card Data Schema（survey_card 卡的 data 面）。
 * `purpose` 全 optional 增量：旧卡（无 purpose）照常解析。
 */
export const SurveyCardDataSchema = z.object({
  sessionId: z.string().optional(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  message: z.string().optional(),
  purpose: z.enum(PURPOSE_ENUM).optional(),
  questions: z
    .array(SurveyQuestionSchema)
    .min(1, "At least one question is required"),
});

export type SurveyCardData = z.infer<typeof SurveyCardDataSchema>;

// ============================================================================
// 共享题库 PROFILE_INTAKE_QUESTIONS（spec §2.2/§2.3 定稿）
// ============================================================================

/** 器材二级菜单：健身房 12 值（spec §2.3 树，value ∈ EXERCISE_EQUIPMENT） */
const GYM_EQUIPMENT_CHILDREN = [
  { label: '杠铃', value: 'barbell' },
  { label: '深蹲架', value: 'rack' },
  { label: '训练凳', value: 'bench' },
  { label: '哑铃', value: 'dumbbell' },
  { label: '固定器械', value: 'machine' },
  { label: '绳索', value: 'cable' },
  { label: '壶铃', value: 'kettlebell' },
  { label: '单杠', value: 'pull_up_bar' },
  { label: '弹力带', value: 'band' },
  { label: '瑞士球', value: 'stability_ball' },
  { label: '药球', value: 'medicine_ball' },
  { label: '泡沫轴', value: 'foam_roller' },
] as const satisfies ReadonlyArray<{
  label: string;
  value: ExerciseEquipment;
}>;

/** 器材二级菜单：家里 8 值 */
const HOME_EQUIPMENT_CHILDREN = [
  { label: '哑铃', value: 'dumbbell' },
  { label: '壶铃', value: 'kettlebell' },
  { label: '弹力带', value: 'band' },
  { label: '训练凳', value: 'bench' },
  { label: '单杠', value: 'pull_up_bar' },
  { label: '瑞士球', value: 'stability_ball' },
  { label: '药球', value: 'medicine_ball' },
  { label: '泡沫轴', value: 'foam_roller' },
] as const satisfies ReadonlyArray<{
  label: string;
  value: ExerciseEquipment;
}>;

/** 器材二级菜单：户外 3 值 */
const OUTDOOR_EQUIPMENT_CHILDREN = [
  { label: '单杠', value: 'pull_up_bar' },
  { label: '弹力带', value: 'band' },
  { label: '负重背心', value: 'weighted' },
] as const satisfies ReadonlyArray<{
  label: string;
  value: ExerciseEquipment;
}>;

/**
 * profile_intake v2 题库（spec §2.2 全量题目定义）。
 *
 * - Section A 必答 7 题（goal/experience/weight_kg/equipment_venue+children/
 *   weekly_frequency/injuries）与 novice-starting.md §3.2.0 门禁六项对齐；
 * - Section B 条件必答（age，减脂/体能目标时，HRmax≈208−0.7×age 同口径）；
 * - Section C 选答（height_cm/gender/session_minutes）；
 * - Section D 自由补充（notes，textarea）。
 *
 * `bodyweight` 永远隐式可用（EXERCISE_EQUIPMENT 显式值），不设题——
 * 写库时由确定性代码固定追加进 preferences.equipment（spec §2.3）。
 * 题库 value 即机器值：goal/experience/session_minutes 等提交即写库，
 * 无中文模糊映射（#114 缺口 3d 根治）。
 */
export const PROFILE_INTAKE_QUESTIONS: readonly SurveyQuestion[] = [
  // --- Section A 必答 ---
  {
    id: 'goal',
    section: '必答',
    question: '当前最想达成的目标',
    required: true,
    inputType: 'select',
    options: [
      { label: '增肌变壮', value: 'muscle_gain' },
      { label: '减脂塑形', value: 'fat_loss' },
      { label: '提升力量', value: 'strength' },
      { label: '保持健康与体能', value: 'general_fitness' },
      { label: '体态改善', value: 'body_recomp' },
    ],
  },
  {
    id: 'experience',
    section: '必答',
    question: '训练经验',
    required: true,
    inputType: 'select',
    options: [
      { label: '纯新手，没系统练过', value: 'beginner_zero' },
      { label: '3 个月以内', value: 'beginner' },
      { label: '半年到两年', value: 'intermediate' },
      { label: '两年以上', value: 'advanced' },
    ],
  },
  {
    id: 'weight_kg',
    section: '必答',
    question: '体重（kg）',
    required: true,
    inputType: 'number',
    unit: 'kg',
    min: 30,
    max: 250,
    hint: '用于推算你的起步重量，只存在你的档案里',
  },
  {
    id: 'equipment_venue',
    section: '必答',
    question: '主要训练场地',
    required: true,
    inputType: 'select',
    childKey: 'equipment_items',
    options: [
      { label: '健身房', value: 'gym', children: [...GYM_EQUIPMENT_CHILDREN] },
      { label: '家里', value: 'home', children: [...HOME_EQUIPMENT_CHILDREN] },
      {
        label: '户外',
        value: 'outdoor',
        children: [...OUTDOOR_EQUIPMENT_CHILDREN],
      },
    ],
  },
  {
    id: 'weekly_frequency',
    section: '必答',
    question: '每周能练几次',
    required: true,
    inputType: 'select',
    options: [
      { label: '1 次', value: '1' },
      { label: '2 次', value: '2' },
      { label: '3 次', value: '3' },
      { label: '4 次', value: '4' },
      { label: '5 次', value: '5' },
      { label: '6 次', value: '6' },
    ],
  },
  {
    id: 'injuries',
    section: '必答',
    question: '有无伤病/疼痛部位',
    required: true,
    inputType: 'checkbox',
    options: [
      { label: '无', value: 'none' },
      { label: '膝', value: 'knee' },
      { label: '腰', value: 'lower_back' },
      { label: '肩', value: 'shoulder' },
      { label: '腕', value: 'wrist' },
      { label: '颈', value: 'neck' },
      { label: '其他', value: 'other' },
    ],
  },
  // --- Section B 条件必答（goal ∈ {fat_loss, general_fitness} 时渲染并必答） ---
  {
    id: 'age',
    section: '必答',
    question: '年龄',
    required: true,
    inputType: 'number',
    min: 14,
    max: 90,
    condition: { questionId: 'goal', equals: ['fat_loss', 'general_fitness'] },
  },
  // --- Section C 选答 ---
  {
    id: 'height_cm',
    section: '补充信息（可选）',
    question: '身高（cm）',
    required: false,
    inputType: 'number',
    unit: 'cm',
    min: 120,
    max: 230,
  },
  {
    id: 'gender',
    section: '补充信息（可选）',
    question: '性别',
    required: false,
    inputType: 'select',
    options: [
      { label: '男', value: 'male' },
      { label: '女', value: 'female' },
      { label: '其他', value: 'other' },
    ],
  },
  {
    id: 'session_minutes',
    section: '补充信息（可选）',
    question: '单次可训时长',
    required: false,
    inputType: 'select',
    options: [
      { label: '30 分钟', value: '30' },
      { label: '45 分钟', value: '45' },
      { label: '60 分钟', value: '60' },
      { label: '90 分钟以上', value: '90' },
    ],
  },
  // --- Section D 自由补充（必带） ---
  {
    id: 'notes',
    section: '自由补充',
    question: '还有什么想让教练知道的？',
    required: false,
    inputType: 'textarea',
    maxLength: 500,
    placeholder: '夜班倒班、产后恢复、旧伤细节、不喜欢的动作……都可以写',
  },
];

/**
 * 题库 id 枚举定稿（后续两批的公共依赖，spec §5 批 1 产出）。
 * 含 equipment_items：它不是题目数组里的独立题，而是 equipment_venue 的
 * childKey（答案键），写库映射按 answers[id] 直取时与题目 id 同轴。
 */
export const PROFILE_INTAKE_QUESTION_IDS = [
  'goal',
  'experience',
  'weight_kg',
  'equipment_venue',
  'equipment_items',
  'weekly_frequency',
  'injuries',
  'age',
  'height_cm',
  'gender',
  'session_minutes',
  'notes',
] as const;

export type ProfileIntakeQuestionId =
  (typeof PROFILE_INTAKE_QUESTION_IDS)[number];
