// 共享日志标签契约（Logging Contracts）
//
// ⚠️ 临时占位实现（2026-07-11）：cb69a6b 在 contracts/index.ts 引入了这些符号的
// re-export，但 logging/index.ts 源文件从未提交（gap from baseline）。这些符号
// 目前仅由 index.ts re-export，无实际消费者。这里用宽松占位（z.string）让
// import 解析通过、backend 能启动（live 验证用）。正式「日志标签体系」实现待补
// 。
//
// TODO: 按 cb69a6b「日志标签体系」设计补全 schema enum 值 + formatLogTag/parseLogTag
// 真实语义 + ALL_MAS_TAGS/LOG_TAG_CATEGORY 真实常量。

import { z } from "zod";

// Schemas（宽松占位，避免 enum 值不匹配导致解析失败）
export const MASLogTagSchema = z.string();
export const ServiceLogTagSchema = z.string();
export const AgentLogTagSchema = z.string();
export const InfrastructureLogTagSchema = z.string();

// Types
export type MASLogTag = string;
export type ServiceLogTag = string;
export type AgentLogTag = string;
export type InfrastructureLogTag = string;
export type LogTagCategory = string;

// Constants（占位）
export const ALL_MAS_TAGS: readonly string[] = [];
export const LOG_TAG_CATEGORY: Record<string, LogTagCategory> = {};

// Functions（占位：原样透传）
export function formatLogTag(tag: string): string {
  return tag;
}

export function parseLogTag(raw: string): string {
  return raw;
}
