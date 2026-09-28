/**
 * Prompt-size probe (issue #42 batch 42a) — executes buildSystemPrompt() for
 * every scenario and prints per-scenario character counts, following the
 * measurement method of docs/agent-prompt-quality-diagnosis.md §1.1.
 *
 * Run: cd backend && npx tsx scripts/prompt-size-probe.mjs
 * (Read-only; no DB / no model / no network touched.)
 */
import { buildSystemPrompt } from "../src/services/agent/DeepAgentService.js";

const scenarios = [
  "plan",
  "workout_complete",
  "update_profile",
  "chat",
  undefined,
];

const rows = [];
for (const scenario of scenarios) {
  const prompt = buildSystemPrompt(scenario);
  rows.push({
    scenario: scenario ?? "default",
    chars: prompt.length,
    lines: prompt.split("\n").length,
  });
}

const pad = (s, n) => String(s).padEnd(n);
for (const r of rows) {
  console.log(`${pad(r.scenario, 18)} chars=${r.chars}  lines=${r.lines}`);
}

// JSON output for scripted before/after diffs.
console.log(
  "JSON:" +
    JSON.stringify(
      Object.fromEntries(rows.map((r) => [r.scenario, r.chars])),
    ),
);
