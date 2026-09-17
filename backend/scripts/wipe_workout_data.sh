#!/usr/bin/env bash
# ============================================================================
# wipe_workout_data.sh — 清空全部历史训练与心率数据（ADR-0002）
# ============================================================================
# 决策依据：docs/adr/0002-wipe-all-historical-workout-data.md
#   现有数据全部来自测试期（手动录入心率链路产物 = 污染数据），
#   对走势图/脚本分析/AI 解读全是干扰项，决定全量清空。
#
# 保留：users 表（账号与档案）。清空：sessions（级联 rpe_logs）、
#       deviation_logs、cache_history_summaries、cache_rpe_stats、heart_rate_samples。
#
# 安全网：先 pg_dump 备份到 deploy/backups/（带时间戳），再 TRUNCATE。
# 用法：  bash backend/scripts/wipe_workout_data.sh
# 依赖：  docker（本地 PG 跑在 starfit-postgres 容器）
# ============================================================================
set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-starfit-postgres}"
PG_DB="${PG_DB:-starfit}"
PG_USER="${PG_USER:-starfit}"

BACKUP_DIR="$(pwd)/deploy/backups"
mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE="$BACKUP_DIR/starfit_pre_watch_wipe_${STAMP}.dump"

echo "==> 1/3 备份到 $BACKUP_FILE"
docker exec "$PG_CONTAINER" pg_dump -U "$PG_USER" -d "$PG_DB" -Fc > "$BACKUP_FILE"
ls -lh "$BACKUP_FILE"

echo "==> 2/3 清空前计数"
docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -c \
  "SELECT 'sessions' t, count(*) FROM sessions
   UNION ALL SELECT 'rpe_logs', count(*) FROM rpe_logs
   UNION ALL SELECT 'deviation_logs', count(*) FROM deviation_logs
   UNION ALL SELECT 'cache_history_summaries', count(*) FROM cache_history_summaries
   UNION ALL SELECT 'cache_rpe_stats', count(*) FROM cache_rpe_stats
   UNION ALL SELECT 'heart_rate_samples', count(*) FROM heart_rate_samples
   UNION ALL SELECT 'users', count(*) FROM users;"

echo "==> 3/3 TRUNCATE 运动数据表（users 保留）"
docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 -c \
  "TRUNCATE TABLE sessions, deviation_logs, cache_history_summaries, cache_rpe_stats, heart_rate_samples RESTART IDENTITY CASCADE;"

echo "==> 清空后计数（sessions/rpe_logs/deviation_logs/caches/hr_samples 应为 0，users 不变）"
docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -c \
  "SELECT 'sessions' t, count(*) FROM sessions
   UNION ALL SELECT 'rpe_logs', count(*) FROM rpe_logs
   UNION ALL SELECT 'deviation_logs', count(*) FROM deviation_logs
   UNION ALL SELECT 'cache_history_summaries', count(*) FROM cache_history_summaries
   UNION ALL SELECT 'cache_rpe_stats', count(*) FROM cache_rpe_stats
   UNION ALL SELECT 'heart_rate_samples', count(*) FROM heart_rate_samples
   UNION ALL SELECT 'users', count(*) FROM users;"

echo "==> 完成。备份：$BACKUP_FILE"
