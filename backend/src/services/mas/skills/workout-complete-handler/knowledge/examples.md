# workout-complete-handler 示例库

本文件供 Agent 按需读取（原生 `read_file`），给出 workout_complete 场景的完整执行示例与边界情况。

## 示例 1：正常训练结束（无异常）

前端已把 session 落库。Agent 收到 workout_complete 后：

1. `load_history({ include_dynamic: true, include_profile: true, limit: 10 })`
2. 最新 session：4 个动作，45 分钟，总容量 4800kg，completed_sets == sets，无重量下调。
3. 负荷适中 → Smart Survey 只问 1 个低优先级问题（疲劳程度，可选）。
4. 输出：先 prose 总结（数据全部来自 load_history），再发 survey_card。

## 示例 2：检测到重量下调

最新 session 卧推 50kg × 8，load_anchors 里卧推锚点 60kg → 下调 17%。

1. survey_card 问两问：疲劳程度（RPE）+ 卧推时肩/胸是否不适（options: 无/肩部/胸部/其他）。
2. 用户回答"肩部有轻微不适"（survey_upload）→ 按 survey 上传流程：
   - `update_profile({ active_limitations: [ ...当前列表, { part: "right_shoulder", severity: 4, expire_at: "<+7天>", logged_at: "<现在>", auto_heal: true } ] })`
   - 回 audit_complete：`updates: [{ field: "active_limitations", label: "活动限制", count: 1 }]`

**边界**：这类 survey 驱动的限制登记是用户已直接回答的反馈，走本技能的正常流程，不需要 profile_update_confirm 确认卡片；profile-update-reviewer 的确认门针对的是**非 survey 场景**的画像关键参数变更（受伤陈述、收尾总结发现等）。

## 示例 3：PR 检测（常规锚点更新）

深蹲 100kg × 5，锚点 95kg → 新 PR。

- 常规 load_anchors 更新是训练数据的自然延伸，**直接** `update_profile` 合并写入（先 load 当前 map），无需确认卡片。
- 总结里标注"新 PR！"，survey 可省略或只问疲劳。

## 示例 4：时长异常

session 95 分钟（>90min 阈值）→ survey 问疲劳程度（中优先级）；<15 分钟 → 询问是否中断/受伤，若用户答受伤 → 转 profile-update-reviewer 技能流程（确认卡片）。

## 红线回顾

- 先 load_history 再说话；数字全部来自工具返回。
- survey 最多 3 问，动态取舍，没有值得问的就发 0 问（纯文字总结收尾）。
- update_profile 替换语义：写前必读、必合并。
