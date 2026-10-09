import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseArgs,
  lastValue,
  allValues,
  intValue,
  UsageError,
} from "../src/args.js";

test("args: 位置参数 + 布尔 flag", () => {
  const a = parseArgs(["profile", "get", "alice", "--json"]);
  assert.deepEqual(a.positionals, ["profile", "get", "alice"]);
  assert.equal(a.flags.has("--json"), true);
  assert.equal(lastValue(a, "--limit"), undefined);
});

test("args: --flag value 与 --flag=value 等价", () => {
  const a1 = parseArgs(["data", "sessions", "u", "--limit", "5"]);
  const a2 = parseArgs(["data", "sessions", "u", "--limit=5"]);
  assert.deepEqual(a1.values.get("--limit"), ["5"]);
  assert.deepEqual(a2.values.get("--limit"), ["5"]);
});

test("args: 重复 flag 收集数组", () => {
  const a = parseArgs([
    "profile",
    "update",
    "u",
    "--field",
    "basic_info.weight=75",
    "--field",
    "psychological.risk_preference=moderate",
  ]);
  assert.deepEqual(allValues(a, "--field"), [
    "basic_info.weight=75",
    "psychological.risk_preference=moderate",
  ]);
});

test("args: 缺值的 value flag 报用法错误", () => {
  assert.throws(() => parseArgs(["data", "sessions", "u", "--limit"]), UsageError);
  assert.throws(() => parseArgs(["x", "--field"]), UsageError);
});

test("args: 空值 = 报用法错误", () => {
  assert.throws(() => parseArgs(["x", "--limit="]), UsageError);
});

test("args: -- 之后全部按位置参数（防 token 以 - 开头被吃）", () => {
  const a = parseArgs(["config", "set", "token", "--", "--weird-token--"]);
  assert.deepEqual(a.positionals, [
    "config",
    "set",
    "token",
    "--weird-token--",
  ]);
});

test("args: 单字母缩写归一", () => {
  assert.equal(parseArgs(["-h"]).flags.has("--help"), true);
  assert.equal(parseArgs(["-V"]).flags.has("--version"), true);
  assert.equal(parseArgs(["ping", "-j"]).flags.has("--json"), true);
});

test("args: intValue 解析与拒绝", () => {
  assert.equal(intValue(parseArgs(["--limit", "5"]), "--limit"), 5);
  assert.equal(intValue(parseArgs([]), "--limit"), undefined);
  assert.throws(() => intValue(parseArgs(["--limit", "abc"]), "--limit"), UsageError);
  assert.throws(() => intValue(parseArgs(["--limit", "-3"]), "--limit"), UsageError);
});

test("args: lastValue 取最后一次", () => {
  const a = parseArgs(["--server", "a", "--server", "b"]);
  assert.equal(lastValue(a, "--server"), "b");
});
