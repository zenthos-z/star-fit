#!/bin/bash
# cap sync 会把 ios/App/App/capacitor.config.json 的 packageClassList 清空，
# 手写原生插件 LiquidGlassPlugin 必须在列表里才会被 Capacitor 桥注册。
# 用法：npx cap sync ios && bash scripts/patch-capacitor-json.sh
set -e
cd "$(dirname "$0")/.."
python3 - <<'EOF'
import json
p = 'ios/App/App/capacitor.config.json'
d = json.load(open(p))
lst = d.get('packageClassList', [])
if 'LiquidGlassPlugin' not in lst:
    lst.append('LiquidGlassPlugin')
d['packageClassList'] = lst
json.dump(d, open(p, 'w'), indent='\t', ensure_ascii=False)
print('packageClassList:', d['packageClassList'])
EOF
