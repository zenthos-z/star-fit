import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeEnvelope,
  renderTable,
  renderSections,
  truncateCell,
  deepGet,
  SCHEMA_VERSION,
} from "../src/output.js";
import { BRIDGE_VERSION } from "../src/version.js";

test("envelope: 信封字段齐备且 data 引用原样（透传不复制不裁剪）", () => {
  const payload = {
    rows: [
      { id: "s1", raw_json: { sets: [{ weight: 60, reps: 8 }] }, nested: { deep: [1, 2, 3] } },
    ],
    extra: null,
  };
  const env = makeEnvelope("GET /api/x", payload);
  assert.equal(env.schema_version, SCHEMA_VERSION);
  assert.equal(env.bridge_version, BRIDGE_VERSION);
  assert.equal(env.ok, true);
  assert.equal(env.endpoint, "GET /api/x");
  assert.ok(typeof env.generated_at === "string");
  // data 是同一引用：透传零拷贝零映射
  assert.equal(env.data, payload);
  assert.deepEqual(Object.keys(env.data as object), ["rows", "extra"]);
});

test("envelope: schema_version 语义已定案为 semver 字符串", () => {
  assert.match(SCHEMA_VERSION, /^\d+\.\d+\.\d+$/);
});

test("table: 渲染含表头与数据行，空数据显示 0 行提示", () => {
  const lines = renderTable(
    [
      { header: "id", width: 8, get: (r: unknown) => String((r as { id?: string }).id ?? "") },
      { header: "name", width: 8, get: (r: unknown) => String((r as { name?: string }).name ?? "") },
    ],
    [
      { id: "abc", name: "深蹲" },
      { id: "def", name: undefined },
    ],
  );
  assert.equal(lines.length, 4);
  assert.match(lines[0]!, /id\s+name/);
  assert.match(lines[2]!, /abc\s+深蹲/);
  assert.match(lines[3]!, /def\s+-/);

  const empty = renderTable(
    [{ header: "id", width: 8, get: () => "" }],
    [],
  );
  assert.match(empty[empty.length - 1]!, /0 行/);
});

test("table: 长 cell 截断带省略号（仅显示层，数据不动）", () => {
  const long = "x".repeat(200);
  const truncated = truncateCell(long, 48);
  assert.ok(truncated.length < long.length);
  assert.ok(truncated.endsWith("…"));
  assert.equal(long.length, 200); // 原值未被修改
});

test("sections: 嵌套对象逐键紧凑渲染", () => {
  const lines = renderSections({
    basic_info: { age: 30, weight: 75 },
    empty: null,
  });
  assert.equal(lines.length, 2);
  assert.match(lines[0]!, /^basic_info: \{"age":30/);
  assert.match(lines[1]!, /^empty: -$/);
});

test("deepGet: 安全深取", () => {
  const obj = { a: { b: { c: 5 } }, arr: [1, 2] };
  assert.equal(deepGet(obj, "a.b.c"), 5);
  assert.equal(deepGet(obj, "a.x.y"), undefined);
  assert.equal(deepGet(null, "a"), undefined);
  assert.equal(deepGet("str", "a"), undefined);
  assert.deepEqual(deepGet(obj, "arr"), [1, 2]);
});
