#!/usr/bin/env node
/**
 * bridge —— star-fit 数据桥 CLI（issue #90 P0 第一批）
 *
 * 用户运动数据与画像的全量开放对接工具：外部 Agent（Claude Code / 任意
 * Hermes / 自定义脚本）零门槛接入消费 star-fit 数据。
 *
 * 通道：现有 REST API（X-Access-Token = STARFIT_ACCESS_TOKEN 体系）。
 * 输出：人读表格（默认）/ --json 机器信封（schema_version 协商，数据原样透传）。
 *
 * 退出码：0 成功；1 运行错误；2 用法错误；3 功能未实现（如 data hr 占位）。
 */

import { parseArgs, lastValue, allValues, intValue, UsageError } from "./args.js";
import { BridgeClient, ApiError } from "./client.js";
import { resolveConfig, configFilePath } from "./config.js";
import { UsageLikeError } from "./commands.js";
import { UserResolutionError } from "./user.js";
import {
  cmdPing,
  cmdConfigGet,
  cmdConfigSet,
  cmdConfigUnset,
  cmdProfileGet,
  cmdProfileUpdate,
  cmdAppConfigGet,
  cmdAppConfigSet,
  cmdDataSessions,
  cmdDataPlans,
  cmdDataExercises,
  hrReservedPayload,
  emitResult,
  type CommandContext,
  type VerbResult,
} from "./commands.js";
import { BRIDGE_VERSION } from "./version.js";

const HELP = `bridge ${BRIDGE_VERSION} —— star-fit 数据桥（用户运动数据与画像的全量开放对接 CLI）

用法: bridge <命令组> <动词> [参数] [--json]

前置（首次）:
  bridge config set server http://<host>:43111
  bridge config set token <STARFIT_ACCESS_TOKEN>     # 服务器未开鉴权可跳过
  bridge ping                                        # 连接自检

命令组:
  ping                                  连接自检（GET /health）
  config get [server|token]             本地配置（env STARFIT_BRIDGE_* 可覆盖）
  config set <server|token> <value>     写本地配置文件
  config unset <server|token>           清除本地配置值
  app-config get [key]                  远端 app_configs 读（admin 命名空间）
  app-config set <key> <json|str>       远端 app_configs 写
  profile get <user>                    用户画像（<user> = display_name 或 UUID）
  profile update <user> --field <section.path=value>...
                                        画像字段更新（读-改-写，保住同段其余字段）
  data sessions <user> [--limit N] [--offset M]
                                        训练会话（raw_json 原样透传）
  data plans <user> [--date D | --from D --to D]
                                        计划（默认当前周；逐日行走 schedule/today）
  data exercises [--id <id>]            动作库（全量或单个）
  data hr <user>                        心率时序（占位，第二批实现）

通用 flag:
  --json          机器输出（信封 {schema_version, endpoint, data: 原样载荷}）
  --server <url>  一次性覆盖服务器地址（不落盘）
  --token <t>     一次性覆盖令牌（不落盘）
  -h/--help       本帮助；-V/--version 版本

<user> 解析: UUID 直接使用；display_name 经 GET /api/admin/users 精确匹配。
字段形状真源: shared/contracts/（CLI 不裁剪不映射，演进原则见 .claude/skills/bridge/SKILL.md）

退出码: 0 成功 | 1 运行错误 | 2 用法错误 | 3 未实现`;

function println(s: string): void {
  process.stdout.write(s + "\n");
}
function eprintln(s: string): void {
  process.stderr.write(s + "\n");
}

async function main(argv: string[]): Promise<number> {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    if (e instanceof UsageError) {
      eprintln(`用法错误: ${e.message}`);
      eprintln("bridge --help 查看用法");
      return 2;
    }
    throw e;
  }

  if (args.flags.has("--version")) {
    println(BRIDGE_VERSION);
    return 0;
  }

  const json = args.flags.has("--json");
  const wantsHelp = args.flags.has("--help");
  const pos = args.positionals;
  const noun = pos[0];

  if (wantsHelp || noun === undefined) {
    println(HELP);
    return wantsHelp ? 0 : 2;
  }

  // 本地配置动词组优先（无需服务器连接）
  if (noun === "config") {
    return await runLocalConfig(args, json, pos);
  }

  const resolved = resolveConfig({
    server: lastValue(args, "--server"),
    token: lastValue(args, "--token"),
  });
  const client = new BridgeClient(resolved.server, resolved.token);
  const ctx: CommandContext = { client, stdout: println, stderr: eprintln };

  try {
    let result: VerbResult;
    switch (noun) {
      case "ping": {
        if (pos.length > 1) throw new UsageError("ping 无额外参数");
        result = await cmdPing(ctx);
        break;
      }
      case "app-config":
      case "appconfig": {
        const verb = pos[1];
        if (verb === "get" || verb === undefined) {
          result = await cmdAppConfigGet(ctx, pos[2]);
        } else if (verb === "set") {
          if (pos[2] === undefined || pos[3] === undefined) {
            throw new UsageError("app-config set <key> <json|str>");
          }
          result = await cmdAppConfigSet(ctx, pos[2], pos.slice(3).join(" "));
        } else {
          throw new UsageError(`未知 app-config 动词 "${verb}"（get | set）`);
        }
        break;
      }
      case "profile": {
        const verb = pos[1];
        if (verb === "get") {
          if (pos[2] === undefined) throw new UsageError("profile get <user>");
          result = await cmdProfileGet(ctx, pos[2]);
        } else if (verb === "update") {
          if (pos[2] === undefined) throw new UsageError("profile update <user> --field ...");
          result = await cmdProfileUpdate(ctx, pos[2], allValues(args, "--field"));
        } else {
          throw new UsageError(`未知 profile 动词 "${verb ?? "(缺)"}"（get | update）`);
        }
        break;
      }
      case "data": {
        const verb = pos[1];
        if (verb === "sessions") {
          if (pos[2] === undefined) throw new UsageError("data sessions <user> [--limit N]");
          result = await cmdDataSessions(ctx, pos[2], intValue(args, "--limit"), intValue(args, "--offset"));
        } else if (verb === "plans") {
          if (pos[2] === undefined) {
            throw new UsageError("data plans <user> [--date D | --from D --to D]");
          }
          result = await cmdDataPlans(
            ctx,
            pos[2],
            lastValue(args, "--date"),
            lastValue(args, "--from"),
            lastValue(args, "--to"),
          );
        } else if (verb === "exercises") {
          result = await cmdDataExercises(ctx, lastValue(args, "--id"));
        } else if (verb === "hr") {
          if (pos[2] === undefined) throw new UsageError("data hr <user>");
          const reserved = hrReservedPayload(pos[2]);
          result = { endpoint: reserved.endpoint, data: reserved.data, human: reserved.human };
          emitResult(result, json, println);
          return 3;
        } else {
          throw new UsageError(
            `未知 data 动词 "${verb ?? "(缺)"}"（sessions | plans | exercises | hr）`,
          );
        }
        break;
      }
      default:
        eprintln(`未知命令 "${noun}"`);
        eprintln("bridge --help 查看用法");
        return 2;
    }
    emitResult(result, json, println);
    return 0;
  } catch (e) {
    return reportError(e, json);
  }
}

async function runLocalConfig(
  args: ReturnType<typeof parseArgs>,
  json: boolean,
  pos: string[],
): Promise<number> {
  const verb = pos[1];
  const ctx: CommandContext = { client: null as never, stdout: println, stderr: eprintln };
  try {
    let result: VerbResult;
    if (verb === "get" || verb === undefined) {
      result = await cmdConfigGet(ctx, pos[2]);
    } else if (verb === "set") {
      if (pos[2] === undefined || pos[3] === undefined) {
        throw new UsageError("config set <server|token> <value>");
      }
      result = await cmdConfigSet(ctx, pos[2], pos.slice(3).join(" "));
    } else if (verb === "unset") {
      if (pos[2] === undefined) throw new UsageError("config unset <server|token>");
      result = await cmdConfigUnset(ctx, pos[2]);
    } else if (verb === "path") {
      const p = configFilePath();
      result = { endpoint: "local:config", data: { config_file: p }, human: [p] };
    } else {
      throw new UsageError(`未知 config 动词 "${verb}"（get | set | unset | path）`);
    }
    emitResult(result, json, println);
    return 0;
  } catch (e) {
    return reportError(e, json);
  }
}

function reportError(e: unknown, json: boolean): number {
  if (e instanceof UsageError || e instanceof UsageLikeError) {
    if (json) {
      println(
        JSON.stringify(
          { ok: false, error: { kind: "usage", message: e.message } },
          null,
          2,
        ),
      );
    } else {
      eprintln(`用法错误: ${e.message}`);
      eprintln("bridge --help 查看用法");
    }
    return 2;
  }
  if (e instanceof UserResolutionError) {
    if (json) {
      println(
        JSON.stringify(
          { ok: false, error: { kind: "user_resolution", message: e.message } },
          null,
          2,
        ),
      );
    } else {
      eprintln(e.message);
    }
    return 1;
  }
  if (e instanceof ApiError) {
    if (json) {
      println(
        JSON.stringify(
          {
            ok: false,
            error: {
              kind: "api",
              status: e.status,
              endpoint: e.endpoint,
              message: e.message,
            },
          },
          null,
          2,
        ),
      );
    } else {
      eprintln(`请求失败: ${e.message}`);
      if (e.status === 401) {
        eprintln("鉴权失败：检查 bridge config set token（STARFIT_ACCESS_TOKEN 体系）");
      }
    }
    return 1;
  }
  const message = e instanceof Error ? e.message : String(e);
  if (json) {
    println(JSON.stringify({ ok: false, error: { kind: "internal", message } }, null, 2));
  } else {
    eprintln(`错误: ${message}`);
  }
  return 1;
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((e) => {
    process.exit(reportError(e, false));
  });
