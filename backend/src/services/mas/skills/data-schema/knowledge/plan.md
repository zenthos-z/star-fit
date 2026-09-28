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

| 列                  | 类型                   | 说明                                                     |
| ------------------- | ---------------------- | -------------------------------------------------------- |
| id                  | uuid                   | 主键                                                     |
| weekly_plan_id      | uuid                   | 所属周计划                                               |
| user_id             | uuid                   | 冗余用户列（按用户隔离查询，不依赖联表）                 |
| entry_date          | date                   | YYYY-MM-DD 日历日（无时区）                              |
| exercise_id         | text                   | NanoID（12-24 字符），引用 exercises.id                  |
| target_sets         | integer                | 正整数                                                   |
| target_load_type    | enum plan_load_type    | `rpe` / `percent_1rm`                                    |
| target_load_min/max | numeric(5,2)           | 负荷区间（应用层为嵌套对象，DB 拆三列，Repository 映射） |
| status              | enum plan_entry_status | 见状态机                                                 |
| sort_order          | integer                | 同日内排序，默认 0                                       |

## 二、PlanEntryInput（apply 载荷 entries[] 单条形态）

| 字段        | 形态                     | 说明                                     |
| ----------- | ------------------------ | ---------------------------------------- |
| entry_date  | YYYY-MM-DD（无时区）     | 条目归属的日历日                         |
| exercise_id | NanoID（12-24 字符）     | 必须来自 list_exercises                  |
| target_sets | 正整数                   | 当日目标组数                             |
| target_load | {type, min, max} 区间    | rpe ∈ [0,10] / %1RM ∈ (0,100]，min ≤ max |
| sort_order  | 非负整数（可选，默认 0） | 同日内排序                               |

## 三、apply 载荷（weekly_plan 卡 data.apply，确认落库唯一数据面）

```json
{
  "week_id": "2026-W40", // 可缺省（=当前周，服务器推导）
  "scope": "week", // week=整周 upsert / days=单日覆盖
  "split": "push_pull_legs", // scope=week 必填；days 忽略
  "dates": [], // scope=days 必填：被覆盖日期（YYYY-MM-DD，≤7 个）
  "entries": [/* PlanEntryInput */]
}
```

- scope=week：整周 upsert（split 必带，覆盖全部训练日，休息日不建条目）
- scope=days：单日覆盖（要求该周已有计划行；entries 的 entry_date 必须全部
  落在 dates 内——落库面=被替换面，防漏删/误删）
- entries 不能为空（至少一条）；确认端点 `POST /api/schedule/weekly-plan/apply`
  落库前以契约 Schema 校验，失败即抛

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
