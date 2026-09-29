# 计划域数据结构（weekly_plans / plan_entries）

> 真源：`shared/contracts/weekly-plan.ts`（契约）+
> `backend/src/db/postgresql/migrations/001_weekly_plans.sql`（DDL）。
> 本文件是 Agent 速查层（42c 自 plan-generation/knowledge.md §11.2 迁移）。

## 一、表结构

### weekly_plans（周计划，每周每用户一份）

| 列                      | 类型                    | 约束/说明                                                                          |
| ----------------------- | ----------------------- | ---------------------------------------------------------------------------------- |
| id                      | uuid                    | 主键                                                                               |
| user_id                 | uuid                    | 与 week_id 联合唯一（`weekly_plans_user_week_unique`）                             |
| week_id                 | text                    | ISO 周格式 `YYYY-Www`（周号 01-53，CHECK 约束）                                    |
| split                   | enum weekly_plan_split  | `full_body` / `upper_lower` / `push_pull_legs` / `hybrid` / `custom`（严格五枚举） |
| status                  | enum weekly_plan_status | `active`（默认）/ `archived`（周结束或被替代时归档）                               |
| created_at / updated_at | timestamptz             | 系统列                                                                             |

### plan_entries（每日条目）

| 列                  | 类型                                    | 说明                                                                                          |
| ------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------- |
| id                  | uuid                                    | 主键                                                                                          |
| weekly_plan_id      | uuid                                    | 所属周计划                                                                                    |
| user_id             | uuid                                    | 冗余用户列（按用户隔离查询，不依赖联表）                                                      |
| entry_date          | date                                    | YYYY-MM-DD 日历日（无时区）                                                                   |
| exercise_id         | text                                    | NanoID（12-24 字符），引用 exercises.id                                                       |
| target_sets         | integer                                 | 正整数                                                                                        |
| target_load_type    | enum plan_load_type                     | `rpe` / `percent_1rm`                                                                         |
| target_load_min/max | numeric(5,2)                            | 负荷区间（应用层为嵌套对象，DB 拆三列，Repository 映射）                                      |
| status              | enum plan_entry_status                  | 见状态机                                                                                      |
| sort_order          | integer                                 | 同日内排序，默认 0；三段课表按热身→正式→收尾排                                                |
| day_focus           | text NULL（T9/#66）                     | 日聚焦短标签（腿/胸/背/肩/全身…），同日各条目同值                                             |
| rationale           | text NULL（T9/#66）                     | 当日说明（安排原因/目标/注意要点），同日各条目同值                                            |
| category            | enum plan_entry_category NULL（T9/#66） | 段位 `warmup` / `main` / `cooldown`；旧数据 NULL 读取回落 `main`                              |
| sets                | jsonb NULL（T9/#66）                    | 逐组处方 `[{set_no, weight_kg?, reps, rpe}]`；旧数据 NULL 回落 target_sets × target_load 展示 |

## 二、PlanEntryInput（apply 载荷 entries[] 单条形态）

| 字段        | 形态                                   | 说明                                                                                                                                           |
| ----------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| entry_date  | YYYY-MM-DD（无时区）                   | 条目归属的日历日                                                                                                                               |
| exercise_id | NanoID（12-24 字符）                   | 必须来自 list_exercises                                                                                                                        |
| target_sets | 正整数                                 | 当日目标组数                                                                                                                                   |
| target_load | {type, min, max} 区间                  | rpe ∈ [0,10] / %1RM ∈ (0,100]，min ≤ max                                                                                                       |
| sort_order  | 非负整数（可选，默认 0）               | 同日内排序；三段课表按 热身→正式→收尾 排                                                                                                       |
| day_focus   | 短标签（可选，T9）                     | 日聚焦（腿/胸/背/肩/全身…），同日各条目同值                                                                                                    |
| rationale   | 一两句说明（可选，T9）                 | 当日安排原因/目标/注意要点，同日各条目同值                                                                                                     |
| category    | `warmup`/`main`/`cooldown`（可选，T9） | 段位；缺省读取回落 `main`，新提案必带                                                                                                          |
| sets        | 逐组处方数组（可选，T9）               | `[{set_no, weight_kg?, reps, rpe}]`：组数必须 = target_sets、set_no 从 1 连续；rpe 逐组可不同（0-10）；自重/弹力带类可省 weight_kg。新提案必带 |

**T9 结构化四件套**（day_focus / rationale / category / sets）在配参数段
随 weekly_plan 卡**一次成型**（展示层 days[].focus / days[].rationale /
exercises[].category / exercises[].sets 与 apply 同源），不为此增加轮次或
工具调用（防膨胀红线，plan-generation SKILL.md）。

## 三、apply 载荷（weekly_plan 卡 data.apply，确认落库唯一数据面）

```json
{
  "week_id": "2026-W40", // 可缺省（=当前周，服务器推导）
  "scope": "week", // week=整周 upsert / days=单日覆盖
  "split": "push_pull_legs", // scope=week 必填；days 忽略
  "dates": [], // scope=days 必填：被覆盖日期（YYYY-MM-DD，≤7 个）
  "entries": [
    {
      "entry_date": "2026-09-21",
      "exercise_id": "V1StGXR8_Z5jdHi6",
      "target_sets": 3,
      "target_load": { "type": "rpe", "min": 7, "max": 8 },
      "sort_order": 1,
      "day_focus": "胸肩三头",
      "rationale": "复合动作打底，末端轻量肩部收尾",
      "category": "main",
      "sets": [
        { "set_no": 1, "weight_kg": 60, "reps": 8, "rpe": 7 },
        { "set_no": 2, "weight_kg": 62.5, "reps": 8, "rpe": 7.5 },
        { "set_no": 3, "weight_kg": 65, "reps": 6, "rpe": 8 }
      ]
    }
  ]
}
```

- scope=week：整周 upsert（split 必带，覆盖全部训练日，休息日不建条目）
- scope=days：单日覆盖（要求该周已有计划行；entries 的 entry_date 必须全部
  落在 dates 内——落库面=被替换面，防漏删/误删）
- entries 不能为空（至少一条）；确认端点 `POST /api/schedule/weekly-plan/apply`
  落库前以契约 Schema 校验，失败即抛（含 T9 结构化字段与 sets/target_sets
  对齐校验：组数相等 + set_no 1..N 连续）

## 四、条目状态机

`planned → adjusted → completed / skipped`（落库即 `planned`，后两态为终态）：

| from      | 可迁至                                  |
| --------- | --------------------------------------- |
| planned   | adjusted / completed / skipped          |
| adjusted  | adjusted（再调整）/ completed / skipped |
| completed | —（终态）                               |
| skipped   | —（终态）                               |

同态迁移（from === to）视为幂等重放放行；迁移由 Repository 按契约迁移表强制执行。

## 五、week_id 与今日课表

- `week_id` 由服务器用 `getIsoWeekId`（ISO 周一为始、周四定年）从日期推导——
  **Agent 不做日历算术**
- `GET /api/schedule/today` 三态：`planned`（今日有条目）/ `rest_day`（本周有
  计划今日无）/ `no_plan`（本周无计划，split=null、entries=[]，前端引导生成）；
  返回含 date / week_id / status / split / entries（exercise_name 为
  JOIN 投影，中文优先 COALESCE(name_zh, name)）
