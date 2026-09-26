/**
 * A6 instructions_zh 结构化编解码单测（issue #19）——纯函数，无 DB。
 *
 * 覆盖：buildInstructionsZh 四段编码（空段省略）、parseInstructionsZh 解析
 * （roundtrip / 旧纯步骤形态回退 null / 空输入）、InstructionsZhSectionsSchema
 * 默认值。真源 = shared/contracts/exercise-library.ts（A6 约定）。
 */

import {
  INSTRUCTIONS_ZH_SECTIONS,
  InstructionsZhSectionsSchema,
  buildInstructionsZh,
  parseInstructionsZh,
} from "../../../../../shared/contracts/index.js";

const FULL = {
  steps: [
    "仰卧于平凳，双眼位于杠铃正下方",
    "起杠至胸部上方",
    "有控制地下放至中胸",
  ],
  cues: ["双脚蹬地稳定下肢", "手腕保持中立叠于前臂上方"],
  mistakes: [
    "避免杠铃漂向颈部——沿垂直轨迹下放",
    "避免肘部过度外展——约 75° 夹角",
  ],
  breathing: "下放时吸气，上推时呼气。",
};

describe("buildInstructionsZh", () => {
  it("四段全量编码：段头独立元素 + 空段省略", () => {
    const encoded = buildInstructionsZh(FULL);
    expect(encoded).toEqual([
      INSTRUCTIONS_ZH_SECTIONS.steps,
      ...FULL.steps,
      INSTRUCTIONS_ZH_SECTIONS.cues,
      ...FULL.cues,
      INSTRUCTIONS_ZH_SECTIONS.mistakes,
      ...FULL.mistakes,
      INSTRUCTIONS_ZH_SECTIONS.breathing,
      FULL.breathing,
    ]);
  });

  it("空段整体省略；全空返回空数组", () => {
    const stepsOnly = buildInstructionsZh({
      steps: ["仅一步"],
      cues: [],
      mistakes: [],
      breathing: null,
    });
    expect(stepsOnly).toEqual(["【步骤】", "仅一步"]);

    expect(
      buildInstructionsZh({
        steps: [],
        cues: [],
        mistakes: [],
        breathing: null,
      }),
    ).toEqual([]);
  });

  it("breathing 纯空白视为空段", () => {
    const encoded = buildInstructionsZh({
      steps: ["a步"],
      cues: [],
      mistakes: [],
      breathing: "   ",
    });
    expect(encoded).not.toContain("【呼吸】");
  });
});

describe("parseInstructionsZh", () => {
  it("build 产物 roundtrip 无损", () => {
    expect(parseInstructionsZh(buildInstructionsZh(FULL))).toEqual(FULL);
  });

  it("无段头（旧纯步骤形态）→ null（调用方回退为 steps 全量）", () => {
    expect(parseInstructionsZh(["平躺在凳上", "握距略宽于肩"])).toBeNull();
  });

  it("null / undefined / 空数组 → null", () => {
    expect(parseInstructionsZh(null)).toBeNull();
    expect(parseInstructionsZh(undefined)).toBeNull();
    expect(parseInstructionsZh([])).toBeNull();
  });

  it("只有单段的编码可解析（步骤缺失不炸）", () => {
    const encoded = ["【要领】", "肩胛后收下沉", "核心持续收紧"];
    const parsed = parseInstructionsZh(encoded)!;
    expect(parsed.steps).toEqual([]);
    expect(parsed.cues).toEqual(["肩胛后收下沉", "核心持续收紧"]);
    expect(parsed.mistakes).toEqual([]);
    expect(parsed.breathing).toBeNull();
  });

  it("段头前的游离元素被忽略（防御异常形态）", () => {
    const encoded = ["游离元素", "【步骤】", "第一步"];
    const parsed = parseInstructionsZh(encoded)!;
    expect(parsed.steps).toEqual(["第一步"]);
  });
});

describe("InstructionsZhSectionsSchema", () => {
  it("缺省字段补默认值（cues/mistakes/breathing 可省）", () => {
    const parsed = InstructionsZhSectionsSchema.parse({ steps: ["一"] });
    expect(parsed).toEqual({
      steps: ["一"],
      cues: [],
      mistakes: [],
      breathing: null,
    });
  });
});
