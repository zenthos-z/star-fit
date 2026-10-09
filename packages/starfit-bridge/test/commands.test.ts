import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BridgeClient } from "../src/client.js";
import {
  resolveUser,
  isUuid,
  UserResolutionError,
} from "../src/user.js";
import {
  parseFieldSpec,
  deepSet,
  expandDateRange,
  mondayOfCurrentWeekUtc,
  cmdProfileUpdate,
  cmdProfileGet,
  UsageLikeError,
} from "../src/commands.js";

function makeCtx(
  handler: (url: string, init?: RequestInit) => { status: number; body: string },
): {
  calls: { url: string; init?: RequestInit }[];
  ctx: { client: BridgeClient; stdout: () => void; stderr: () => void };
} {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const { status, body } = handler(String(url), init);
    return new Response(body, {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return {
    calls,
    ctx: {
      client: new BridgeClient("http://h:1", "t", impl),
      stdout: () => {},
      stderr: () => {},
    },
  };
}

const UUID_A = "11111111-1111-1111-1111-111111111111";
const UUID_B = "22222222-2222-2222-2222-222222222222";

const USERS_BODY = JSON.stringify([
  {
    id: UUID_A,
    device_id: "alice",
    display_name: "alice",
    created_at: "2026-01-01",
    session_count: 3,
  },
  {
    id: UUID_B,
    device_id: "bob",
    display_name: "bob",
    created_at: "2026-02-01",
    session_count: 1,
  },
]);

// ── user 解析 ────────────────────────────────────────────────────

test("user: UUID 直接透传（小写归一，不发请求）", async () => {
  const { calls, ctx } = makeCtx(() => ({ status: 200, body: USERS_BODY }));
  const r = await resolveUser(ctx.client, UUID_A.toUpperCase());
  assert.equal(r.userId, UUID_A);
  assert.equal(calls.length, 0);
});

test("user: display_name 精确匹配解析为 UUID", async () => {
  const { ctx } = makeCtx(() => ({ status: 200, body: USERS_BODY }));
  const r = await resolveUser(ctx.client, "alice");
  assert.equal(r.userId, UUID_A);
  assert.equal(r.displayName, "alice");
});

test("user: 未命中报错并列出候选", async () => {
  const { ctx } = makeCtx(() => ({ status: 200, body: USERS_BODY }));
  await assert.rejects(
    () => resolveUser(ctx.client, "carol"),
    (e: unknown) => {
      assert.ok(e instanceof UserResolutionError);
      assert.match(e.message, /未找到用户 "carol"/);
      assert.match(e.message, /alice/);
      assert.match(e.message, /bob/);
      assert.equal(e.candidates.length, 2);
      return true;
    },
  );
});

test("user: 同名歧义报错并要求改用 UUID", async () => {
  const dup = JSON.stringify([
    { id: UUID_A, device_id: "a", display_name: "same", created_at: "2026-01-01", session_count: 0 },
    { id: UUID_B, device_id: "b", display_name: "same", created_at: "2026-02-01", session_count: 0 },
  ]);
  const { ctx } = makeCtx(() => ({ status: 200, body: dup }));
  await assert.rejects(
    () => resolveUser(ctx.client, "same"),
    (e: unknown) => {
      assert.ok(e instanceof UserResolutionError);
      assert.match(e.message, /命中 2 个账号/);
      assert.match(e.message, new RegExp(UUID_A));
      return true;
    },
  );
});

test("user: isUuid", () => {
  assert.equal(isUuid(UUID_A), true);
  assert.equal(isUuid("alice"), false);
  assert.equal(isUuid("11111111-1111-1111-1111-11111111111"), false);
});

// ── profile update 读-改-写 ──────────────────────────────────────

test("profile update: --field 单字段更新保住同段其余字段（读-改-写）", async () => {
  const profileBefore = {
    user_id: UUID_A,
    basic_info: { age: 30, weight: 75, height: 180, gender: "male" },
    preferences: { goal: "muscle_gain", weekly_frequency_days: 4 },
    modified_by: "admin",
  };
  const profileAfter = {
    ...profileBefore,
    basic_info: { ...profileBefore.basic_info, weight: 80 },
  };
  const { calls, ctx } = makeCtx((url, init) => {
    if (url.endsWith(`/profiles/${UUID_A}`) && init?.method === "PUT") {
      return { status: 200, body: '{"success":true}' };
    }
    if (url.endsWith(`/profiles/${UUID_A}`)) {
      // 两次 GET：更新前 / 更新后 —— 用 PUT 次数区分
      const putCount = calls.filter(
        (c) => c.url.endsWith("/profile/static") && c.init?.method === "PUT",
      ).length;
      return {
        status: 200,
        body: JSON.stringify(putCount === 0 ? profileBefore : profileAfter),
      };
    }
    if (url.endsWith("/profile/static") && init?.method === "PUT") {
      return { status: 200, body: '{"success":true,"message":"Profile static updated"}' };
    }
    if (url.endsWith("/admin/users")) return { status: 200, body: USERS_BODY };
    return { status: 404, body: '{"error":"nope"}' };
  });

  const result = await cmdProfileUpdate(ctx, "alice", [
    "basic_info.weight=80",
  ]);

  // PUT static 的 body 必须是完整 basic_info 段（含未动的 age/height/gender）
  const put = calls.find(
    (c) => c.url.endsWith("/profile/static") && c.init?.method === "PUT",
  )!;
  assert.deepEqual(JSON.parse(String(put.init?.body)), {
    basic_info: { age: 30, weight: 80, height: 180, gender: "male" },
  });
  // 输出 = 回读的全量画像
  assert.deepEqual(result.data, profileAfter);
});

test("profile update: 动态段走 /profile/dynamic 端点", async () => {
  const profileBefore = {
    user_id: UUID_A,
    basic_info: {},
    load_anchors: { "ex-1": { weight: 60 } },
  };
  const { calls, ctx } = makeCtx((url, init) => {
    if (url.endsWith(`/admin/users/${UUID_A}/profile/dynamic`) && init?.method === "PUT") {
      return { status: 200, body: '{"success":true}' };
    }
    if (url.endsWith("/profile/static") && init?.method === "PUT") {
      return { status: 200, body: '{"success":true}' };
    }
    if (url.endsWith(`/profiles/${UUID_A}`)) {
      return { status: 200, body: JSON.stringify(profileBefore) };
    }
    if (url.endsWith("/admin/users")) return { status: 200, body: USERS_BODY };
    return { status: 404, body: '{"error":"nope"}' };
  });

  await cmdProfileUpdate(ctx, "alice", [
    'load_anchors={"ex-2":{"weight":40}}',
  ]);

  const putDyn = calls.find(
    (c) => c.url.endsWith("/profile/dynamic") && c.init?.method === "PUT",
  )!;
  assert.deepEqual(JSON.parse(String(putDyn.init?.body)), {
    load_anchors: { "ex-2": { weight: 40 } },
  });
  assert.equal(
    calls.some((c) => c.url.endsWith("/profile/static")),
    false,
  );
});

test("profile update: 未知段/坏格式报用法错误", async () => {
  const { ctx } = makeCtx(() => ({ status: 200, body: USERS_BODY }));
  await assert.rejects(
    () => cmdProfileUpdate(ctx, "alice", ["nonsense_section.x=1"]),
    UsageLikeError,
  );
  await assert.rejects(
    () => cmdProfileUpdate(ctx, "alice", ["basic_info.weight"]),
    UsageLikeError,
  );
  await assert.rejects(
    () => cmdProfileUpdate(ctx, "alice", []),
    UsageLikeError,
  );
});

test("profile update: 值按 JSON 解析（数字/字符串/布尔/对象）", () => {
  assert.deepEqual(parseFieldSpec("basic_info.weight=75"), {
    section: "basic_info",
    path: ["weight"],
    value: 75,
  });
  assert.deepEqual(parseFieldSpec("preferences.goal=muscle_gain"), {
    section: "preferences",
    path: ["goal"],
    value: "muscle_gain",
  });
  assert.deepEqual(parseFieldSpec("basic_info.gender=male"), {
    section: "basic_info",
    path: ["gender"],
    value: "male",
  });
  assert.deepEqual(parseFieldSpec('preferences={"goal":"fat_loss"}'), {
    section: "preferences",
    path: [],
    value: { goal: "fat_loss" },
  });
});

test("deepSet: 深路径创建不破坏兄弟节点", () => {
  const obj: Record<string, unknown> = { a: { keep: 1 } };
  deepSet(obj, ["b", "c", "d"], 5);
  assert.deepEqual(obj, { a: { keep: 1 }, b: { c: { d: 5 } } });
});

// ── profile get ─────────────────────────────────────────────────

test("profile get: 解析用户后取画像，人读输出含分段", async () => {
  const profile = {
    user_id: UUID_A,
    basic_info: { age: 30 },
    load_anchors: {},
  };
  const { ctx } = makeCtx((url) => {
    if (url.endsWith("/admin/users")) return { status: 200, body: USERS_BODY };
    if (url.endsWith(`/profiles/${UUID_A}`)) {
      return { status: 200, body: JSON.stringify(profile) };
    }
    return { status: 404, body: '{"error":"nope"}' };
  });
  const result = await cmdProfileGet(ctx, "alice");
  assert.deepEqual(result.data, profile);
  assert.ok(result.human.some((l) => l.startsWith("user_id:")));
  assert.ok(result.human.some((l) => l.startsWith("basic_info:")));
});

// ── plans 日期区间 ───────────────────────────────────────────────

test("plans: --date 单日；--from/--to 含首尾；互斥校验", () => {
  assert.deepEqual(expandDateRange("2026-10-05", undefined, undefined), [
    "2026-10-05",
  ]);
  assert.deepEqual(
    expandDateRange(undefined, "2026-10-05", "2026-10-07"),
    ["2026-10-05", "2026-10-06", "2026-10-07"],
  );
  assert.throws(
    () => expandDateRange("2026-10-05", "2026-10-05", undefined),
    UsageLikeError,
  );
  assert.throws(
    () => expandDateRange(undefined, "2026-10-07", "2026-10-05"),
    UsageLikeError,
  );
  assert.throws(
    () => expandDateRange("2026/10/05", undefined, undefined),
    UsageLikeError,
  );
  assert.throws(
    () => expandDateRange(undefined, "2026-01-01", undefined),
    UsageLikeError,
  );
});

test("plans: 默认当前周（周一 7 天）", () => {
  const days = expandDateRange(undefined, undefined, undefined);
  assert.equal(days.length, 7);
  const monday = mondayOfCurrentWeekUtc();
  assert.equal(days[0], monday);
  assert.equal(days[6], addDaysIso(monday, 6));
  // 周一锚点：与 1970-01-05（首个 ISO 周一）同余
  assert.equal(
    Date.parse(`${monday}T00:00:00Z`) % (7 * 86400_000),
    Date.parse("1970-01-05T00:00:00Z") % (7 * 86400_000),
  );
});

test("plans: 区间上限守卫", () => {
  assert.throws(
    () => expandDateRange(undefined, "2026-01-01", "2026-12-31"),
    UsageLikeError,
  );
});

function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
