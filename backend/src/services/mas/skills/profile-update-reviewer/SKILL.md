---
name: "profile-update-reviewer"
description: "用户画像自动更新流程指南。当检测到触发条件（一天训练结束、用户报告受伤或影响画像关键参数的情况）时，Agent 必须先分析真实数据、生成 profile_update_confirm 确认卡片征求用户同意，用户确认后才调用 update_profile 写入，并用 audit_complete 卡片反馈更新结果。核心红线：未经用户确认绝不写画像；所有提案必须来自 MCP 工具返回的真实数据。"
category: "workflow"
version: "1.0.0"
---

# 用户画像自动更新流程 (Profile Update Reviewer)

## 何时使用本技能

**本技能对任何 scenario 都适用（包括普通 `chat`）**——它是场景无关的行为规范，不是给"建议管线"用的。只要对话中**语义上**出现了以下任一触发条件（用户不会说"我要更新画像"，他们只会描述自己的状态——你要主动识别），就按本技能流程处理：

| 触发条件 | 语义化识别信号（例） | trigger 值 |
|---------|---------|-----------|
| (a) 一天的训练结束 | `workout_complete` 总结收尾、用户说"今天练完了/收工"、当日最后一次训练分析完成 | `day_end` |
| (b) 用户告知身体异常 | 任何关于疼痛/僵硬/无力/活动受限的**描述性**表达，如"卧推的时候右边使不上劲""膝盖有点不舒服""肩膀僵" | `injury_report` |
| (b) 关键参数/状态变化 | 睡眠模式改变（"最近都睡不着"）、连续疲劳（"练了五天顶不住了"）、体重明显变化、停训复工、目标变更 | `key_parameter_change` |
| 用户主动要求 | "更新我的画像/记录一下" | `user_request` |

**识别要点**：触发判断基于语义而非关键词。用户描述"状态和以前不一样了"（睡不好/发力异常/持续疲劳）就是信号；不要因为用户没说"受伤/更新"等词就不触发。同理，**不要因为识别到触发就只给训练建议而跳过画像更新提议**——给建议的同时必须附带确认卡片，这是本技能的核心交付物。

**重要**：训练后的常规 load_anchors 更新（workout-complete-handler 技能 Step 3 的 PR 记录）不触发本技能——那是训练数据的自然延伸。本技能管的是**画像关键参数**的更新（active_limitations / recovery_state / memories / 重大锚点调整）。

## 核心原则（红线）

1. **先问后写**：任何画像写入前必须获得用户明确确认。检测到触发条件的那一轮，只生成 `profile_update_confirm` 卡片，**绝不调用 `update_profile`**。
2. **数据为据**：所有提案必须来自 `load_history` 等工具返回的真实数据，不得编造任何数值。
3. **最小改动**：只提议有依据的字段，不做"顺手"的无关更新。
4. **确认后反馈**：写入完成必须用 `audit_complete` 卡片告知用户更新了什么。

## 流程一：提案轮（检测到触发条件）

### Step 1: 读取当前画像

```
load_history({ include_dynamic: true, include_profile: true, limit: 10 })
```

拿到当前 `profile_dynamic`（load_anchors / active_limitations / recovery_state / memories）和最近 sessions。

### Step 2: 分析并形成提案

对照触发条件，逐字段判断是否需要更新：

- **day_end**：当日训练暴露的模式——连续疲劳（recovery_state 下调）、反复不适部位（active_limitations 追加）、用户口述的习惯/偏好（memories）。
- **injury_report**：受伤部位 → `active_limitations` 追加（`{ part, severity: 1-10, expire_at: 建议7天后自动过期, logged_at: 当前时间, auto_heal: true }`），并考虑下调关联动作的 load_anchors。
- **key_parameter_change**：体重变化 → 关联 bodyweight 类动作锚点；睡眠/压力 → recovery_state。
- **user_request**：按用户明确说的内容。

**没有值得更新的字段就不提案**——直接告知用户"当前画像无需更新"，不要为了走流程而生成卡片。

### Step 3: 生成 profile_update_confirm 卡片

```json
{
  "type": "profile_update_confirm",
  "data": {
    "title": "用户画像更新建议",
    "message": "你提到右肩卧推时有刺痛感。建议更新训练画像以保护恢复：",
    "trigger": "injury_report",
    "proposals": [
      {
        "field": "active_limitations",
        "label": "活动限制",
        "change": "新增右肩限制，严重度 4/10，7 天后自动过期",
        "value": { "part": "right_shoulder", "severity": 4 }
      },
      {
        "field": "memories",
        "label": "训练记忆",
        "change": "记录：2026-09 卧推出现右肩刺痛，暂避大重量推类动作"
      }
    ],
    "confirmLabel": "确认更新",
    "cancelLabel": "暂不更新"
  }
}
```

字段规范：
- `proposals[].field` 只能是 `load_anchors | active_limitations | recovery_state | memories`
- `change` 必须是用户能看懂的一句话描述（写什么、为什么）
- `value` 可选，放提案的新值或摘要片段，供前端预览
- 卡片前后可有一两句话术（受全局 1000 字限制），卡片本身不算入长度

### Step 4: 提案轮到此结束

发出卡片后本轮回复结束。等用户确认，**不要在本轮调用 update_profile**。

## 流程二：执行轮（用户已确认）

用户回复确认（点确认气泡回传，或文字同意，如"好/更新吧/可以"）后：

### Step 1: 重新读取当前画像

```
load_history({ include_dynamic: true, include_profile: false, limit: 1 })
```

**必须重读**：用户画像可能在提案与确认之间已变化；且 `update_profile` 对 load_anchors / active_limitations 是替换语义，要先取当前值合并。

### Step 2: 合并并写入

把确认的提案合并进当前值，调用：

```
update_profile({
  active_limitations: [ ...当前列表, 新增条目 ],
  ...
})
```

只写用户确认过的字段。用户在确认时追加/修改的意见，按其意见调整后再写。

### Step 3: 生成 audit_complete 反馈卡片

```json
{
  "type": "audit_complete",
  "data": {
    "title": "画像已更新",
    "message": "已根据你的确认更新训练画像。",
    "actionLabel": "查看详情",
    "requiresConfirmation": false,
    "updates": [
      { "field": "active_limitations", "label": "活动限制", "count": 1, "details": ["右肩 · 严重度4 · 7天自动过期"] },
      { "field": "memories", "label": "训练记忆", "count": 1 }
    ]
  }
}
```

`updates[].field` 使用与 profile_dynamic 一致的下划线键名。一句话说明即可，勿长篇大论。

## 流程二变体：用户拒绝

用户拒绝（点取消、说"先不用/算了"）：简短致意（"好的，画像保持不变，有需要随时说"），**不写任何数据**，不追问。

## 红线检查清单

- [ ] 提案轮**绝对没有**调用 `update_profile`
- [ ] 提案前已调用 `load_history`，提案内容全部来自工具返回
- [ ] 执行轮写入前**重新**调用了 `load_history` 并做了合并
- [ ] 只写入用户确认的字段
- [ ] 写入后发出了 `audit_complete` 卡片
- [ ] 无依据时不生成确认卡片（宁可不更新）

## 版本历史

- **1.0.0** (2026-09-08) - 初始版本：触发检测 → 确认卡片 → 确认执行 → audit_complete 反馈闭环
