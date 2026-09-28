# 工具参考 (tool-reference)

6 个 MCP 工具的完整参数、返回、调用示例。工具定义源码在 `backend/src/services/agent/mcpTools.ts`。

---

## load_history（读）

读取当前用户的训练历史 + 静态画像 + 动态画像。**只读**，自动绑定当前用户。

**参数**

| 参数              | 类型      | 默认 | 说明                                                             |
| ----------------- | --------- | ---- | ---------------------------------------------------------------- |
| `include_profile` | bool      | true | 是否返回 `profile_static`（长期画像：健身等级/标签/红旗）        |
| `include_dynamic` | bool      | true | 是否返回 `profile_dynamic`（负荷锚点/活动限制/恢复——计划硬约束） |
| `limit`           | int(1-50) | 10   | 返回最近 N 次 session                                            |

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

**过滤 + 分页**浏览动作库。**只读**。全库约 355 条，单次调用默认只返回 30 条——**不要试图一次拉全量**：先按 `body_part` / `equipment` / `keyword` 过滤（计划流程 = 每个目标肌群一次 body_part 查询），仅当 `has_more=true` 且确实需要更多候选时才用 `offset` 翻页。`description` 已带 pattern/targets/equipment/impact，足够判断某个动作适不适合。

**参数**（全部可选）：

| 参数        | 说明                                                                                                                                                     |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `body_part` | 按部位过滤（不区分大小写包含）：`chest` / `back` / `shoulders` / `waist` / `upper_arms` / `lower_arms` / `upper_legs` / `lower_legs` / `hips` / `cardio` |
| `equipment` | 按器械过滤：`barbell` / `dumbbell` / `machine` / `cable` / `band` / `bodyweight` / `kettlebell` 等                                                       |
| `keyword`   | 自由文本，匹配 name / name_zh / 部位 / 肌群，如 `"squat"`、`"卧推"`、`"glutes"`                                                                          |
| `limit`     | 本页行数（默认 30，最大 100）——优先用过滤而不是翻页                                                                                                      |
| `offset`    | 跳过的行数（默认 0），`has_more=true` 时才翻页                                                                                                           |

**返回**

```json
{
  "total": 28,
  "count": 28,
  "offset": 0,
  "limit": 30,
  "has_more": false,
  "exercises": [
    {
      "id": "V1StGXR8_Z5jdHi6",
      "name": "Goblet Squat",
      "name_zh": "高脚杯深蹲",
      "exercise_type": "resistance",
      "description": "resistance | beginner | pattern:squat | targets:quads+glutes | equipment:dumbbell | impact:knee:6"
    }
  ]
}
```

`total` 是过滤后的总条数，`count` 是本页条数，`has_more` 告知是否还有下一页。

`description` 字段格式（`|` 分隔，字段均可能缺省）：
`<type> | <difficulty> | pattern:<动作模式> | targets:<主目标肌群，+分隔> | equipment:<所需器械，+分隔；无器械则 bodyweight> | impact:<关节:N>（仅列冲击≥5的关节）`

**示例**（两步查询：先按部位过滤，再在结果里按器械 + 伤病挑）：

- 排下肢日 → `list_exercises({ body_part: "upper_legs" })`（下肢为主时可再加 `{ body_part: "hips" }`）→ 结果里只保留 `equipment:dumbbell` 或 `equipment:bodyweight` 的
- 膝盖有旧伤 → 在返回页里排除 `impact:knee:N` 里 N 偏高的（或挑 N 最低的）
- 找特定动作 → `list_exercises({ keyword: "卧推" })` 按 `name_zh` 命中

⚠️ 同一过滤条件的查询一个会话只调一次，缓存复用结果；不要每轮重复调，也不要无过滤地盲翻页。

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

| 参数        | 类型             | 必填 | 说明                                         |
| ----------- | ---------------- | ---- | -------------------------------------------- |
| `summary`   | string(1-500)    | 是   | 一句话总结                                   |
| `date`      | string           | 否   | ISO 日期，如 `2026-07-11`                    |
| `exercises` | array(max 50)    | 否   | 每项 `{ name, sets?, reps?, weight?, rpe? }` |
| `notes`     | string(max 1000) | 否   | 备注                                         |

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

| 参数                 | 类型   | 说明                                                                                            |
| -------------------- | ------ | ----------------------------------------------------------------------------------------------- |
| `load_anchors`       | map    | `动作名 -> 锚点对象 {type, best_weight/best_reps/best_duration/best_pace...}`。**替换整个 map** |
| `active_limitations` | array  | `[{ part, severity(1-10), expire_at(ISO), logged_at(ISO), auto_heal? }]`。**替换整个列表**      |
| `recovery_state`     | object | `{ total_score(0-100), last_assessed(ISO), cns_fusing?, acute_load?, chronic_load? }`。**替换** |

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
