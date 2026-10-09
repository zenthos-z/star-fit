/**
 * 动词实现（P0 第一批：骨架 + 画像/配置/数据三大动词组）。
 *
 * 端点映射（全部为现有 REST API，零后端改动）：
 * - ping            → GET  /health（根级，免鉴权）
 * - profile get     → GET  /api/profiles/:userId（原始分段画像，透传真源；
 *                     /admin/users/:id/profile 是拍平 V2 投影，不用于读）
 * - profile update  → GET /api/profiles/:userId → PUT /api/admin/users/:id/profile/{static,dynamic}
 *                     → GET /api/profiles/:userId
 *                     （读-改-写：后端按「整段替换」合并 JSONB，CLI 必须先取全量
 *                      段对象再回写，否则 --field 单字段更新会抹掉同段其余字段）
 * - app-config get  → GET  /api/admin/configs[/:key]
 * - app-config set  → POST /api/admin/configs {key, value}
 * - data sessions   → GET  /api/admin/users/:id/sessions?limit=&offset=
 * - data plans      → GET  /api/schedule/today?date= 逐日行走（X-User-Id 头；
 *                     现无整周/全量计划列表端点 —— 端点能力缺口，已列 PR 待裁决项）
 * - data exercises  → GET  /api/exercises[/:id]
 * - data hr         → 占位（第二批实现；时序量级设计待定）
 */

import type { BridgeClient } from "./client.js";
import {
  maskToken,
  resolveConfig,
  unsetConfigKey,
  writeConfigKey,
  configFilePath,
} from "./config.js";
import {
  cellJson,
  deepGet,
  makeEnvelope,
  renderSections,
  renderTable,
  truncateCell,
  type Column,
} from "./output.js";
import { resolveUser } from "./user.js";

export interface CommandContext {
  client: BridgeClient;
  /** 人读行输出（--json 模式下仍用于少量诊断行？否：机器模式保持纯 JSON，诊断走 stderr） */
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

export interface VerbResult {
  /** --json 模式的信封 data（服务器原样载荷） */
  data: unknown;
  /** 人读模式行集 */
  human: string[];
  /** 信封 endpoint 标识 */
  endpoint: string;
}

// ── ping ─────────────────────────────────────────────────────────

export async function cmdPing(ctx: CommandContext): Promise<VerbResult> {
  const started = Date.now();
  const health = await ctx.client.root("/health");
  const latency = Date.now() - started;
  const h = asRecord(health);
  return {
    endpoint: "GET /health",
    data: health,
    human: [
      `server : ${ctx.client.rootUrl("")}`,
      `ok     : ${String(deepGet(h, "ok") ?? "?")}`,
      `app    : ${String(deepGet(h, "app") ?? "?")}`,
      `version: ${String(deepGet(h, "version") ?? "?")}`,
      `latency: ${latency} ms`,
    ],
  };
}

// ── 本地 config（bridge 自身配置；远端 app_configs 见 app-config 动词组）──

export async function cmdConfigGet(
  ctx: CommandContext,
  key?: string,
): Promise<VerbResult> {
  const resolved = resolveConfig();
  const view = {
    server: resolved.server,
    token: maskToken(resolved.token),
    server_source: resolved.serverSource,
    token_source: resolved.tokenSource,
    config_file: resolved.configPath,
  };
  let shown: Record<string, unknown>;
  if (key === undefined) {
    shown = view;
  } else if (key in view) {
    shown = { [key]: view[key as keyof typeof view] };
  } else {
    throw new UsageLikeError(`未知 config 键 "${key}"（可用: server, token）`);
  }
  return {
    endpoint: "local:config",
    data: shown,
    human: Object.entries(shown).map(([k, v]) => `${k.padEnd(14)}: ${String(v)}`),
  };
}

export async function cmdConfigSet(
  ctx: CommandContext,
  key: string,
  value: string,
): Promise<VerbResult> {
  if (key !== "server" && key !== "token") {
    throw new UsageLikeError(
      `config set 只接受 server | token（当前: ${key}）`,
    );
  }
  const path = writeConfigKey(key, value);
  return {
    endpoint: "local:config",
    data: { key, written: true, config_file: path },
    human: [
      `已写入 ${key} → ${path}`,
      key === "token" ? `token: ${maskToken(value)}` : `server: ${value}`,
    ],
  };
}

export async function cmdConfigUnset(
  ctx: CommandContext,
  key: string,
): Promise<VerbResult> {
  if (key !== "server" && key !== "token") {
    throw new UsageLikeError(
      `config unset 只接受 server | token（当前: ${key}）`,
    );
  }
  const existed = unsetConfigKey(key);
  return {
    endpoint: "local:config",
    data: { key, removed: existed, config_file: configFilePath() },
    human: [
      existed
        ? `已清除 ${key}（文件保留，值置空）→ ${configFilePath()}`
        : `配置文件不存在，无操作 → ${configFilePath()}`,
    ],
  };
}

// ── profile ──────────────────────────────────────────────────────

export async function cmdProfileGet(
  ctx: CommandContext,
  userArg: string,
): Promise<VerbResult> {
  const { userId } = await resolveUser(ctx.client, userArg);
  const profile = await ctx.client.api(`/profiles/${userId}`);
  const p = asRecord(profile);
  const human: string[] = [`user_id: ${userId}`];
  human.push(...renderSections(p));
  return { endpoint: `GET /api/profiles/:userId`, data: profile, human };
}

const STATIC_SECTIONS = new Set([
  "basic_info",
  "preferences",
  "physiological",
  "psychological",
]);
const DYNAMIC_SECTIONS = new Set([
  "load_anchors",
  "active_limitations",
  "recovery_state",
]);

export class UsageLikeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageLikeError";
  }
}

export interface FieldSpec {
  section: string;
  /** 段内路径（可空 = 整段赋值）；空数组表示段根 */
  path: string[];
  /** 已解析的值（JSON 或原始字符串） */
  value: unknown;
}

/** 解析 --field section.path=value；value 按 JSON 解析，失败回退原始字符串 */
export function parseFieldSpec(raw: string): FieldSpec {
  const eq = raw.indexOf("=");
  if (eq <= 0) {
    throw new UsageLikeError(
      `--field 格式: section.path=value（当前: "${raw}"）`,
    );
  }
  const lhs = raw.slice(0, eq);
  const valueRaw = raw.slice(eq + 1);
  const segs = lhs.split(".");
  const section = segs[0]!;
  if (segs.some((s) => s.length === 0)) {
    throw new UsageLikeError(`--field 路径不能有空段（当前: "${raw}"）`);
  }
  let value: unknown;
  try {
    value = JSON.parse(valueRaw) as unknown;
  } catch {
    value = valueRaw;
  }
  return { section, path: segs.slice(1), value };
}

/** 深度写入（只创建经过的对象节点，不改动无关键） */
export function deepSet(
  target: Record<string, unknown>,
  path: string[],
  value: unknown,
): void {
  if (path.length === 0) {
    throw new UsageLikeError("--field 段根赋值需要 JSON 对象");
  }
  let cur: Record<string, unknown> = target;
  for (let i = 0; i < path.length - 1; i += 1) {
    const seg = path[i]!;
    const next = cur[seg];
    if (next === null || next === undefined || typeof next !== "object" || Array.isArray(next)) {
      const fresh: Record<string, unknown> = {};
      cur[seg] = fresh;
      cur = fresh;
    } else {
      cur = next as Record<string, unknown>;
    }
  }
  cur[path[path.length - 1]!] = value;
}

export async function cmdProfileUpdate(
  ctx: CommandContext,
  userArg: string,
  fieldSpecs: string[],
): Promise<VerbResult> {
  if (fieldSpecs.length === 0) {
    throw new UsageLikeError(
      "profile update 至少需要一个 --field section.path=value",
    );
  }
  const specs = fieldSpecs.map(parseFieldSpec);
  for (const spec of specs) {
    if (!STATIC_SECTIONS.has(spec.section) && !DYNAMIC_SECTIONS.has(spec.section)) {
      throw new UsageLikeError(
        `未知画像段 "${spec.section}"（静态段: ${[...STATIC_SECTIONS].join(", ")}；动态段: ${[...DYNAMIC_SECTIONS].join(", ")}）`,
      );
    }
  }

  const { userId } = await resolveUser(ctx.client, userArg);

  // 读-改-写：基底取 /api/profiles/:userId 的原始分段（/admin/users/:id/profile
  // 是拍平的 V2 投影视图，缺 basic_info.preferences 等段，不能当合并基底）
  const current = asRecord(
    await ctx.client.api(`/profiles/${userId}`),
  );

  const staticBody: Record<string, unknown> = {};
  const dynamicBody: Record<string, unknown> = {};
  for (const spec of specs) {
    const bucket = STATIC_SECTIONS.has(spec.section) ? staticBody : dynamicBody;
    if (spec.path.length === 0) {
      // 整段赋值（值须为对象）
      if (spec.value === null || typeof spec.value !== "object" || Array.isArray(spec.value)) {
        throw new UsageLikeError(
          `--field ${spec.section}=<json> 需要 JSON 对象（整段赋值）`,
        );
      }
      bucket[spec.section] = spec.value;
    } else {
      const base = asRecord(current[spec.section] ?? {});
      const sectionObj: Record<string, unknown> = bucket[spec.section] !== undefined
        ? asRecord(bucket[spec.section])
        : { ...base };
      deepSet(sectionObj, spec.path, spec.value);
      bucket[spec.section] = sectionObj;
    }
  }

  if (Object.keys(staticBody).length > 0) {
    await ctx.client.api(`/admin/users/${userId}/profile/static`, {
      method: "PUT",
      body: staticBody,
    });
  }
  if (Object.keys(dynamicBody).length > 0) {
    await ctx.client.api(`/admin/users/${userId}/profile/dynamic`, {
      method: "PUT",
      body: dynamicBody,
    });
  }

  // 回读全量画像作为输出（透传）
  const updated = await ctx.client.api(`/profiles/${userId}`);
  const human = [
    `已更新 ${specs.map((s) => `${s.section}.${s.path.join(".")}`).join(", ")}`,
    "",
    ...renderSections(asRecord(updated)),
  ];
  return {
    endpoint: `PUT /api/admin/users/:id/profile/{static,dynamic} + GET /api/profiles/:userId`,
    data: updated,
    human,
  };
}

// ── app-config（远端 app_configs，user_id="admin" 命名空间）─────────

export async function cmdAppConfigGet(
  ctx: CommandContext,
  key?: string,
): Promise<VerbResult> {
  if (key === undefined) {
    const all = await ctx.client.api("/admin/configs");
    const rec = asRecord(all);
    const human = Object.entries(rec).map(
      ([k, v]) => `${k.padEnd(28)}: ${truncateCell(cellJson(v), 80)}`,
    );
    return { endpoint: "GET /api/admin/configs", data: all, human };
  }
  const one = await ctx.client.api(`/admin/configs/${encodeURIComponent(key)}`);
  const human = [`key        : ${String(deepGet(asRecord(one), "key") ?? key)}`];
  human.push(`value      : ${truncateCell(cellJson(deepGet(asRecord(one), "value")), 80)}`);
  human.push(`updated_at : ${String(deepGet(asRecord(one), "updated_at") ?? "-")}`);
  return { endpoint: "GET /api/admin/configs/:key", data: one, human };
}

export async function cmdAppConfigSet(
  ctx: CommandContext,
  key: string,
  valueRaw: string,
): Promise<VerbResult> {
  let value: unknown;
  try {
    value = JSON.parse(valueRaw) as unknown;
  } catch {
    value = valueRaw; // 标量字符串原样入库
  }
  const result = await ctx.client.api("/admin/configs", {
    method: "POST",
    body: { key, value },
  });
  return {
    endpoint: "POST /api/admin/configs",
    data: result,
    human: [
      `已写入 app_config "${key}"`,
      `value: ${truncateCell(cellJson(value), 80)}`,
    ],
  };
}

// ── data ─────────────────────────────────────────────────────────

export async function cmdDataSessions(
  ctx: CommandContext,
  userArg: string,
  limit?: number,
  offset?: number,
): Promise<VerbResult> {
  const { userId } = await resolveUser(ctx.client, userArg);
  const params = new URLSearchParams();
  if (limit !== undefined) params.set("limit", String(limit));
  if (offset !== undefined) params.set("offset", String(offset));
  const qs = params.toString().length > 0 ? `?${params.toString()}` : "";
  const sessions = await ctx.client.api(
    `/admin/users/${userId}/sessions${qs}`,
  );
  const rows = Array.isArray(sessions) ? sessions : [];
  const columns: Column[] = [
    { header: "id", width: 12, get: (r) => String(deepGet(r, "id") ?? "") },
    { header: "start_time", width: 24, get: (r) => String(deepGet(r, "start_time") ?? "") },
    { header: "duration_s", width: 10, get: (r) => String(deepGet(r, "duration") ?? "") },
    { header: "title", width: 22, get: (r) => String(deepGet(r, "title") ?? "") },
    {
      header: "raw_json",
      width: 48,
      get: (r) => truncateCell(cellJson(deepGet(r, "raw_json")), 48),
    },
  ];
  return {
    endpoint: `GET /api/admin/users/:id/sessions${qs}`,
    data: sessions,
    human: [`共 ${rows.length} 条会话`, ...renderTable(columns, rows)],
  };
}

export async function cmdDataExercises(
  ctx: CommandContext,
  id?: string,
): Promise<VerbResult> {
  if (id !== undefined) {
    const one = await ctx.client.api(`/exercises/${encodeURIComponent(id)}`);
    const human = renderSections(asRecord(one));
    return { endpoint: "GET /api/exercises/:id", data: one, human };
  }
  const all = await ctx.client.api("/exercises");
  const rows = Array.isArray(all) ? all : [];
  const columns: Column[] = [
    { header: "id", width: 12, get: (r) => String(deepGet(r, "id") ?? "") },
    { header: "name", width: 26, get: (r) => String(deepGet(r, "name") ?? "") },
    { header: "name_zh", width: 16, get: (r) => String(deepGet(r, "name_zh") ?? "") },
    { header: "type", width: 12, get: (r) => String(deepGet(r, "exercise_type") ?? "") },
    { header: "difficulty", width: 11, get: (r) => String(deepGet(r, "difficulty") ?? "") },
    { header: "equipment", width: 12, get: (r) => String(deepGet(r, "equipment") ?? "") },
  ];
  return {
    endpoint: "GET /api/exercises",
    data: all,
    human: [`共 ${rows.length} 个动作`, ...renderTable(columns, rows)],
  };
}

// data plans：日期区间行走 GET /api/schedule/today（现有 API 无整周列表端点）

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function assertIsoDate(s: string, flagName: string): string {
  if (!DATE_RE.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) {
    throw new UsageLikeError(`${flagName} 需要 YYYY-MM-DD（当前: ${s}）`);
  }
  return s;
}

function isoDateOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDateOf(d);
}

/** 当前 ISO 周的周一（UTC；与后端 getIsoWeekId 周四规则同源的周锚点） */
export function mondayOfCurrentWeekUtc(): string {
  const now = new Date();
  const today = isoDateOf(now);
  const dow = now.getUTCDay(); // 0=Sun
  const back = (dow + 6) % 7;
  return back === 0 ? today : addDays(today, -back);
}

export function expandDateRange(
  date: string | undefined,
  from: string | undefined,
  to: string | undefined,
  maxDays = 92,
): string[] {
  if (date !== undefined) {
    if (from !== undefined || to !== undefined) {
      throw new UsageLikeError("--date 与 --from/--to 互斥");
    }
    return [assertIsoDate(date, "--date")];
  }
  const fromNorm =
    from !== undefined
      ? assertIsoDate(from, "--from")
      : mondayOfCurrentWeekUtc();
  if (from !== undefined && to === undefined) {
    throw new UsageLikeError("--from 需要配对 --to（单日请用 --date）");
  }
  const toNorm = to !== undefined ? assertIsoDate(to, "--to") : addDays(fromNorm, 6);
  if (toNorm < fromNorm) {
    throw new UsageLikeError(`--to(${toNorm}) 早于 --from(${fromNorm})`);
  }
  const days: string[] = [];
  let cur = fromNorm;
  while (cur <= toNorm) {
    days.push(cur);
    cur = addDays(cur, 1);
    if (days.length > maxDays) {
      throw new UsageLikeError(`日期区间超过 ${maxDays} 天上限`);
    }
  }
  return days;
}

export async function cmdDataPlans(
  ctx: CommandContext,
  userArg: string,
  date: string | undefined,
  from: string | undefined,
  to: string | undefined,
): Promise<VerbResult> {
  const { userId } = await resolveUser(ctx.client, userArg);
  const days = expandDateRange(date, from, to);
  const dayResults: unknown[] = [];
  for (const d of days) {
    const one = await ctx.client.api(`/schedule/today?date=${d}`, {
      headers: { "X-User-Id": encodeURIComponent(userId) },
    });
    dayResults.push(one);
  }
  const columns: Column[] = [
    { header: "date", width: 10, get: (r) => String(deepGet(r, "date") ?? "") },
    { header: "week_id", width: 10, get: (r) => String(deepGet(r, "week_id") ?? "") },
    { header: "status", width: 9, get: (r) => String(deepGet(r, "status") ?? "") },
    { header: "split", width: 14, get: (r) => String(deepGet(r, "split") ?? "") },
    {
      header: "entries",
      width: 6,
      get: (r) => String(
        Array.isArray(deepGet(r, "entries")) ? (deepGet(r, "entries") as unknown[]).length : 0,
      ),
    },
  ];
  return {
    endpoint: `GET /api/schedule/today?date= ×${days.length}`,
    data: dayResults,
    human: [
      `user_id: ${userId}，${days[0]} ~ ${days[days.length - 1]}（${days.length} 天）`,
      ...renderTable(columns, dayResults),
    ],
  };
}

export function hrReservedPayload(userArg: string): {
  endpoint: string;
  data: unknown;
  human: string[];
} {
  return {
    endpoint: "reserved:heart_rate_samples",
    data: {
      channel: "heart_rate_samples",
      status: "reserved",
      user: userArg,
      message:
        "心率时序导出通道为第二批交付（量级与降采样设计待定，见 issue #90 评论 Q6）；本批仅留接口占位。",
    },
    human: [
      "data hr：心率时序独立导出通道（占位）",
      "状态: reserved —— 第二批实现（schema/降采样设计见 issue #90）",
      "--json 可取得结构化占位载荷。",
    ],
  };
}

// ── helpers ──────────────────────────────────────────────────────

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/** 统一出口：按模式渲染 VerbResult */
export function emitResult(
  result: VerbResult,
  json: boolean,
  stdout: (s: string) => void,
): void {
  if (json) {
    stdout(JSON.stringify(makeEnvelope(result.endpoint, result.data), null, 2));
  } else {
    for (const line of result.human) stdout(line);
  }
}
