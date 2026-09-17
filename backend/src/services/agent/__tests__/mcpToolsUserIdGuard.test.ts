/**
 * mcpTools userId UUID 校验（2026-09-17）：非 UUID 的 configurable.userId 必须在
 * 工具入口抛结构化错误，而不是流入 SQL 触发 `invalid input syntax for type uuid`
 * 的 PostgresClient 裸崩（实锤案例：测试脚本传 "survey-test-0917"）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getUserIdFromContext } from "../mcpTools.js";

const UUID = "15ba86ca-574c-42c1-b14a-eb4217d702c9";

test("getUserIdFromContext accepts a valid UUID from ALS context", () => {
  // ALS 不可用时（非 LangGraph 环境）走 explicitConfig 回退
  const uid = getUserIdFromContext({
    explicitConfig: { configurable: { userId: UUID } },
  });
  assert.equal(uid, UUID);
});

test("getUserIdFromContext rejects a non-UUID userId (survey-test case)", () => {
  assert.throws(
    () =>
      getUserIdFromContext({
        explicitConfig: { configurable: { userId: "survey-test-0917" } },
      }),
    /not a valid UUID/,
  );
});

test("getUserIdFromContext rejects non-UUID injected test principal", () => {
  assert.throws(
    () => getUserIdFromContext({ injectedUserId: "not-a-uuid" }),
    /not a valid UUID/,
  );
});
