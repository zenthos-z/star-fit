/**
 * T1 SSE 回放样例（issue #53）——后端 /api/chat text/event-stream 的真实 wire 形态
 * 原始字节流（含 `: ping` 保活注释帧），供 SSE 调试台离线回放。
 *
 * 形态真源：
 *  - backend/src/sse/agentSse.ts（sseEncode：`data: <AgentEvent-json>\n\n`；
 *    PING_FRAME：`: ping\n\n`，15s 一帧）
 *  - shared/contracts AgentEventSchema（token/thinking/uiHint/done/error）
 *
 * 回放走与实况同一个解析-记录管线（src/debug/sse/recorder.ts），
 * 所以这里也是「解析器对未知帧/坏帧容错（禁炸）」的确定性回归样例。
 */
import type { SseStreamFixture } from './types';

/** 迷你 plan_card（回放流里的 uiHint 载荷，真实线上帧同构） */
const MINI_PLAN = JSON.stringify({
  type: 'plan_card',
  data: [
    { exerciseId: 'bench_press', name: '杠铃卧推', exercise_type: 'resistance', sets: 4, reps: 8, weight: 60 },
    { exerciseId: 'plank', name: '平板支撑', exercise_type: 'isometric', sets: 3, reps: 1, duration: 60 },
  ],
});

export const SSE_STREAM_FIXTURES: SseStreamFixture[] = [
  {
    id: 'sse-happy-path',
    label: '正常一轮：思考 → 逐字 → 卡片 → done',
    description: 'thinking + token 流 + uiHint(plan_card) + done 的完整健康回合',
    raw: [
      'data: {"type":"thinking","text":"用户要练胸，先查库……第一版卡片里 isometric 缺 duration，重发。"}\n\n',
      'data: {"type":"token","text":"今天"}\n\n',
      'data: {"type":"token","text":"安排"}\n\n',
      'data: {"type":"token","text":"推日："}\n\n',
      `data: {"type":"uiHint","card":${MINI_PLAN}}\n\n`,
      'data: {"type":"token","text":"计划已生成，确认后加入今天的主页。"}\n\n',
      'data: {"type":"done"}\n\n',
    ].join(''),
  },
  {
    id: 'sse-keepalive-ping',
    label: '保活帧穿插（: ping）',
    description: '后端每 15s 一帧 : ping 注释——对事件解析不可见，但实况记录里必须可见（断流诊断的眼睛）',
    raw: [
      ': ping\n\n',
      'data: {"type":"token","text":"深度思考中"}\n\n',
      ': ping\n\n',
      ': ping\n\n',
      'data: {"type":"token","text":"，马上出结果"}\n\n',
      ': ping\n\n',
      'data: {"type":"done"}\n\n',
    ].join(''),
  },
  {
    id: 'sse-json-bubble-regression',
    label: 'JSON 气泡回归样例（卡片 JSON 泄漏进 token）',
    description: '卡片 JSON 没被剥成 uiHint 事件、以 token 文本泄漏的坏形态——「JSON 气泡」问题的可复现样本',
    raw: [
      'data: {"type":"token","text":"给你安排今天的训练："}\n\n',
      'data: {"type":"token","text":"```json"}\n\n',
      `data: {"type":"token","text":${JSON.stringify('{"type":"plan_card","data":[{"exerciseId":"bench_press","sets":4,"reps":8,"weight":60}]}')}}\n\n`,
      'data: {"type":"token","text":"```"}\n\n',
      'data: {"type":"done"}\n\n',
    ].join(''),
  },
  {
    id: 'sse-weekly-plan-leak-long-thinking',
    label: '#56 长思考后周计划卡泄漏（thinking 倾泻 + 卡片 JSON 进 token）',
    description: 'issue #56 复现帧序：GLM 长思考 delta 倾泻后，weekly_plan 卡未被剥成 uiHint、以围栏 JSON 进 token——前端终态复原兜底（cardLeakRecovery）的确定性回归样例',
    raw: [
      ...Array.from({ length: 20 }, (_, i) =>
        `data: {"type":"thinking","text":"画像读取与动作选配推理第${i}步。"}\n\n`),
      'data: {"type":"token","text":"这是为你定制的第 1 周计划：\\n\\n```json\\n"}\n\n',
      `data: {"type":"token","text":${JSON.stringify(JSON.stringify({
        type: 'weekly_plan',
        data: {
          week_label: '第 1 周',
          phase_label: '增肌基础块',
          split_summary: '全身×3 · 每周三练 · 新手起步',
          days: [
            {
              entry_date: '2026-09-30',
              split_label: '全身',
              focus: '胸肩三头',
              rest: false,
              exercises: [{ exercise_id: 'V1StGXR8_Z5jdHi6', name: '杠铃卧推', sets: [{ set: 1, weight: 60, reps: 8 }] }],
            },
            { entry_date: '2026-10-01', rest: true, exercises: [] },
          ],
          apply: {
            scope: 'week',
            split: 'full_body',
            dates: [],
            entries: [{
              entry_date: '2026-09-30',
              exercise_id: 'V1StGXR8_Z5jdHi6',
              target_sets: 1,
              target_load: { type: 'rpe', min: 4, max: 5 },
              sort_order: 0,
              day_focus: '胸肩三头',
              rationale: '新手以复合动作为主建立基础力量',
              category: 'main',
              sets: [{ set_no: 1, weight_kg: 60, reps: 8, rpe: 7 }],
            }],
          },
        },
      }))}}\n\n`,
      'data: {"type":"token","text":"\\n```\\n\\n确认后我帮你启用本周计划。"}\n\n',
      'data: {"type":"done"}\n\n',
    ].join(''),
  },
  {
    id: 'sse-hostile-frames',
    label: '异常帧全家桶（未知类型/坏 JSON/[DONE]/CRLF/多行 data）',
    description: '解析器容错极限：未知帧类型、畸形 JSON、[DONE] 哨兵、CRLF 分隔、多行 data 拼接、注释帧——一律跳过/标注，禁炸',
    raw: [
      'data: {"type":"experimental_frame","payload":{"hint":"future frame"}}\n\n',
      'data: {"type":"token","text":"一"\r\n\r\n',
      'data: {"type":"token","text":"段"}\r\n\r\n',
      'data: {"type":"token",\n\n',
      'data: "text":"坏 JSON 故事的一半"}\n\n',
      'data: {"type":"token",\ndata:  "text":"多行 data 应拼接成一个 JSON"}\n\n',
      ': keepalive note\n\n',
      'data: [DONE]\n\n',
      'data: {"type":"done"}\n\n',
    ].join(''),
  },
  {
    id: 'sse-broken-stream',
    label: '断流（有字无 done，中途被掐）',
    description: 'token 流中途中断、无 done 终态——前端看门狗会补 CONNECTION_LOST 的形态',
    raw: [
      'data: {"type":"thinking","text":"正在编排……"}\n\n',
      'data: {"type":"token","text":"下周的"}\n\n',
      'data: {"type":"token","text":"计划"}\n\n',
      // 没有 done —— 流被掐断
    ].join(''),
  },
];
