/**
 * TutorialAssembler — 动作教学「库数据优先」组装器（A4，issue #12 + #8 附加改造）。
 *
 * 职责：exercises 深化列（instructions/form_cues/common_mistakes/breathing/
 * primary_muscles/...）→ 五段式教学 Markdown（动作作用/发力心法/步骤/注意事项/
 * 常见错误）。纯模板渲染，零 LLM、零算术（CLAUDE.md AI 边界红线）。
 *
 * 段落标识 = 纯文字「## 标题」（issue #8 实施修正：禁 emoji 段图标）；
 * 无数据的段落整体省略，不虚构内容。
 *
 * 消费方：
 * - exerciseController.withViewFields（REST GET /exercises/:id → tutorial_md）
 * - server.ts WS tutor.generate_tutorial（库命中直接回包，不走 LLM）
 */

import {
  BODY_PART_LABELS_ZH,
  CATEGORY_LABELS_ZH,
  DIFFICULTY_LABELS_ZH,
  EQUIPMENT_LABELS_ZH,
  FORCE_TYPE_LABELS_ZH,
  MECHANIC_LABELS_ZH,
  MUSCLE_LABELS_ZH,
  parseInstructionsZh,
  type ExerciseMuscle,
} from "../../../shared/dist/contracts/index.js";

/** 教学相关深化列子集（exercises 行 SELECT * 的形态） */
export interface TutorialSourceRow {
  name: string;
  difficulty?: string | null;
  equipment?: string | null;
  category?: string | null;
  body_part?: string | null;
  primary_muscles?: string[] | null;
  secondary_muscles?: string[] | null;
  force_type?: string | null;
  mechanic?: string | null;
  instructions?: string[] | null;
  instructions_zh?: string[] | null;
  form_cues?: string[] | null;
  common_mistakes?: string[] | null;
  breathing?: string | null;
}

/** 教程数据源标记（前端据此展示徽标） */
export type TutorialSource = "library" | "ai_generated";

/** 判定：库内结构化教学数据是否成立（任一教学字段非空即库优先） */
export function hasStructuredTutorialData(row: TutorialSourceRow): boolean {
  const hasList = (v: string[] | null | undefined): boolean =>
    Array.isArray(v) && v.some((s) => typeof s === "string" && s.trim() !== "");
  return (
    hasList(row.instructions) ||
    hasList(row.instructions_zh) ||
    hasList(row.form_cues) ||
    hasList(row.common_mistakes) ||
    (typeof row.breathing === "string" && row.breathing.trim() !== "")
  );
}

/** 词表值 → 中文标签（未知值原样返回，不炸不造） */
function label(
  map: Readonly<Record<string, string>>,
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }
  return map[value] ?? value;
}

function muscleLabel(value: string): string {
  return MUSCLE_LABELS_ZH[value as ExerciseMuscle] ?? value;
}

function bulletList(items: string[]): string {
  return items.map((s) => `- ${s}`).join("\n");
}

function numberedList(items: string[]): string {
  return items.map((s, i) => `${i + 1}. ${s}`).join("\n");
}

/**
 * 五段式教学 Markdown 组装。仅渲染有数据的段落；
 * 全部教学字段为空时返回 null（调用方走 AI 兜底）。
 */
export function assembleTutorialMd(row: TutorialSourceRow): string | null {
  if (!hasStructuredTutorialData(row)) {
    return null;
  }

  // A6 结构化中文教学（instructions_zh 段头编码）：逐段中文优先，缺段回退英文源；
  // 纯步骤数组（无段头，兼容旧形态）整体按中文步骤解释。
  const zh = parseInstructionsZh(row.instructions_zh);
  const steps = zh?.steps.length
    ? zh.steps
    : row.instructions_zh?.length
      ? row.instructions_zh
      : (row.instructions ?? []);
  const cues = zh?.cues.length ? zh.cues : (row.form_cues ?? []);
  const mistakes = zh?.mistakes.length
    ? zh.mistakes
    : (row.common_mistakes ?? []);
  const breathing = zh?.breathing?.trim() || row.breathing?.trim() || null;
  const primary = row.primary_muscles ?? [];
  const secondary = row.secondary_muscles ?? [];

  const sections: string[] = [];

  // ---- 一、动作作用（肌群 + 分类画像，全部来自结构化列） ----
  const purposeLines: string[] = [];
  if (primary.length > 0) {
    purposeLines.push(
      `主发力肌群：${primary.map(muscleLabel).join("、")}${
        secondary.length > 0
          ? `；协同肌群：${secondary.map(muscleLabel).join("、")}`
          : ""
      }。`,
    );
  }
  const profile = [
    label(CATEGORY_LABELS_ZH, row.category),
    label(MECHANIC_LABELS_ZH, row.mechanic),
    label(BODY_PART_LABELS_ZH, row.body_part),
    DIFFICULTY_LABELS_ZH[
      row.difficulty as "beginner" | "intermediate" | "advanced"
    ] ?? row.difficulty,
  ].filter((v): v is string => !!v);
  if (profile.length > 0) {
    purposeLines.push(`动作画像：${profile.join(" · ")}。`);
  }
  if (purposeLines.length > 0) {
    sections.push(`## 动作作用\n\n${purposeLines.join("\n\n")}`);
  }

  // ---- 二、发力心法（要领提示 + 力向） ----
  const cueLines: string[] = [];
  if (cues.length > 0) {
    cueLines.push(bulletList(cues));
  }
  const force = label(FORCE_TYPE_LABELS_ZH, row.force_type);
  if (force) {
    cueLines.push(`力向：${force}。`);
  }
  if (cueLines.length > 0) {
    sections.push(`## 发力心法\n\n${cueLines.join("\n\n")}`);
  }

  // ---- 三、步骤（编号列表；中文口径优先） ----
  if (steps.length > 0) {
    sections.push(`## 步骤\n\n${numberedList(steps)}`);
  }

  // ---- 四、注意事项（呼吸法 + 器材 + 难度基准） ----
  const cautionLines: string[] = [];
  if (breathing) {
    cautionLines.push(`呼吸：${breathing}`);
  }
  const equipment = label(EQUIPMENT_LABELS_ZH, row.equipment);
  if (equipment) {
    cautionLines.push(
      `器材：${equipment}。开始前确认器材稳固、动作行程内无障碍。`,
    );
  }
  const difficultyLine = difficultyCaution(row.difficulty);
  if (difficultyLine) {
    cautionLines.push(difficultyLine);
  }
  if (cautionLines.length > 0) {
    sections.push(`## 注意事项\n\n${cautionLines.join("\n\n")}`);
  }

  // ---- 五、常见错误 ----
  if (mistakes.length > 0) {
    sections.push(`## 常见错误\n\n${bulletList(mistakes)}`);
  }

  return sections.length > 0 ? sections.join("\n\n") : null;
}

/** 难度基准提示（模板文案，按三档受控词表生成） */
function difficultyCaution(
  difficulty: string | null | undefined,
): string | null {
  switch (difficulty) {
    case "beginner":
      return "初级动作：建议从自重或轻负荷开始，优先保证动作轨迹正确，再逐步增加强度。";
    case "intermediate":
      return "中级动作：建议具备基础力量后练习，组间留足恢复时间。";
    case "advanced":
      return "高级动作：技术门槛与负荷要求较高，建议有保护或教练指导时进行。";
    default:
      return null;
  }
}
