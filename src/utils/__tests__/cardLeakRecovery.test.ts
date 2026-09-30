/**
 * cardLeakRecovery 单测（issue #56）——「长思考后周计划气泡显示原始 JSON 串」
 * 前端兜底的行为契约。泄漏形态枚举自后端流层提取器（uiHintExtractor）的真实
 * 漏剥路径 + t10-sse-round1 真实采集的健康对照：
 *   A 围栏卡漏剥（token 里带 ```json 围栏的完整卡）→ Tier 1 复原成卡
 *   B 无围栏平衡卡（提取器无围栏兜底同样漏）→ Tier 1 复原成卡
 *   C 括号平衡但语法破损的卡（提取器「leave intact as prose」路径）→ Tier 2
 *     摘除 + 明确可读降级提示（红线：禁静默吞掉）
 *   D 非卡型 JSON / 普通散文 → 原文保留（禁过度容错）
 *   E 健康流（卡片走 uiHint 帧、正文无 JSON）→ 输出 = 输入（零扰动）
 */
import { describe, it, expect, vi } from 'vitest';
import {
  recoverLeakedCard,
  CARD_DEGRADED_NOTE,
} from '../cardLeakRecovery';
import type { UiHintCard } from 'shared/contracts';

// 冗余卡摘除路径会 console.info（透明度日志），测试静音
vi.spyOn(console, 'info').mockImplementation(() => {});

/** 与 shared/contracts/weekly-plan 契约同构的最小周计划卡载荷 */
const weeklyPlanData = {
  week_label: '第 1 周',
  split_summary: '全身×3 · 每周三练 · 新手起步',
  days: [
    {
      entry_date: '2026-09-30',
      split_label: '全身',
      focus: '胸肩三头',
      rest: false,
      exercises: [
        {
          exercise_id: 'V1StGXR8_Z5jdHi6',
          name: '杠铃卧推',
          sets: [{ set: 1, weight: 60, reps: 8 }],
        },
      ],
    },
    { entry_date: '2026-10-01', rest: true, exercises: [] },
  ],
};

describe('recoverLeakedCard · Tier 1 复原（卡型 JSON → 卡片）', () => {
  it('A1: 围栏 ```json 周计划卡漏剥 → 复原卡 + 正文清洗', () => {
    const cardJson = JSON.stringify({ type: 'weekly_plan', data: weeklyPlanData });
    const text = `好的，这是为你定制的第 1 周计划：\n\n\`\`\`json\n${cardJson}\n\`\`\`\n\n确认后我帮你启用。`;

    const r = recoverLeakedCard(text);

    expect(r.card).toBeDefined();
    expect(r.card!.type).toBe('weekly_plan');
    expect((r.card!.data as Record<string, unknown>).week_label).toBe('第 1 周');
    expect(r.degraded).toBe(false);
    expect(r.text).not.toContain('```');
    expect(r.text).not.toContain('week_label');
    expect(r.text).toContain('好的，这是为你定制的第 1 周计划');
    expect(r.text).toContain('确认后我帮你启用');
  });

  it('A2: 真实采集同构形态——长思考后卡片 JSON 泄漏在正文末尾（无闭合散文）', () => {
    const cardJson = JSON.stringify({
      type: 'weekly_plan',
      title: '第 1 周计划',
      data: weeklyPlanData,
    });
    const text = `计划来了：\n\n\`\`\`json\n${cardJson}`;

    const r = recoverLeakedCard(text);

    expect(r.card).toBeDefined();
    expect(r.card!.title).toBe('第 1 周计划');
    expect(r.text).toBe('计划来了：');
  });

  it('B1: 无围栏平衡周计划卡 → 复原', () => {
    const cardJson = JSON.stringify({ type: 'weekly_plan', data: weeklyPlanData });
    const text = `你的周计划如下：\n\n${cardJson}\n\n确认即可启用。`;

    const r = recoverLeakedCard(text);

    expect(r.card?.type).toBe('weekly_plan');
    expect(r.text).toContain('你的周计划如下');
    expect(r.text).toContain('确认即可启用');
    expect(r.text).not.toContain('week_label');
  });

  it('B2: 旧别名 type:"plan" 的数组卡 → 归一为 plan_card 并过形态闸', () => {
    const planData = [
      { exerciseId: 'bench_press', name: '杠铃卧推', sets: 4, reps: 8, weight: 60 },
    ];
    const cardJson = JSON.stringify({ type: 'plan', data: planData });
    const text = `今天的推日计划：\n\n\`\`\`json\n${cardJson}\n\`\`\``;

    const r = recoverLeakedCard(text);

    expect(r.card?.type).toBe('plan_card');
    expect(Array.isArray(r.card!.data)).toBe(true);
  });

  it('E: 健康流对照——正文无 JSON 时零扰动（prose 原样）', () => {
    const text = '首次训练重量是新手起步值（宁轻勿伤），练完把实际重量告诉我。';
    const r = recoverLeakedCard(text);
    expect(r.text).toBe(text);
    expect(r.card).toBeUndefined();
    expect(r.degraded).toBe(false);
  });

  it('D1: 非卡型 JSON（无 type 字段）→ 原文保留，不摘不改', () => {
    const text = '配置示例：{"weight": 60, "reps": 8}，按这个记录。';
    const r = recoverLeakedCard(text);
    expect(r.text).toBe(text);
    expect(r.degraded).toBe(false);
  });

  it('D2: 无卡型的 markdown 代码块 → 原文保留', () => {
    const text = '记录格式如下：\n\n```\n深蹲 5x5 @80kg\n```\n\n照这个练。';
    const r = recoverLeakedCard(text);
    expect(r.text).toBe(text);
    expect(r.card).toBeUndefined();
  });

  it('D3: 未知卡型 JSON（hitl_confirm 等不可渲染型）→ 原文保留', () => {
    const cardJson = JSON.stringify({ type: 'hitl_confirm', data: { foo: 1 } });
    const text = `示例：\n\n\`\`\`json\n${cardJson}\n\`\`\``;
    const r = recoverLeakedCard(text);
    expect(r.text).toBe(text);
    expect(r.card).toBeUndefined();
  });
});

describe('recoverLeakedCard · Tier 2 降级（破损卡 → 明确可读提示）', () => {
  it('C1: 括号平衡但语法破损（尾逗号）→ 摘除 + 降级提示，原始 JSON 不裸露', () => {
    // 尾逗号：JSON.parse 拒绝，但括号平衡——后端提取器「leave intact as
    // prose」的实锤泄漏形态
    const broken =
      '{"type":"weekly_plan","data":{"week_label":"第 1 周","split_summary":"全身",' +
      '"days":[{"entry_date":"2026-09-30","rest":false,"exercises":[]}],}}';
    const text = `这是你的计划：\n\n\`\`\`json\n${broken}\n\`\`\`\n\n确认后启用。`;

    const r = recoverLeakedCard(text);

    expect(r.card).toBeUndefined();
    expect(r.degraded).toBe(true);
    expect(r.text).not.toContain('week_label');
    expect(r.text).not.toContain('```');
    expect(r.text).toContain(CARD_DEGRADED_NOTE);
    expect(r.text).toContain('这是你的计划');
  });

  it('C2: 卡型正确但形态闸不过（weekly_plan 缺 days）→ 降级而非渲染破损卡', () => {
    const badShape = JSON.stringify({
      type: 'weekly_plan',
      data: { week_label: '第 1 周', split_summary: '缺 days' },
    });
    const text = `计划如下：\n\n${badShape}`;

    const r = recoverLeakedCard(text);

    expect(r.card).toBeUndefined();
    expect(r.degraded).toBe(true);
    expect(r.text).not.toContain('week_label');
    expect(r.text).toContain(CARD_DEGRADED_NOTE);
  });

  it('C3: 流中断的未闭合卡对象（花括号不平衡到文末）→ 摘除 + 降级', () => {
    const text = '计划来了：\n\n{"type":"weekly_plan","data":{"week_label":"第 1 周"';
    const r = recoverLeakedCard(text);
    expect(r.degraded).toBe(true);
    expect(r.text).not.toContain('week_label');
    expect(r.text).toContain('计划来了');
    expect(r.text).toContain(CARD_DEGRADED_NOTE);
  });

  it('降级提示明确可读：含警示与补救动作，非静默吞掉', () => {
    expect(CARD_DEGRADED_NOTE).toContain('⚠️');
    expect(CARD_DEGRADED_NOTE).toContain('重新生成');
  });
});

describe('recoverLeakedCard · 与 SSE 卡的协同', () => {
  it('SSE 已送达卡 + 正文泄漏同型卡 → 冗余载荷摘除，不产出第二张卡', () => {
    const sseCard: UiHintCard = {
      type: 'weekly_plan',
      data: weeklyPlanData as unknown as Record<string, unknown>,
      priority: 0,
    };
    const cardJson = JSON.stringify({ type: 'weekly_plan', data: weeklyPlanData });
    const text = `计划来了：\n\n\`\`\`json\n${cardJson}\n\`\`\``;

    const r = recoverLeakedCard(text, sseCard);

    expect(r.card).toBeUndefined(); // 不覆盖 SSE 卡
    expect(r.degraded).toBe(false);
    expect(r.text).toBe('计划来了：');
  });

  it('SSE 已送达卡 + 正文破损卡 → 冗余摘除但降级提示仍然给出（破损事实可见）', () => {
    const sseCard: UiHintCard = {
      type: 'weekly_plan',
      data: weeklyPlanData as unknown as Record<string, unknown>,
      priority: 0,
    };
    const broken = '{"type":"weekly_plan","data":{"week_label":"第 1 周"';
    const text = `计划来了：\n\n${broken}`;

    const r = recoverLeakedCard(text, sseCard);

    expect(r.card).toBeUndefined();
    expect(r.degraded).toBe(true);
    expect(r.text).toContain(CARD_DEGRADED_NOTE);
  });
});

describe('recoverLeakedCard · 边界', () => {
  it('空文本安全', () => {
    expect(recoverLeakedCard('')).toEqual({ text: '', degraded: false });
  });

  it('多卡泄漏：第一张复原，后续按冗余摘除', () => {
    const plan = [{ exerciseId: 'bench_press', name: '杠铃卧推' }];
    const c1 = JSON.stringify({ type: 'plan_card', data: plan });
    const c2 = JSON.stringify({ type: 'plan_card', data: plan });
    const text = `\`\`\`json\n${c1}\n\`\`\`\n\`\`\`json\n${c2}\n\`\`\``;

    const r = recoverLeakedCard(text);

    expect(r.card?.type).toBe('plan_card');
    expect(r.text.trim()).toBe('');
    expect(r.degraded).toBe(false);
  });

  it('正文里引号内花括号不干扰配平（字符串感知）', () => {
    const plan = [{ exerciseId: 'bench_press', name: '杠铃卧推' }];
    const cardJson = JSON.stringify({
      type: 'plan_card',
      data: plan,
      title: '推日 {"note": "花括号在字符串里"}',
    });
    const text = `计划：\n\n\`\`\`json\n${cardJson}\n\`\`\``;
    const r = recoverLeakedCard(text);
    expect(r.card?.title).toContain('花括号在字符串里');
    expect(r.text).toBe('计划：');
  });

  it('摘除后折叠多余空行，不残留大段空白', () => {
    const plan = [{ exerciseId: 'bench_press', name: '杠铃卧推' }];
    const cardJson = JSON.stringify({ type: 'plan_card', data: plan });
    const text = `第一段。\n\n\n\n\`\`\`json\n${cardJson}\n\`\`\`\n\n\n\n第二段。`;
    const r = recoverLeakedCard(text);
    expect(r.text).toBe('第一段。\n\n第二段。');
  });
});
