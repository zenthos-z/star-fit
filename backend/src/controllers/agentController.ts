import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { buildPosterPrompt } from "../services/promptEngine.js";
import { generateImage } from "../services/genai.js";
import { getUserId } from "../utils/requestUtils.js";

const WorkoutItemSchema = z.object({
  name: z.string().min(1).optional(),
  weight: z.string().optional(),
  sets: z.string().optional()
});

const PosterSessionSchema = z.object({
  Nickname: z.string().optional(),
  Date: z.string().optional(),
  Duration: z.string().optional(),
  Workout_List: z.array(WorkoutItemSchema).optional()
});

const VibeOverrideSchema = z.object({
  brandingName: z.string().optional(),
  slogans: z.string().optional(),
  palette: z.string().optional(),
  brandingStyle: z.string().optional()
}).optional();

type PosterSession = z.infer<typeof PosterSessionSchema>;

import { classifyExercise } from "../services/librarian.js";

export async function postClassifyExercise(req: FastifyRequest, reply: FastifyReply) {
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
    return reply.status(500).send({ error: err?.message || "Internal Server Error" });
  }
}

export async function postImage(req: FastifyRequest, reply: FastifyReply) {
  try {
    const userId = getUserId(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const session = PosterSessionSchema.parse(body.session ?? {});
    const templateKey = typeof body.templateKey === "string" ? body.templateKey : undefined;
    const vibeOverride = body.vibeOverride ? VibeOverrideSchema.parse(body.vibeOverride) : undefined;

    const prompt = await buildPosterPrompt(session, templateKey, vibeOverride, userId);
    const dataUrl = await generateImage(prompt, req.log);

    return reply.status(200).send({ dataUrl, traceId: req.id });
  } catch (err: any) {
    req.log.error({ err }, "image_generation_failed");
    return reply.status(400).send({ error: err?.message || "Bad Request", traceId: req.id });
  }
}
