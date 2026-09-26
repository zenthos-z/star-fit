/**
 * A4 教程库数据组装器单测（issue #12 + #8 附加改造）——纯函数，无 DB。
 *
 * 覆盖：结构化数据判定、五段 Markdown 组装（段序/标题/编号步骤/中文标签）、
 * 空段落省略、全空走 null（AI 兜底信号）、instructions_zh 优先、禁 emoji。
 */

import {
  assembleTutorialMd,
  hasStructuredTutorialData,
  type TutorialSourceRow,
} from "../../../src/services/tutorialAssembler.js";

const FULL_ROW: TutorialSourceRow = {
  name: "barbell bench press",
  difficulty: "intermediate",
  equipment: "barbell",
  category: "strength",
  body_part: "chest",
  primary_muscles: ["chest", "triceps"],
  secondary_muscles: ["shoulders"],
  force_type: "push",
  mechanic: "compound",
  instructions: [
    "Lie flat on the bench with feet planted.",
    "Grip the bar slightly wider than shoulder width.",
    "Lower the bar to mid-chest with control.",
    "Press the bar up until arms are extended.",
  ],
  instructions_zh: null,
  form_cues: [
    "Keep shoulder blades retracted throughout.",
    "Wrists stacked directly over elbows.",
  ],
  common_mistakes: [
    "Bouncing the bar off the chest.",
    "Flaring elbows to 90 degrees.",
  ],
  breathing: "Inhale while lowering, exhale while pressing.",
};

/** emoji 检测（常见 emoji 区段；箭头/汉字不在其中） */
const EMOJI_RE =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/u;

describe("hasStructuredTutorialData", () => {
  it("任一教学字段非空即成立", () => {
    expect(hasStructuredTutorialData(FULL_ROW)).toBe(true);
    expect(
      hasStructuredTutorialData({
        ...FULL_ROW,
        instructions: null,
        form_cues: null,
        common_mistakes: null,
      }),
    ).toBe(true); // 仅 breathing
  });

  it("空数组/空白串/null 不算结构化数据", () => {
    expect(
      hasStructuredTutorialData({
        ...FULL_ROW,
        instructions: [],
        instructions_zh: [],
        form_cues: [],
        common_mistakes: [],
        breathing: "   ",
      }),
    ).toBe(false);
    expect(hasStructuredTutorialData({ name: "x" })).toBe(false);
  });

  it("肌群/器材等画像字段不算教学数据（不因此绕过 AI）", () => {
    expect(
      hasStructuredTutorialData({
        ...FULL_ROW,
        instructions: null,
        form_cues: null,
        common_mistakes: null,
        breathing: null,
      }),
    ).toBe(false);
  });
});

describe("assembleTutorialMd", () => {
  it("全字段 → 五段齐备、段序正确、无 emoji", () => {
    const md = assembleTutorialMd(FULL_ROW)!;
    expect(md).toBeTruthy();

    const headings = md
      .split("\n")
      .filter((l) => l.startsWith("## "))
      .map((l) => l.slice(3));
    expect(headings).toEqual([
      "动作作用",
      "发力心法",
      "步骤",
      "注意事项",
      "常见错误",
    ]);

    expect(EMOJI_RE.test(md)).toBe(false);
  });

  it("动作作用：17 词表英文值转中文标签", () => {
    const md = assembleTutorialMd(FULL_ROW)!;
    const purpose = md.split("## 发力心法")[0];
    expect(purpose).toContain("主发力肌群：胸部、肱三头肌");
    expect(purpose).toContain("协同肌群：肩部");
    expect(purpose).toContain("力量训练 · 复合动作 · 胸部 · 中级");
  });

  it("步骤：有序编号列表", () => {
    const md = assembleTutorialMd(FULL_ROW)!;
    expect(md).toContain("1. Lie flat on the bench");
    expect(md).toContain("4. Press the bar up");
  });

  it("instructions_zh 优先于 instructions", () => {
    const md = assembleTutorialMd({
      ...FULL_ROW,
      instructions_zh: ["平躺在凳上", "握距略宽于肩"],
    })!;
    expect(md).toContain("1. 平躺在凳上");
    expect(md).not.toContain("Lie flat");
  });

  it("缺失数据的段落整体省略，不虚构", () => {
    const md = assembleTutorialMd({
      ...FULL_ROW,
      form_cues: null,
      force_type: null,
      common_mistakes: null,
    })!;
    expect(md).not.toContain("## 发力心法");
    expect(md).not.toContain("## 常见错误");
    expect(md).toContain("## 步骤");
  });

  it("教学字段全空 → null（调用方走 AI 兜底）", () => {
    expect(
      assembleTutorialMd({
        ...FULL_ROW,
        instructions: null,
        instructions_zh: null,
        form_cues: null,
        common_mistakes: null,
        breathing: null,
      }),
    ).toBeNull();
  });

  it("注意事项含呼吸法/器材/难度基准；难度三档文案不同", () => {
    const caution = (row: TutorialSourceRow) =>
      assembleTutorialMd(row)!.split("## 注意事项")[1];

    expect(caution(FULL_ROW)).toContain("呼吸：Inhale while lowering");
    expect(caution(FULL_ROW)).toContain("器材：杠铃");
    expect(caution(FULL_ROW)).toContain("中级动作");

    expect(caution({ ...FULL_ROW, difficulty: "beginner" })).toContain(
      "初级动作",
    );
    expect(caution({ ...FULL_ROW, difficulty: "advanced" })).toContain(
      "高级动作",
    );
  });

  it("未知词表值原样透出，不炸不造", () => {
    const md = assembleTutorialMd({
      ...FULL_ROW,
      primary_muscles: ["mystery_muscle"],
      difficulty: "weird",
    })!;
    expect(md).toContain("mystery_muscle");
    expect(md).toContain("weird");
  });
});
