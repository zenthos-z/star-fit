/**
 * 注册表装配文件 —— 现有卡片全量编译时注册（issue #88 分册3）
 *
 * 唯一的模块级装配处：ExerciseRenderer 分发链只消费注册表，本文件是
 * cardType → 组件映射的唯一真源（原 ExerciseRenderer 硬编码 PluginRegistry
 * 已删除，grep cardType 映射在渲染层零命中）。
 *
 * 上新卡片 3 步（docs/card-spec/README.md 尾节）：
 *   1. 写规范卡：复制 docs/card-spec/templates/card-spec-template.md 逐项
 *      必答（守门 `node scripts/check-card-spec.mjs` 退出码 0）
 *   2. 在真源扩键：新 cardType 先进 shared/contracts card-types.ts
 *      （CARD_TYPE_VALUES / 别名）——域外键 register 直接抛错
 *   3. 本文件 register(cardType, component, spec)——spec 与契约对拍，
 *      不一致装配即抛错（启动即红）
 *
 * 已知未注册键（分发到它们 = 显式错误卡，属可见缺口非兜底）：
 *   deviation_card / instruction_card / deviation_confirmation / unknown_card
 *   ——补上组件后在下方注册即闭环。
 */
import React from 'react';
import { register } from './cardRegistry';
import { UI_HINT_DATA_KEYS } from './cardSpec';

// ── 运动卡（plugins/）──────────────────────────────────────────────
import { ResistanceCard } from '../plugins/ResistanceCard';
import { CardioCard } from '../plugins/CardioCard';
import { RunningCard } from '../plugins/RunningCard';
import { IsometricCard } from '../plugins/IsometricCard';
// 户外卡体积大（地图链路），保持懒加载（与迁移前 ExerciseRenderer 同款）
const OutdoorExerciseCardV2 = React.lazy(() =>
  import('../plugins/OutdoorExerciseCardV2').then((m) => ({ default: m.OutdoorExerciseCardV2 })),
);

// ── AI 卡（cards/）─────────────────────────────────────────────────
import { PlanCard } from '../cards/PlanCard';
import { WeeklyPlanCard } from '../cards/WeeklyPlanCard';
import { SummaryCard } from '../cards/SummaryCard';
import { SurveyCard } from '../cards/SurveyCard';
import { SurveySuccessCard } from '../cards/SurveySuccessCard';
import { AuditCompleteCard } from '../cards/AuditCompleteCard';
import { HitlConfirmCard } from '../cards/HitlConfirmCard';
import { ProfileUpdateConfirmCard } from '../cards/ProfileUpdateConfirmCard';
import { StandardCard } from '../cards/StandardCard';

// ════════════════════════════════════════════════════════════════════
// 运动卡（active 活动卡：开始运动 → 逐组执行采集 → 完成）
// ════════════════════════════════════════════════════════════════════

register('resistance_standard', ResistanceCard, {
  interactionMode: 'active',
  requiredSetFields: ['reps', 'weight', 'timestamp'],
  fineTypes: ['resistance', 'unilateral', 'bodyweight', 'assisted', 'heavy_weight', 'rep_training'],
  docRef: 'docs/card-spec/resistance_standard.md',
});

register('cardio_running', RunningCard, {
  interactionMode: 'active',
  requiredSetFields: ['duration', 'timestamp'],
  fineTypes: ['cardio'],
  docRef: 'docs/card-spec/cardio_running.md',
});

// 户外有氧卡：标准键 + 两个存量别名键共用同一懒加载组件
// （别名真源 = CARD_TYPE_ALIASES：running_gps / outdoor_gps → cardio_outdoor）
register('cardio_outdoor', OutdoorExerciseCardV2, {
  interactionMode: 'active',
  requiredSetFields: ['distance', 'duration', 'timestamp'],
  fineTypes: ['outdoor'],
  docRef: 'docs/card-spec/fine/outdoor.md（占位页，规范卡未定义）',
});
register('running_gps', OutdoorExerciseCardV2, {
  interactionMode: 'active',
  requiredSetFields: ['distance', 'duration', 'timestamp'],
  fineTypes: [],
  docRef: 'docs/card-spec/fine/outdoor.md（running_gps = cardio_outdoor 存量别名）',
});
register('outdoor_gps', OutdoorExerciseCardV2, {
  interactionMode: 'active',
  requiredSetFields: ['distance', 'duration', 'timestamp'],
  fineTypes: [],
  docRef: 'docs/card-spec/fine/outdoor.md（outdoor_gps = cardio_outdoor 存量别名）',
});

register('isometric_static', IsometricCard, {
  interactionMode: 'active',
  requiredSetFields: ['duration', 'timestamp'],
  fineTypes: ['isometric'],
  docRef: 'docs/card-spec/fine/isometric.md（占位页）',
});

register('hiit_timer', CardioCard, {
  interactionMode: 'active',
  requiredSetFields: ['duration', 'timestamp'],
  fineTypes: [], // hiit 为编排格式，无动作库细类（card-types.ts 拍板）
});

register('stretch_standard', StandardCard, {
  interactionMode: 'active',
  requiredSetFields: ['timestamp'], // duration 可选（fine/flexibility.md）
  fineTypes: ['flexibility'],
  docRef: 'docs/card-spec/fine/flexibility.md（占位页：未定义≠不能跑，走默认模板）',
});

// ════════════════════════════════════════════════════════════════════
// AI Coach 卡（passive 记录卡：填入/确认/展示 → 落账，无执行流）
// uiHintDataKeys 引用真值表（与 uiHintValidator 一致由 guard 测试守门）
// ════════════════════════════════════════════════════════════════════

register('plan_card', PlanCard, {
  interactionMode: 'passive',
  uiHintDataKeys: UI_HINT_DATA_KEYS.plan_card,
  docRef: 'docs/card-spec/resistance_standard.md §3/§4.1（plan_card data 行字段）',
});

register('weekly_plan', WeeklyPlanCard, {
  interactionMode: 'passive',
  uiHintDataKeys: UI_HINT_DATA_KEYS.weekly_plan,
});

register('summary_card', SummaryCard, {
  interactionMode: 'passive',
  uiHintDataKeys: UI_HINT_DATA_KEYS.summary_card,
});

register('survey_card', SurveyCard, {
  interactionMode: 'passive',
  uiHintDataKeys: UI_HINT_DATA_KEYS.survey_card,
});

register('survey_success', SurveySuccessCard, {
  interactionMode: 'passive',
  // 前端专属卡（后端不产出）：组件 props 即允许键真源
  uiHintDataKeys: ['title', 'message', 'actionLabel', 'requiresConfirmation'],
});

register('audit_complete', AuditCompleteCard, {
  interactionMode: 'passive',
  uiHintDataKeys: UI_HINT_DATA_KEYS.audit_complete,
});

register('hitl_confirm', HitlConfirmCard, {
  interactionMode: 'passive',
  // 前端专属卡（HC-4 拉黑 Agent 产出，仅客户端交互）：组件容错读取，允许键
  // 取实际消费面（sub_type 判别 + data 内 reason/message/prompt 文案）
  uiHintDataKeys: ['sub_type', 'data', 'reason', 'message', 'prompt'],
});

register('profile_update_confirm', ProfileUpdateConfirmCard, {
  interactionMode: 'passive',
  uiHintDataKeys: UI_HINT_DATA_KEYS.profile_update_confirm,
});

// ════════════════════════════════════════════════════════════════════
// 哨兵卡（协议 UIHint 枚举占位键：skeleton 加载骨架 / unknown 未知占位）
// ════════════════════════════════════════════════════════════════════

register('skeleton', StandardCard, {
  interactionMode: 'passive',
});

register('unknown', StandardCard, {
  interactionMode: 'passive',
});
