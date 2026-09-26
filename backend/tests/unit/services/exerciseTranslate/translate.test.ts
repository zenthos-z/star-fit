/**
 * A6 翻译核心单测（issue #19）——纯函数，无 DB / 无 LLM 调用。
 *
 * 覆盖：LLM 响应 Zod 校验口径（中文字段/空数组默认/步数上限）、
 * prompt 构建（教学字段「无」标记 / 定名锚定）、代码栅栏剥离、
 * 术语一致性检查（命中/miss/宽松空白）、定名命中复核。
 */

import { join } from "node:path";
import {
  ContentTranslationSchema,
  ContentBatchSchema,
  NamesBatchSchema,
  buildBatchUserPrompt,
  buildContentSystemPrompt,
  buildContentUserPrompt,
  buildNamesSystemPrompt,
  checkNameOverrideHit,
  checkTermConsistency,
  loadGlossary,
  renderGlossaryForPrompt,
  stripCodeFence,
} from "../../../../src/services/exerciseTranslate/index.js";

const REAL_GLOSSARY = join(
  __dirname,
  "../../../../src/scripts/terminology-glossary.json",
);

const VALID_CONTENT = {
  name_zh: "平板杠铃卧推",
  steps: [
    "仰卧于平凳，双眼位于杠铃正下方，双脚踩实地面，收紧核心保持躯干稳定。",
    "双手握距略宽于肩，伸直手臂将杠铃起杠移至胸部上方。",
  ],
  cues: ["双脚蹬地稳定下肢", "手腕中立叠于前臂上方"],
  mistakes: ["避免臀部离开凳面——保持自然拱腰贴凳，下肢只负责稳定。"],
  breathing: "下放时吸气，上推时呼气。",
};

describe("ContentTranslationSchema（LLM 响应校验口径）", () => {
  it("合法四段载荷通过", () => {
    expect(ContentTranslationSchema.parse(VALID_CONTENT)).toBeTruthy();
  });

  it("cues/mistakes/breathing 可省（默认空数组/null）", () => {
    const parsed = ContentTranslationSchema.parse({
      name_zh: "徒手深蹲",
      steps: ["双脚与肩同宽站距站立。"],
    });
    expect(parsed.cues).toEqual([]);
    expect(parsed.mistakes).toEqual([]);
    expect(parsed.breathing).toBeNull();
  });

  it("纯英文 steps 拒绝（中文字段口径）", () => {
    expect(() =>
      ContentTranslationSchema.parse({
        ...VALID_CONTENT,
        steps: ["Lie flat on the bench"],
      }),
    ).toThrow();
  });

  it("steps 空数组 / 缺失拒绝；超上限拒绝", () => {
    expect(() =>
      ContentTranslationSchema.parse({ ...VALID_CONTENT, steps: [] }),
    ).toThrow();
    expect(() => {
      const { steps: _omit, ...rest } = VALID_CONTENT;
      ContentTranslationSchema.parse(rest);
    }).toThrow();
    expect(() =>
      ContentTranslationSchema.parse({
        ...VALID_CONTENT,
        steps: Array.from({ length: 16 }, (_, i) => `第${i + 1}步动作描述`),
      }),
    ).toThrow();
  });
});

describe("NamesBatchSchema", () => {
  it("合法批量翻译通过；空 translations 拒绝", () => {
    expect(
      NamesBatchSchema.parse({
        translations: [{ name: "Squat", name_zh: "徒手深蹲" }],
      }),
    ).toBeTruthy();
    expect(() => NamesBatchSchema.parse({ translations: [] })).toThrow();
  });
});

describe("prompt 构建", () => {
  it("内容 system prompt 含术语纪律与术语表；user prompt 空字段标「无」", () => {
    const g = loadGlossary(REAL_GLOSSARY);
    const sys = buildContentSystemPrompt(renderGlossaryForPrompt(g));
    expect(sys).toContain("术语一致性最高优先级");
    expect(sys).toContain("步数与原文严格一一对应");
    expect(sys).toContain("罗马尼亚硬拉");

    const user = buildContentUserPrompt(
      {
        id: "x",
        name: "Squat",
        instructions: ["Stand with feet shoulder-width apart."],
        form_cues: null,
        common_mistakes: null,
        breathing: null,
      },
      "徒手深蹲",
    );
    expect(user).toContain("动作中文名（定名，必须逐字采用）: 徒手深蹲");
    expect(user).toContain("1. Stand with feet shoulder-width apart.");
    expect(user).toContain("form_cues（要领提示）: 无");
    expect(user).toContain("breathing（呼吸法）: 无");
  });

  it("名称 system prompt 含定名纪律", () => {
    const sys = buildNamesSystemPrompt("术语表占位");
    expect(sys).toContain("全名定名表");
    expect(sys).toContain("不是字面直译");
  });
});

describe("ContentBatchSchema / buildBatchUserPrompt（批量主通道）", () => {
  it("合法批量数组通过；缺 name 拒绝", () => {
    const valid = [
      {
        name: "Squat",
        name_zh: "徒手深蹲",
        steps: ["双脚与肩同宽站立，脚尖微微外展。"],
        cues: [],
        mistakes: [],
        breathing: null,
      },
    ];
    expect(ContentBatchSchema.parse(valid)).toBeTruthy();
    const { name: _drop, ...noName } = valid[0];
    expect(() => ContentBatchSchema.parse([noName])).toThrow();
  });

  it("批量 prompt：动作分块 + 数组输出指令 + 定名锚定", () => {
    const anchor = new Map([["Squat", "徒手深蹲"]]);
    const prompt = buildBatchUserPrompt(
      [
        {
          id: "a",
          name: "Squat",
          instructions: ["Stand with feet apart."],
          form_cues: null,
          common_mistakes: null,
          breathing: null,
        },
      ],
      anchor,
    );
    expect(prompt).toContain("共 1 个动作");
    expect(prompt).toContain("### 动作 1: Squat");
    expect(prompt).toContain("动作中文名（定名，必须逐字采用）: 徒手深蹲");
    expect(prompt).toContain("输出 JSON 数组");
  });
});

describe("stripCodeFence", () => {
  it("剥掉 ```json 栅栏；无栅栏原样返回", () => {
    expect(stripCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripCodeFence('```\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripCodeFence('{"a":1}')).toBe('{"a":1}');
  });
});

describe("checkTermConsistency（抽检引擎）", () => {
  const g = loadGlossary(REAL_GLOSSARY);

  it("源文术语译名命中 → hit", () => {
    const check = checkTermConsistency(
      "Keep your lats engaged during the lat pulldown.",
      "高位下拉全程保持背阔肌收紧。",
      g,
    );
    expect(check.hitCount).toBeGreaterThanOrEqual(2); // lats + lat pulldown
    expect(check.terms.map((t) => t.en)).toContain("Lat Pulldown");
  });

  it("译名缺失 → miss（警示不改写）", () => {
    const check = checkTermConsistency(
      "Perform the romanian deadlift with a neutral spine.",
      "做这个动作时保持背部平直。",
      g,
    );
    const missed = check.terms.filter((t) => !t.hit).map((t) => t.en);
    expect(missed).toContain("Romanian Deadlift");
    expect(missed).toContain("Deadlift");
    expect(missed).toContain("Neutral Spine");
    expect(missed).toContain("Spine"); // 解剖词同源命中，同计 miss
    expect(check.missCount).toBe(4);
  });

  it("空白差异不影响命中（全角/空格宽松口径）", () => {
    const check = checkTermConsistency("farmer's walk", "农夫 行走", g);
    expect(check.hitCount).toBe(1);
  });
});

describe("checkNameOverrideHit（定名复核）", () => {
  const g = loadGlossary(REAL_GLOSSARY);

  it("逐字一致 → exact；偏离定名 → 不 exact 但给出定名", () => {
    expect(
      checkNameOverrideHit("Barbell Bench Press", "平板杠铃卧推", g),
    ).toEqual({
      override: expect.objectContaining({ zh: "平板杠铃卧推" }),
      exact: true,
    });
    const deviated = checkNameOverrideHit("Barbell Bench Press", "杠铃卧推", g);
    expect(deviated.exact).toBe(false);
    expect(deviated.override?.zh).toBe("平板杠铃卧推");
  });

  it("词表层完整动作名也是定名（Burpee 逐字一致判定）", () => {
    const hit = checkNameOverrideHit("Burpee", "波比跳", g);
    expect(hit.override?.zh).toBe("波比跳");
    expect(hit.exact).toBe(true);
    expect(checkNameOverrideHit("Burpee", "立卧撑跳", g).exact).toBe(false);
  });

  it("定名未命中 → override null（LLM 兜底口径）", () => {
    expect(
      checkNameOverrideHit("Never Seen Exercise", "无名动作", g).override,
    ).toBeNull();
  });
});
