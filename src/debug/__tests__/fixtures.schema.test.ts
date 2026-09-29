/**
 * T1 fixture 契约校验测试（issue #53）。
 *
 * 红线：「字段要过得了现有 Zod 校验」——不是前端自画像，而是直接拿后端
 * 校验回路（uiHintValidationLoop）消费的同一份 UIHintSchema（backend 源码
 * 单文件、纯 Zod、无 IO，可与前端共用同一 zod 4.x）逐一验证 fixture。
 * 后端契约改动导致 fixture 漂移时，本测试第一时间红。
 *
 * 执行卡走前端协议真源 ExerciseActionSchema（src/types/protocol.ts）。
 */
import { describe, it, expect } from 'vitest';
// 后端校验回路真源（zod 纯 schema 模块，root 与 backend 同用 zod 4.4.3）
import { UIHintSchema } from '../../../backend/src/services/agent/schemas/uiHintSchemas';
import { ExerciseActionSchema } from '../../types/protocol';
import { DEBUG_SCENARIOS, SSE_STREAMS } from '../fixtures';

const backendValidated = DEBUG_SCENARIOS.filter(s => s.backendValidated);
const frontendOnly = DEBUG_SCENARIOS.filter(s => s.group === 'chat-card-frontend-only');
const executionCards = DEBUG_SCENARIOS.filter(s => s.group === 'execution-card');

describe('T1 fixture 契约校验 · 对话卡片（backend UIHintSchema）', () => {
  it('后端卡型 7 类全覆盖（plan_card/weekly_plan/summary_card/survey_card/deviation_card/audit_complete/profile_update_confirm）', () => {
    const covered = new Set(backendValidated.map(s => (s.wireCard as { type: string }).type));
    expect(covered).toEqual(new Set([
      'plan_card',
      'weekly_plan',
      'summary_card',
      'survey_card',
      'deviation_card',
      'audit_complete',
      'profile_update_confirm',
    ]));
  });

  it.each(backendValidated.map(s => [s.id, s]))(
    '「%s」过 backend UIHintSchema 校验',
    (_id, scenario) => {
      const result = UIHintSchema.safeParse(scenario.wireCard);
      if (!result.success) {
        const detail = result.error.issues
          .map(i => `${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('\n  ');
        throw new Error(`fixture 未过后端校验回路：\n  ${detail}`);
      }
      expect(result.success).toBe(true);
    },
  );

  it('后端拉黑的 hitl_confirm 只出现在前端专属组（backendValidated=false）', () => {
    for (const s of frontendOnly) {
      expect(s.backendValidated).toBeFalsy();
    }
    const hitl = frontendOnly.find(s => (s.wireCard as { type: string }).type === 'hitl_confirm');
    expect(hitl).toBeDefined();
    // 且确实会被后端校验拒绝（黑名单/枚举外），证明分组标注是真的
    expect(UIHintSchema.safeParse(hitl!.wireCard).success).toBe(false);
  });
});

describe('T1 fixture 契约校验 · 执行卡片（ExerciseActionSchema）', () => {
  it('执行卡 4 类插件键全覆盖（resistance/hiit/isometric/gps）', () => {
    const keys = executionCards.map(
      s => (s.exercise as { uiHint?: { cardType?: string } }).uiHint?.cardType,
    );
    expect(new Set(keys)).toEqual(new Set([
      'resistance_standard',
      'hiit_timer',
      'isometric_static',
      'running_gps',
    ]));
  });

  it.each(executionCards.map(s => [s.id, s]))(
    '「%s」过 ExerciseActionSchema 校验',
    (_id, scenario) => {
      const result = ExerciseActionSchema.safeParse(scenario.exercise);
      if (!result.success) {
        const detail = result.error.issues
          .map(i => `${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('\n  ');
        throw new Error(`执行卡 fixture 未过协议校验：\n  ${detail}`);
      }
      expect(result.success).toBe(true);
    },
  );
});

describe('T1 fixture 契约校验 · SSE 回放样例', () => {
  it('5 条回放流齐备且均为非空 wire 文本', () => {
    expect(SSE_STREAMS.length).toBeGreaterThanOrEqual(5);
    for (const stream of SSE_STREAMS) {
      expect(stream.raw.length).toBeGreaterThan(0);
      expect(stream.raw).toContain('data:');
    }
  });

  it('保活样例真的带 `: ping` 注释帧；异常样例真的带未知帧/坏帧', () => {
    const keepalive = SSE_STREAMS.find(s => s.id === 'sse-keepalive-ping');
    expect(keepalive?.raw).toContain(': ping');
    const hostile = SSE_STREAMS.find(s => s.id === 'sse-hostile-frames');
    expect(hostile?.raw).toContain('experimental_frame');
    expect(hostile?.raw).toContain('[DONE]');
    const broken = SSE_STREAMS.find(s => s.id === 'sse-broken-stream');
    expect(broken?.raw).not.toContain('"type":"done"');
  });
});
