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

// exercise_type 词表单一真源（#88 分册1）：枚举列表由 shared card-types 生成，禁手抄
// survey 题库 id 清单同理由共享题库常量派生（#114 B5c）——prompt 文本与
// PROFILE_INTAKE_QUESTIONS 不可能漂移。
import {
  EXERCISE_TYPE_VALUES,
  PROFILE_INTAKE_QUESTIONS,
} from "shared/contracts";

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
 * 首用画像问卷题库 id 清单（#114 B5c）——运行时从 PROFILE_INTAKE_QUESTIONS
 * 派生（id + 题干），注入下方 survey_card 段落。单一真源：题库增删题时
 * 本清单自动跟随，prompt 永不手抄题面。
 */
const PROFILE_BANK_ID_LIST: string = PROFILE_INTAKE_QUESTIONS.map(
  (q) => `${q.id}（${q.question}${q.required ? "" : "，选答"}）`,
).join(" · ");

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
    `  - \`exercise_type\` (one of: ${EXERCISE_TYPE_VALUES.join("|")})`,
    "  - `sets` (positive integer)",
    "  - `reps` (positive integer)",
    "",
    "  **CRITICAL: Field requirements depend on `exercise_type`:**",
    "  | type | required fields | notes |",
    "  |------|-----------------|-------|",
    "  | isometric | duration > 0, reps=1 | 静力训练按时间计量 |",
    "  | cardio | duration > 0 | 有氧训练必需时长 |",
    "  | outdoor | distance > 0 | 户外运动必需距离 |",
    "  | resistance/unilateral/heavy_weight | weight 不能为 0（留 0 会被校验打回） | 起步重量按经验分支，细则见 plan-generation 技能 novice-starting |",
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
    "- `weekly_plan` — a WHOLE-WEEK plan card (proposal-confirm: emit it",
    "  DIRECTLY in the reply with `data.apply` — there is NO save tool). `data` is an",
    "  OBJECT (not an array): `week_label` (non-empty string, e.g. 第 2 周),",
    "  optional `phase_label` (e.g. 力量块), `split_summary` (non-empty one-line",
    "  summary, e.g. 推拉腿 · 每周 3 练 · 主项渐进 +1 档), `days` (array, 1+ items;",
    "  cover the whole week Mon-Sun when possible). Each day:",
    "  - `entry_date` (YYYY-MM-DD, calendar day, no timezone)",
    "  - optional `split_label` (short split tag: 推 / 拉 / 腿 / 上 / 下 …)",
    "  - optional `focus` (day-focus short label, e.g. 胸肩三头 / 腿 / 全身)",
    "  - optional `rationale` (1-2 sentence day note: why this layout / goal /",
    "    cautions — T9 structured field, same value as apply.entries[].rationale)",
    "  - `rest` (boolean, default false — rest days weaken to a gray row)",
    "  - `exercises` (array, default []): each is { exercise_id (from",
    "    list_exercises, NEVER invented), name, sets (array, 1+ items), optional",
    "    note, optional category }. Each set: { set (1-based number), optional",
    "    weight (kg; assisted stays NEGATIVE), optional reps, optional duration",
    "    (seconds), optional note }. Per-set params may differ",
    "    (第1组 60kg×8 / 第2组 65kg×6) — that is the point of per-set expansion;",
    "    a set with all of weight/reps/duration/note empty is rejected.",
    "  - T9 structured fields (plan-generation skill → one-shot, NO extra",
    "    rounds): exercise `category` = warmup | main | cooldown orders the day",
    "    as 热身→正式→收尾拉伸 (same value as apply.entries[].category); the",
    "    apply entries carry day_focus / rationale / category / per-set",
    "    prescription sets [{set_no, weight_kg?, reps, rpe}] with sets.length =",
    "    target_sets and set_no 1..N contiguous — see /data-schema/knowledge/plan.md.",
    "  NO progress / status / completion-rate fields exist on this card — it is",
    "  a freshly generated plan, not an execution report.",
    "- `summary_card` — workout/session summary. `data`: `summary` (non-empty",
    "  string), optional `title`, `highlights` (string[]), `metrics` (record of",
    "  string|number).",
    "- `survey_card` — interactive questionnaire, tagged with `data.purpose`",
    "  (one of `profile_intake` / `plan_gap` / `workout_feedback`):",
    "  * `profile_intake` — FIRST-USE profile survey for a brand-new user whose",
    "    goal/experience/equipment/frequency/injuries/weight are mostly unknown.",
    "    Emit it BEFORE any plan; a plain-text question list in prose is a FAILED",
    "    delivery (the app can only render interactive surveys from this card).",
    "  * `plan_gap` — targeted gap-fill: the profile exists but specific bank",
    "    items are still missing (e.g. only weight + injuries unknown). Include",
    "    ONLY the missing ids — do not re-ask answered fields.",
    "  * `workout_feedback` — post-workout feedback (≤3 free-form questions,",
    "    only what THIS workout makes relevant: fatigue after weight changes,",
    "    discomfort after unusual patterns).",
    "",
    "  ** Profile-domain surveys CONVERGE on the shared question bank (#114): **",
    "  For `profile_intake` / `plan_gap`, the question set comes from the single",
    "  source bank PROFILE_INTAKE_QUESTIONS (shared/contracts/survey.ts — the",
    "  SAME bank the app's first-use survey renders; the id→profile-field map",
    "  lives in plan-generation knowledge.md §11.1). The backend REPLACES your",
    "  question content (wording / options / two-level menus / inputType) with",
    "  the canonical bank text BY ID before the card reaches the app. So you",
    "  supply ONLY: `purpose` + the bank question `id`s (for plan_gap) + your",
    "  own `title`/`message` prose. NEVER invent profile question wording,",
    "  options, or ids; off-bank ids are dropped (a card with zero valid ids is",
    "  rejected and retried).",
    `  Bank ids (the ONLY valid profile ids): ${PROFILE_BANK_ID_LIST}.`,
    "  Conditional pick rule: `age` only renders when goal ∈ {fat_loss,",
    "  general_fitness} — whenever you include `age`, also include `goal`.",
    "",
    "  Question object shape (free-form `workout_feedback` questions use it",
    "  directly; profile-domain questions are canonicalized by id anyway):",
    "  `id` (string), `question` (string), optional `options` (array of",
    '  {label, value}), optional `inputType` ("text" | "number" | "checkbox" |',
    '  "select" | "textarea" — checkbox = MULTI-SELECT, user picks 1+ options;',
    "  select = single-choice; textarea = free-text supplement), optional",
    "  `placeholder`, optional `required` (boolean). Optional top-level `title`,",
    "  `subtitle`, `sessionId`, `purpose`.",
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
    "  when a trigger fires (day_end / injury_report / key_parameter_change /",
    "  user_request). `data`: `message` (non-empty string), `trigger` (one of:",
    "  day_end | injury_report | key_parameter_change | user_request),",
    "  `proposals` (array, 1+ items), optional `title`, `confirmLabel`,",
    "  `cancelLabel`, and optional `pending_intent` when the user's message",
    "  carried a MAIN TASK the update interrupts (e.g. 调整周计划):",
    "  `{ user_message: <user's original words>, summary: <one-line what to",
    '  continue>, scenario: "chat"|"plan" }`. Each proposal: `field` (one of:',
    "  load_anchors | active_limitations | recovery_state | memories), `label`,",
    "  `change` (human-readable), and REQUIRED `value` holding the FINAL",
    "  machine-applicable value, computed THIS turn (the app writes it",
    "  deterministically on confirm — there is no second LLM round):",
    "  - load_anchors      → object map { exerciseKey: anchorObj } (merged per key)",
    "  - active_limitations → array of NEW entries [{ part, severity }] (appended;",
    "    expire_at / logged_at / auto_heal are stamped server-side)",
    "  - recovery_state    → object { total_score } (replaced; last_assessed",
    "    stamped server-side)",
    "  - memories          → object map { key: content } (merged per key)",
    "  NEVER call `update_profile` in the same turn that emits this card. When",
    "  the user taps the bubble's confirm button the APP writes the values",
    "  directly; a later turn starting with the marker （系统续跑指令） means the",
    "  write already happened — resume the user's original task, do NOT",
    "  re-propose or re-write the profile. Only plain-text confirmations",
    "  (「好 / 更新吧」) still follow the agent path (load_history → merge →",
    "  update_profile → audit_complete).",
    "",
    "### Common shape rules",
    "- `type` is REQUIRED and must be one of the values above (whitelist).",
    "- `data` shape MUST match its type (discriminated by `type`).",
    "- For `plan_card`, `data` MUST be a JSON array, never an object/map.",
    "- For `weekly_plan`, `data` MUST be a JSON OBJECT (days inside it is an array).",
    "- For `survey_card`, `questions` MUST be an array. Profile-domain cards",
    "  (`profile_intake` full bank / `plan_gap` missing-id subset) are NOT",
    "  capped at 3; the 3-question cap applies to `workout_feedback` only.",
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
