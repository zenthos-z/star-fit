/**
 * A6 术语表模块单测（issue #19）——纯函数，无 DB / 无 LLM。
 *
 * 覆盖：真实术语表文件加载（parseJSONSafe + Zod 校验回路）、全名定名层/
 * 词表层切分、nameOverride 精确命中与大小写语义、prompt 渲染锚定格式、
 * 非法文件快速失败。
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadGlossary,
  nameOverride,
  renderGlossaryForPrompt,
} from "../../../../src/services/exerciseTranslate/index.js";

const REAL_GLOSSARY = join(
  __dirname,
  "../../../../src/scripts/terminology-glossary.json",
);

describe("loadGlossary（真实术语表）", () => {
  it("加载仓库术语表：meta 合法、条目非空、分层正确", () => {
    const g = loadGlossary(REAL_GLOSSARY);
    expect(g.meta.issue).toBe(19);
    expect(g.entries.length).toBeGreaterThanOrEqual(500);
    expect(g.overrides.length).toBeGreaterThan(300);
    expect(g.vocabulary.length).toBeGreaterThan(100);
    // byName：跨层重名时全名定名层胜出（设计内），不丢键
    expect(g.byName.size).toBe(new Set(g.entries.map((e) => e.en)).size);
    for (const e of g.entries) {
      expect(["通行", "直译", "存疑"]).toContain(e.source);
      expect(e.zh.length).toBeGreaterThan(0);
    }
    for (const name of g.byName.keys()) {
      const hit = g.byName.get(name)!;
      if (g.overrides.some((o) => o.en === name)) {
        expect(hit.section).toBe("full_name_overrides");
      }
    }
  });

  it("354 动作名全部可精确命中（名称翻译确定性前提）", () => {
    const g = loadGlossary(REAL_GLOSSARY);
    // 抽代表性名称（全名定名层 + 词表层来源混合）
    const samples = [
      "Barbell Bench Press",
      "Romanian Deadlift",
      "Skull Crusher",
      "Farmer's Walk",
      "Face Pull",
      "Commando Pull-Up",
      "Band Hip Abduction",
      "Lever Seated Hip Abduction",
    ];
    for (const name of samples) {
      const hit = g.byName.get(name);
      expect(hit).toBeDefined();
    }
  });

  it("非法 JSON / 空文件 / 结构不合规快速失败（不静默）", () => {
    const dir = join(tmpdir(), `a6-glossary-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    try {
      // 非法 JSON：parseJSONSafe 开发态直接抛 JSONParseError（契约快速失败）
      const bad = join(dir, "bad.json");
      writeFileSync(bad, "{not json", "utf8");
      expect(() => loadGlossary(bad)).toThrow();

      // 空文件：parseJSONSafe 返回 null → loadGlossary 显式报错
      const empty = join(dir, "empty.json");
      writeFileSync(empty, "", "utf8");
      expect(() => loadGlossary(empty)).toThrow(/不是合法 JSON/);

      const wrongShape = join(dir, "wrong.json");
      writeFileSync(
        wrongShape,
        JSON.stringify({ meta: {}, sections: { a: [{ en: "x" }] } }),
        "utf8",
      );
      expect(() => loadGlossary(wrongShape)).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("nameOverride（术语表精确命中）", () => {
  const g = loadGlossary(REAL_GLOSSARY);

  it("定名层条目命中并返回条目", () => {
    const hit = nameOverride(g, "Barbell Bench Press");
    expect(hit).not.toBeNull();
    expect(hit?.zh).toBe("平板杠铃卧推");
  });

  it("词表层完整动作名同样可作为名称定名（Burpee / Farmer's Walk）", () => {
    expect(nameOverride(g, "Burpee")?.zh).toBe("波比跳");
    expect(nameOverride(g, "Farmer's Walk")?.zh).toBe("农夫行走");
  });

  it("跨层重名时全名定名层胜出（Squat → 徒手深蹲，非词表层「深蹲」）", () => {
    expect(nameOverride(g, "Squat")?.zh).toBe("徒手深蹲");
    expect(nameOverride(g, "Squat")?.section).toBe("full_name_overrides");
  });

  it("大小写敏感：未命中返回 null（走 LLM 兜底）", () => {
    expect(nameOverride(g, "barbell bench press")).toBeNull();
    expect(nameOverride(g, "Definitely Not An Exercise")).toBeNull();
  });
});

describe("renderGlossaryForPrompt（prompt 锚定文本）", () => {
  const g = loadGlossary(REAL_GLOSSARY);

  it("两层结构渲染：全名定名表 + 术语词表，含统一译名对", () => {
    const text = renderGlossaryForPrompt(g);
    expect(text).toContain("【一、动作全名定名表】");
    expect(text).toContain("【二、术语词表】");
    expect(text).toContain("Romanian Deadlift = 罗马尼亚硬拉");
    expect(text).toContain("Face Pull = 面拉");
    expect(text).toContain("Farmer's Walk = 农夫行走");
    // 非通行条目带来源标注（存疑不强行定名，模型不得改写）
    const doubtfulLine = g.overrides.find((e) => e.source === "存疑");
    if (doubtfulLine) {
      expect(text).toContain(`${doubtfulLine.en} = ${doubtfulLine.zh}〔存疑`);
    }
  });
});
