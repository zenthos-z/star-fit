/**
 * 输出双模（issue #90 P0 第 6 项）：
 * - 人读表格（默认）
 * - --json（机器，外部 Agent 主用）
 *
 * 契约演进四原则落地（issue #90 评论 2026-10-09）：
 * 1. schema 版本协商：--json 模式包裹信封 {schema_version, ...}；信封内的
 *    data 字段 = 服务器响应原样引用，零裁剪零映射。
 * 2. 原始透传：机器通道 data 逐字透传；表格通道仅为显示截断（cell 截断不回写数据）。
 *
 * schema_version 语义（semver）：
 * - MAJOR：信封结构破坏性变更（消费端必须按版本分支）
 * - MINOR：信封新增可选字段
 * - PATCH：无语义变化
 */

import { BRIDGE_VERSION } from "./version.js";

export const SCHEMA_VERSION = "1.0.0";

export interface Envelope {
  schema_version: string;
  bridge_version: string;
  endpoint: string;
  generated_at: string;
  ok: boolean;
  data: unknown;
}

export function makeEnvelope(endpoint: string, data: unknown): Envelope {
  return {
    schema_version: SCHEMA_VERSION,
    bridge_version: BRIDGE_VERSION,
    endpoint,
    generated_at: new Date().toISOString(),
    ok: true,
    data,
  };
}

export interface RenderContext {
  json: boolean;
  stderr: (line: string) => void;
}

export function printJson(value: unknown, out: (s: string) => void): void {
  out(JSON.stringify(value, null, 2));
}

// ── 表格渲染（人读模式）────────────────────────────────────────────

export interface Column {
  header: string;
  width: number;
  /** cell 取值；undefined/空 显示 - */
  get: (row: unknown) => string;
}

const CELL_TRUNCATE = 48;

export function truncateCell(s: string, width: number): string {
  const max = Math.max(width, CELL_TRUNCATE);
  // CJK 宽字符按 2 列计的粗略近似：先按字符数截，显示端通常可容忍
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function renderTable(
  columns: Column[],
  rows: unknown[],
): string[] {
  const lines: string[] = [];
  const widths = columns.map((c) => Math.max(c.header.length, Math.min(c.width, CELL_TRUNCATE)));

  const headerCells = columns.map((c, i) => c.header.padEnd(widths[i]!));
  lines.push(headerCells.join("  "));
  lines.push(widths.map((w) => "-".repeat(w)).join("  "));

  for (const row of rows) {
    const cells = columns.map((c, i) =>
      truncateCell(c.get(row) || "-", widths[i]!).padEnd(widths[i]!),
    );
    lines.push(cells.join("  "));
  }
  if (rows.length === 0) {
    lines.push(`(0 行 — 无数据；--json 查看原始载荷)`);
  }
  return lines;
}

/** 任意 JSON 值 → 表格 cell 用的紧凑单行字符串 */
export function cellJson(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/** 键值分区渲染（画像等嵌套对象用）：每段一行 `key: 紧凑 JSON` */
export function renderSections(
  obj: Record<string, unknown>,
  skipKeys: string[] = [],
): string[] {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (skipKeys.includes(key)) continue;
    const s = cellJson(value);
    lines.push(`${key}: ${s === "" ? "-" : truncateCell(s, 10_000)}`);
  }
  return lines;
}

/** 安全深取（路径不存在返回 undefined，不抛错） */
export function deepGet(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of path.split(".")) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}
