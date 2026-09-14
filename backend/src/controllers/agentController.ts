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
    // 动作名：客户端 exercises[] 自带中文 name（来自动作库）；libraryId 可兜底查库。
    // （历史 bug：曾读不存在的 exerciseId 字段 → 全部 fallback 成 "Unknown"。）
    const libraryIds = exercises
      .map((e: any) => {
        if (typeof e?.name === "string" && e.name.trim()) return ""; // 有名字无需查库
        const lib =
          typeof e?.libraryId === "string"
            ? e.libraryId
            : typeof e?.metadata?.libraryId === "string"
              ? e.metadata.libraryId
              : "";
        return lib;
      })
      .filter(Boolean);
    const idToName = new Map<string, string>();
    if (libraryIds.length > 0) {
      try {
        // 只允许字母数字下划线连字符，杜绝注入后字面拼接
        const safeIds = [...new Set(libraryIds)].filter((s: string) =>
          /^[\w-]+$/.test(s),
        );
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
      // 完成组 = completed!==false 或 reps>0（旧版本不写 completed）
      const done = sets.filter(
        (s: any) => s?.completed !== false || Number(s?.reps) > 0,
      );
      const topWeight = Math.max(
        0,
        ...done.map((s: any) => Number(s?.weight) || 0),
      );
      const totalReps = done.reduce(
        (n: number, s: any) => n + (Number(s?.reps) || 0),
        0,
      );
      const totalSecs = done.reduce(
        (n: number, s: any) => n + (Number(s?.duration) || 0),
        0,
      );
      const libId =
        typeof e?.libraryId === "string"
          ? e.libraryId
          : typeof e?.metadata?.libraryId === "string"
            ? e.metadata.libraryId
            : "";
      const name =
        (typeof e?.name === "string" && e.name.trim()) ||
        (libId && idToName.get(libId)) ||
        "Unknown";
      // 组数x次数 or 组数x时长（平板支撑等 isometric）
      const setsDesc =
        totalSecs > 0 && topWeight === 0
          ? `${done.length}x${done[0]?.duration ?? "?"}s`
          : `${done.length}x${done[0]?.reps ?? "-"}`;
      const loadDesc = topWeight > 0 ? `${topWeight}kg` : "bodyweight";
      return {
        name,
        weight: loadDesc,
        sets:
          totalSecs > 0 && topWeight === 0
            ? `${setsDesc} (${totalSecs}s total)`
            : `${setsDesc} (${totalReps} reps)`,
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

    // 所见即所得：前端把界面展示的提示词原样发来时，直接用它生图，
    // 跳过后端 SCENE_TEMPLATES 自拼（两套 prompt 体系不一致会导致
    // "界面显示包豪斯、生图却是工业酸画风"）。仅在缺省时走后端拼装。
    const promptOverride =
      typeof body.promptOverride === "string" && body.promptOverride.trim()
        ? body.promptOverride
        : undefined;
    const prompt =
      promptOverride ??
      (await buildPosterPrompt(session, templateKey, vibeOverride, userId));
    const dataUrl = await generateImage(prompt, req.log);

    return reply.status(200).send({ dataUrl, traceId: req.id });
  } catch (err: any) {
    req.log.error({ err }, "image_generation_failed");
    return reply
      .status(400)
      .send({ error: err?.message || "Bad Request", traceId: req.id });
  }
}
