/**
 * 单组记录契约（ExerciseAction.sets 元素）—— issue #97 感受采集契约批。
 *
 * 独立子模块原因：agent-delivery.ts（交付边界硬校验）与本 schema 双向依赖
 * （index.ts 聚合导出两者），下沉为兄弟模块避免 index ↔ delivery 循环求值
 * （沿用 weekly-plan / card-types 的兄弟导入模式）。
 *
 * #97 变更（口径真源：#88 v2 spec 三红线 · 分册5 §4.2/§4.5）：
 *   - `timestamp` optional → **required**：休息推断链与会话内动作顺序还原的地基。
 *     存量兼容唯一入口 = `normalizeSessionForAgentDelivery`（agent-delivery.ts）：
 *     无时间戳旧数据按 session.startTime + 组序推算填充（推算规则见该模块），
 *     禁绕过 normalize 直接 parse 存量原始数据。
 *   - 新增 `feel`：0-100 无级滑块原值（int，禁分档离散化）。
 *   - 新增 `feel_note`：语义文本补充 ≤500 字符（语音转写产物，原始音频不存）。
 *
 * 命名：数据库与应用层统一 snake_case（CLAUDE.md 红线；restEndTime 为既有
 * 存量字段名，保留原样禁破坏存量语义）。
 */

import { z } from 'zod';

export const ExerciseSetEntrySchema = z.object({
  index: z.number().int().min(0),
  reps: z.number().optional(),
  weight: z.number().optional(),
  duration: z.number().optional(),
  distance: z.number().optional(),
  rpe: z.number().min(0).max(10).optional(),
  status: z.enum(['unknown', 'planned', 'completed', 'skipped']).default('unknown'),
  /** 组完成时刻 ISO 8601 UTC（#97 必填化；存量推算规则见 agent-delivery.ts） */
  timestamp: z.string().datetime(),
  restEndTime: z.number().optional(),
  /** 感受滑块原值 0-100（无级连续值，禁分档；#97 分册5 §4.5） */
  feel: z.number().int().min(0).max(100).optional(),
  /** 感受语义补充（语音转写文本，≤500 字符；原始音频不存；#97） */
  feel_note: z.string().max(500).optional(),
});

export type ExerciseSetEntry = z.infer<typeof ExerciseSetEntrySchema>;
