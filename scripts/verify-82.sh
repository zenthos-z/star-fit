#!/usr/bin/env bash
# [#82 方案A] 账号切换清残留 · 验收一键复跑
# 用途：第三方在干净 checkout 上验证本修复，无需任何本地状态：
#   bash scripts/verify-82.sh
# 全部验证门均以 env -u NODE_ENV 独立隔离跑（任务书要求）。
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== [1/4] typecheck ==="
env -u NODE_ENV npm run typecheck

echo "=== [2/4] 全量单测 ==="
env -u NODE_ENV npm run test:run

echo "=== [3/4] #82 隔离验收测试（单文件复跑） ==="
env -u NODE_ENV npx vitest run tests/account-switch.isolation.test.ts

echo "=== [4/4] build ==="
env -u NODE_ENV npm run build

echo ""
echo "VERIFY-82: ALL GATES PASSED ✅"
