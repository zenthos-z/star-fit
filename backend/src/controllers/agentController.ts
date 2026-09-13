import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { buildPosterPrompt } from "../services/promptEngine.js";
import { generateImage } from "../services/genai.js";
import { getUserId } from "../utils/requestUtils.js";
import { getPostgresClient } from "../db/postgresql/index.js";

const WorkoutItemSchema = z.object({
  name: z.string().min(1).optional(),
  weight: z.string().optional(),
  sets: z.string().optional(),
});

const PosterSessionSchema = z.object({
  Nickname: z.string().optional(),
  Date: z.string().optional(),
  Duration: z.string().optional(),
  Workout_List: z.array(WorkoutItemSchema).optional(),
});

const VibeOverrideSchema = z
  .object({
    brandingName: z.string().optional(),
    slogans: z.string().optional(),
    palette: z.string().optional(),
    brandingStyle: z.string().optional(),
  })
  .optional();

type PosterSession = z.infer<typeof PosterSessionSchema>;

import { classifyExercise } from "../services/librarian.js";

export async function postClassifyExercise(
  req: FastifyRequest,
  reply: FastifyReply,
) {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name : "";

    if (!name) {
      return reply.status(400).send({ error: "Name is required" });
    }

    const classification = await classifyExercise(name);
    return reply.status(200).send(classification);
  } catch (err: any) {
    req.log.error({ err }, "classification_failed");
    return reply
      .status(500)
      .send({ error: err?.message || "Internal Server Error" });
  }
}

export async function postImage(req: FastifyRequest, reply: FastifyReply) {
  try {
    const userId = getUserId(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    // Frontend sends a raw WorkoutSession (exercises/startTime/...). Map it into
    // the poster's UserData shape — the old schema expected Nickname/Date/
    // Duration/Workout_List fields that the client never sent, so every poster
    // was generated with empty workout data.
    const raw = (body.session ?? {}) as Record<string, unknown>;
    const exercises = Array.isArray(raw.exercises) ? raw.exercises : [];
    // exerciseId 形如 fit://library/exercise/<id> —— 批量查库还原中文动作名
    const exerciseIds = exercises
      .map((e: any) =>
        typeof e?.exerciseId === "string"
          ? e.exerciseId.replace("fit://library/exercise/", "")
          : "",
      )
      .filter(Boolean);
    const idToName = new Map<string, string>();
    if (exerciseIds.length > 0) {
      try {
        // id 段只允许字母数字下划线连字符，杜绝注入后字面拼接
        const safeIds = exerciseIds.filter((s: string) => /^[\w-]+$/.test(s));
        if (safeIds.length > 0) {
          const db = getPostgresClient();
          const list = safeIds.map((s: string) => `'${s}'`).join(",");
          const result = await db.query(
            `SELECT id, name FROM exercises WHERE id IN (${list})`,
            {},
          );
          for (const row of result.rows ?? []) {
            if (row?.id && row?.name) idToName.set(row.id, row.name);
          }
        }
      } catch (err) {
        req.log.warn({ err }, "poster_exercise_name_lookup_failed");
      }
    }
    const workoutList = exercises.map((e: any) => {
      const sets = Array.isArray(e?.sets) ? e.sets : [];
      const done = sets.filter(
        (s: any) => s?.completed !== false || s?.reps > 0,
      );
      const topWeight = Math.max(
        0,
        ...done.map((s: any) => Number(s?.weight) || 0),
      );
      const totalReps = done.reduce(
        (n: number, s: any) => n + (Number(s?.reps) || 0),
        0,
      );
      const eid =
        typeof e?.exerciseId === "string"
          ? e.exerciseId.replace("fit://library/exercise/", "")
          : "";
      const name =
        (eid && idToName.get(eid)) ||
        (typeof e?.name === "string" && e.name) ||
        eid ||
        "Unknown";
      return {
        name,
        weight: topWeight > 0 ? `${topWeight}kg` : "bodyweight",
        sets: `${done.length}x${done[0]?.reps ?? "-"} (${totalReps} reps)`,
      };
    });
    const startTime =
      typeof raw.startTime === "string" ? raw.startTime : undefined;
    const endTime = typeof raw.endTime === "string" ? raw.endTime : undefined;
    let duration = "";
    if (startTime && endTime) {
      const mins = Math.round(
        (new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000,
      );
      if (Number.isFinite(mins) && mins > 0) duration = `${mins} min`;
    }
    const session = PosterSessionSchema.parse({
      Nickname: undefined, // resolved from vibe config below
      Date: startTime
        ? new Date(startTime).toISOString().slice(0, 10)
        : undefined,
      Duration: duration,
      Workout_List: workoutList,
    });
    const templateKey =
      typeof body.templateKey === "string" ? body.templateKey : undefined;
    const vibeOverride = body.vibeOverride
      ? VibeOverrideSchema.parse(body.vibeOverride)
      : undefined;

    const prompt = await buildPosterPrompt(
      session,
      templateKey,
      vibeOverride,
      userId,
    );
    const dataUrl = await generateImage(prompt, req.log);

    return reply.status(200).send({ dataUrl, traceId: req.id });
  } catch (err: any) {
    req.log.error({ err }, "image_generation_failed");
    return reply
      .status(400)
      .send({ error: err?.message || "Bad Request", traceId: req.id });
  }
}
