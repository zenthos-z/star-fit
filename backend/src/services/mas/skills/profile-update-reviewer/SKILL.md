---
name: "profile-update-reviewer"
description: "用户画像自动更新流程指南。触发条件（一天训练结束、用户报告受伤或影响画像关键参数）出现时，先分析真实数据、生成 profile_update_confirm 确认卡片（提案带最终值 + 可选待续意图）。用户确认后系统确定性写入（不经 LLM），再自动续跑原始意图。红线：未经确认绝不写画像；提案必须来自工具返回的真实数据，弹卡轮算成最终值。"
category: "workflow"
version: "1.1.0"
---

# 用户画像自动更新流程 (Profile Update Reviewer)

## 何时使用本技能

**本技能对任何 scenario 都适用（包括普通 `chat`）**——它是场景无关的行为规范，不是给"建议管线"用的。只要对话中**语义上**出现了以下任一触发条件（用户不会说"我要更新画像"，他们只会描述自己的状态——你要主动识别），就按本技能流程处理：

| 触发条件              | 语义化识别信号（例）                                                                                | trigger 值             |
| --------------------- | --------------------------------------------------------------------------------------------------- | ---------------------- |
| (a) 一天的训练结束    | `workout_complete` 总结收尾、用户说"今天练完了/收工"、当日最后一次训练分析完成                      | `day_end`              |
| (b) 用户告知身体异常  | 任何关于疼痛/僵硬/无力/活动受限的**描述性**表达，如"卧推的时候右边使不上劲""膝盖有点不舒服""肩膀僵" | `injury_report`        |
| (b) 关键参数/状态变化 | 睡眠模式改变（"最近都睡不着"）、连续疲劳（"练了五天顶不住了"）、体重明显变化、停训复工、目标变更    | `key_parameter_change` |
| 用户主动要求          | "更新我的画像/记录一下"                                                                             | `user_request`         |

**识别要点**：触发判断基于语义而非关键词。用户描述"状态和以前不一样了"（睡不好/发力异常/持续疲劳）就是信号；不要因为用户没说"受伤/更新"等词就不触发。同理，**不要因为识别到触发就只给训练建议而跳过画像更新提议**——给建议的同时必须附带确认卡片，这是本技能的核心交付物。

**重要**：训练后的常规 load_anchors 更新（workout-complete-handler 技能 Step 3 的 PR 记录）不触发本技能——那是训练数据的自然延伸。本技能管的是**画像关键参数**的更新（active_limitations / recovery_state / memories / 重大锚点调整）。

## 核心原则（红线）

1. **先问后写**：任何画像写入前必须获得用户明确确认。检测到触发条件的那一轮，只生成 `profile_update_confirm` 卡片，**绝不调用 `update_profile`**。
2. **数据为据**：所有提案必须来自 `load_history` 等工具返回的真实数据，不得编造任何数值。
3. **最终值就位**：提案的 `value` 必须在弹卡那一轮算成**机器可执行的最终值**——用户点「确认更新」后由系统直接写入（`POST /api/profile/apply-proposals`，确定性端点，无 LLM、无第二轮），你没有机会再补算。
4. **最小改动**：只提议有依据的字段，不做"顺手"的无关更新。

## 流程一：提案轮（检测到触发条件）

### Step 1: 读取当前画像

```
load_history({ include_dynamic: true, include_profile: true, limit: 10 })
```

拿到当前 `profile_dynamic`（load_anchors / active_limitations / recovery_state / memories）和最近 sessions。

### Step 2: 分析并算出最终值

对照触发条件，逐字段判断是否需要更新，**并把每条提案的最终值当场算好**：

| field                | `value` 形状（必须）                                                  | 系统写入语义                                                                                      |
| -------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `load_anchors`       | `{ "<动作键>": { type, best_weight, best_reps, ... }, ... }` 非空 map | 按 key 合并（只覆盖提案里的键，不动其余锚点）                                                     |
| `active_limitations` | `[{ "part": "right_shoulder", "severity": 4 }, ...]` 新条目数组       | 追加（`expire_at` / `logged_at` / `auto_heal` 由系统盖章：默认 7 天后自动过期，**你不要算时间**） |
| `recovery_state`     | `{ "total_score": 55 }`（可含 cns_fusing 等已有键）                   | 整体替换（`last_assessed` 由系统盖章）                                                            |
| `memories`           | `{ "<记忆键>": "<一段话>" }` 非空 map                                 | 按 key 合并                                                                                       |

**没有值得更新的字段就不提案**——直接告知用户"当前画像无需更新"，不要为了走流程而生成卡片。

### Step 3: 生成 profile_update_confirm 卡片（含待续意图）

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
        "value": [{ "part": "right_shoulder", "severity": 4 }]
      },
      {
        "field": "memories",
        "label": "训练记忆",
        "change": "记录：2026-09 卧推出现右肩刺痛，暂避大重量推类动作",
        "value": {
          "right_shoulder_note": "2026-09 卧推出现右肩刺痛，暂避大重量推类动作"
        }
      }
    ],
    "pending_intent": {
      "user_message": "根据我的信息调整一下周计划",
      "summary": "画像写入后结合新的活动限制调整本周周计划",
      "scenario": "plan"
    },
    "confirmLabel": "确认更新",
    "cancelLabel": "暂不更新"
  }
}
```

字段规范：

- `proposals[].field` 只能是 `load_anchors | active_limitations | recovery_state | memories`
- `proposals[].value` **必填**，形状按 Step 2 的表；缺 value 或形状不对的卡片会被校验回路打回重发
- `change` 必须是用户能看懂的一句话描述（写什么、为什么）
- **`pending_intent`（待续意图）**：弹卡打断了用户的主任务时**必填**——
  - `user_message`：用户原话（触发本轮画像更新的原始请求）
  - `summary`：一句话任务摘要（写入完成后要继续做什么）
  - `scenario`：续跑轮场景，按原始意图选 `plan`（计划类任务）或 `chat`
  - 无主任务的触发（如 day_end 收尾、纯伤情上报）**省略该字段**
- 卡片前后可有一两句话术（受全局 1000 字限制），卡片本身不算入长度

### Step 4: 提案轮到此结束

发出卡片后本轮回复结束。等用户确认，**不要在本轮调用 update_profile**。

## 流程二：确认写入（系统确定性执行，无 Agent 轮）

用户点「确认更新」气泡按钮后，**写入不经过你**：

1. 前端直调 `POST /api/profile/apply-proposals`（确定性端点，无 LLM），把提案 `value` 按上表语义写入 `profile_dynamic`，毫秒级完成；卡片在同一气泡内流转为「已更新」终态。
2. 若卡片带了 `pending_intent`，前端自动把待续意图作为新一轮对话输入发来（消息带「（系统续跑指令）」标记）。**你收到该轮时画像已写入完毕**：
   - 直接续跑用户的原始任务（例：调出并调整周计划、输出计划卡片）；
   - **不要**重新提案画像更新、**不要**调用 `update_profile`、不要让用户再催一遍；
   - 需要最新画像时可正常 `load_history`（读到的已是新值）。
3. 用户点「暂不更新」→ 意图任务清除，你只需简短确认（见流程三），不写入任何数据。

## 流程三：文字确认（兜底路径，气泡之外）

用户不用气泡、直接文字回复确认（"好/更新吧/可以"）时，仍走 Agent 执行轮：

### Step 1: 重新读取当前画像

```
load_history({ include_dynamic: true, include_profile: false, limit: 1 })
```

**必须重读**：画像可能在提案与确认之间已变化；且 `update_profile` 对 load_anchors / active_limitations 是替换语义，要先取当前值合并。

### Step 2: 合并并写入

把确认的提案合并进当前值，调用 `update_profile`。只写用户确认过的字段。

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
      {
        "field": "active_limitations",
        "label": "活动限制",
        "count": 1,
        "details": ["右肩 · 严重度4 · 7天自动过期"]
      },
      { "field": "memories", "label": "训练记忆", "count": 1 }
    ]
  }
}
```

`updates[].field` 使用与 profile_dynamic 一致的下划线键名。一句话说明即可，勿长篇大论。

## 流程四：用户拒绝

用户拒绝（点取消、说"先不用/算了"）：简短致意（"好的，画像保持不变，有需要随时说"），**不写任何数据**，不追问。

## 红线检查清单

- [ ] 提案轮**绝对没有**调用 `update_profile`
- [ ] 提案前已调用 `load_history`，提案内容全部来自工具返回
- [ ] 每条提案的 `value` 是**最终值**且形状符合 Step 2 的表（时间字段不算、留给系统盖章）
- [ ] 弹卡打断了用户主任务时，卡片带 `pending_intent`（user_message + summary + scenario）
- [ ] 收到「（系统续跑指令）」轮：画像已写入，直接续跑原始任务，不重提案/重写入
- [ ] 文字确认兜底路径：写入前**重新**调用了 `load_history` 并做了合并，写后发 audit_complete
- [ ] 无依据时不生成确认卡片（宁可不更新）

## 版本历史

- **1.1.0** (2026-09-28) - B5 issue #37：确认改为纯程序化写入（前端直调确定性端点，无 Agent 执行轮）；提案 value 必须为弹卡轮算好的最终值；新增 pending_intent 待续意图 + 续跑主线；文字确认保留为兜底路径
- **1.0.0** (2026-09-08) - 初始版本：触发检测 → 确认卡片 → 确认执行 → audit_complete 反馈闭环
