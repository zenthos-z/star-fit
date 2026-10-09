/**
 * 自研轻量参数解析（零重依赖红线：不引 commander）。
 *
 * 语法约定：
 *   bridge <noun> [<subnoun>] <positional>... [--flag value | --flag=value | --boolflag]...
 *
 * - `--flag value` 与 `--flag=value` 等价
 * - 重复出现的 flag 收集成数组（--field）
 * - `--` 之后全部按位置参数处理
 * - 单字母缩写：-h/--help、-V/--version、-j/--json
 */

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export interface ParsedArgs {
  /** 位置参数（含名词，如 ["profile", "get", "alice"]） */
  positionals: string[];
  /** 布尔 flag 集合 */
  flags: Set<string>;
  /** 带 value 的 flag（单值：最后一次出现生效；定义 repeated 的由调用方自行收集） */
  values: Map<string, string[]>;
}

const SHORT_TO_LONG: Record<string, string> = {
  "-h": "--help",
  "-V": "--version",
  "-j": "--json",
};

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Set<string>();
  const values = new Map<string, string[]>();

  let i = 0;
  let onlyPositional = false;
  while (i < argv.length) {
    const tok = argv[i]!;
    i += 1;

    if (onlyPositional) {
      positionals.push(tok);
      continue;
    }
    if (tok === "--") {
      onlyPositional = true;
      continue;
    }

    const normalized = SHORT_TO_LONG[tok] ?? tok;
    if (normalized.startsWith("--")) {
      const eq = normalized.indexOf("=");
      if (eq !== -1) {
        const name = normalized.slice(0, eq);
        const value = normalized.slice(eq + 1);
        if (value.length === 0) {
          throw new UsageError(`flag ${name} 需要非空值（--${name.slice(2)}=value）`);
        }
        push(values, name, value);
      } else if (VALUE_FLAGS.has(normalized)) {
        const value = argv[i];
        if (value === undefined) {
          throw new UsageError(`flag ${normalized} 缺少值（${normalized} <value>）`);
        }
        i += 1;
        push(values, normalized, value);
      } else {
        flags.add(normalized);
      }
    } else {
      positionals.push(tok);
    }
  }

  return { positionals, flags, values };
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key) ?? [];
  list.push(value);
  map.set(key, list);
}

/** 需要 value 的 flag 全集（其余 --xxx 一律视为布尔） */
const VALUE_FLAGS = new Set([
  "--limit",
  "--offset",
  "--field",
  "--id",
  "--date",
  "--from",
  "--to",
  "--server",
  "--token",
]);

export function lastValue(
  args: ParsedArgs,
  name: string,
): string | undefined {
  const list = args.values.get(name);
  return list === undefined || list.length === 0
    ? undefined
    : list[list.length - 1];
}

export function allValues(args: ParsedArgs, name: string): string[] {
  return args.values.get(name) ?? [];
}

export function intValue(
  args: ParsedArgs,
  name: string,
): number | undefined {
  const raw = lastValue(args, name);
  if (raw === undefined) return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new UsageError(`${name} 需要非负整数（当前: ${raw}）`);
  }
  return n;
}
