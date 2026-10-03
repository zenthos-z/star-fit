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
    ).toThrow("basic_info validation failed");
  });

  it("throws on non-array active_limitations", () => {
    expect(() =>
      UserProfileService.validateProfile({
        userId: UUID,
        modifiedBy: "user",
        active_limitations: { part: "腰部" } as never,
      } as never),
    ).toThrow("active_limitations validation failed");
  });

  it("throws on non-object load_anchors", () => {
    expect(() =>
      UserProfileService.validateProfile({
        userId: UUID,
        modifiedBy: "user",
        load_anchors: 42 as never,
      } as never),
    ).toThrow("load_anchors validation failed");
  });

  it("validates recovery_state against RecoveryStateSchema (total_score required)", () => {
    // 缺 total_score → 抛错
    expect(() =>
      UserProfileService.validateProfile({
        userId: UUID,
        modifiedBy: "user",
        recovery_state: { raw: { anything: true } } as never,
      } as never),
    ).toThrow("recovery_state validation failed");
    // 合法 recovery_state → 通过
    const ok = UserProfileService.validateProfile({
      userId: UUID,
      modifiedBy: "user",
      recovery_state: {
        total_score: 80,
        cns_fusing: false,
        last_assessed: "2026-09-22T00:00:00.000Z",
      },
    } as never);
    expect(ok.recovery_state).toMatchObject({ total_score: 80 });
  });
});

describe("shared/contracts BasicInfoSchema（契约层清洗：归一 + 枚举拦截）", () => {
  it("coerces numeric strings for body_fat (form 输入归一)", () => {
    const parsed = BasicInfoSchema.parse({
      age: "30",
      weight: "76",
      body_fat: "22.5",
    });
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

describe("#114 契约批 B5a — weekly_frequency_days 落库 + 伤病 note 通道", () => {
  it("weekly_frequency_days 过 preferences 白名单清洗并保留（落库链路通）", () => {
    const validated = UserProfileService.validateProfile({
      userId: UUID,
      modifiedBy: "user",
      preferences: {
        goal: "body_recomp",
        equipment: ["barbell"],
        weekly_frequency_days: 3,
      },
    } as never);
    expect(validated.preferences).toMatchObject({
      goal: "body_recomp",
      weekly_frequency_days: 3,
    });
  });

  it("weekly_frequency_days 表单字符串 coerce、区间字符串/越界抛错（不静默取下界）", () => {
    expect(
      UserProfileService.validateProfile({
        userId: UUID,
        modifiedBy: "user",
        preferences: { weekly_frequency_days: "4" },
      } as never).preferences,
    ).toMatchObject({ weekly_frequency_days: 4 });

    for (const bad of ["3-4", 0, 8]) {
      expect(() =>
        UserProfileService.validateProfile({
          userId: UUID,
          modifiedBy: "user",
          preferences: { weekly_frequency_days: bad },
        } as never),
      ).toThrow("preferences validation failed");
    }
  });

  it("伤病原文经 active_limitations[].note 过白名单（auto_heal:false 长期旧伤）", () => {
    const validated = UserProfileService.validateProfile({
      userId: UUID,
      modifiedBy: "mas",
      active_limitations: [
        {
          part: "left_knee",
          severity: 4,
          expire_at: "2999-12-31T00:00:00.000Z",
          logged_at: "2026-10-03T00:00:00.000Z",
          auto_heal: false,
          note: "半月板旧伤，下蹲深处有弹响",
        },
      ],
    } as never);
    expect(validated.active_limitations?.[0]).toMatchObject({
      auto_heal: false,
      note: "半月板旧伤，下蹲深处有弹响",
    });
  });

  it("旧 payload 无新字段仍通过（兼容断言：v1 画像零影响）", () => {
    const validated = UserProfileService.validateProfile({
      userId: UUID,
      modifiedBy: "user",
      basic_info: { age: 30, weight: 76 },
      preferences: { goal: "health", equipment: ["machine"] },
    } as never);
    expect(validated.preferences).toEqual({
      goal: "health",
      equipment: ["machine"],
    });
  });
});
