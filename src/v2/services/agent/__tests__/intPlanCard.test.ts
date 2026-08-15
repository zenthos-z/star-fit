/**
 * INT B5 — frontend plan_card rendering path (P010 signature-frozen seam).
 *
 * useAICoach does: `result = await consumeAgentStream(agentClient.chat(...))`
 * then `uiHint = synthesizeUiHint(result.card)` and renders when
 * `uiHint?.type === 'plan_card'`. This test drives THAT path with a realistic
 * backend SSE fixture (token + uiHint(plan_card, exercise array) + done) and
 * asserts the renderable card is a non-empty `plan_card` with the exercise
 * data intact — i.e. the frontend renders the card without error and with no
 * field/shape mismatch (A018: fixture mirrors the real M5a plan_card schema).
 *
 * The backend now emits `card.type === 'plan_card'` directly (MAS UIHint
 * schema); synthesizeUiHint passes it through (the legacy map has no
 * `plan_card` key, so the fallback keeps the literal). This test pins that
 * contract.
 */
import { describe, it, expect, vi } from "vitest";
import {
  consumeAgentStream,
  createSseAgentClient,
  synthesizeUiHint,
} from "../sseAgentClient";
import type { AgentEvent } from "shared/contracts";

function sseResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return { ok: true, status: 200, body } as unknown as Response;
}

function frame(event: AgentEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

const noHeaders = () => ({ "Content-Type": "application/json" });
const fixedUser = () => "11111111-1111-1111-1111-111111111111";

const PLAN_EXERCISES = [
  { exerciseId: "bench", name: "Bench Press", sets: 4, reps: 8, weight: 60 },
  { exerciseId: "row", name: "Barbell Row", sets: 3, reps: 10 },
];

describe("INT B5: frontend renders plan_card over the frozen seam", () => {
  it("consumeAgentStream + synthesizeUiHint turn an SSE uiHint(plan_card) into a renderable card", async () => {
    const chunks = [
      frame({ type: "token", text: "Here is your plan.\n" }),
      frame({ type: "uiHint", card: { type: "plan_card", data: PLAN_EXERCISES } as any }),
      frame({ type: "token", text: "Let me know!" }),
      frame({ type: "done" }),
    ];
    const fetchImpl = vi.fn(async () => sseResponse(chunks)) as unknown as typeof fetch;
    const client = createSseAgentClient({
      fetchImpl,
      url: "/api/chat",
      getHeaders: noHeaders,
      getUserId: fixedUser,
    });

    // useAICoach's exact consumption shape.
    const result = await consumeAgentStream(
      client.chat({ userId: fixedUser(), message: "帮我做增肌计划", scenario: "plan" }),
    );

    // The card survived the round-trip with its type + exercise array.
    expect(result.card?.type).toBe("plan_card");
    expect(Array.isArray(result.card?.data)).toBe(true);
    expect((result.card?.data as unknown as unknown[]).length).toBe(2);
    expect(result.text).toContain("Here is your plan");
    expect(result.error).toBeUndefined();

    // synthesizeUiHint produces the renderable hint useAICoach checks against.
    const hint = synthesizeUiHint(result.card);
    expect(hint).toBeDefined();
    expect(hint?.type).toBe("plan_card"); // the literal useAICoach branches on
    expect(hint?.data).toEqual(PLAN_EXERCISES);
  });

  it("synthesizeUiHint keeps card.type==='plan_card' verbatim (no map entry -> fallback)", () => {
    // The legacy CARD_TYPE_TO_LEGACY map keys are v3 types (plan/summary/...);
    // 'plan_card' is not a key, so the fallback `?? card.type` must preserve it.
    const hint = synthesizeUiHint({ type: "plan_card", data: [{ name: "x" }] } as any);
    expect(hint?.type).toBe("plan_card");
  });
});
