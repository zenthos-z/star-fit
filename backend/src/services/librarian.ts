// R9 (Planner Decision #2): migrated from backend/src/services/mas/librarian.ts so the
// LIVE route /agent/classify (agentController) survives the MAS runtime deletion.
// classifyExercise depends only on llm.js (generateTextUnified) — a standalone tool.
// Only the import path changed (../llm.js -> ./llm.js); behaviour is identical.
import { generateTextUnified } from "./llm.js";

export interface ExerciseClassification {
  type: 'resistance' | 'cardio' | 'bodyweight' | 'assisted' | 'unilateral' | 'isometric' | 'weight_only' | 'reps_only';
  cardioSubtype?: 'DISTANCE' | 'GENERAL';
  bodyCategory?: 'push' | 'pull' | 'legs' | 'core' | 'cardio' | 'shoulders' | 'arms';
  primaryMuscles?: string[];
  equipment?: string;
  defaultRpe?: number;
  metadata?: Record<string, any>;
}

const CLASSIFICATION_SYSTEM_PROMPT = `
You are the Librarian Agent of Starfit. Your job is to classify exercise names into the system's schema.
Output strictly in JSON format. No markdown, no comments.

Schema:
{
  "type": "resistance" | "cardio" | "bodyweight" | "assisted" | "unilateral" | "isometric" | "weight_only" | "reps_only",
  "cardioSubtype": "DISTANCE" | "GENERAL" (Only for cardio. DISTANCE for running/cycling/rowing/swimming, GENERAL for jump rope/HIIT/boxing),
  "bodyCategory": "push" | "pull" | "legs" | "core" | "cardio" | "shoulders" | "arms" (REQUIRED),
  "primaryMuscles": ["string"],
  "equipment": "string",
  "defaultRpe": number (1-10)
}

Rules:
- "Run", "Cycle", "Row", "Swim" -> cardio, DISTANCE, bodyCategory: cardio
- "Jump Rope", "HIIT", "Boxing" -> cardio, GENERAL, bodyCategory: cardio
- "Pullup", "Dip" (if weighted) -> bodyweight; (if assisted machine) -> assisted. Default to bodyweight if ambiguous.
- "Plank", "Wall Sit" -> isometric, bodyCategory: core (usually) or legs
- "Dumbbell Press" -> resistance, bodyCategory: push
- "Squat" -> resistance, bodyCategory: legs
- "Single Arm ...", "Bulgarian Split Squat" -> unilateral
- "1RM Test", "Heavy Single", "Max Attempt" -> weight_only
- "Burpee", "Box Jump", "Kettlebell Swing", "Jumping Jack" -> reps_only (if typically counted in reps without variable weight)
`;

export async function classifyExercise(name: string): Promise<ExerciseClassification> {
  try {
    const response = await generateTextUnified(
      `Classify this exercise: "${name}"`,
      console,
      "calc", // Use fast model
      CLASSIFICATION_SYSTEM_PROMPT
    );

    // Clean markdown if present
    const cleanJson = response.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleanJson);
  } catch (error) {
    console.error("Librarian Classification Failed:", error);
    // Fallback default
    return { type: 'resistance', defaultRpe: 7 };
  }
}
