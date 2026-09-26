/**
 * uiHintFormat (M5a) — the HC-1 uiHint card-format skill.
 *
 * `loadUiHintFormatSkill()` returns the systemPrompt knowledge block that
 * teaches the single agent loop how to emit uiHint cards in the exact shape
 * the M5b validator (`uiHintValidator.ts`) enforces. It is a pure string
 * producer (no IO) so it can be unit-tested and injected into any scenario's
 * systemPrompt assembly.
 *
 * The allowed `type` values match the migrated canonical schema
 * (`./schemas/uiHintSchemas.js`):
 * plan_card, weekly_plan, summary_card, survey_card, deviation_card,
 * audit_complete, profile_update_confirm.
 *
 * Note: `survey_card` is now allowed for workout_complete scenario (v3 amendment).
 */

/**
 * The card types the agent is allowed to emit. Kept as a runtime
 * constant so tests and consumers stay in sync with the skill text.
 */
export const ALLOWED_UIHINT_TYPES = [
  "plan_card",
  "weekly_plan", // 2026-09: conversational weekly plan card (issue #9 / D2)
  "summary_card",
  "survey_card", // v3: now allowed for workout_complete
  "deviation_card",
  "audit_complete",
  "profile_update_confirm", // 2026-09: user-profile auto-update consent bubble
] as const;

/**
 * Card types the agent must NEVER emit (HC-4 HITL blacklist). Mirrors
 * `HITL_BLACKLISTED_TYPES` in the validator; duplicated here as plain strings
 * so this module has no runtime dependency on the validator (it only produces
 * prompt text).
 */
export const BLACKLISTED_UIHINT_TYPES = ["hitl_confirm"] as const;

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
    "## uiHint Card Format (HC-1)",
    "",
    "When a structured card is the right response, emit ONE JSON object with a",
    "`type` field. The card is validated programmatically upstream; an invalid",
    "card is rejected and you will be asked to re-emit it.",
    "",
    "### Allowed `type` values (enum — use exactly one)",
    "- `plan_card` — a training plan. `data` MUST be an ARRAY of exercises.",
    "  Each exercise REQUIRES:",
    "  - `exerciseId` (string)",
    "  - `name` (string)",
    "  - `exercise_type` (one of: resistance|bodyweight|isometric|cardio|outdoor|unilateral|assisted|flexibility|heavy_weight|rep_training)",
    "  - `sets` (positive integer)",
    "  - `reps` (positive integer)",
    "",
    "  **CRITICAL: Field requirements depend on `exercise_type`:**",
    "  | type | required fields | notes |",
    "  |------|-----------------|-------|",
    "  | isometric | duration > 0, reps=1 | 静力训练按时间计量 |",
    "  | cardio | duration > 0 | 有氧训练必需时长 |",
    "  | outdoor | distance > 0 | 户外运动必需距离 |",
    "  | resistance/unilateral/heavy_weight | weight 可选（0=首训自选重量） | 留 0 时须在正文说明「首次尝试请自选重量」 |",
    "  | assisted | weight <= 0（负值辅助重量） | -20 = 辅助 20kg；正值会被打回 |",
    "  | bodyweight/rep_training | (none) | weight 默认 0 |",
    "  | flexibility | (none) | 无必需字段 |",
    "",
    "  Optional fields: `weight` (default 0), `duration`, `distance`.",
    "  Optional top-level `diff`: { added[], modified[], removed[] }.",
    '  Optional top-level `target`: "next_day" — set it ONLY when the user asks',
    "  for a TOMORROW / next-day plan (e.g. 制定明天的计划, 第二天练什么) while",
    "  NOT finishing a workout right now. The card then becomes a standalone",
    '  "tomorrow plan" the app saves by calendar date instead of loading into',
    "  the current session. Never set target for a normal current-session plan.",
    "",
    "  **BEFORE generating a plan_card:**",
    "  1. Call `list_exercises` to get the exercise library (includes `exercise_type`)",
    "  2. For each exercise, match its `exercise_type` to the requirements above",
    "  3. If unsure, read `exercise-type-guide/knowledge-index.md`",
    "- `weekly_plan` — a WHOLE-WEEK plan card (use it instead of plan_card after",
    "  `save_weekly_plan` succeeds — the weekly plan display layer). `data` is an",
    "  OBJECT (not an array): `week_label` (non-empty string, e.g. 第 2 周),",
    "  optional `phase_label` (e.g. 力量块), `split_summary` (non-empty one-line",
    "  summary, e.g. 推拉腿 · 每周 3 练 · 主项渐进 +1 档), `days` (array, 1+ items;",
    "  cover the whole week Mon-Sun when possible). Each day:",
    "  - `entry_date` (YYYY-MM-DD, calendar day, no timezone)",
    "  - optional `split_label` (short split tag: 推 / 拉 / 腿 / 上 / 下 …)",
    "  - optional `focus` (muscle-group description, e.g. 胸肩三头)",
    "  - `rest` (boolean, default false — rest days weaken to a gray row)",
    "  - `exercises` (array, default []): each is { exercise_id (from",
    "    list_exercises, NEVER invented), name, sets (array, 1+ items), optional",
    "    note }. Each set: { set (1-based number), optional weight (kg; assisted",
    "    stays NEGATIVE), optional reps, optional duration (seconds), optional",
    "    note }. Per-set params may differ (第1组 60kg×8 / 第2组 65kg×6) — that",
    "    is the point of per-set expansion; a set with all of",
    "    weight/reps/duration/note empty is rejected.",
    "  NO progress / status / completion-rate fields exist on this card — it is",
    "  a freshly generated plan, not an execution report.",
    "- `summary_card` — workout/session summary. `data`: `summary` (non-empty",
    "  string), optional `title`, `highlights` (string[]), `metrics` (record of",
    "  string|number).",
    "- `survey_card` — post-workout survey questions. `data`: `questions` (array",
    "  of objects), each question: `id` (string), `question` (string), optional",
    '  `options` (array of {label, value}), optional `inputType` ("text", "number",',
    '  or "checkbox" — checkbox = MULTI-SELECT question, user picks 1+ options),',
    "  optional `placeholder`, optional `required` (boolean). Optional top-level",
    "  `title`, `subtitle`, `sessionId`. Maximum 3 questions. Smart survey: only",
    "  ask questions relevant to the workout (e.g., fatigue if weight adjusted,",
    "  discomfort if unusual pattern).",
    "",
    "  ** survey_card option menus (PRE-DECLARED — never invent new values) **",
    "  When a question maps to a profile field below, use EXACTLY these options",
    "  (label / value) so the frontend renders a picker instead of free text, and",
    "  the value parses cleanly into the profile:",
    "  - experience (training experience): 「完全新手」/beginner ·",
    "    「有一定经验」/intermediate · 「资深练家」/advanced",
    "  - pre_test (首次配重方式): 「教练带我测」/coach_tested ·",
    "    「我自己会测」/self_tested · 「先随便练找感觉」/self_select",
    "  - goal: 「增肌」/muscle_gain · 「减脂」/fat_loss · 「力量」/strength ·",
    "    「健康」/health",
    "  - frequency (weekly): 「2次」/2 · 「3次」/3 · 「4次」/4 · 「5次及以上」/5",
    "  - equipment: 「健身房」/gym · 「哑铃杠铃」/free_weights ·",
    "    「自重」/bodyweight · 「弹力带」/bands (inputType=checkbox, multi-select)",
    "  For any question NOT in this table, free-text (inputType omitted) is fine.",
    "  Reuse the option VALUES the user already answered in earlier surveys when",
    "  referencing their experience/pre_test — do not re-ask answered fields.",
    "- `deviation_card` — plan deviation needing adjustment. `data`: `reason`",
    "  (non-empty string), optional `suggestion`.",
    "- `audit_complete` — profile audit finished. `data`: `message` (non-empty",
    "  string), optional `title`, `actionLabel`, `requiresConfirmation` (boolean),",
    "  `updates` (array of { field, label, count, details? } — `field` uses the",
    "  profile_dynamic keys load_anchors/active_limitations/recovery_state/",
    "  memories, and `details` when present MUST be an ARRAY of strings, never a",
    "  single string), `sessionId`, `auditContent`.",
    "- `profile_update_confirm` — user-profile auto-update CONSENT bubble",
    "  (HITL gate for profile writes). Emit this BEFORE calling `update_profile`",
    "  when a trigger fires (day_end / injury_report / key_parameter_change).",
    "  `data`: `message` (non-empty string), `trigger` (one of: day_end |",
    "  injury_report | key_parameter_change | user_request), `proposals` (array,",
    "  1+ items), optional `title`, `confirmLabel`, `cancelLabel`. Each proposal:",
    "  `field` (one of: load_anchors | active_limitations | recovery_state |",
    "  memories), `label` (string), `change` (human-readable description of the",
    "  intended edit), optional `value` (preview of the new value). NEVER call",
    "  `update_profile` in the same turn that emits this card — wait for the",
    "  user confirmation.",
    "",
    "### Common shape rules",
    "- `type` is REQUIRED and must be one of the values above (whitelist).",
    "- `data` shape MUST match its type (discriminated by `type`).",
    "- For `plan_card`, `data` MUST be a JSON array, never an object/map.",
    "- For `weekly_plan`, `data` MUST be a JSON OBJECT (days inside it is an array).",
    "- For `survey_card`, `questions` MUST be an array (1-3 questions max).",
    "- For `profile_update_confirm`, `proposals` MUST be an array (1+ items).",
    "- ALWAYS wrap the card in a ```json fenced block (the fence is the primary",
    "  extraction path — an unfenced card with any JSON typo leaks as prose).",
    "- Double-check bracket balance before emitting: every `[` opened inside",
    "  `data` must be closed, and `confirmLabel`/`cancelLabel` sit INSIDE `data`",
    "  (sibling of `proposals`), never as stray objects after the array.",
    "- Emit the card as a single JSON object.",
    "",
    "### HARD CONSTRAINT (HC-4)",
    `NEVER emit ${BLACKLISTED_UIHINT_TYPES.map((t) => `\`${t}\``).join(" or ")}.`,
    "This HITL card type is blacklisted and will always be rejected. Use one",
    "of the allowed types above instead.",
  ].join("\n");
}
