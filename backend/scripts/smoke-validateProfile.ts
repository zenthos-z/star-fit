/**
 * 快速冒烟：UserProfileService.validateProfile 的 Zod 白名单清洗
 *
 * 验证（清理批次2 验收项）：
 * 1. basic_info 传未知键 + body_fat_percentage → 未知键被丢弃、body_fat 归一生效
 * 2. 枚举校验失败（gender: 'alien'）→ 抛 ValidationError（controller 层转 400）
 * 3. preferences 未知键被丢弃
 * 4. active_limitations 带空串 expire_at/logged_at（admin 控制台占位）→ 仍通过
 * 5. psychological 枚举非法 → 抛 ValidationError
 *
 * 运行：cd backend && npx tsx scripts/smoke-validateProfile.ts
 */
import assert from "node:assert";
import { UserProfileService } from "../src/services/userProfileService.js";
import { ValidationError } from "../src/utils/errorHandler.js";

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}

// 1. 未知键丢弃 + body_fat 归一
check("basic_info 未知键丢弃 + body_fat_percentage 归一生效", () => {
  const out = UserProfileService.validateProfile({
    userId: "00000000-0000-4000-8000-000000000001",
    modifiedBy: "admin",
    basic_info: {
      age: 30,
      weight: 72,
      evil_unknown_key: "should-drop",
      body_fat_percentage: 18.5,
    } as any,
  });
  const bi = out.basic_info as Record<string, unknown>;
  assert.ok(bi, "basic_info 应存在");
  assert.strictEqual(bi.age, 30);
  assert.strictEqual(bi.weight, 72);
  assert.strictEqual(bi.body_fat, 18.5, "body_fat_percentage 应并入 body_fat");
  assert.ok(
    !("body_fat_percentage" in bi),
    "body_fat_percentage 旧键应被删除（归一）",
  );
  assert.ok(
    !("evil_unknown_key" in bi),
    "未知键应被丢弃",
  );
});

// 2. 枚举校验失败抛错
check("basic_info 枚举校验失败（gender: alien）抛 ValidationError", () => {
  let threw: unknown = null;
  try {
    UserProfileService.validateProfile({
      userId: "00000000-0000-4000-8000-000000000001",
      modifiedBy: "admin",
      basic_info: { gender: "alien" } as any,
    });
  } catch (e) {
    threw = e;
  }
  assert.ok(threw instanceof ValidationError, `应抛 ValidationError，实际: ${String(threw)}`);
  assert.match((threw as Error).message, /gender/, "错误信息应带字段路径");
});

// 3. preferences 未知键丢弃
check("preferences 未知键丢弃", () => {
  const out = UserProfileService.validateProfile({
    userId: "00000000-0000-4000-8000-000000000001",
    modifiedBy: "admin",
    preferences: {
      goal: "fat_loss",
      junk: 123,
    } as any,
  });
  const prefs = out.preferences as Record<string, unknown>;
  assert.strictEqual(prefs.goal, "fat_loss");
  assert.ok(!("junk" in prefs), "preferences 未知键应被丢弃");
});

// 4. active_limitations 空串占位仍通过（admin 控制台 handleLimitationAdd 兼容）
check("active_limitations 空串 expire_at/logged_at 仍通过", () => {
  const out = UserProfileService.validateProfile({
    userId: "00000000-0000-4000-8000-000000000001",
    modifiedBy: "admin",
    active_limitations: [
      {
        part: "right_wrist",
        severity: 3,
        expire_at: "",
        logged_at: "",
        auto_heal: true,
        junk_key: "x",
      } as any,
    ],
  });
  const limits = out.active_limitations as Array<Record<string, unknown>>;
  assert.strictEqual(limits.length, 1);
  assert.strictEqual(limits[0].part, "right_wrist");
  assert.strictEqual(limits[0].severity, 3);
  assert.ok(!("junk_key" in limits[0]), "限制元素未知键应被丢弃");
});

// 4b. severity 越界抛错
check("active_limitations severity 越界抛 ValidationError", () => {
  let threw: unknown = null;
  try {
    UserProfileService.validateProfile({
      userId: "00000000-0000-4000-8000-000000000001",
      modifiedBy: "admin",
      active_limitations: [
        { part: "knee", severity: 99, expire_at: "", logged_at: "" },
      ],
    });
  } catch (e) {
    threw = e;
  }
  assert.ok(threw instanceof ValidationError, "severity 越界应抛 ValidationError");
});

// 5. psychological 枚举非法抛错
check("psychological 枚举非法抛 ValidationError", () => {
  let threw: unknown = null;
  try {
    UserProfileService.validateProfile({
      userId: "00000000-0000-4000-8000-000000000001",
      modifiedBy: "admin",
      psychological: { accountability: "sometimes" } as any,
    });
  } catch (e) {
    threw = e;
  }
  assert.ok(threw instanceof ValidationError, "非法枚举应抛 ValidationError");
});

console.log(`\n冒烟结果: ${passed} 通过, ${failed} 失败`);
if (failed > 0) {
  process.exit(1);
}
