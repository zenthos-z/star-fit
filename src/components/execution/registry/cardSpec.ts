/**
 * 卡片规范卡 spec —— 注册面契约与真源对拍（issue #88 分册3）
 *
 * register(cardType, component, spec) 的 spec = docs/card-spec/ 规范卡的
 * 结构化摘要（必答清单的代码面）。本模块定义 spec 形态 + 注册键域 +
 * 注册时自动校验（validateCardSpec，纯函数）。校验不过 → 装配文件
 * 求值即抛错（红线3「无缺漏无错误」的注册面：坏 spec 不许进运行时）。
 *
 * 键域（cardType 合法值，两个域 + 哨兵域）：
 *   - 运动卡：`{major}_{variant}` 两级键 —— 真源 shared/contracts/card-types.ts
 *     （CARD_TYPE_VALUES + CARD_TYPE_ALIASES 别名键，运行时派生，禁手写第二套）
 *   - AI 卡：后端 uiHintValidator 卡型 + 前端专属卡（survey_success /
 *     hitl_confirm）——无 shared 真源，本模块 AI_CARD_TYPES 是唯一定义点，
 *     与后端 UIHintTypeEnum 的一致性由 __tests__ guard 测试对拍守门
 *   - 哨兵：skeleton / unknown（协议 UIHint 枚举内的占位键）
 *
 * uiHint.data 允许键真值表（UI_HINT_DATA_KEYS）：
 *   - weekly_plan 运行时从 shared/contracts WeeklyPlanCardDataSchema 派生
 *   - 其余后端校验卡型逐字对齐 backend uiHintSchemas（*.DataSchema 字段），
 *     漂移由 guard 测试导真源模块比对守门（前端产物禁直接依赖 backend）
 *
 * @see docs/card-spec/README.md 必答清单（spec 的文档面）
 * @created 2026-10-01
 */

import {
  CARD_TYPE_ALIASES,
  CARD_TYPE_VALUES,
  EXERCISE_TYPE_VALUES,
  ExerciseSetEntrySchema,
  MAJOR_CARD_TYPES,
  WeeklyPlanCardDataSchema,
  cardTypeForExerciseType,
  normalizeExerciseActionType,
} from 'shared/contracts';

// ============================================================================
// 键域（cardType 合法值单一取用点）
// ============================================================================

/**
 * 运动卡键域 = 标准两级键 + 兼容别名（真源 card-types.ts 运行时派生，
 * 真源扩值本域自动跟随，禁手写第二套）。
 */
export const EXERCISE_CARD_TYPE_KEYS: readonly string[] = [
  ...CARD_TYPE_VALUES,
  ...Object.keys(CARD_TYPE_ALIASES),
];

/**
 * AI 卡键域（uiHint 多态卡）。前 7 项 = 后端 uiHintValidator 可产出卡型
 * （UIHintTypeEnum 同序；deviation_card 当前无组件、未注册——分发到它
 * 是显式错误，属已知缺口，补 DeviationCard 后在装配文件注册即闭环）；
 * survey_success / hitl_confirm 为前端专属卡（后端不产出 / 已拉黑）。
 * 与后端枚举的一致性由 guard 测试守门。
 */
export const AI_CARD_TYPES = [
  'plan_card',
  'weekly_plan',
  'summary_card',
  'survey_card',
  'deviation_card',
  'audit_complete',
  'profile_update_confirm',
  'survey_success',
  'hitl_confirm',
] as const;

export type AiCardType = (typeof AI_CARD_TYPES)[number];

/** 哨兵键（协议 UIHint 枚举内：加载骨架 / 未知占位） */
export const SENTINEL_CARD_TYPES = ['skeleton', 'unknown'] as const;
export type SentinelCardType = (typeof SENTINEL_CARD_TYPES)[number];

/** 注册键三大域的并集（register 的 cardType 参数合法值全集） */
export const REGISTERABLE_CARD_TYPES: readonly string[] = [
  ...EXERCISE_CARD_TYPE_KEYS,
  ...AI_CARD_TYPES,
  ...SENTINEL_CARD_TYPES,
];

// ============================================================================
// 真源对拍用的键域导出（供校验与 guard 测试）
// ============================================================================

/**
 * uiHint.data 允许键真值表 —— 仅覆盖后端 uiHintValidator 校验的卡型
 * （「与 uiHintValidator 一致」的注册面真源）。
 *
 * - plan_card 的 data 是 ExercisePlan 行数组，此处为**行内允许键**
 *   （= backend ExercisePlanSchema 字段；data 本身的数组形态由卡组件消化）
 * - weekly_plan 从 shared/contracts 运行时派生（真源即契约）
 * - 前端专属卡（survey_success / hitl_confirm）不进本表：无外部校验真源，
 *   spec.uiHintDataKeys 自声明即可（组件 props 即事实）
 *
 * 漂移守门：__tests__ guard 测试逐键比对 backend uiHintSchemas 的
 * *DataSchema.shape，不一致即红。
 */
export const UI_HINT_DATA_KEYS: Readonly<Record<string, readonly string[]>> = {
  plan_card: [
    'exerciseId',
    'name',
    'exercise_type',
    'sets',
    'reps',
    'weight',
    'duration',
    'distance',
  ],
  weekly_plan: Object.keys(WeeklyPlanCardDataSchema.shape),
  summary_card: ['title', 'summary', 'highlights', 'metrics'],
  survey_card: ['sessionId', 'title', 'subtitle', 'message', 'questions'],
  deviation_card: ['reason', 'suggestion'],
  audit_complete: [
    'title',
    'message',
    'actionLabel',
    'requiresConfirmation',
    'updates',
    'sessionId',
    'auditContent',
  ],
  profile_update_confirm: [
    'title',
    'message',
    'trigger',
    'proposals',
    'pending_intent',
    'confirmLabel',
    'cancelLabel',
  ],
};

/** ExerciseSetEntry 契约键域（requiredSetFields 的对拍真源，运行时派生） */
export const EXERCISE_SET_FIELD_KEYS: readonly string[] = Object.keys(
  ExerciseSetEntrySchema.shape,
);

// ============================================================================
// spec 形态（docs/card-spec 必答清单的结构化摘要）
// ============================================================================

/** 卡片交互模式（#88 v2 spec：两类交互） */
export type InteractionMode = 'active' | 'passive';

/**
 * 卡片规范卡的结构化摘要。
 *
 * 必答项与 docs/card-spec/README.md 必答清单一一对应：
 *   - interactionMode（§1 身份）：active 活动卡（执行流）/ passive 记录卡（填入确认）
 *   - requiredSetFields（§4.2 执行记录层，运动卡专用）：本卡执行记录必需的
 *     sets 字段；注册时对拍 ExerciseSetEntrySchema 键域（禁编造字段）
 *   - uiHintDataKeys（§3 数据输出，AI 卡专用）：uiHint.data 允许键清单；
 *     后端校验卡型逐字对齐 UI_HINT_DATA_KEYS（无缺漏无错误，多键缺键都拒）
 *   - fineTypes（§1 覆盖细类，运动卡专用）：⊆ EXERCISE_TYPE_VALUES；
 *     全注册表细类恰好全覆盖一卡由测试守门
 *   - docRef：对应规范卡文档页（开发者指引，非校验对象）
 */
export interface CardSpec {
  interactionMode: InteractionMode;
  /** 运动卡专用：执行记录必需字段（⊆ ExerciseSetEntrySchema 键域） */
  requiredSetFields?: readonly string[];
  /** AI 卡专用：uiHint.data 允许键（后端校验卡型 = 真值表逐字一致） */
  uiHintDataKeys?: readonly string[];
  /** 运动卡专用：覆盖细类（⊆ EXERCISE_TYPE_VALUES） */
  fineTypes?: readonly string[];
  /** 规范卡文档页锚点（如 docs/card-spec/resistance_standard.md） */
  docRef?: string;
}

/** 注册键分域（校验规则按域区分） */
export type CardKeyDomain = 'exercise' | 'ai' | 'sentinel';

/** cardType → 键域（未知键返回 undefined） */
export function cardKeyDomain(cardType: string): CardKeyDomain | undefined {
  if ((EXERCISE_CARD_TYPE_KEYS as readonly string[]).includes(cardType)) return 'exercise';
  if ((AI_CARD_TYPES as readonly string[]).includes(cardType)) return 'ai';
  if ((SENTINEL_CARD_TYPES as readonly string[]).includes(cardType)) return 'sentinel';
  return undefined;
}

// ============================================================================
// 注册时自动校验（纯函数，返回问题清单；register 侧非空即抛错）
// ============================================================================

const INTERACTION_MODES: readonly string[] = ['active', 'passive'];

/**
 * 校验一份 spec 与真源的对拍结果。
 *
 * @returns 问题清单（空数组 = 过）。每条问题自带修复指引。
 */
export function validateCardSpec(cardType: string, spec: CardSpec): string[] {
  const problems: string[] = [];
  const domain = cardKeyDomain(cardType);

  // 0. cardType 在真源枚举内（分册1 两级键 / AI 卡键域 / 哨兵）
  if (!domain) {
    problems.push(
      `cardType "${cardType}" 不在真源枚举内——运动卡取 shared/contracts CARD_TYPE_VALUES/CARD_TYPE_ALIASES，` +
        `AI 卡取 AI_CARD_TYPES（cardSpec.ts）；新键先扩真源再注册`,
    );
    return problems; // 域未知时后续按域校验无意义
  }

  // 1. interactionMode 必答且合法
  if (!(INTERACTION_MODES as readonly string[]).includes(spec.interactionMode)) {
    problems.push(
      `interactionMode 必须是 "active" | "passive"（当前: ${JSON.stringify(spec.interactionMode)}）`,
    );
  }

  const setFields = spec.requiredSetFields ?? [];
  const dataKeys = spec.uiHintDataKeys ?? [];

  if (domain === 'exercise') {
    // 2a. 运动卡：执行记录必需字段 ⊆ ExerciseSetEntry 契约键域
    for (const f of setFields) {
      if (!EXERCISE_SET_FIELD_KEYS.includes(f)) {
        problems.push(
          `requiredSetFields 字段 "${f}" 不在 ExerciseSetEntrySchema 契约键域 [${EXERCISE_SET_FIELD_KEYS.join(', ')}] 内`,
        );
      }
    }
    // 2b. 运动卡渲染数据载体是 exercise（ExerciseAction.uiHint={cardType,pluginId}），
    //     不声明 uiHint.data 允许键（数据窄：扩键先扩契约）
    if (dataKeys.length > 0) {
      problems.push(
        `运动卡不声明 uiHintDataKeys（渲染数据载体是 ExerciseAction，非 uiHint.data）——改为 requiredSetFields`,
      );
    }
    // 2c. 覆盖细类 ⊆ EXERCISE_TYPE_VALUES
    for (const t of spec.fineTypes ?? []) {
      if (!(EXERCISE_TYPE_VALUES as readonly string[]).includes(t)) {
        problems.push(`fineTypes 细类 "${t}" 不在 EXERCISE_TYPE_VALUES 真源枚举内`);
      }
    }
  } else if (domain === 'ai') {
    // 3a. AI 卡：uiHint.data 允许键必答
    if (dataKeys.length === 0) {
      problems.push(`AI 卡必须声明 uiHintDataKeys（uiHint.data 允许键清单，必答项）`);
    }
    // 3b. 后端校验卡型：与真值表逐字一致（无缺漏无错误——多键缺键都拒）
    const truth = UI_HINT_DATA_KEYS[cardType];
    if (truth && dataKeys.length > 0) {
      const missing = truth.filter((k) => !dataKeys.includes(k));
      const extra = dataKeys.filter((k) => !truth.includes(k));
      if (missing.length > 0) {
        problems.push(
          `uiHintDataKeys 缺键 [${missing.join(', ')}]——与 uiHintValidator 允许键不一致（真源: backend uiHintSchemas / UI_HINT_DATA_KEYS）`,
        );
      }
      if (extra.length > 0) {
        problems.push(
          `uiHintDataKeys 多键 [${extra.join(', ')}]——数据窄：扩键先扩契约，再扩 UI_HINT_DATA_KEYS 真值表`,
        );
      }
    }
    // 3c. AI 卡无执行记录域
    if (setFields.length > 0) {
      problems.push(`AI 卡不声明 requiredSetFields（无 ExerciseAction.sets 执行记录域）`);
    }
    if ((spec.fineTypes ?? []).length > 0) {
      problems.push(`AI 卡不声明 fineTypes（细类覆盖是运动卡的概念）`);
    }
  } else {
    // 4. 哨兵卡：自由载荷占位（StandardCard 直渲染），不声明任何数据面清单
    if (setFields.length > 0) problems.push(`哨兵卡不声明 requiredSetFields`);
    if (dataKeys.length > 0) problems.push(`哨兵卡不声明 uiHintDataKeys`);
    if ((spec.fineTypes ?? []).length > 0) problems.push(`哨兵卡不声明 fineTypes`);
  }

  // 重复键自查（同一清单内同名键 = 笔误）
  for (const [label, list] of [
    ['requiredSetFields', setFields],
    ['uiHintDataKeys', dataKeys],
  ] as const) {
    if (new Set(list).size !== list.length) {
      problems.push(`${label} 存在重复键 [${list.join(', ')}]`);
    }
  }

  return problems;
}

// ============================================================================
// 细类/动作类型裸值 → 标准卡键（真源函数装配，供 resolveCard 派生）
// ============================================================================

/**
 * 会话动作类型裸值（exercise.type：细类 / hiit / UNKNOWN）→ 标准分发卡键。
 * 'strength' 等存量旧值经 LEGACY_EXERCISE_TYPE_ALIASES 兼容归一（真源
 * normalizeExerciseActionType 唯一对照）。无法归一返回 undefined（调用方
 * 显式报错，禁静默编造）。
 */
export function actionTypeToCardType(raw: string): string | undefined {
  const action = normalizeExerciseActionType(String(raw ?? '').toLowerCase().trim());
  if (action === 'unknown') return undefined;
  if (action === 'hiit') return MAJOR_CARD_TYPES.hiit;
  return cardTypeForExerciseType(action);
}
