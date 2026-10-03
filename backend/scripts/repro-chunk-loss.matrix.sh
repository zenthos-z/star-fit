#!/usr/bin/env bash
# repro-chunk-loss.matrix.sh — ChatMessageChunk 丢 tool_calls 复现矩阵 runner（refs #110）
#
# 矩阵：2 个 @langchain/openai 版本 × 2 种流形态 × 2 条消费路径 + #113 healing 腿
#   leg repo-runtime : 仓库当前 node_modules（DeepAgentService 实际解析到的版本）
#   leg openai-1.6.2 : 隔离 scratch 安装的 @langchain/openai@1.6.2 + @langchain/core@^1.2.14
#   leg repo-healing : 仓库运行时 + RoleHealingChatOpenAI（#113 根治子类，tsx 直载源码）
#   形态 glm-no-role : 全程 delta 无 role（GLM 异常形态，PR #110）
#   形态 openai-normal: 首 delta 带 role=assistant（对照组）
#   路径 stream(): 逐 chunk concat 聚合；路径 invoke(): lc_prefer_streaming 回调（生产路径）
#
# 用法： bash backend/scripts/repro-chunk-loss.matrix.sh
# 退出码：任一腿的对照组（openai-normal）失败即非零；healing 腿的
#         glm-no-role 未转 PASS 亦非零（#113 根治回归门）；基线腿 BUG 不算失败。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRATCH="${REPRO_SCRATCH:-${TMPDIR:-/tmp}/repro-chunk-loss-matrix}"
V_162="1.6.2"

log() { printf '\033[1m%s\033[0m\n' "$*"; }

# --- leg 1: 仓库运行时 ------------------------------------------------------
OUT1="$(mktemp)"
log "== leg 1/3: repo runtime（脚本自身解析链 = 生产解析链） =="
env -u NODE_ENV node "$HERE/repro-chunk-loss.mjs" --label repo-runtime | tee "$OUT1"

# --- leg 2: 隔离 1.6.2 scratch（幂等引导） -----------------------------------
need_install=0
if [ ! -f "$SCRATCH/openai-$V_162/node_modules/@langchain/openai/package.json" ]; then
  need_install=1
elif [ "$(node -p "require('$SCRATCH/openai-$V_162/node_modules/@langchain/openai/package.json').version")" != "$V_162" ]; then
  need_install=1
fi
if [ "$need_install" = "1" ]; then
  log "== 引导 scratch: @langchain/openai@$V_162 + @langchain/core@^1.2.14 → $SCRATCH =="
  mkdir -p "$SCRATCH/openai-$V_162"
  (
    cd "$SCRATCH/openai-$V_162"
    [ -f package.json ] || echo '{ "name": "repro-openai-'"$V_162"'", "private": true, "type": "module" }' > package.json
    env -u NODE_ENV npm install --no-audit --no-fund --silent "@langchain/openai@$V_162" '@langchain/core@^1.2.14'
  )
fi

OUT2="$(mktemp)"
log "== leg 2/3: @langchain/openai@${V_162}（隔离 scratch） =="
env -u NODE_ENV node "$HERE/repro-chunk-loss.mjs" --module-root "$SCRATCH/openai-$V_162" --label "openai-$V_162" | tee "$OUT2"

# --- leg 3: 仓库运行时 + RoleHealing（#113 根治回归门） ----------------------
OUT3="$(mktemp)"
log "== leg 3/3: repo runtime + RoleHealingChatOpenAI（#113 根治） =="
env -u NODE_ENV npx tsx "$HERE/repro-chunk-loss.mjs" --label repo-healing --healing | tee "$OUT3"

# --- 汇总矩阵 ---------------------------------------------------------------
log "== 矩阵汇总（BUG = tool_calls 在聚合层被静默丢弃） =="
env -u NODE_ENV node -e '
const fs = require("fs");
const rows = [process.argv[1], process.argv[2], process.argv[3]]
  .map((f) => fs.readFileSync(f, "utf8").split("\n").find((l) => l.startsWith("##RESULT## ")))
  .filter(Boolean)
  .map((l) => JSON.parse(l.slice("##RESULT## ".length)));
const cell = (leg, shape, path) => leg.legs[shape].verdict[path];
const w = (s, n) => String(s).padEnd(n);
console.log(
  "  " + w("leg", 14) + w("@langchain/openai", 18) + w("core", 10)
  + w("glm-no-role/stream", 20) + w("glm-no-role/invoke", 20)
  + w("normal/stream", 16) + "normal/invoke",
);
const labels = ["repo-runtime", "openai-1.6.2", "repo-healing"];
for (const [i, r] of rows.entries()) {
  console.log(
    "  " + w(labels[i] ?? r.label, 14) + w(r.openai, 18) + w(r.core, 10)
    + w(cell(r, "glm-no-role", "stream"), 20) + w(cell(r, "glm-no-role", "invoke"), 20)
    + w(cell(r, "openai-normal", "stream"), 16) + cell(r, "openai-normal", "invoke"),
  );
}
// #113 根治回归门：healing 腿（最后一个 ##RESULT##）的 glm-no-role 双路径须 PASS。
const healing = rows[rows.length - 1];
const healed =
  healing.label === "repo-healing" &&
  cell(healing, "glm-no-role", "stream") === "PASS" &&
  cell(healing, "glm-no-role", "invoke") === "PASS";
console.log(healed
  ? "  #113 根治门: PASS（healing 腿 glm-no-role 双路径均保留 tool_calls）"
  : "  #113 根治门: FAIL（healing 腿 glm-no-role 未全转 PASS）");
process.exitCode = healed ? 0 : 1;
' "$OUT1" "$OUT2" "$OUT3"

rm -f "$OUT1" "$OUT2" "$OUT3"
