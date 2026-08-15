---
name: "workout-complete-handler"
description: "训练结束后处理流程指南。当收到 workout_complete scenario 时，Agent 必须按本技能定义的顺序调用 MCP 工具：先 load_history 获取已持久化的训练数据（前端已通过 POST /api/sessions 写入），分析后决定是否更新 profile_dynamic，最后生成 survey_card。核心目标：确保 Agent 使用真实数据分析，防止幻觉；smart survey 只问关键问题，避免过度打扰用户。"
category: "workflow"
version: "1.0.0"
---

# 训练结束后处理流程 (Workout Complete Handler)

## 何时使用本技能

当收到 `scenario: 'workout_complete'` 请求时，必须按本技能定义的流程处理。

**关键前提**：前端已经在训练结束时将 session 数据通过 `POST /api/sessions` 持久化到数据库。Agent 不需要、也不应该直接从前端接收原始训练数据。

## 核心原则

1. **数据从数据库读取**：Agent 必须通过 `load_history` 获取已持久化的 session 数据
2. **防止幻觉**：所有分析必须基于 MCP 工具返回的真实数据，不得凭空编造
3. **Smart Survey**：只问有价值的问题，最多 3 个，根据训练异常情况动态决定

## 流程（必须按序执行）

### Step 1: 调用 load_history 获取数据

```
load_history({
  include_dynamic: true,  // 获取 profile_dynamic（锚点/限制/恢复状态）
  include_profile: true,  // 获取 profile_static
  limit: 10               // 获取最近 10 条 session
})
```

**返回内容**：
- `history_summary.sessions[]` - 最近的训练记录，最新的在数组末尾
- `profile_dynamic` - 负荷锚点、活动限制、恢复状态
- `profile_static` - 用户基本信息、偏好

**关键**：最新的 session 就是刚刚持久化的本次训练，从 `sessions[sessions.length - 1]` 获取。

### Step 2: 分析最新 session

分析维度：

1. **负荷统计**
   - 计算总容量：`Σ(weight × reps × sets)`
   - 对比 `profile_dynamic.load_anchors` 检查是否有新的 PR

2. **异常检测**
   - 重量下调（相比锚点或上次）：可能表示疲劳或不适
   - 未完成的组/次：可能表示挑战过大或疲劳
   - 训练时长异常：过长（>90min）或过短（<15min）

3. **训练频率**
   - 统计本周 session 数量（从 `history_summary.sessions` 中筛选）
   - 如果 >4 次，提示恢复关注

### Step 3: 更新画像（如有必要）

根据分析结果调用 `update_profile`：

**情况 A：检测到新的 PR**
```
update_profile({
  load_anchors: {
    // 先从 load_history 获取当前 load_anchors
    // 更新对应动作的锚点
    "bench_press": { type: "weight", best_weight: 65, best_reps: 8, date: "2026-07-14" }
  }
})
```

**情况 B：用户报告疲劳或恢复问题（从 survey 反馈）**
```
update_profile({
  recovery_state: {
    total_score: 65,
    last_assessed: "2026-07-14T12:00:00Z",
    acute_load: 8500,
    chronic_load: 42000
  }
})
```

**情况 C：发现新的活动限制（从 survey 或训练表现推断）**
```
update_profile({
  active_limitations: [
    // 获取当前列表，追加新条目
    { part: "left_knee", severity: 5, expire_at: "2026-07-21T00:00:00Z", logged_at: "2026-07-14T12:00:00Z", auto_heal: true }
  ]
})
```

### Step 4: 生成 survey_card

**核心原则**：只问有价值的问题，最多 3 个。

#### Smart Survey 规则

根据 Step 2 的分析结果决定问题：

| 检测到的异常 | 推荐问题 | 优先级 |
|------------|---------|--------|
| 重量下调 >10% | 该动作是否有不适？具体部位？ | 高 |
| 训练时长 >90min | 疲劳程度（RPE 1-10） | 中 |
| 本周训练 >4次 | 恢复状态如何？ | 中 |
| 无明显异常 | 疲劳程度（RPE 1-10）- 可选 | 低 |

**示例 survey_card 生成**：

```json
{
  "type": "survey_card",
  "data": {
    "title": "训练反馈",
    "sessionId": "from request metadata",
    "questions": [
      {
        "id": "fatigue_level",
        "question": "今天的训练感觉有多累？（1-10分）",
        "required": false,
        "inputType": "number",
        "placeholder": "请输入 1-10 的分数"
      },
      {
        "id": "sleep_quality",
        "question": "昨晚睡眠质量如何？",
        "required": false,
        "options": [
          { "label": "很好", "value": "excellent" },
          { "label": "一般", "value": "average" },
          { "label": "较差", "value": "poor" }
        ]
      }
    ]
  }
}
```

#### survey_card Schema

```typescript
{
  type: "survey_card",
  data: {
    title?: string,           // 卡片标题
    subtitle?: string,        // 副标题
    sessionId?: string,       // 关联的 session ID
    questions: [              // 问题数组（1-3 个）
      {
        id: string,           // 问题唯一标识
        question: string,     // 问题文本
        required?: boolean,   // 是否必填（默认 false）
        options?: [           // 选项（有则显示按钮）
          { label: string, value: string }
        ],
        inputType?: "text" | "number",  // 输入类型（无 options 时）
        placeholder?: string  // 输入框占位符
      }
    ]
  }
}
```

### Step 5: 生成总结文字

用自然语言总结本次训练，内容必须来自 `load_history` 返回的真实数据：

```
本次训练完成 4 个动作，用时 45 分钟，总容量 4800kg。
- 杠铃卧推：4组×8次×60kg（与锚点持平）
- 哑铃飞鸟：3组×12次×15kg（新PR！）
- 绳索夹胸：3组×15次×15kg
- 俯卧撑：3组×20次

训练负荷适中，动作选择符合你的当前水平。
```

**红线**：不得出现 `load_history` 未返回的数据（如虚假的组数、重量等）。

---

## Survey 上传后处理（survey_upload）

当收到 `type: 'survey_upload'` 时，**必须按以下步骤执行**：

### Step 1: 调用 load_history 获取最新画像

```
load_history({
  include_dynamic: true,
  include_profile: true,
  limit: 5
})
```

获取用户当前的：
- `profile_dynamic`（recovery_state, active_limitations, load_anchors）
- `profile_static`（用户基本信息）

### Step 2: 根据 survey 答案分析

从 `intent_context.data.responses` 中提取答案，分析：

| 答案字段 | 分析规则 | 建议动作 |
|---------|---------|---------|
| `fatigue_level` | 值 >= 7 表示高疲劳 | 更新 `recovery_state.total_score` 降低 10-20% |
| `sleep_quality` | 值为 'poor' | 调用 `write_memory` 记录睡眠问题，影响恢复评估 |
| `discomfort` / `pain` | 存在则表示受伤风险 | 添加到 `active_limitations`，设置 7 天自动过期 |
| `additional_notes` | 提取关键词判断意图 | 如有疼痛描述，记录到 `active_limitations` |

### Step 3: 调用 update_profile 更新画像

**重要**：`update_profile` 是**替换语义**，必须传入完整字段。

```javascript
// 示例：更新恢复状态
update_profile({
  recovery_state: {
    total_score: 65,  // 从 load_history 获取当前值，根据 fatigue_level 调整
    last_assessed: new Date().toISOString(),
    acute_load: ...,  // 从历史 sessions 计算
    chronic_load: ...
  }
})

// 示例：添加活动限制
update_profile({
  active_limitations: [
    // 先从 load_history 获取当前列表
    ...currentLimitations,
    // 追加新限制
    {
      part: "left_knee",
      severity: 5,
      expire_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      logged_at: new Date().toISOString(),
      auto_heal: true
    }
  ]
})
```

### Step 4: 返回 audit_complete

```json
{
  "type": "audit_complete",
  "data": {
    "message": "感谢反馈！已根据您的回答更新训练画像。",
    "updates": [
      { "field": "recovery_state", "label": "恢复状态", "count": 1 },
      { "field": "active_limitations", "label": "活动限制", "count": 1 }
    ]
  }
}
```

### 红线检查

- [ ] **必须先调用 load_history**：获取当前画像，不能直接覆盖
- [ ] **update_profile 是替换语义**：必须先获取当前值，合并后再写入
- [ ] **必须实际调用 update_profile**：不能只生成文字回复

---

## 红线检查清单

- [ ] **必须先调用 load_history**：不得跳过此步骤直接生成内容
- [ ] **数据必须来自 MCP 工具**：不得使用前端传递的原始数据
- [ ] **Survey 最多 3 个问题**：不得过度打扰用户
- [ ] **Survey 问题必须有针对性**：根据训练异常情况动态生成
- [ ] **不编造数据**：所有数字（组数、重量、时间）必须来自工具返回

---

## 示例流程

### 正常训练结束

```
用户结束训练 → 前端 POST /api/sessions → 数据持久化
                    ↓
用户打开 AI Coach → Agent 收到 workout_complete
                    ↓
Agent: load_history() → 获取最新 session + profile
                    ↓
Agent 分析：4 个动作，45 分钟，无异常
                    ↓
Agent: 生成总结 + survey_card（仅问疲劳程度）
                    ↓
用户填写 survey → Agent 收到 survey_upload
                    ↓
Agent: load_history() + update_profile(recovery_state)
                    ↓
Agent: 返回 audit_complete
```

### 检测到重量下调

```
Agent 分析：卧推重量从 60kg 降到 50kg（下调 17%）
                    ↓
Smart Survey 生成：
- 问题1：疲劳程度（RPE）
- 问题2：卧推时胸部/肩部是否有不适？
                    ↓
用户回答：肩部有轻微不适
                    ↓
Agent: update_profile(active_limitations)
添加：{ part: "right_shoulder", severity: 4, expire_at: "..." }
```

---

## 版本历史

- **1.0.0** (2026-07-14) - 初始版本，定义 workout_complete 处理流程
