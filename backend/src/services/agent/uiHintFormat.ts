/**
 * uiHintFormat (M5a) — the HC-1 uiHint card-format skill.
 *
 * `loadUiHintFormatSkill()` returns the systemPrompt knowledge block that
 * teaches the single agent loop how to emit uiHint cards in the exact shape
 * the M5b validator (`uiHintValidator.ts`) enforces. It is a pure string
 * producer (no IO) so it can be unit-tested and injected into any scenario's
 * systemPrompt assembly.
 *
 * The six allowed `type` values match the migrated canonical schema
 * (`./schemas/uiHintSchemas.js`):
 * plan_card, summary_card, survey_card, deviation_card, audit_complete, strategy_confirm.
 *
 * Note: `survey_card` is now allowed for workout_complete scenario (v3 amendment).
 */

/**
 * The six card types the agent is allowed to emit. Kept as a runtime
 * constant so tests and consumers stay in sync with the skill text.
 */
export const ALLOWED_UIHINT_TYPES = [
  'plan_card',
  'summary_card',
  'survey_card',  // v3: now allowed for workout_complete
  'deviation_card',
  'audit_complete',
  'strategy_confirm',
] as const;

/**
 * Card types the agent must NEVER emit (HC-4 HITL blacklist). Mirrors
 * `HITL_BLACKLISTED_TYPES` in the validator; duplicated here as plain strings
 * so this module has no runtime dependency on the validator (it only produces
 * prompt text).
 */
export const BLACKLISTED_UIHINT_TYPES = ['hitl_confirm'] as const;

/**
 * Build the uiHint card-format skill text for systemPrompt injection.
 *
 * Returns a stable Markdown block describing:
 *   - the six allowed `type` values (enum),
 *   - the per-type `data` schema the validator enforces,
 *   - the HC-4 hard constraint against HITL types.
 *
 * Pure function — same input (none) always yields the same string.
 */
export function loadUiHintFormatSkill(): string {
  return [
    '## uiHint Card Format (HC-1)',
    '',
    'When a structured card is the right response, emit ONE JSON object with a',
    '`type` field. The card is validated programmatically upstream; an invalid',
    'card is rejected and you will be asked to re-emit it.',
    '',
    '### Allowed `type` values (enum — use exactly one)',
    '- `plan_card` — a training plan. `data` MUST be an ARRAY of exercises.',
    '  Each exercise REQUIRES:',
    '  - `exerciseId` (string)',
    '  - `name` (string)',
    '  - `exercise_type` (one of: resistance|bodyweight|isometric|cardio|outdoor|unilateral|assisted|flexibility|heavy_weight|rep_training)',
    '  - `sets` (positive integer)',
    '  - `reps` (positive integer)',
    '',
    '  **CRITICAL: Field requirements depend on `exercise_type`:**',
    '  | type | required fields | notes |',
    '  |------|-----------------|-------|',
    '  | isometric | duration > 0, reps=1 | 静力训练按时间计量 |',
    '  | cardio | duration > 0 | 有氧训练必需时长 |',
    '  | outdoor | distance > 0 | 户外运动必需距离 |',
    '  | resistance/unilateral/heavy_weight/assisted | weight > 0 | 负重训练必需重量 |',
    '  | bodyweight/rep_training | (none) | weight 默认 0 |',
    '  | flexibility | (none) | 无必需字段 |',
    '',
    '  Optional fields: `weight` (default 0), `duration`, `distance`.',
    '  Optional top-level `diff`: { added[], modified[], removed[] }.',
    '',
    '  **BEFORE generating a plan_card:**',
    '  1. Call `list_exercises` to get the exercise library (includes `exercise_type`)',
    '  2. For each exercise, match its `exercise_type` to the requirements above',
    '  3. If unsure, read `exercise-type-guide/knowledge-index.md`',
    '- `summary_card` — workout/session summary. `data`: `summary` (non-empty',
    '  string), optional `title`, `highlights` (string[]), `metrics` (record of',
    '  string|number).',
    '- `survey_card` — post-workout survey questions. `data`: `questions` (array',
    '  of objects), each question: `id` (string), `question` (string), optional',
    '  `options` (array of {label, value}), optional `inputType` ("text" or "number"),',
    '  optional `placeholder`, optional `required` (boolean). Optional top-level',
    '  `title`, `subtitle`, `sessionId`. Maximum 3 questions. Smart survey: only',
    '  ask questions relevant to the workout (e.g., fatigue if weight adjusted,',
    '  discomfort if unusual pattern).',
    '- `deviation_card` — plan deviation needing adjustment. `data`: `reason`',
    '  (non-empty string), optional `suggestion`.',
    '- `audit_complete` — profile audit finished. `data`: `message` (non-empty',
    '  string), optional `title`, `actionLabel`, `requiresConfirmation` (boolean),',
    '  `updates` (array of { field, label, count, details? }), `sessionId`,',
    '  `auditContent`.',
    '- `strategy_confirm` — training strategy for confirmation. `data`: `preview`',
    '  (non-empty string), `fullContent` (non-empty string), optional `title`,',
    '  `message`, `actionLabel`, `updatedAt` (ISO 8601 datetime).',
    '',
    '### Common shape rules',
    '- `type` is REQUIRED and must be one of the six values above (whitelist).',
    '- `data` shape MUST match its type (discriminated by `type`).',
    '- For `plan_card`, `data` MUST be a JSON array, never an object/map.',
    '- For `survey_card`, `questions` MUST be an array (1-3 questions max).',
    '- Emit the card as a single JSON object.',
    '',
    '### HARD CONSTRAINT (HC-4)',
    `NEVER emit ${BLACKLISTED_UIHINT_TYPES.map((t) => `\`${t}\``).join(' or ')}.`,
    'This HITL card type is blacklisted and will always be rejected. Use one',
    'of the six allowed types instead.',
  ].join('\n');
}
