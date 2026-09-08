#!/bin/bash
# E2E 稳定性验证：连跑 5 轮画像更新闭环
cd /Users/Admin/Documents/codelib/work/star-fit/main/backend
sleep 8
curl -s -m5 http://localhost:43111/health >/dev/null && echo HEALTHY
for i in 1 2 3 4 5; do
  node scripts/e2e-profile-update.mjs > /tmp/e2e-final-$i.log 2>&1
  echo "run$i exit=$? $(grep -oE '总结果: .*' /tmp/e2e-final-$i.log)"
done
