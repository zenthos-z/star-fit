---
name: "fitness-data-tools"
description: "健身训练数据工具指南。读取或更新用户训练数据前必先读本技能：生成计划前必先 load_history（负荷锚点/活动限制/恢复状态是硬约束），选动作必先 find_exercises（肌群×模式×器械×难度组合筛选+精排短列表，≤3 次收敛禁翻页），list_exercises 用于关键词检索/浏览（分页 30 条/次），get_exercise_detail 确认细节；训练后 write_session + update_profile 更新锚点/限制/恢复。涉及数据读写、计划、训练后总结、动作推荐、画像更新、历史查询时适用。"
---

# 健身训练数据工具指南 (fitness-data-tools)

## 何时使用本技能

只要你的回答需要基于**这个用户的真实数据**或**真实动作库**，就必须用本技能里的工具去取，而不是凭记忆编。典型触发：

- 生成 / 调整训练计划
- 用户问"我能做什么动作""帮我选动作""适合我的训练"
- 训练结束后总结、记录训练、据表现调整后续
- 回答涉及用户的能力水平、伤病限制、恢复状态、训练历史
- 更新用户画像（新的 PR、新出现的伤痛、恢复变化）

## 工具总览

| 工具                  | 方向 | 何时用                                                                                | 关键参数                                                                                                                                                                             |
| --------------------- | ---- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `load_history`        | 读   | 任何需要用户数据的最开始                                                              | `include_dynamic`(默认true)、`include_profile`(默认true)、`limit`                                                                                                                    |
| `find_exercises`      | 读   | **计划/选动作首选**：肌群×模式×器械×难度组合筛选，返回精排短列表（无分页，≤3 次收敛） | `muscle_groups`(必填,1-6)、`movement_pattern`、`equipment[]`、`difficulty`、`exclude_ids`、`limit`(默认10)；空结果带 `relax_hint` 指明放宽哪个维度                                   |
| `list_exercises`      | 读   | 关键词检索/浏览动作库（分页工具，默认 30 条/次），结果里再按冲击/难度筛               | `body_part`、`equipment`、`keyword`、`limit`(默认30)、`offset`；返回 `{total,has_more,exercises:[{id,name,name_zh,description}]}`，`description` 带 pattern/targets/equipment/impact |
| `get_exercise_detail` | 读   | 确认某个动作的完整属性（器械/冲击/教程）                                              | `id`                                                                                                                                                                                 |
| `write_session`       | 写   | 训练结束后记录这次训练                                                                | `summary`、`date`、`exercises[]`、`notes`                                                                                                                                            |
| `update_profile`      | 写   | 据训练表现更新画像（锚点/限制/恢复）                                                  | `load_anchors`、`active_limitations`、`recovery_state`                                                                                                                               |
| `write_memory`        | 写   | 记一条自由文本长期记忆                                                                | `key`、`content`                                                                                                                                                                     |

所有写工具**自动绑定当前用户**，你无法、也不需要指定 `userId`。

## 调用顺序硬规则

### A. 生成训练计划（必须按序）

1. `load_history({ include_dynamic: true })` —— 拿到 `profile_dynamic`：**负荷锚点**（当前能力基线）、**活动限制**（伤病，硬约束）、**恢复状态**；以及 `history_summary`（近期训练）和 `profile_static`（长期画像）。
2. `find_exercises({ muscle_groups, movement_pattern, equipment, difficulty, limit })` —— **组合筛选，≤3 次收敛**：每个训练日一次组合查询（如推日 = `muscle_groups:["chest","shoulders","triceps"] + movement_pattern:"push" + equipment:[用户器械] + difficulty:[用户等级]`），一次最多 6 肌群、短列表已按主肌群命中精排。候选不够 → 按 `relax_hint` 最高计数**放宽一个维度**补查一次。合计 ≤3 次封顶，**禁止 `list_exercises` 翻页遍历**。找配件动作（提踵/髋外展等）时不传 `movement_pattern`（未归类配件会被该参数排除）。
3. 必要时对候选用 `get_exercise_detail({ id })` 二次确认（如核对某动作对受伤关节的 `impact_level`、所需器械、教程是否存在）。
4. 基于真实动作 + 用户锚点排计划，负荷参考 `load_anchors`，**不要凭空编动作名或重量**。
5. 用 `uiHint` 的 `plan` 卡片输出。

### B. 训练结束后（必须按序）

1. `write_session({ summary, date, exercises: [...], notes })` —— 先把这次训练落库到历史。
2. `update_profile({ ... })` —— 据这次表现更新画像：
   - 创了 PR / 锚点变化 → 更新 `load_anchors`（**替换语义**：先从 load_history 取当前 map，改对应条目，再传完整 map 回来）
   - 出现新伤痛 / 旧伤复发 → `active_limitations`（**替换语义**：先取当前列表，追加新条目，再传完整列表）
   - 恢复状态变化 → `recovery_state`

### C. 一般问答

- 问历史/进步 → `load_history`
- 问"XX 动作怎么做 / 适不适合我" → `list_exercises({ keyword: "<动作名/中文名>" })` 找到 id → `get_exercise_detail` 看教程与冲击
- 问"帮我选动作/适合我的训练" → `find_exercises`（肌群+器械+难度组合筛选）
- 需要长期记住的偏好（如"周一只能短练"）→ `write_memory`

## 红线

1. **动作必须来自动作库**：计划/推荐里的每个动作都要能在 `find_exercises`/`list_exercises` 返回的列表里找到，不可凭记忆编造动作名。
2. **活动限制是硬约束**：`profile_dynamic.active_limitations` 命中的关节，选动作时必须用 `impact_joint`+`max_impact` 避开高冲击，或选替代动作。
3. **器械是硬约束**：`find_exercises` 的 `equipment` 传入用户拥有的器械，只返回用户实际能做的动作。
4. **替换语义**：`update_profile` 的 `load_anchors` / `active_limitations` 是**整字段替换**，不是追加。更新前先 `load_history` 取当前值，在客户端合并后再写回完整字段。
5. **写操作幂等性**：`write_session` 是追加（每次调用加一条）；`write_memory` 按 `key` 覆盖；`update_profile` 按字段浅合并。
6. **不暴露 userId**：写工具不接受 `userId` 参数，系统自动绑定当前用户，跨用户写会被拒绝。
7. **选动作 ≤3 次**：计划流选动作合计 ≤3 次 `find_exercises`（合并大查询 + relax_hint 放宽重查），禁止翻页遍历动作库。

## 详细参考（按需 read_file）

- `references/tool-reference.md` —— 7 个工具的完整参数 / 返回 / 调用示例
- `references/decision-tree.md` —— 调用时机决策树（什么场景调哪个）
- `references/examples.md` —— 计划生成与训练后两条端到端对话流
