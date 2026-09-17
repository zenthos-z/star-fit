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
for name in ('LiquidGlassPlugin', 'LiveActivityPlugin', 'SpeechRecognitionPlugin', 'WatchConnectivityPlugin'):
    if name not in lst:
        lst.append(name)
# saveImage 方法挂在 LiquidGlassPlugin 上，无需新增类；此注释仅提示 saveImage 依赖本插件的注册
d['packageClassList'] = lst
json.dump(d, open(p, 'w'), indent='\t', ensure_ascii=False)
print('packageClassList:', d['packageClassList'])
EOF
