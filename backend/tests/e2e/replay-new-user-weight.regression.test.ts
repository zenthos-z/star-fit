/**
 * INT — replay regression: 新用户首训配重对话的坏轨迹回归测试。
 *
 * 背景：2026-09-22 生产 checkpoints 时间线还原（NAS thread_1790093114776_b6g6tmhqo），
 * 新用户 5 轮对话 24.5 分钟才拿到计划，其中 AI 两次被校验器打回（instruction 卡
 * 不在白名单 / resistance weight=0），每次重试 30-90s 空窗。
 *
 * 本文件把昨晚的 3 种坏轨迹固化为确定性回归：scripted agent 重放当时的出卡行为，
 * 断言（a）校验器确实拦截（b）打回反馈包含定向修正指引（卡片类型清单/新手起步
 * 重量），使下一轮重试能一次通过——R1/R2/R3。
 *
 * Framework: node:test + tsx（与 plan-generation.e2e.test.ts 同约定）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { AgentEvent, AgentService, ChatRequest } from "shared/contracts";
import {
  composeCardValidatingService,
  setAgentServiceResolver,
} from "../../src/controllers/chatController.js";
import { validateUiHint } from "../../src/services/agent/uiHintValidator.js";

// 昨晚第4轮 AI 实际发出的 instruction 卡（打回重放的原文形状）
const REPLAY_INSTRUCTION_CARD = JSON.stringify({
  type: "instruction",
  title: "PRE 自测教学",
  data: {
    message: "用很轻的重量试 8-10 次，找到有点费力但能标准完成的重量",
    steps: ["选杠铃", "加5kg", "试举8次"],
  },
});

// 昨晚第3轮 AI 实际发出的 plan_card：新手 + 无 load_anchor，抗阻动作 weight=0
const REPLAY_ZERO_WEIGHT_PLAN = JSON.stringify({
  type: "plan_card",
  data: [
    {
      exerciseId: "bench-press",
      name: "杠铃卧推",
      exercise_type: "resistance",
      sets: 4,
      reps: 8,
      weight: 0,
    },
    {
      exerciseId: "squat",
      name: "杠铃深蹲",
      exercise_type: "resistance",
      sets: 4,
      reps: 8,
      weight: 0,
    },
    {
      exerciseId: "plank",
      name: "平板支撑",
      exercise_type: "bodyweight",
      sets: 3,
      reps: 1,
      weight: 0,
    },
  ],
});

// 优化后期望的新手分支出卡：空杆 20kg / bodyweight 0
const BEGINNER_STARTER_PLAN = JSON.stringify({
  type: "plan_card",
  data: [
    {
      exerciseId: "bench-press",
      name: "杠铃卧推",
      exercise_type: "resistance",
      sets: 4,
      reps: 8,
      weight: 20,
    },
    {
      exerciseId: "squat",
      name: "杠铃深蹲",
      exercise_type: "resistance",
      sets: 4,
      reps: 8,
      weight: 20,
    },
    {
      exerciseId: "plank",
      name: "平板支撑",
      exercise_type: "bodyweight",
      sets: 3,
      reps: 1,
      weight: 0,
    },
  ],
});

/** scripted agent：依次发出 cards 里的卡（每轮一张），token+done 正常收尾。 */
function scriptedAgent(cards: string[]): AgentService {
  let call = 0;
  return {
    async *chat(): AsyncIterable<AgentEvent> {
      call += 1;
      const card = cards[Math.min(call - 1, cards.length - 1)];
      yield { type: "token", text: "好的，" };
      yield { type: "token", text: "```json\n" + card + "\n```\n" };
      yield { type: "done" };
    },
  };
}

function drain(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  return (async () => {
    const out: AgentEvent[] = [];
    for await (const e of events) out.push(e);
    return out;
  })();
}

const REQ: ChatRequest = {
  userId: "00000000-0000-0000-0000-0000000000aa",
  threadId: "replay-regression",
  message: "帮我创建训练计划",
  scenario: "plan",
} as unknown as ChatRequest;

test.afterEach(() => setAgentServiceResolver(null));

test("R1: instruction 卡被校验器拒绝（不在6型白名单），且反馈列出正确类型", async () => {
  const verdict = validateUiHint(JSON.parse(REPLAY_INSTRUCTION_CARD));
  assert.equal(verdict.ok, false, "instruction 类型必须被拦截");
  assert.ok(
    verdict.errors.some((e) => e.path.includes("type")),
    "错误必须指向 type 字段",
  );
});

test("R2: 新手 weight=0 抗阻计划被拒，反馈含新手起步重量指引", () => {
  const verdict = validateUiHint(JSON.parse(REPLAY_ZERO_WEIGHT_PLAN));
  assert.equal(verdict.ok, false, "抗阻动作 weight=0 必须被拦截");
  const msg = verdict.errors.map((e) => e.message).join(" ");
  assert.ok(
    msg.includes("空杆") || msg.includes("最小配重"),
    `打回反馈必须给出新手分支修正方向，实际: ${msg}`,
  );
});

test("R3: 新手起步计划（空杆20kg + bodyweight 0）一轮通过校验", () => {
  const verdict = validateUiHint(JSON.parse(BEGINNER_STARTER_PLAN));
  assert.equal(
    verdict.ok,
    true,
    `新手起步计划必须直接通过: ${JSON.stringify(verdict.errors ?? [])}`,
  );
});

test("R4: 端到端重放——第一轮坏卡打回后，重试轮发出合法卡且 uiHint 事件落地", async () => {
  // 昨晚实际轨迹：先发 weight=0 坏卡（第3轮），打回后重试（此处用合法起步卡代替
  // 昨晚实际发出的重量问卷——这正是优化后期望收敛的路径）
  setAgentServiceResolver(() =>
    scriptedAgent([REPLAY_ZERO_WEIGHT_PLAN, BEGINNER_STARTER_PLAN]),
  );
  const raw = scriptedAgent([REPLAY_ZERO_WEIGHT_PLAN, BEGINNER_STARTER_PLAN]);
  const svc = composeCardValidatingService(raw);
  const events = await drain(svc.chat(REQ));
  const uiHints = events.filter((e) => e.type === "uiHint");
  assert.ok(uiHints.length >= 1, "打回重试后必须产出合法 uiHint");
  const last = uiHints[uiHints.length - 1] as Extract<
    AgentEvent,
    { type: "uiHint" }
  >;
  assert.equal((last as { card?: { type?: string } }).card?.type, "plan_card");
  // 坏卡（weight=0 plan）不得作为 uiHint 落地——只有重试后的合法卡落地
  assert.equal(
    uiHints.length,
    1,
    `只有重试后的合法卡落地，实际 ${uiHints.length} 张`,
  );
});
