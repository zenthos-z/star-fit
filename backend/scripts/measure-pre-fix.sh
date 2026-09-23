#!/usr/bin/env bash
# 修复前（泄漏版 main，starfit-bench-new:43122）token 泄漏测量
set -u
BASE="${1:-http://127.0.0.1:43122}"
SUID="a015dd22-9fd2-47ae-bbcb-aaa90bd2aebb"
TID="bench-pre-$(date +%s)"
OUT=$(mktemp)
curl -sN -m 180 -X POST "$BASE/api/chat" \
  -H "content-type: application/json" \
  -H "x-user-id: $SUID" \
  -d "{\"userId\":\"$SUID\",\"threadId\":\"$TID\",\"message\":\"制定明天的训练计划\",\"scenario\":\"plan\",\"metadata\":{}}" \
  > "$OUT" 2>&1
python3 - "$OUT" <<'EOF'
import json, sys
chars = 0
events = 0
cards = []
for line in open(sys.argv[1]):
    line = line.strip()
    if not line.startswith("data: "):
        continue
    try:
        ev = json.loads(line[6:])
    except Exception:
        continue
    if ev.get("type") == "token":
        events += 1
        chars += len(ev.get("text", ""))
    elif ev.get("type") == "uiHint":
        cards.append(ev.get("card", {}).get("type", "?"))
print(f"PRE_FIX token_events={events} token_total_chars={chars} cards={cards}")
EOF
rm -f "$OUT"