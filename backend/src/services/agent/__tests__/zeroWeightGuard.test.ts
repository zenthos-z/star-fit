import { test } from "node:test";
import assert from "node:assert/strict";
import { ExercisePlanSchema } from "../schemas/uiHintSchemas.js";

const base = {
  exerciseId: "e1",
  name: "杠铃卧推",
  exercise_type: "resistance",
  sets: 3,
  reps: 8,
};

test("resistance weight=0 is rejected with PRE guidance", () => {
  const zero = ExercisePlanSchema.safeParse({ ...base, weight: 0 });
  assert.equal(zero.success, false, "weight=0 must fail");
  assert.ok(
    zero.error!.issues[0].message.includes("杠铃卧推"),
    "error contains exercise name",
  );
  assert.ok(
    zero.error!.issues[0].message.includes("PRE"),
    "error mentions PRE flow",
  );
});

test("resistance with concrete weight passes", () => {
  const ok = ExercisePlanSchema.safeParse({ ...base, weight: 60 });
  assert.equal(ok.success, true);
});

test("assisted weight=0 still allowed (assistance semantics)", () => {
  const r = ExercisePlanSchema.safeParse({
    exerciseId: "e2",
    name: "弹力带引体",
    exercise_type: "assisted",
    sets: 3,
    reps: 8,
    weight: 0,
  });
  assert.equal(r.success, true);
});

test("bodyweight weight=0 still allowed", () => {
  const r = ExercisePlanSchema.safeParse({
    exerciseId: "e3",
    name: "俯卧撑",
    exercise_type: "bodyweight",
    sets: 3,
    reps: 12,
    weight: 0,
  });
  assert.equal(r.success, true);
});
