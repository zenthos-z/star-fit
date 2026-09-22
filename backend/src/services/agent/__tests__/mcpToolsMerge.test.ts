/**
 * mcpTools UserScopedWriteRepository.mergeProfileDynamic 测试（批次3补充）。
 *
 * 参考 mcpToolsUserIdGuard.test.ts 风格（node:test，随 agent __tests__ 由
 * `npx tsx --test src/services/agent/__tests__/*.test.ts` 运行）。
 *
 * 验证 mergeProfileDynamic 走 BaseRepository.execute → client.query：
 *  - SQL 必须是 COALESCE('{}') || $updates::jsonb 浅合并模式
 *   （GOLD UserRepository 的 jsonb_set(target, $updates::jsonb) 双参调用
 *   在 PG 上运行时崩 `function jsonb_set(jsonb, jsonb) does not exist`，
 *   这正是 UserScopedWriteRepository 独立存在的原因）
 *  - updates 参数必须被 JSON.stringify 序列化
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { UserScopedWriteRepository } from "../mcpTools.js";

const UUID = "15ba86ca-574c-42c1-b14a-eb4217d702c9";

function makeFakeClient() {
  const calls: { sql: string; params: Record<string, unknown> }[] = [];
  const client = {
    query: async (sql: string, params: Record<string, unknown>) => {
      calls.push({ sql, params });
      return { rowCount: 1, rows: [] };
    },
  };
  return { client, calls };
}

test("mergeProfileDynamic issues COALESCE || jsonb shallow-merge with stringified updates", async () => {
  const { client, calls } = makeFakeClient();
  const repo = new UserScopedWriteRepository(client as never);

  const data = { memories: [{ text: "昨天练腿状态不错" }], load_anchors: { squat: { best_weight: 100 } } };
  await repo.mergeProfileDynamic(UUID, data);

  assert.equal(calls.length, 1);
  assert.match(
    calls[0].sql,
    /profile_dynamic = COALESCE\(profile_dynamic, '\{\}'::jsonb\) \|\| \$updates::jsonb/,
  );
  assert.match(calls[0].sql, /WHERE id = \$userId/);
  assert.equal(calls[0].params.userId, UUID);
  assert.equal(calls[0].params.updates, JSON.stringify(data));
  assert.match(calls[0].sql, /updated_at = NOW\(\)/);
});

test("mergeProfileDynamic rejects the GOLD jsonb_set(target, $updates::jsonb) shape", async () => {
  // 防御性断言：如果未来有人改回 jsonb_set 双参调用（PG 运行时崩溃），
  // 该 SQL 不再匹配 COALESCE || 模式 → 本测试立即红灯提示。
  const { client, calls } = makeFakeClient();
  const repo = new UserScopedWriteRepository(client as never);

  await repo.mergeProfileDynamic(UUID, { recovery_state: { total_score: 80 } });

  assert.equal(calls.length, 1);
  assert.ok(
    !/jsonb_set\(/.test(calls[0].sql),
    `sql should not use the broken jsonb_set(target, updates) form: ${calls[0].sql}`,
  );
});

test("mergeProfileDynamic propagates execute rowCount failure as rejection", async () => {
  const client = {
    query: async () => {
      throw new Error("connection refused");
    },
  };
  const repo = new UserScopedWriteRepository(client as never);

  await assert.rejects(
    () => repo.mergeProfileDynamic(UUID, { memories: [] }),
    /connection refused/,
  );
});
