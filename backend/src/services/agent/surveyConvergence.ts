/**
 * surveyConvergence (#114 / B5c) — survey_card 生成收敛共享题库（确定性侧）。
 *
 * spec §2.4 双真源统一的 Agent 侧落点：Agent 出画像域问卷卡（首用调研 /
 * 缺口补全）时，题目集从 `PROFILE_INTAKE_QUESTIONS`（shared/contracts/survey.ts
 * 单一真源，与 App 首用问卷同源）取，不再自由发挥。
 *
 * 分工（AI/Service 边界）：
 *   - Agent（意图）：决定 `purpose`（新用户全量 profile_intake / 按缺口子集
 *     plan_gap）+ 题库 id 子集 + 卡片 title/message 话术；
 *   - Service（数据，本模块）：按 id 把题目内容（题干/选项/二级菜单/
 *     inputType/约束）替换为题库原文——Agent 写的题面一律以题库为准，
 *     措辞漂移在结构上不可能到达前端。
 *
 * 兼容：`purpose` 缺省或 = workout_feedback 的卡（练后反馈，spec §4.4 本期
 * 不动）原样透传——旧卡/自由反馈零影响；仅 profile_intake / plan_gap 触发
 * 收敛。plan_gap 子集选不中任何题库 id → 结构化错误走既有校验回路重试
 * （与 Zod shape 错误同通道）。
 *
 * 纯函数：无 IO、无副作用；返回的题目对象均为深拷贝，下游改动不会污染
 * 共享题库常量。
 */

import {
  PROFILE_INTAKE_QUESTIONS,
  type SurveyQuestion,
} from "./schemas/uiHintSchemas.js";
import type { StructuredError } from "./uiHintValidator.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** 收敛结果：成功携带替换后的整卡，失败携带走校验回路的结构化错误。 */
export type CanonicalizeSurveyResult =
  { ok: true; card: unknown } | { ok: false; errors: StructuredError[] };

/** plan_gap 子集选不中任何题库 id 时的稳定错误码（程序化消费可识别）。 */
export const SURVEY_OFF_BANK_CODE = "survey_question_off_bank";

// ---------------------------------------------------------------------------
// Bank index
// ---------------------------------------------------------------------------

/** 题库 id → 题目原文（模块级只读索引；题目对象永不直接外发，只发深拷贝）。 */
const BANK_BY_ID: ReadonlyMap<string, SurveyQuestion> = new Map(
  PROFILE_INTAKE_QUESTIONS.map((q) => [q.id, q]),
);

// ---------------------------------------------------------------------------
// canonicalizeSurveyCard
// ---------------------------------------------------------------------------

/**
 * 把画像域 survey_card 的题目集收敛到共享题库。
 *
 * 规则：
 *   - 非 survey_card / data 形状不对 / purpose 缺省或 = workout_feedback →
 *     原样透传（校验器已保证 schema 合法，本函数不做二次形状裁决）；
 *   - purpose = profile_intake → 题目集 = 题库全量（题库顺序），Agent 给的
 *     questions 内容不参考（新用户一次问完，spec §2.1 原则 3）；
 *   - purpose = plan_gap → 题目集 = Agent 声明的 id ∩ 题库 id（题库顺序）；
 *     题外 id 静默丢弃；条件题依赖自动补齐（如 age ← goal：只带 age 不带
 *     goal 时 age 的 condition 永不满足，等于白问）；交集为空 → 结构化错误。
 *
 * @param card 校验回路已放行的 uiHint 卡（UIHintSchema 形状）
 * @returns 收敛后的整卡（title/message 等话术字段原样保留），或错误
 */
export function canonicalizeSurveyCard(
  card: unknown,
): CanonicalizeSurveyResult {
  if (!isPlainObject(card) || card.type !== "survey_card") {
    return { ok: true, card };
  }
  const data = card.data;
  if (!isPlainObject(data)) {
    return { ok: true, card };
  }
  const purpose = data.purpose;
  if (purpose !== "profile_intake" && purpose !== "plan_gap") {
    return { ok: true, card };
  }

  if (purpose === "profile_intake") {
    return {
      ok: true,
      card: { ...card, data: { ...data, questions: fullBankQuestions() } },
    };
  }

  const requestedIds = collectQuestionIds(data.questions);
  const selected = selectBankSubset(requestedIds);
  if (selected.length === 0) {
    return {
      ok: false,
      errors: [
        {
          code: SURVEY_OFF_BANK_CODE,
          message:
            `plan_gap survey_card 携带的题目 id（${requestedIds.join(", ") || "（空）"}）` +
            `没有一个属于共享题库 PROFILE_INTAKE_QUESTIONS。可用 id：` +
            `${PROFILE_INTAKE_QUESTIONS.map((q) => q.id).join(", ")}。` +
            `缺哪几项发对应题库 id，禁止自造题目。`,
          path: ["data", "questions"],
        },
      ],
    };
  }
  return {
    ok: true,
    card: { ...card, data: { ...data, questions: selected } },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 题库全量深拷贝（题库顺序）。 */
function fullBankQuestions(): SurveyQuestion[] {
  return PROFILE_INTAKE_QUESTIONS.map(cloneQuestion);
}

/**
 * 取 Agent 声明的题目 id（只认 string id，形状坏的条目忽略——schema 层已
 * 保证存在性，这里只提取意图）。
 */
function collectQuestionIds(questions: unknown): string[] {
  if (!Array.isArray(questions)) {
    return [];
  }
  const ids: string[] = [];
  for (const q of questions) {
    if (isPlainObject(q) && typeof q.id === "string") {
      ids.push(q.id);
    }
  }
  return ids;
}

/**
 * id 子集 → 题库题目（题库顺序，深拷贝）。
 *
 * 条件题依赖补齐：题库中带 `condition.questionId` 的题（如 age 依赖 goal），
 * 若被选中而被引用题未选中 → 一并补入（否则 condition 永不满足，该题不
 * 渲染也不参与必答校验，等于白带）。被引用题自身无依赖，一层补齐即闭环。
 */
function selectBankSubset(ids: string[]): SurveyQuestion[] {
  const wanted = new Set(ids.filter((id) => BANK_BY_ID.has(id)));
  for (const q of PROFILE_INTAKE_QUESTIONS) {
    if (
      q.condition &&
      wanted.has(q.id) &&
      BANK_BY_ID.has(q.condition.questionId)
    ) {
      wanted.add(q.condition.questionId);
    }
  }
  return PROFILE_INTAKE_QUESTIONS.filter((q) => wanted.has(q.id)).map(
    cloneQuestion,
  );
}

/** 题库条目深拷贝（纯 JSON 数据，JSON 往返即确定性拷贝）。 */
function cloneQuestion(q: SurveyQuestion): SurveyQuestion {
  return JSON.parse(JSON.stringify(q)) as SurveyQuestion;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
