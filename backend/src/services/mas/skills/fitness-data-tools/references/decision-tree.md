# 调用时机决策树 (decision-tree)

按用户意图选择工具。优先级从上到下。

```
用户输入
│
├─ 要生成 / 调整训练计划？
│   └─ 强制链路：
│      load_history(include_dynamic=true)
│      → find_exercises({ muscle_groups: [该日目标肌群], movement_pattern: "<推/拉/蹲…>",
│        equipment: [用户器械], difficulty: <用户等级>, limit: 10-12 })
│        （组合筛选，一次收窄四维；≤3 次收敛：候选不够按 relax_hint 最高计数
│          放宽单一维度补查；一次最多 6 肌群，可把推日胸+肩+三头并一次查）
│      → 短列表已精排（主肌群命中排前），直接从中挑；空结果看 relax_hint
│      → （可选）get_exercise_detail(候选 id) 看教程/确认冲击值
│      → 排计划（负荷参考 load_anchors）
│      → plan 卡片输出
│
├─ 用户刚练完 / 报告训练结果？
│   └─ 强制链路：
│      write_session(summary + exercises + date)
│      → update_profile(据表现更新 load_anchors / active_limitations / recovery_state)
│      → （可选）summary/deviation 卡片
│
├─ 用户问"我能做什么动作"/"有没有练 X 的动作"？
│   └─ find_exercises({ muscle_groups: [X], equipment: [用户器械], difficulty: <用户等级> })
│      （找提踵/髋外展等配件时不传 movement_pattern）
│
├─ 用户问"XX 动作怎么做 / 标准是什么 / 适不适合我"？
│   └─ list_exercises({ keyword: "<动作名/中文名>" }) 找到 id（或直接用已知 id）
│      → get_exercise_detail(id) 看 content_html / tutorials / impact_level
│
├─ 用户问历史 / 进步 / 最近练了什么 / 个人能力？
│   └─ load_history
│
├─ 用户说出新的伤病 / 限制 / 偏好，需要长期记住？
│   ├─ 结构化的能力/限制/恢复 → update_profile
│   └─ 自由文本偏好/约定       → write_memory
│
└─ 不需要用户数据、也不需要动作库（如通用健身常识问答）
    └─ 直接回答，不调工具
```

## 反模式（不要这样做）

- ❌ 不调 `load_history` 就排计划 → 计划会脱离用户的真实能力与限制
- ❌ 计划选动作不用 `find_exercises`、却用 `list_exercises` 按部位翻页 → 动作库 355 条
  永远翻不完，思考链被无谓拉长；选动作一律组合筛选 ≤3 次收敛
- ❌ 不查动作库就推荐动作 → 可能推荐用户器械做不了、或库里根本不存在的动作
- ❌ 知道用户有膝伤却不看 description 的 `impact:knee:N`、选了高冲击动作 → 加重伤情
- ❌ 选动作超过 3 次工具调用 → 合并多日为大查询（一次最多 6 肌群）或按 relax_hint
  放宽单一维度，绝不翻页（find_exercises 无 offset）
- ❌ 重复多次调同一过滤条件的查询（查一次缓存复用即可，不要每轮都查）
- ❌ `update_profile({ active_limitations: [单条新伤] })` 不先取现有列表 → 把已有伤病记录全覆盖丢失
- ❌ 把 `exercise_list` / 动作数组写成 JSON 字符串而不是数组
- ❌ 在写工具里传 `userId`（参数不存在，会被 schema 拒绝）
