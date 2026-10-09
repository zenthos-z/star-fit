import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { BRIDGE_VERSION } from "../src/version.js";

test("version: version.ts 与 package.json 一致（漂移守卫）", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  // dist-test/test/ → 包根两级之上；test/ 源跑时同目录
  const pkgPath = join(here, "..", "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    version: string;
    bin: Record<string, string>;
    engines: { node: string };
  };
  assert.equal(pkg.version, BRIDGE_VERSION);
  assert.equal(pkg.bin["bridge"], "dist/index.js");
  assert.ok(pkg.engines.node.startsWith(">=18"));
});

test("version: 零运行时依赖", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgPath = join(here, "..", "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    dependencies?: Record<string, string>;
  };
  assert.equal(pkg.dependencies, undefined);
});
