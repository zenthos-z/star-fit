# 工具参考 (tool-reference)

6 个 MCP 工具的完整参数、返回、调用示例。工具定义源码在 `backend/src/services/agent/mcpTools.ts`。

---

## load_history（读）

读取当前用户的训练历史 + 静态画像 + 动态画像。**只读**，自动绑定当前用户。

**参数**
| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `include_profile` | bool | true | 是否返回 `profile_static`（长期画像：健身等级/标签/红旗） |
| `include_dynamic` | bool | true | 是否返回 `profile_dynamic`（负荷锚点/活动限制/恢复——计划硬约束） |
| `limit` | int(1-50) | 10 | 返回最近 N 次 session |

**返回**
```json
{
  "userId": "uuid",
  "history_summary": { "sessions": [ { "summary": "...", "date": "...", "exercises": [...], "recorded_at": "..." } ] },
  "profile_static": { "fitness_level": "BEGINNER", "tags": [...], "red_flags": [...] },
  "profile_dynamic": {
    "load_anchors": { "Back Squat": { "type": "resistance", "best_weight": 100, "best_reps": 5 } },
    "active_limitations": [ { "part": "left_knee", "severity": 6, "expire_at": "...", "logged_at": "...", "auto_heal": true } ],
    "recovery_state": { "total_score": 72, "cns_fusing": false, "last_assessed": "..." }
  }
}
```

**示例**：`load_history({ include_dynamic: true, limit: 5 })`

---

## list_exercises（读）

返回**整个**动作库。**只读**，**无参数**。动作库足够小，可全量塞进上下文，因此不再做向量/筛选搜索——一次拿到全量后，在上下文里自行据用户器械 + 伤病筛选。`description` 已带 pattern/targets/equipment/impact，足够判断某个动作适不适合。

**参数**：无（空对象 `{}`）

**返回**
```json
{ "count": 87, "exercises": [ { "id": "V1StGXR8_Z5jdHi6", "name": "Goblet Squat", "description": "resistance | beginner | pattern:squat | targets:quads+glutes | equipment:dumbbell | impact:knee:6" } ] }
```

`description` 字段格式（` | ` 分隔，字段均可能缺省）：
`<type> | <difficulty> | pattern:<动作模式> | targets:<主目标肌群，+分隔> | equipment:<所需器械，+分隔；无器械则 bodyweight> | impact:<关节:N>（仅列冲击≥5的关节）`

**示例**：`list_exercises({})` → 拿到全量后在上下文里挑：
- 用户只有哑铃 → 只保留 `equipment:dumbbell` 或 `equipment:bodyweight` 的
- 膝盖有旧伤 → 排除 `impact:knee:N` 里 N 偏高的（或挑 N 最低的）
- 练下肢 → 看 `targets:` 含股四头肌/腘绳肌/臀的

⚠️ 一个会话调一次即可，不要每轮重复调。

---

## get_exercise_detail（读）

按 id 取单个动作的完整记录（属性/教程/内容）。**只读**。

**参数**：`{ id: string }`（精确 id，来自 list_exercises）

**返回**
```json
{ "found": true, "exercise": { "id": "...", "name": "...", "exercise_type": "...", "difficulty": "...", "attributes": { "targets": {...}, "equipment_required": [...], "impact_level": {"knee":7,"back":4}, "pattern": "squat" }, "tutorials": { "cover": "...", "video": [...], "images": [...] }, "content_html": "..." } }
```
未找到时返回 `{ "found": false, "id": "..." }`。

**示例**：`get_exercise_detail({ id: "V1StGXR8_Z5jdHi6" })`

---

## write_session（写）

把一次完成的训练追加到当前用户历史。每次调用追加一条。

**参数**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `summary` | string(1-500) | 是 | 一句话总结 |
| `date` | string | 否 | ISO 日期，如 `2026-07-11` |
| `exercises` | array(max 50) | 否 | 每项 `{ name, sets?, reps?, weight?, rpe? }` |
| `notes` | string(max 1000) | 否 | 备注 |

**返回**：`{ "ok": true, "userId": "uuid", "sessions_count": 12 }`

**示例**
```json
write_session({
  "summary": "下肢日：深蹲 + 罗马尼亚硬拉",
  "date": "2026-07-11",
  "exercises": [ { "name": "Back Squat", "sets": 5, "reps": 5, "weight": 100, "rpe": 8 } ],
  "notes": "膝盖略有不适"
})
```

---

## update_profile（写）

结构化更新当前用户的 `profile_dynamic`。**浅合并到 profile_dynamic**；三个字段都是**整字段替换**（非追加），更新前先 `load_history` 取当前值再合并。

**参数（全部可选，至少传一个）**
| 参数 | 类型 | 说明 |
|------|------|------|
| `load_anchors` | map | `动作名 -> 锚点对象 {type, best_weight/best_reps/best_duration/best_pace...}`。**替换整个 map** |
| `active_limitations` | array | `[{ part, severity(1-10), expire_at(ISO), logged_at(ISO), auto_heal? }]`。**替换整个列表** |
| `recovery_state` | object | `{ total_score(0-100), last_assessed(ISO), cns_fusing?, acute_load?, chronic_load? }`。**替换** |

**返回**：`{ "ok": true, "userId": "uuid", "updated_fields": ["recovery_state"] }`

**示例**：训练后更新恢复分
```json
update_profile({ "recovery_state": { "total_score": 68, "last_assessed": "2026-07-11T13:00:00Z", "cns_fusing": true } })
```

**追加一条新伤（正确做法：先取再合并）**
```
1. load_history() → 取 profile_dynamic.active_limitations = [A, B]
2. 在客户端拼成 [A, B, 新伤C]
3. update_profile({ active_limitations: [A, B, 新伤C] })
```

---

## write_memory（写）

按 key 写/覆盖一条自由文本长期记忆到 `profile_dynamic.memories[key]`。适合存偏好、约定（如"周一只能练 30 分钟"）。

**参数**：`{ key: string(1-64), content: string(1-2000) }`

**返回**：`{ "ok": true, "userId": "uuid", "key": "..." }`

**示例**：`write_memory({ key: "pref_short_monday", content: "用户周一只能短练 30 分钟，以复合动作为主" })`
