/**
 * 本地配置（bridge config 动词组的后端）。
 *
 * 双通道读取（issue #90 拍板：复用 STARFIT_ACCESS_TOKEN 同一 token 体系）：
 *   1. 环境变量：STARFIT_BRIDGE_SERVER / STARFIT_BRIDGE_TOKEN，
 *      token 另有 STARFIT_ACCESS_TOKEN 兜底（与 App/后端共用同一令牌名）。
 *   2. 配置文件：~/.config/starfit-bridge/config.json（受 XDG_CONFIG_HOME 尊重；
 *      STARFIT_BRIDGE_CONFIG_PATH 可整体改指 —— 测试用）。
 *
 * 优先级：CLI 显式 flag > env > 配置文件 > 默认值（server 默认本机 43111）。
 * token 属敏感值：文件权限 0600，展示一律掩码（output.ts maskToken）。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface BridgeConfig {
  /** 服务器基址，如 http://192.168.1.5:43111（带不带 /api 均可） */
  server: string;
  /** STARFIT_ACCESS_TOKEN 体系的令牌值；服务器未开鉴权时可空 */
  token: string;
}

export interface ResolvedConfig extends BridgeConfig {
  /** 配置文件实际路径（不存在时为将会创建的路径） */
  configPath: string;
  /** server 来源：flag | env | file | default */
  serverSource: "flag" | "env" | "file" | "default";
  /** token 来源：flag | env | env-fallback | file | none */
  tokenSource:
    | "flag"
    | "env"
    | "env-fallback"
    | "file"
    | "none";
}

export const DEFAULT_SERVER = "http://localhost:43111";

export function configFilePath(): string {
  const override = process.env["STARFIT_BRIDGE_CONFIG_PATH"];
  if (override && override.length > 0) return resolve(override);
  const xdg = process.env["XDG_CONFIG_HOME"];
  const base =
    xdg && xdg.length > 0 ? xdg : join(process.env["HOME"] ?? "~", ".config");
  return join(base, "starfit-bridge", "config.json");
}

interface ConfigFileShape {
  server?: unknown;
  token?: unknown;
}

function readConfigFile(path: string): ConfigFileShape {
  if (!existsSync(path)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {}; // 损坏的配置文件按空处理；写入时会整体重建
  }
  if (parsed === null || typeof parsed !== "object") return {};
  return parsed as ConfigFileShape;
}

export function readLocalConfig(path = configFilePath()): BridgeConfig {
  const raw = readConfigFile(path);
  return {
    server:
      typeof raw.server === "string" && raw.server.length > 0
        ? raw.server
        : DEFAULT_SERVER,
    token: typeof raw.token === "string" ? raw.token : "",
  };
}

/**
 * 合并三通道得到实际生效配置。
 * @param flagOverrides CLI 显式 --server/--token（可选）
 */
export function resolveConfig(
  flagOverrides: Partial<Pick<BridgeConfig, "server" | "token">> = {},
  path = configFilePath(),
): ResolvedConfig {
  const file = readLocalConfig(path);
  const envServer = process.env["STARFIT_BRIDGE_SERVER"];
  const envToken = process.env["STARFIT_BRIDGE_TOKEN"];
  const envFallbackToken = process.env["STARFIT_ACCESS_TOKEN"];

  let server = file.server;
  let serverSource: ResolvedConfig["serverSource"] = "default";
  if (typeof envServer === "string" && envServer.length > 0) {
    server = envServer;
    serverSource = "env";
  }
  if (file.server !== DEFAULT_SERVER && serverSource === "default") {
    serverSource = "file";
  }
  if (typeof flagOverrides.server === "string" && flagOverrides.server.length > 0) {
    server = flagOverrides.server;
    serverSource = "flag";
  }

  let token = "";
  let tokenSource: ResolvedConfig["tokenSource"] = "none";
  if (file.token.length > 0) {
    token = file.token;
    tokenSource = "file";
  }
  if (typeof envFallbackToken === "string" && envFallbackToken.length > 0) {
    token = envFallbackToken;
    tokenSource = "env-fallback";
  }
  if (typeof envToken === "string" && envToken.length > 0) {
    token = envToken;
    tokenSource = "env";
  }
  if (
    typeof flagOverrides.token === "string" &&
    flagOverrides.token.length > 0
  ) {
    token = flagOverrides.token;
    tokenSource = "flag";
  }

  return { server, token, configPath: path, serverSource, tokenSource };
}

/** 写单个键（bridge config set）。返回实际落盘路径。 */
export function writeConfigKey(
  key: "server" | "token",
  value: string,
  path = configFilePath(),
): string {
  const current = readLocalConfig(path);
  const next: BridgeConfig = { ...current, [key]: value };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  return path;
}

/** 删除单个键（bridge config unset）；文件不存在时为 no-op。 */
export function unsetConfigKey(
  key: "server" | "token",
  path = configFilePath(),
): boolean {
  if (!existsSync(path)) return false;
  const current = readLocalConfig(path);
  const next: BridgeConfig = { ...current, [key]: "" };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  return true;
}

/** token 展示掩码：保留首尾各 4 字符，中间以 **** 折叠；过短全掩。 */
export function maskToken(token: string): string {
  if (token.length === 0) return "(not set)";
  if (token.length <= 8) return "****";
  return `${token.slice(0, 4)}****${token.slice(-4)}`;
}
