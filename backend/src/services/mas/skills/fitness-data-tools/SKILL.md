---
name: "fitness-data-tools"
description: "健身训练数据工具指南。当需要读取或更新用户训练数据时必须先读本技能：生成训练计划前必须 load_history 取 profile_dynamic（负荷锚点/活动限制/恢复状态是计划硬约束），用 list_exercises 拿到全量动作库后在上下文里按用户器械/目标肌群/关节冲击自行筛选（动作库小、可全量入上下文，不做向量搜索），get_exercise_detail 确认细节；训练结束后必须 write_session 记录并 update_profile 据表现更新负荷锚点/限制/恢复。涉及用户数据读写、训练计划、训练后总结、动作推荐、用户画像更新、历史查询时一律适用。即使你已知道工具名，调用前仍应确认参数与时机约束。"
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

| 工具 | 方向 | 何时用 | 关键参数 |
|------|------|--------|----------|
| `load_history` | 读 | 任何需要用户数据的最开始 | `include_dynamic`(默认true)、`include_profile`(默认true)、`limit` |
| `list_exercises` | 读 | 拿到**全量**动作库（小、可全量入上下文），在上下文里自行按器械/肌群/冲击筛选 | 无参数（空对象 `{}`）；返回 `[{id,name,description}]`，`description` 带 pattern/targets/equipment/impact |
| `get_exercise_detail` | 读 | 确认某个动作的完整属性（器械/冲击/教程） | `id` |
| `write_session` | 写 | 训练结束后记录这次训练 | `summary`、`date`、`exercises[]`、`notes` |
| `update_profile` | 写 | 据训练表现更新画像（锚点/限制/恢复） | `load_anchors`、`active_limitations`、`recovery_state` |
| `write_memory` | 写 | 记一条自由文本长期记忆 | `key`、`content` |

所有写工具**自动绑定当前用户**，你无法、也不需要指定 `userId`。

## 调用顺序硬规则

### A. 生成训练计划（必须按序）

1. `load_history({ include_dynamic: true })` —— 拿到 `profile_dynamic`：**负荷锚点**（当前能力基线）、**活动限制**（伤病，硬约束）、**恢复状态**；以及 `history_summary`（近期训练）和 `profile_static`（长期画像）。
2. `list_exercises({})` —— 拿到**全量动作库** `[{id,name,description}]`（一次即可，不要重复调）。`description` 带 pattern/targets/equipment/impact，在上下文里自行筛出**用户实际能做**的动作：只保留用户器械能覆盖的（`equipment:...` 或 `equipment:bodyweight`），并避开受伤关节的高冲击动作（`impact:<关节>:N` 里 N 偏高的）。
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
- 问"XX 动作怎么做 / 适不适合我" → `list_exercises` 按 name 找到 id → `get_exercise_detail` 看教程与冲击
- 需要长期记住的偏好（如"周一只能短练"）→ `write_memory`

## 红线

1. **动作必须来自动作库**：计划/推荐里的每个动作都要能在 `list_exercises` 返回的列表里找到，不可凭记忆编造动作名。
2. **活动限制是硬约束**：`profile_dynamic.active_limitations` 命中的关节，选动作时必须用 `impact_joint`+`max_impact` 避开高冲击，或选替代动作。
3. **器械是硬约束**：用 `equipment` 传入用户拥有的器械，只返回用户实际能做的动作。
4. **替换语义**：`update_profile` 的 `load_anchors` / `active_limitations` 是**整字段替换**，不是追加。更新前先 `load_history` 取当前值，在客户端合并后再写回完整字段。
5. **写操作幂等性**：`write_session` 是追加（每次调用加一条）；`write_memory` 按 `key` 覆盖；`update_profile` 按字段浅合并。
6. **不暴露 userId**：写工具不接受 `userId` 参数，系统自动绑定当前用户，跨用户写会被拒绝。

## 详细参考（按需 read_file）

- `references/tool-reference.md` —— 6 个工具的完整参数 / 返回 / 调用示例
- `references/decision-tree.md` —— 调用时机决策树（什么场景调哪个）
- `references/examples.md` —— 计划生成与训练后两条端到端对话流
