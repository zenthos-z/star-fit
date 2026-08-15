import { buildPosterPrompt } from "../src/services/promptEngine";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

const session = {
  Nickname: "你的昵称",
  Date: "2025-12-18",
  Duration: "112分钟",
  Workout_List: [
    { name: "哑铃高脚杯深蹲", weight: "12.5KG", sets: "3 SETS" }
  ]
};

async function main() {
  const prompt = await buildPosterPrompt(session as any, "Industrial_Dark");
  const snapPath = resolve(process.cwd(), "tmp", "prompt.snapshot.txt");

  if (!existsSync(snapPath)) {
    writeFileSync(snapPath, prompt, "utf-8");
    console.log("Snapshot created at", snapPath);
    process.exit(0);
  }

  const snapshot = readFileSync(snapPath, "utf-8");
  const normalize = (s: string) => s.replace(/\r/g, "");
  if (normalize(snapshot) === normalize(prompt)) {
    console.log("Snapshot match: OK");
    process.exit(0);
  } else {
    console.error("Snapshot mismatch");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

