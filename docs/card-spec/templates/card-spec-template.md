# 卡片规范卡：`{cardType}`（{中文名}）

> **状态**：草案 / 已定义（复制本模板后改为「已定义」前，先让 `node scripts/check-card-spec.mjs` 退出码 0）
> 口径真源：#88 v2 spec · 类型真源：`shared/contracts/card-types.ts` · 用语：`CONTEXT.md`

## 1. 身份声明

| 项 | 值 |
|---|---|
| cardType | `{major}_{variant}`（值域对拍 `CARD_TYPE_VALUES`） |
| 大类（major） | `{major}`（{大类中文名}） |
| 覆盖细类（fine） | `{fine1}` / `{fine2}` / …（对拍 `EXERCISE_TYPE_DEFS`，多个细类可共用一张卡） |
| interactionMode | `active`（活动卡：开始运动 → 执行采集 → 完成）/ `passive`（记录卡：填入 → 确认落账，无执行流） |

**无兜底声明（逐字保留，不得删改）**：本卡基本功能按理想情况开发、必须 100% 成功，**不设降级路径**；本页不出现任何降级路径章节。

## 2. 数据输入

### 2.1 计划参数（Agent / 用户下发）

按本卡覆盖细类逐类写明必填约束（真源 = `ExercisePlanSchema` superRefine 业务规则）：

| 细类 | 必填约束 | 可选参数 | 禁止值 |
|---|---|---|---|
| `{fine}` | {如 `weight > 0`} | {如 `-`} | {如负重类禁 `weight=0`} |

### 2.2 执行中输入（设备 / 交互采集）

{逐项列：本卡执行期间采集什么、来自哪端（手机 / 手表）、写入哪个字段。可引用分册5 §采集项规格表。}

## 3. 数据输出（uiHint 卡）

出卡类型：`plan_card`（data = `ExercisePlan` 数组）/ 其他 uiHint 类型……

data 允许键清单 = `ExercisePlanSchema` 字段（见 §4 第一层），无本卡私有扩展键（数据窄：扩键先扩契约，再扩本页）。

## 4. 存储字段清单（三层，与 shared/contracts 对拍）

### 4.1 计划参数层（plan_card data 每行；真源 `ExercisePlanSchema`）

<!-- spec:fields id="tpl-plan-data" expect="ExercisePlanSchema" -->
| 字段 | 必填 | 说明 |
|---|---|---|
| `exerciseId` | ✅ | 动作库内 id（NanoID），禁止编造 |
| `name` | ✅ | 动作名（展示用，中文名以库直出为准） |
| `exercise_type` | ✅ | 10 细类枚举 |
| `sets` | ✅ | 正整数 |
| `reps` | ✅ | 正整数 |
| `weight` | ✅（默认 0） | kg；符号语义随细类（如 assisted 负值助力） |
| `duration` | ⛔ 可选 | 秒 |
| `distance` | ⛔ 可选 | 米 |
<!-- /spec:fields -->

plan_card 卡级外层键（对拍 `UIHintPlanCard`）：

<!-- spec:fields id="tpl-plan-card-outer" expect="UIHintPlanCard" -->
| 字段 | 必填 | 说明 |
|---|---|---|
| `type` | ✅ | 判别键，字面量 `plan_card` |
| `data` | ✅ | `ExercisePlan` 数组（≥1 行） |
| `diff` | ⛔ 可选 | 计划变更摘要（added/modified/removed） |
| `target` | ⛔ 可选 | `next_day` 明日卡标记 |
<!-- /spec:fields -->

### 4.2 执行记录层（`ExerciseAction.sets` 每组；真源 `shared/contracts`）

<!-- spec:fields id="tpl-action-sets" expect="ExerciseActionSets" -->
| 字段 | 说明 |
|---|---|
| `index` | 组序号 |
| `reps` | 实际次数 |
| `weight` | 实际重量 kg |
| `duration` | 实际时长秒 |
| `distance` | 实际距离米 |
| `rpe` | 实际 RPE（0-10） |
| `status` | `unknown` / `planned` / `completed` / `skipped` |
| `timestamp` | 组时间戳（ISO 8601；目标必填化，契约批） |
| `restEndTime` | 休息结束时间戳（epoch ms，休息推断链输入） |
<!-- /spec:fields -->

### 4.3 持久化条目层（`POST /api/sessions` exercises[] 每行；格式化训练条目）

<!-- spec:fields id="tpl-session-entry" expect="SessionExerciseEntry" -->
| 字段 | 说明 |
|---|---|
| `name` | 动作名 |
| `type` | 细类原值 |
| `sets` | 计划组数 |
| `completed_sets` | 实际完成组数 |
| `reps` | 平均每组次数 |
| `weight` | 平均重量 kg（assisted 保留负值） |
| `duration` | 时长合计秒 |
| `distance` | 距离合计米 |
| `avg_hr` | 组平均心率均值 bpm（样本聚合） |
| `rest_sec` | 组间休息合计秒（时间戳推算） |
| `metadata` | 扩展元数据 |
<!-- /spec:fields -->

## 5. 全局事件挂钩表（候选见 README §全局事件总表）

| 事件 | 挂钩 | 本卡产出 |
|---|---|---|
| 计划生成 | {✅/不挂钩} | {产出} |
| 组完成 | {✅/不挂钩} | {产出} |
| … | | |

## 6. 运动时段采集数据清单（详见分册5）

| 数据 | 分辨率 / 简化规则 | 落点 |
|---|---|---|
| {心率样本} | {5s 1 均值} | {heart_rate_samples} |

## 7. 感受采集说明

组后弹窗（每组最后一个动作完成后）：`feel` 0-100 无级滑块**原值存储不分档** + `feel_note` 语义文本补充（语音转文本复用 @ 对话框，原始音频不存）。本卡采集时机：{写明}。

## 8. 示例 JSON（守门脚本实际校验）

<!-- spec:example id="tpl-example-plan" validator="uiHint" -->
```json
{
  "type": "plan_card",
  "data": [
    {
      "exerciseId": "V1StGXR8_Z5jdHi6B-myT",
      "name": "深蹲",
      "exercise_type": "resistance",
      "sets": 4,
      "reps": 8,
      "weight": 60
    }
  ]
}
```
<!-- /spec:example -->

（示例起点：复制本模板后替换为本卡真实示例；每个示例块必须带 `spec:example` 标记与 validator 声明，未标记的 json 块会让守门脚本退出码 1。）

## 9. 变更记录

| 日期 | 变更 | 依据 |
|---|---|---|
| | | |
