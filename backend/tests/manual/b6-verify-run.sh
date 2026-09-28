#!/usr/bin/env bash
# ============================================================================
# B6 建议参数缓存 —— API 剧本验证跑批（issue #39 后端批）
#
# 用法（仓库根目录）：
#   bash backend/tests/manual/b6-verify-run.sh
#
# 端口：43111 常被其它工作树的 dev 后端占用（共享调试口），本剧本固定用
# 43117 起独立后端 + 43199 mock GLM，互不干扰。
#
# 做的事：
#   1. 起 mock GLM 端点（127.0.0.1:43199，OpenAI 兼容 SSE —— 无真实密钥时
#      验证门 c 的对话流由它承载；Agent 管线/DB 全真实）
#   2. 起后端（43117，starfit-postgres@5432，空闲窗口压缩到 3s 便于验证）
#   3. 跑 b6-verify.mjs 四门断言（a/b/c/d），转发退出码
#   4. 收尾杀两个子进程
# ============================================================================
set -uo pipefail

# 端口动态挑选：多工作树并发跑批时（43111=b5、43117 曾被 a15 抢占），
# 固定端口会撞车——health 探到别人的服务、业务路由 404。先扫空闲口再起。
pick_free_port() {
  local base=$1
  for p in $(seq "$base" $((base + 60))); do
    if node -e "const s=require('net').createServer();s.once('error',()=>process.exit(1));s.listen($p,'127.0.0.1',()=>s.close(()=>process.exit(0)))" 2>/dev/null; then
      echo "$p"
      return 0
    fi
  done
  echo ""
  return 1
}

MOCK_PORT=$(pick_free_port 43180)
BACKEND_PORT=$(pick_free_port 43240)
[ -n "$MOCK_PORT" ] && [ -n "$BACKEND_PORT" ] || { echo "no free port found"; exit 1; }
echo "[b6-verify] ports: mock=$MOCK_PORT backend=$BACKEND_PORT"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
BACKEND="$ROOT/backend"
LOG_DIR="$(mktemp -d /tmp/b6-verify.XXXXXX)"
cleanup_done=0

cleanup() {
  [ "$cleanup_done" = "1" ] && return
  cleanup_done=1
  [ -n "${MOCK_PID:-}" ] && kill "$MOCK_PID" 2>/dev/null
  [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null
}
trap cleanup EXIT INT TERM

echo "[b6-verify] logs in $LOG_DIR"

# 1) mock GLM（exec：让 $MOCK_PID 就是 node 进程本身，kill 不悬空）
(cd "$BACKEND" && exec env -u NODE_ENV PORT=$MOCK_PORT MOCK_TOKENS=30 MOCK_INTERVAL_MS=800 \
  node tests/manual/b6-mock-glm.mjs >"$LOG_DIR/mock.log" 2>&1) &
MOCK_PID=$!
for i in $(seq 1 50); do
  curl -sf "http://127.0.0.1:$MOCK_PORT/__health" >/dev/null 2>&1 && break
  kill -0 "$MOCK_PID" 2>/dev/null || break
  sleep 0.2
done
curl -sf "http://127.0.0.1:$MOCK_PORT/__health" >/dev/null || { echo "mock GLM failed to start"; tail -20 "$LOG_DIR/mock.log"; exit 1; }
# 归属校验：监听该端口的必须是我们拉起的进程（防抢座：EADDRINUSE 后 tsx
# 进程不退出，health 会探到占座者）
if ! lsof -tnP -i ":$MOCK_PORT" 2>/dev/null | grep -qx "$MOCK_PID"; then
  echo "mock port $MOCK_PORT owned by another process (race lost)"; exit 1
fi
echo "[b6-verify] mock GLM up (pid $MOCK_PID)"

# 2) 后端（空闲窗口 3s；GLM 指向 mock；starfit-postgres@5432）
cd "$BACKEND"
mkdir -p uploads
exec env -u NODE_ENV \
  PORT=$BACKEND_PORT \
  AI_PROVIDER=glm \
  GLM_API_KEY=b6-mock-key \
  GLM_BASE_URL="http://127.0.0.1:$MOCK_PORT" \
  GLM_MODEL=glm-5.3-flash \
  DATABASE_URL="${B6_DATABASE_URL:-postgresql://starfit:starfit@127.0.0.1:5432/starfit}" \
  SUGGESTION_CACHE_IDLE_WINDOW_MS=3000 \
  npx tsx src/preload.ts >"$LOG_DIR/server.log" 2>&1 &
SERVER_PID=$!
for i in $(seq 1 150); do
  curl -sf "http://127.0.0.1:$BACKEND_PORT/health" >/dev/null 2>&1 && break
  kill -0 "$SERVER_PID" 2>/dev/null || break # 新进程已死（如端口被占）→ 别误连别人的 /health
  sleep 0.4
done
curl -sf "http://127.0.0.1:$BACKEND_PORT/health" >/dev/null || { echo "backend failed to start (or port $BACKEND_PORT taken)"; tail -40 "$LOG_DIR/server.log"; exit 1; }
# 归属校验走日志出身为准（npx tsx 会再派生子进程，lsof 监听 pid ≠ $SERVER_PID；
# 若端口被抢，本进程日志必有 EADDRINUSE，health 探到的是占座者）
if grep -q "EADDRINUSE" "$LOG_DIR/server.log"; then
  echo "backend port $BACKEND_PORT race lost (EADDRINUSE in own log)"; exit 1
fi
echo "[b6-verify] backend up (pid $SERVER_PID port $BACKEND_PORT)"

# 3) 剧本
B6_API="http://127.0.0.1:$BACKEND_PORT" node tests/manual/b6-verify.mjs
VERIFY_RC=$?

echo "[b6-verify] verify exit=${VERIFY_RC}; server 日志关键行："
grep -E "suggestion_cache" "$LOG_DIR/server.log" | tail -20 || true

exit $VERIFY_RC
