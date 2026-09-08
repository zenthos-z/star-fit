# profile-update-reviewer 示例库

本文件供 Agent 按需读取（`read_file`），给出三类典型触发场景的完整提案示例。

## 示例 1：用户报告受伤（trigger: injury_report）

用户说："今天卧推的时候右肩有点刺痛，不敢上重量了。"

流程：
1. `load_history({ include_dynamic: true, include_profile: true, limit: 10 })`
2. 发现当前 active_limitations 为空、卧推锚点 60kg。
3. 生成提案卡片：

```json
{
  "type": "profile_update_confirm",
  "data": {
    "title": "用户画像更新建议",
    "message": "右肩刺痛需要保护。建议更新训练画像：",
    "trigger": "injury_report",
    "proposals": [
      {
        "field": "active_limitations",
        "label": "活动限制",
        "change": "新增右肩限制，严重度 4/10，7 天后自动过期",
        "value": { "part": "right_shoulder", "severity": 4, "auto_heal": true }
      },
      {
        "field": "memories",
        "label": "训练记忆",
        "change": "记录：2026-09-08 卧推右肩刺痛，暂停大重量推类动作"
      }
    ],
    "confirmLabel": "确认更新",
    "cancelLabel": "暂不更新"
  }
}
```

4. 用户确认后：重新 `load_history` 取当前 active_limitations（当前为空数组），合并后写入：

```
update_profile({
  active_limitations: [
    { part: "right_shoulder", severity: 4,
      expire_at: "<提案时+7天 ISO>", logged_at: "<当前 ISO>", auto_heal: true }
  ]
})
```

5. 发 audit_complete 反馈卡片。

## 示例 2：一天训练收尾发现连续疲劳（trigger: day_end）

workout_complete 总结完成后，发现本周第 4 次训练、今日 RPE 9、连续两天睡眠差。

```json
{
  "type": "profile_update_confirm",
  "data": {
    "title": "用户画像更新建议",
    "message": "今天练得不错，但这周连续 4 次训练且睡眠偏差，建议把恢复评分调低一些：",
    "trigger": "day_end",
    "proposals": [
      {
        "field": "recovery_state",
        "label": "恢复状态",
        "change": "恢复评分 78 → 65（连续训练 + 睡眠偏差）",
        "value": { "total_score": 65, "reason": "4连训+睡眠偏差" }
      }
    ],
    "confirmLabel": "确认更新",
    "cancelLabel": "先不改"
  }
}
```

注意：recovery_state 若原值为 null（从未评估过），`change` 写"首次建立恢复评估，评分 65"。

## 示例 3：关键参数变化（trigger: key_parameter_change）

用户说："最近体重涨到 78kg 了（之前记录 74kg）。"

```json
{
  "type": "profile_update_confirm",
  "data": {
    "title": "用户画像更新建议",
    "message": "体重从 74kg 到 78kg，影响自重类动作的负荷估算：",
    "trigger": "key_parameter_change",
    "proposals": [
      {
        "field": "memories",
        "label": "训练记忆",
        "change": "记录：2026-09 体重 74kg → 78kg，引体/双杠类按新体重评估"
      }
    ]
  }
}
```

## 反例（不要这样做）

- **不要**在没有触发条件时生成确认卡片（如普通闲聊、动作咨询）。
- **不要**提案轮就调用 `update_profile`。
- **不要**一次提案超过 4 条——画像更新宁缺毋滥。
- **不要**把训练 PR 锚点更新放进确认卡片（那是 workout-complete-handler 的常规职责，无需确认）。

## 拒绝与部分确认

- 用户点"暂不更新"或说"算了"：回复一句话即可，不写数据。
- 用户说"只更新第一条"：执行轮只写第一条，其余忽略，audit_complete 的 updates[] 只含写入的字段。
- 用户在确认时补充信息（"肩膀是左肩不是右肩"）：按补充信息修正提案再写入。
