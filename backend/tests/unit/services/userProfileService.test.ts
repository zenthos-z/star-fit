/**
 * UserProfileService.validateProfile 清洗测试（批次3补充）。
 *
 * 如实断言当前实现：
 *  - 顶层未知键被丢弃（validated 只保留已知字段）
 *  - 非对象 basic_info / preferences / physiological / load_anchors / psychological 抛错
 *  - 非数组 active_limitations 抛错
 *  - recovery_state 任意动态状态透传
 *
 * body_fat 归一与非法枚举拦截实际发生在 shared/contracts 契约层
 * （BasicInfoSchema z.coerce.number + gender 枚举），本文件一并覆盖，
 * 并遵守 NA-003：类型/校验一律来自 shared/contracts。
 */
import { describe, it, expect, jest } from "@jest/globals";

jest.mock("../../../src/db/postgresql/client/postgres-client.js", () => ({
  getPostgresClient: jest.fn(() => ({
    query: jest.fn(),
    queryOne: jest.fn(),
    queryMany: jest.fn(),
    transaction: jest.fn(),
  })),
}));

import { UserProfileService } from "../../../src/services/userProfileService.js";
import { BasicInfoSchema, PreferencesSchema } from "shared/contracts";

const UUID = "15ba86ca-574c-42c1-b14a-eb4217d702c9";

describe("UserProfileService.validateProfile", () => {
  it("drops unknown top-level keys (whitelist copy)", () => {
    const validated = UserProfileService.validateProfile({
      userId: UUID,
      modifiedBy: "user",
      basic_info: { age: 30, weight: 76 },
      injected_prompt: "rm -rf /", // 未知键
      extra: 123, // 未知键
    } as never);

    expect(validated).toHaveProperty("basic_info");
    expect(validated).not.toHaveProperty("injected_prompt");
    expect(validated).not.toHaveProperty("extra");
  });

  it("throws on non-object basic_info", () => {
    expect(() =>
      UserProfileService.validateProfile({
        userId: UUID,
        modifiedBy: "user",
        basic_info: "not-an-object" as never,
      } as never),
    ).toThrow("basic_info must be an object");
  });

  it("throws on non-array active_limitations", () => {
    expect(() =>
      UserProfileService.validateProfile({
        userId: UUID,
        modifiedBy: "user",
        active_limitations: { part: "腰部" } as never,
      } as never),
    ).toThrow("active_limitations must be an array");
  });

  it("throws on non-object load_anchors", () => {
    expect(() =>
      UserProfileService.validateProfile({
        userId: UUID,
        modifiedBy: "user",
        load_anchors: 42 as never,
      } as never),
    ).toThrow("load_anchors must be an object");
  });

  it("passes through recovery_state regardless of shape (dynamic state)", () => {
    const validated = UserProfileService.validateProfile({
      userId: UUID,
      modifiedBy: "user",
      recovery_state: { total_score: 80, raw: { anything: true } },
    } as never);
    expect(validated.recovery_state).toEqual({ total_score: 80, raw: { anything: true } });
  });
});

describe("shared/contracts BasicInfoSchema（契约层清洗：归一 + 枚举拦截）", () => {
  it("coerces numeric strings for body_fat (form 输入归一)", () => {
    const parsed = BasicInfoSchema.parse({ age: "30", weight: "76", body_fat: "22.5" });
    expect(parsed.body_fat).toBe(22.5);
    expect(parsed.age).toBe(30);
  });

  it("strips unknown nested keys from basic_info", () => {
    const parsed = BasicInfoSchema.parse({
      age: 30,
      weight: 76,
      malware: "nope", // 未知键 → 剥离
    });
    expect(parsed).not.toHaveProperty("malware");
  });

  it("rejects illegal gender enum value", () => {
    expect(() => BasicInfoSchema.parse({ gender: "alien" })).toThrow();
  });

  it("preferences goal enum rejects unknown goal", () => {
    expect(() => PreferencesSchema.parse({ goal: "become_a_bear" })).toThrow();
  });
});
