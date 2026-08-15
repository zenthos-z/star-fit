# 端到端示例 (examples)

两条完整对话流，演示工具调用顺序。

---

## 示例 1：生成训练计划

**用户**：「帮我排个下肢日，我家里只有哑铃，左膝盖之前受过伤」

**Agent 工具调用序列**

1. `load_history({ include_dynamic: true, limit: 5 })`
   → 得到：
   - `profile_dynamic.load_anchors`：`{ "Goblet Squat": { type:"resistance", best_weight:20, best_reps:10 } }`
   - `profile_dynamic.active_limitations`：`[{ part:"left_knee", severity:6, expire_at:"2026-08-01T00:00:00Z", logged_at:"2026-06-15T00:00:00Z", auto_heal:true }]`
   - `profile_dynamic.recovery_state`：`{ total_score:80, last_assessed:"..." }`
   - `profile_static.fitness_level`：`"INTERMEDIATE"`

2. `list_exercises({})`
   → 得到全量动作库 `[{id,name,description}]`。在上下文里筛：只留 `equipment:dumbbell` 或 `equipment:bodyweight` 的，再排除 `impact:knee:N` 里 N 偏高的，最终挑出低膝冲击、哑铃可做的下肢动作（Goblet Squat / DB RDL / Bulgarian Split ...）。

3. `get_exercise_detail({ id: "<Bulgarian Split 的 id>" })`
   → 核对 `attributes.impact_level.knee=3`（可接受）、`equipment_required=["dumbbell"]`、有 `tutorials.video`。

4. 基于真实动作 + `load_anchors`（Goblet Squat 20×10）排重量/次数，输出 `plan` 卡片，说明已避开高膝冲击动作。

**输出**：`{ type:"plan", title:"下肢日（哑铃·护膝）", data:{ sessions:[...] }, ... }` + 文字说明。

---

## 示例 2：训练结束后

**用户**：「刚练完，深蹲 100kg×5 感觉左膝有点不适，整体还行」

**Agent 工具调用序列**

1. `write_session({ summary:"下肢日，深蹲 100×5，左膝略有不适", date:"2026-07-11", exercises:[{ name:"Back Squat", sets:5, reps:5, weight:100, rpe:8 }], notes:"左膝不适" })`
   → `{ ok:true, userId, sessions_count:13 }`

2. `load_history({ include_dynamic:true, limit:1 })` （取当前 profile_dynamic 以便安全合并）
   → 当前 `load_anchors["Back Squat"]` = `{ best_weight:95, best_reps:5 }`（旧）
   → 当前 `active_limitations` = `[{ ...left_knee 旧记录 ... }]`

3. 在客户端合并后写回：
   - `update_profile({ load_anchors: { ..., "Back Squat": { type:"resistance", best_weight:100, best_reps:5 } } })`（PR 更新，传完整 map）
   - `update_profile({ active_limitations: [ <旧 left_knee 记录更新 severity/expire>, ...其余 ] })`（追加/更新膝伤，传完整列表）
   - `update_profile({ recovery_state: { total_score:65, last_assessed:"2026-07-11T13:00:00Z", cns_fusing:false } })`

4. 输出 `summary` 或 `deviation` 卡片：确认记录、提示膝伤注意、下次下肢日降冲击。

---

## 示例 3：一般问答

**用户**：「罗马尼亚硬拉主要练哪？我腰不好能做吗？」

1. `list_exercises({})` → 在返回列表里按 name 找到 "Romanian Deadlift" 的 id
2. `get_exercise_detail({ id })` → `attributes.targets.primary=["hamstrings","glutes"]`，`impact_level.back=5`
3. 回答：主要练腘绳肌+臀；腰部冲击 5/10，腰不好需控制重量、保持脊柱中立，或选冲击更低的变体。
