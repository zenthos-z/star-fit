---
name: "plan-generation"
description: "计划生成能力包 - 周计划模板实例化（策略→选模板→参数化）+ 自由生成回退三段式、结构化四件套输出、周/日粒度、提案-确认、容量与格式验证"
category: "planning"
version: "6.0.0"
---

# 计划生成

提案-确认（5.0）：Agent 不落库——weekly_plan 卡 data.apply 带 entries，用户确认后 App 直调 apply 端点落库，**确认前绝不进数据库**；「今天练什么」走确定性 API（§11.3）。

## 周计划主流程（策略 → 选模板 → 参数化，#151 S3）

周计划请求**首选模板实例化路径**——Agent 只做选型与参数化，剂量/日期/递进
等一切算术由程序层完成（AI 禁止介入算术）：

1. **策略**（零工具）：`load_history` 读画像后按 program-progression 定分化
   方向与周频率，先想清「要哪类模板」。
2. **选模板**（`pick_template`，1 次）：读模板目录（键/人群/分化/器械面/
   天数档），选分化贴合、器械面可用、人群匹配训练龄的模板键。
3. **参数化**（`instantiate_weekly_plan`，1 次）：模板键 + 覆盖参数
   （`tier`/`days_per_week`/`week_offset`/`equipment`/`sex`/
   `training_age_months`/`active_limitations`——未覆盖字段自动从 profile
   回填，伤病恒并集）→ 返回的 card **原样经 `submit_weekly_plan` 提交**，
   禁改剂量/日期/exercise_id。修改轮带新参数重调实例化，不手改旧卡。

## 自由生成回退（模板覆盖不了时）

无匹配分化 / 模板器械面空洞过多时走三段式（策略 → 选动作 → 配参数）：

1. **策略**（零工具）：定分化、每周训练日与各日容量目标。
2. **选动作**（`find_exercises`，**≤3 次收敛**）：组合查询（`muscle_groups`
   ≤6 肌群 + `movement_pattern`/`equipment`/`difficulty`，可多日合并查）；
   候选不够按 `relax_hint` 最高计数**放宽一个维度**补查一次。**绝不
   `list_exercises` 翻页遍历**。单日计划（plan_card）与模板外补充动作同用
   本工具链。
3. **配参数**（零工具）：组×次×重量照 load_anchors / §3.2.0 起步表直取，
   **结构化字段一次成型**，出 weekly_plan 卡数据提交。

## 结构化输出（T9/#66 一次成型）

每个训练日必产出四件结构化字段（模板路径由内核保证；字段表 →
`/data-schema/knowledge/plan.md`）：

- `day_focus` 日聚焦短标签（腿/胸/背/肩/全身…）+ `rationale` 当日说明（安排原因/目标/注意要点）
- `category` 段位 `warmup|main|cooldown`——同日按热身→正式→收尾拉伸三段排 sort_order
- `sets` 逐组处方 `[{set_no, weight_kg?, reps, rpe}]`——组数=target_sets、set_no 从 1 连续；rpe 逐组可不同

**防膨胀红线：输出增加 ≠ 思考链变长**——模板路径思考只做选型与覆盖参数；
自由生成路径思考只定动作清单与日结构，重量/RPE 照锚点直取，禁在思考中
换算。

## 周/日粒度判定（单一真源 → knowledge §11.1）

**周计划=训练框架，日计划=框架内某天的覆盖**。先 `get_current_plan` 判框架，再查五规则判定表（全文=§11.1）。要点：无框架一律先整周；临时原因只改该天（scope=days）；框架级原因整周重算（scope=week）；**原因不明必须先反问时长，原话无线索禁止出卡**；空档案先 survey_card（题库收敛 #114：purpose=profile_intake/plan_gap，题库 id 映射见 §11.1）不按保守假设排计划。

## 流程骨架

```
整周（新计划/#3/#5）：get_current_plan → load_history → 模板路径（策略 0 工具
  → pick_template 1 次 → instantiate_weekly_plan 1 次）→ card 原样经
  submit_weekly_plan 提交 +「确认后生效」；模板覆盖不了 → 三段式回退
  （策略 0 工具 → find_exercises ≤3 次 → 配参数 0 工具+结构化一次成型）
单日（#2）：get_current_plan → load_history（如需）+ find_exercises → 只重排该日
原因不明（#4）：一句话反问，不输出卡
缺勤顺延：Agent 只解释，Service 查表（planAdjustment.ts）；绝不重排/补课/叠加容量
```

`week_id` 缺省由服务器推导当前 ISO 周（**不做日历算术**）；**没有写计划
（落库）工具**——提交工具只交付提案卡，落库仍只经用户确认。

## 知识索引

- 卡片格式/验证自检/粒度五规则（§11.1）/动作选择/画像宪法：`/plan-generation/knowledge.md`
- 新手起步/容量进阶/伤病调整：`/plan-generation/knowledge/{novice-starting,volume-progression,injury-adjustment}.md`
- 计划/画像表结构 + apply 字段契约：`/data-schema/SKILL.md`

## 硬规则

- 面向用户输出一律用 `name_zh`（禁自翻译；`name` 英文只是主键）
- apply 载荷字段/split 五枚举/校验细则 → `/data-schema/knowledge/plan.md`、knowledge.md §9.3；`exercise_id` 必须来自 find_exercises / list_exercises 返回；sets.length = target_sets
- 算术留 Service；数据只经 mcpTools；user_id 服务器注入；落库只经用户确认（先落库再告知=违规）

v5.4.0 T9 (#66)：结构化输出四字段一次成型；粒度判定表迁 knowledge §11.1。
v5.5.0 #114 B5c：问卷收敛共享题库——survey_card 画像域出卡改 purpose=profile_intake/plan_gap + 题库 id 子集，题目内容后端按 PROFILE_INTAKE_QUESTIONS 对齐；§11.1 前置门槛 + novice-starting §3.2.0 门禁表加题库 id 列。
v6.0.0 #151 S3：周计划主流程改「策略→选模板→参数化」（pick_template → instantiate_weekly_plan → submit_weekly_plan 原样转述）；三段式降为模板外回退/单日路径；knowledge §9 示例卡 JSON 删除（#73/#136 源头治理）。
