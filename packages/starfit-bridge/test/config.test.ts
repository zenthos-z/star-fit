import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configFilePath,
  maskToken,
  readLocalConfig,
  resolveConfig,
  unsetConfigKey,
  writeConfigKey,
  DEFAULT_SERVER,
} from "../src/config.js";

function tempConfigPath(): string {
  return join(mkdtempSync(join(tmpdir(), "bridge-cfg-")), "config.json");
}

function withCleanEnv(run: () => void): void {
  const keys = [
    "STARFIT_BRIDGE_SERVER",
    "STARFIT_BRIDGE_TOKEN",
    "STARFIT_ACCESS_TOKEN",
    "STARFIT_BRIDGE_CONFIG_PATH",
    "XDG_CONFIG_HOME",
  ];
  const saved = new Map(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  try {
    run();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("config: 无文件无 env → 默认 server / 空 token", () => {
  withCleanEnv(() => {
    const path = tempConfigPath();
    const resolved = resolveConfig({}, path);
    assert.equal(resolved.server, DEFAULT_SERVER);
    assert.equal(resolved.serverSource, "default");
    assert.equal(resolved.token, "");
    assert.equal(resolved.tokenSource, "none");
  });
});

test("config: 文件读写往返（server+token）", () => {
  withCleanEnv(() => {
    const path = tempConfigPath();
    writeConfigKey("server", "http://192.168.1.5:43111", path);
    writeConfigKey("token", "secret-token-1234", path);
    const local = readLocalConfig(path);
    assert.equal(local.server, "http://192.168.1.5:43111");
    assert.equal(local.token, "secret-token-1234");
    const resolved = resolveConfig({}, path);
    assert.equal(resolved.serverSource, "file");
    assert.equal(resolved.tokenSource, "file");
    assert.equal(resolved.server, "http://192.168.1.5:43111");
  });
});

test("config: env 覆盖文件（STARFIT_BRIDGE_* 优先）", () => {
  withCleanEnv(() => {
    const path = tempConfigPath();
    writeConfigKey("server", "http://from-file:43111", path);
    writeConfigKey("token", "file-token", path);
    process.env["STARFIT_BRIDGE_SERVER"] = "http://from-env:43111";
    process.env["STARFIT_ACCESS_TOKEN"] = "fallback-token";
    let resolved = resolveConfig({}, path);
    assert.equal(resolved.server, "http://from-env:43111");
    assert.equal(resolved.serverSource, "env");
    assert.equal(resolved.token, "fallback-token");
    assert.equal(resolved.tokenSource, "env-fallback");

    process.env["STARFIT_BRIDGE_TOKEN"] = "dedicated-env-token";
    resolved = resolveConfig({}, path);
    assert.equal(resolved.token, "dedicated-env-token");
    assert.equal(resolved.tokenSource, "env");
  });
});

test("config: CLI flag 覆盖一切", () => {
  withCleanEnv(() => {
    const path = tempConfigPath();
    writeConfigKey("server", "http://from-file:43111", path);
    process.env["STARFIT_BRIDGE_SERVER"] = "http://from-env:43111";
    const resolved = resolveConfig(
      { server: "http://from-flag:43111", token: "flag-token" },
      path,
    );
    assert.equal(resolved.server, "http://from-flag:43111");
    assert.equal(resolved.serverSource, "flag");
    assert.equal(resolved.token, "flag-token");
    assert.equal(resolved.tokenSource, "flag");
  });
});

test("config: unset 置空且文件保留", () => {
  withCleanEnv(() => {
    const path = tempConfigPath();
    writeConfigKey("server", "http://x:43111", path);
    writeConfigKey("token", "t", path);
    const existed = unsetConfigKey("token", path);
    assert.equal(existed, true);
    const local = readLocalConfig(path);
    assert.equal(local.token, "");
    assert.equal(local.server, "http://x:43111");
    assert.equal(unsetConfigKey("token", join(path, "missing.json")), false);
  });
});

test("config: 损坏文件按空处理不抛", () => {
  withCleanEnv(() => {
    const dir = mkdtempSync(join(tmpdir(), "bridge-cfg-"));
    const path = join(dir, "config.json");
    writeFileSync(path, "{ not json !!");
    const local = readLocalConfig(path);
    assert.equal(local.server, DEFAULT_SERVER);
    assert.equal(local.token, "");
    // 写入会整体重建
    writeConfigKey("server", "http://rebuilt:43111", path);
    assert.equal(readLocalConfig(path).server, "http://rebuilt:43111");
    rmSync(dir, { recursive: true, force: true });
  });
});

test("config: STARFIT_BRIDGE_CONFIG_PATH 覆盖路径", () => {
  withCleanEnv(() => {
    const dir = mkdtempSync(join(tmpdir(), "bridge-cfg-"));
    const path = join(dir, "custom.json");
    process.env["STARFIT_BRIDGE_CONFIG_PATH"] = path;
    assert.equal(configFilePath(), path);
    rmSync(dir, { recursive: true, force: true });
  });
});

test("config: token 掩码", () => {
  assert.equal(maskToken(""), "(not set)");
  assert.equal(maskToken("short"), "****");
  assert.equal(maskToken("12345678"), "****");
  assert.equal(maskToken("abcd1234wxyz"), "abcd****wxyz");
});
