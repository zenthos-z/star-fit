---
name: "plan-generation"
description: "计划生成能力包 - 周计划提案-确认生成、三段式流程（策略→选动作→配参数）、周/日粒度判断、训练容量计算、历史数据加载、计划格式验证"
category: "planning"
version: "5.3.0"
---

# 计划生成

提案-确认（5.0）：Agent 不落库——weekly_plan 卡 data.apply 带 entries，用户确认后 App 直调 apply 端点落库，**确认前绝不进数据库**。「今天练什么」= GET /api/schedule/today。

## 三段式流程（策略 → 选动作 → 配参数，5.3）

计划生成固定三段推进，**禁止边想边翻动作库**：

1. **策略**（零工具调用）：按 program-progression 定分化（推拉腿/上下肢…）、每周训练日与各日容量目标。先想清「练什么」，再去找动作。
2. **选动作**（`find_exercises`，**≤3 次工具调用收敛**）：每个训练日一次组合查询（`muscle_groups` 一组最多 6 肌群 + `movement_pattern`/`equipment`/`difficulty`，可把推日三肌群并一次查）；候选不够时按 `relax_hint` 最高计数**放宽一个维度**补查。合计 **2-3 次**封顶——合并多日为大查询、或放宽重查，**绝不 `list_exercises` 翻页遍历**。
3. **配参数**（零工具调用）：按 load_anchors / 新手起步规则配组×次×重量，出 weekly_plan 卡。

返回的短列表已精排（主肌群命中优先、total=全库满足数），直接从短列表挑选；孤立配件（提踵/髋外展等 movement_pattern 未归类）查第二轮时不带 movement_pattern 参数。

## 周/日粒度判定表（单一真源）

**周计划=训练框架，日计划=框架内某天的覆盖**；粒度=f(原因影响范围,框架存在性)。先 `get_current_plan` 判框架再查表：

**前置门槛（先于本表）**：`load_history` 后关键输入（目标/经验/器械/频次/伤病/体重）大多未知（典型空档案新用户）先发 **survey_card** 调研，不按保守假设排计划（「档案空按最保守自重排一周」违规）。问卷轮交付 = ```json survey_card 卡（questions=[{id,question,input:text|number|select|checkbox,required?,options:[{label,value}]}]），**纯文本问题清单 = 失败交付**；问卷轮不带 data.apply，完成后下一轮按 #1 出整周卡。

<!-- prettier-ignore -->
| # | 条件 | 动作 | scope |
| --- | --- | --- | --- |
| 1 | 无周计划（框架不存在；空档案走前置门槛） | **一律先出整周计划**，哪怕点名「明天的」——单日依附框架，缺失无处安放。只问「明天练什么」（疑问句）→ 答复并引导建框架，不凭空报一天动作 | `week` |
| 2 | 框架在 + 点名某天 + 原因**临时**（雨天/没空/出差） | 只改该天：卡仍展示整周，apply.entries 只含该日、dates 列该日，其余六天不动 | `days` |
| 3 | 框架在 + 原因**长期框架级**（退卡/搬家/伤病数周/器械永久变化） | 整周重算：先读旧条目参考，按新约束重建全部条目 | `week` |
| 4 | **原因不明**（「改成居家练」没说为什么） | **必须先反问**「长期还是就这几天？」，不许猜；答复后回 #2/#3 | 先问 |
| 5 | 常规「根据我的信息调整一下」 | 默认整周更新 | `week` |

**#4 判定锚**：临时/长期线索必须在**用户原话里显式出现**（今天/明天/出差几天=临时；退卡/搬家/长期/没健身房了=长期）。原话无时长线索时**禁止出卡**，只回一句反问；思考里替用户「按长期处理」再出整周卡=违规。

## 流程骨架

```
整周（新计划/#3/#5）：get_current_plan 判框架 → load_history（硬约束输入）
  → 三段式：策略（零工具）→ find_exercises 组合筛选选动作（≤3 次收敛，禁翻页）
  → 配参数（零工具）→ weekly_plan 卡（整周 + data.apply）+「确认后生效」
单日（#2）：get_current_plan → load_history（如需）+ find_exercises → 只重排该日
原因不明（#4）：一句话反问，不输出卡
缺勤顺延：Agent 只解释，Service 查表（planAdjustment.ts）处理；绝不重排/补课/叠加容量
```

`week_id` 缺省由服务器推导当前 ISO 周（**不做日历算术**）；**没有写计划工具**。

## 知识索引

- 卡片格式/验证自检/动作选择/画像宪法/周计划契约：`/plan-generation/knowledge.md`
- 新手起步（空杆 20kg、推算公式）：`/plan-generation/knowledge/novice-starting.md`
- 容量进阶（周组数、MEV/MRV、适配表）：`/plan-generation/knowledge/volume-progression.md`
- 伤病调整（安全红线、降载比例）：`/plan-generation/knowledge/injury-adjustment.md`
- 计划/画像表结构 + apply 字段契约：`/data-schema/SKILL.md`

## 硬规则

- 面向用户输出一律用 `name_zh`（禁自翻译；`name` 英文只是主键）
- apply 载荷字段/split 五枚举/校验细则 → `/data-schema/knowledge/plan.md`、knowledge.md §9.3；`exercise_id` 必须来自 find_exercises / list_exercises 返回；sets.length = target_sets
- 算术留 Service；数据只经 mcpTools；user_id 服务器注入；落库只经用户确认（先落库再告知=违规）

v5.3.0 T2 (#54)：三段式流程 + find_exercises 组合筛选选动作（≤3 次收敛，禁翻页）。
