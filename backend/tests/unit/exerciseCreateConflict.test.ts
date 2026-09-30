/**
 * POST /api/exercises 重名冲突语义测试（issue #85 可选后端项）
 *
 * 覆盖 exerciseController.createExercise 错误映射：
 *  - exercises_name_key 唯一约束冲突（DatabaseError.context.error.code=23505）
 *    → 409 { error: "name_exists" }，不再裸 500 SQL 错误
 *  - 其余错误 → 500 兜底不变
 *
 * ExerciseLibraryService.createExercise 打桩（pg 错误经 DatabaseError.context.error
 * 透传的形态与 postgres-client.ts query 包装一致，无需真库）。
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import type { FastifyRequest, FastifyReply } from "fastify";

const createExerciseServiceMock = jest.fn<() => Promise<void>>();
jest.mock("../../src/services/exerciseLibraryService.js", () => ({
  ExerciseLibraryService: {
    createExercise: (...args: unknown[]) => createExerciseServiceMock(...args),
  },
}));

import { DatabaseError } from "../../src/utils/errorHandler.js";
import { createExercise } from "../../src/controllers/exerciseController.js";

const validBody = {
  id: "abcd1234abcd1234abcd",
  name: "Barbell Bench Press",
  exercise_type: "resistance",
  targets: { primary: ["chest"], secondary: [] },
  equipment_required: ["barbell"],
  difficulty: "beginner",
};

const makeReq = (): FastifyRequest =>
  ({ body: validBody }) as unknown as FastifyRequest;

const makeReply = () => {
  const reply = {
    status: jest.fn(),
    send: jest.fn(),
  };
  reply.status.mockReturnThis();
  return reply;
};

describe("createExercise 重名冲突 → 409 name_exists（issue #85）", () => {
  beforeEach(() => {
    createExerciseServiceMock.mockReset();
  });

  it("23505 唯一约束冲突 → 409 name_exists（对齐 adminController 映射口径）", async () => {
    const pgError = Object.assign(
      new Error(
        'duplicate key value violates unique constraint "exercises_name_key"',
      ),
      {
        code: "23505",
        constraint: "exercises_name_key",
      },
    );
    createExerciseServiceMock.mockRejectedValue(
      new DatabaseError("PostgreSQL query failed", "query", { error: pgError }),
    );
    const reply = makeReply();

    await createExercise(makeReq(), reply as unknown as FastifyReply);

    expect(reply.status).toHaveBeenCalledWith(409);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: "name_exists" }),
    );
  });

  it("其余错误保持 500 兜底（映射不误伤）", async () => {
    createExerciseServiceMock.mockRejectedValue(
      new Error("connection refused"),
    );
    const reply = makeReply();

    await createExercise(makeReq(), reply as unknown as FastifyReply);

    expect(reply.status).toHaveBeenCalledWith(500);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Failed to create exercise" }),
    );
  });
});
