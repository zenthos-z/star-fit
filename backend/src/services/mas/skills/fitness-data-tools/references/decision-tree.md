# 调用时机决策树 (decision-tree)

按用户意图选择工具。优先级从上到下。

```
用户输入
│
├─ 要生成 / 调整训练计划？
│   └─ 强制链路：
│      load_history(include_dynamic=true)
│      → list_exercises()（拿到全量动作库 [{id,name,description}]，一次即可）
│      → 在上下文里自行筛选：description 已带 pattern/targets/equipment/impact，
│        据用户器械 + 伤病排除不合适的，只选库里真实存在的
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
├─ 用户问"我能做什么动作"/"帮我选动作"/"有没有练 X 的动作"？
│   └─ list_exercises() → 在 description 里按器械/肌群/难度/冲击自行筛
│      → 必要时 get_exercise_detail 看教程
│
├─ 用户问"XX 动作怎么做 / 标准是什么 / 适不适合我"？
│   └─ list_exercises() 按 name 找到 id（或直接用已知 id）
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
- ❌ 不调 `list_exercises` 就推荐动作 → 可能推荐用户器械做不了、或库里根本不存在的动作
- ❌ 知道用户有膝伤却不看 description 的 `impact:knee:N`、选了高冲击动作 → 加重伤情
- ❌ 重复多次调 `list_exercises`（一次拿到全量，缓存复用即可，不要每轮都查）
- ❌ `update_profile({ active_limitations: [单条新伤] })` 不先取现有列表 → 把已有伤病记录全覆盖丢失
- ❌ 把 `exercise_list` / 动作数组写成 JSON 字符串而不是数组
- ❌ 在写工具里传 `userId`（参数不存在，会被 schema 拒绝）
