/**
 * A15-1 管理台动作编辑（issue #15）单元测试
 *
 * 覆盖纯逻辑层（不触库）：
 *  - AdminExercisePatchSchema：白名单放行 / strict 拒未知字段（含任务书列了
 *    但库里无列的 description）/ 拒空对象 / 拒非法枚举与空 name
 *  - ExerciseSourceStatusInputSchema：字段枚举白名单
 *  - requireAdminAuth：默认拒绝（无 ADMIN_TOKEN）/ 错误令牌 401 / 正确令牌放行
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import {
  AdminExercisePatchSchema,
  ExerciseSourceStatusInputSchema,
  ADMIN_EDITABLE_EXERCISE_FIELDS,
} from "../../../shared/contracts/index";
import { requireAdminAuth } from "../../src/utils/adminAuth";

const validPatch = { name_zh: "杠铃卧推" };

describe("AdminExercisePatchSchema（A15-1 白名单）", () => {
  it("放行白名单内字段", () => {
    const r = AdminExercisePatchSchema.safeParse({
      name: "Barbell Bench Press",
      name_zh: "杠铃卧推",
      category: "strength",
      body_part: "chest",
      primary_muscles: ["chest", "triceps"],
      equipment: "barbell",
    });
    expect(r.success).toBe(true);
  });

  it("拒绝白名单外字段（description 库里无列，strict 拒绝不静默丢弃）", () => {
    const r = AdminExercisePatchSchema.safeParse({
      ...validPatch,
      description: "hello",
    });
    expect(r.success).toBe(false);
  });

  it("拒绝任意未知字段（如 modified_by——系统列不可经 API 改）", () => {
    const r = AdminExercisePatchSchema.safeParse({
      ...validPatch,
      modified_by: "system",
    });
    expect(r.success).toBe(false);
  });

  it("拒绝空对象（至少一个字段）", () => {
    expect(AdminExercisePatchSchema.safeParse({}).success).toBe(false);
  });

  it("拒绝空 name 与非法枚举", () => {
    expect(AdminExercisePatchSchema.safeParse({ name: "   " }).success).toBe(
      false,
    );
    expect(
      AdminExercisePatchSchema.safeParse({ equipment: "nonexistent" }).success,
    ).toBe(false);
    expect(
      AdminExercisePatchSchema.safeParse({ primary_muscles: ["chest_xx"] })
        .success,
    ).toBe(false);
    // primary_muscles 空数组拒绝（主肌群至少 1 项）
    expect(
      AdminExercisePatchSchema.safeParse({ primary_muscles: [] }).success,
    ).toBe(false);
  });

  it("白名单常量与任务书字段集一致（description 因无库列被剔除）", () => {
    expect([...ADMIN_EDITABLE_EXERCISE_FIELDS].sort()).toEqual(
      [
        "name",
        "name_zh",
        "category",
        "body_part",
        "primary_muscles",
        "equipment",
      ].sort(),
    );
  });
});

describe("ExerciseSourceStatusInputSchema", () => {
  it("放行白名单字段名", () => {
    expect(
      ExerciseSourceStatusInputSchema.safeParse({ field: "name_zh" }).success,
    ).toBe(true);
  });

  it("拒绝非白名单字段名与多余键", () => {
    expect(
      ExerciseSourceStatusInputSchema.safeParse({ field: "instructions" })
        .success,
    ).toBe(false);
    expect(
      ExerciseSourceStatusInputSchema.safeParse({
        field: "name_zh",
        extra: 1,
      }).success,
    ).toBe(false);
  });
});

describe("requireAdminAuth（最小 admin token 鉴权）", () => {
  const mkReq = (headers: Record<string, string | undefined>) =>
    ({
      headers,
      log: { warn: jest.fn() },
    }) as any;
  const mkReply = () => {
    const reply: any = jest.fn();
    reply.status = jest.fn(() => reply);
    reply.send = jest.fn(() => reply);
    return reply;
  };

  afterEach(() => {
    delete process.env.ADMIN_TOKEN;
  });

  it("未配置 ADMIN_TOKEN → 默认拒绝 401", async () => {
    delete process.env.ADMIN_TOKEN;
    const reply = mkReply();
    await requireAdminAuth(mkReq({ "x-admin-token": "anything" }), reply);
    expect(reply.status).toHaveBeenCalledWith(401);
  });

  it("令牌缺失或错误 → 401", async () => {
    process.env.ADMIN_TOKEN = "secret-token";
    for (const headers of [{}, { "x-admin-token": "wrong" }]) {
      const reply = mkReply();
      await requireAdminAuth(mkReq(headers), reply);
      expect(reply.status).toHaveBeenCalledWith(401);
    }
  });

  it("正确令牌 → 放行（不写响应）", async () => {
    process.env.ADMIN_TOKEN = "secret-token";
    const reply = mkReply();
    await requireAdminAuth(mkReq({ "x-admin-token": "secret-token" }), reply);
    expect(reply.status).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });
});
