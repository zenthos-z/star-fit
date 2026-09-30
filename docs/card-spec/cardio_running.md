# 卡片规范卡：`cardio_running`（跑步卡 / 有氧标准卡）

> **状态**：已定义（样板页）· 覆盖细类 `cardio`；`outdoor` 细类走 `cardio_outdoor`（占位，见 [fine/outdoor.md](fine/outdoor.md)）
> 口径真源：#88 v2 spec · 类型真源：`shared/contracts/card-types.ts` · 用语：`CONTEXT.md`

## 1. 身份声明

| 项 | 值 |
|---|---|
| cardType | `cardio_running` |
| 大类（major） | `cardio`（有氧训练） |
| 覆盖细类（fine） | `cardio`（有氧训练）——器械 / 室内跑走类；户外 GPS 轨迹类细类 `outdoor` 派发 `cardio_outdoor`，不归本卡 |
| interactionMode | `active`（活动卡：开始运动 → 连续执行采集 → 完成） |

**无兜底声明（逐字保留，不得删改）**：本卡基本功能按理想情况开发、必须 100% 成功，**不设降级路径**；本页不出现任何降级路径章节。

## 2. 数据输入

### 2.1 计划参数（Agent / 用户下发；真源 = `ExercisePlanSchema` superRefine 业务规则）

| 细类 | 必填约束 | 可选参数 | 禁止值 |
|---|---|---|---|
| `cardio` | `duration > 0`（秒） | `distance`（米，目标距离） | `duration` 缺省或 ≤0 |

### 2.2 执行中输入（手机 / 手表采集）

| 输入 | 来源 | 写入 |
|---|---|---|
| 实际时长 | 手机 / 手表计时 | `sets.duration`（秒，实际值） |
| 实际距离 | 跑步机 / 手表 | `sets.distance`（米，实际值） |
| 强度参数 | 器械设置（坡度 / 配速 / 阻力档 / 转速 / 功率） | `sets.intensityParams`（前端扩展域，非契约字段） |
| 组完成时刻 | 手机（自动） | `sets.completedAt` / `sets.timestamp` |
| 组平均心率 | 手表心率样本聚合（ADR-0001，手动链路已废弃） | `sets.heartRate`（bpm 单值） |
| 感受 | 组后弹窗（见 §7） | `feel` / `feel_note`（契约批落契约） |

跑步卡的「组」语义：单段连续执行记为 1 组（`sets=1`）；间歇跑拆多段 = 多组，此时组间休息链重新适用。

## 3. 数据输出（uiHint 卡）

- 计划流出 `plan_card`：data = `ExercisePlan` 数组，每行一层字段 + §2.1 约束。
- 训练后可出 `summary_card` / `survey_card`（数字必须来自 load_history 真值，过质量门；配速等派生值由 Service 层计算）。
- data 允许键清单 = `ExercisePlanSchema` 字段全集（见 §4.1），本卡**无私有扩展键**——扩键先扩契约再扩本页（数据窄）。

## 4. 存储字段清单（三层，与 shared/contracts 对拍）

### 4.1 计划参数层（plan_card data 每行；真源 `ExercisePlanSchema`）

<!-- spec:fields id="run-plan-data" expect="ExercisePlanSchema" -->
| 字段 | 必填 | 本卡语义 |
|---|---|---|
| `exerciseId` | ✅ | 动作库内 id（NanoID），只用库内动作 |
| `name` | ✅ | 动作名（中文名以库直出 `name_zh` 为准） |
| `exercise_type` | ✅ | 本卡域内恒为 `cardio` |
| `sets` | ✅ | 段数，正整数（单段连续 = 1） |
| `reps` | ✅ | 恒为 1（时长型动作按时间计量，schema 要求正整数） |
| `weight` | ✅（默认 0） | 本卡恒为 0（不写即默认） |
| `duration` | ✅ | 计划时长秒，> 0（本卡主参数） |
| `distance` | ⛔ 可选 | 计划距离米 |
<!-- /spec:fields -->

plan_card 卡级外层键：

<!-- spec:fields id="run-plan-card-outer" expect="UIHintPlanCard" -->
| 字段 | 必填 | 说明 |
|---|---|---|
| `type` | ✅ | 判别键，字面量 `plan_card` |
| `data` | ✅ | `ExercisePlan` 数组（≥1 行） |
| `diff` | ⛔ 可选 | 计划变更摘要（added/modified/removed） |
| `target` | ⛔ 可选 | `next_day` 明日卡标记 |
<!-- /spec:fields -->

### 4.2 执行记录层（`ExerciseAction.sets` 每组；真源 `shared/contracts`）

<!-- spec:fields id="run-action-sets" expect="ExerciseActionSets" -->
| 字段 | 本卡语义 |
|---|---|
| `index` | 段序号（单段 = 0） |
| `reps` | 本卡不写（按时间计量） |
| `weight` | 本卡不写 |
| `duration` | 实际时长秒（主记录维度） |
| `distance` | 实际距离米 |
| `rpe` | 实际 RPE（0-10，可选） |
| `status` | `planned` / `completed` / `skipped`（整段跳过） |
| `timestamp` | 段完成时刻 ISO 8601（**必填**，#97 已落契约；多段间歇时为休息推断链输入；存量无值按 startTime+组序推算） |
| `restEndTime` | 段间休息结束时刻 epoch ms（单段连续执行不写；多段间歇适用） |
| `feel` | 感受滑块原值 0-100 int（无级连续值禁分档，可选；#97 已落契约） |
| `feel_note` | 感受语义补充 ≤500 字符（语音转写，可选；#97 已落契约） |
<!-- /spec:fields -->

### 4.3 持久化条目层（`POST /api/sessions` exercises[] 每行；格式化训练条目）

<!-- spec:fields id="run-session-entry" expect="SessionExerciseEntry" -->
| 字段 | 本卡语义 |
|---|---|
| `name` | 动作名 |
| `type` | `cardio` |
| `sets` | 计划段数 |
| `completed_sets` | 实际完成段数 |
| `reps` | 本卡不写 |
| `weight` | 本卡不写 |
| `duration` | 完成段时长合计秒（四舍五入） |
| `distance` | 完成段距离合计米（四舍五入） |
| `avg_hr` | 组平均心率再均值 bpm（无可用心率则缺省——视为无心率设备，不是零表现） |
| `rest_sec` | 多段间歇时段间休息合计秒（单段缺省） |
| `metadata` | 扩展元数据（透传） |
<!-- /spec:fields -->

会话级有氧统计（Service 层算术，AI 禁入）：`stats.totalCardioDurationSec` / `stats.totalDistanceM` / `stats.avgHr` 已算好；配速（分/公里）等派生值一律 Service 层计算，Agent 只引用不重算。

## 5. 全局事件挂钩表（事件总表见 README）

| 事件 | 挂钩 | 本卡产出 |
|---|---|---|
| 计划生成 | ✅ | plan_card（ExercisePlan 行 × N） |
| 计划确认 | ✅ | 周计划条目 planned（挂未来轴） |
| 开始运动 | ✅ | 本地训练会话 active |
| 组完成 | ✅（段粒度） | `status=completed` + 实际 duration/distance + 段时间戳 |
| 组间休息 | ⛔ 单段不挂钩 | 多段间歇时同力量卡（`restEndTime`） |
| 组后感受弹窗 | ✅ | `feel` + `feel_note`（每段最后一个动作完成后；单段卡在会话收口前） |
| 动作完成 | ✅ | ExerciseAction 收口 |
| 会话完成 | ✅ | 本地落账 → 格式化训练条目 + stats |
| 本地入队 / 同步入库 / 条目持久化 | ✅ | 见分册5 数据链 |
| 心率样本入库 | ✅ | 组平均心率由样本聚合写入单值 |
| 质量门 / Agent 回读 / 时间线展示 | ✅ | 见分册4 |

## 6. 运动时段采集数据清单（分辨率与简化规则详见分册5）

| 数据 | 分辨率 / 简化规则 | 落点 |
|---|---|---|
| 心率样本 | 5s 1 均值入库（ADR-0001）；组平均心率 = 样本聚合单值；训练中每分钟 1 均值仅作展示推送，不入库 | `heart_rate_samples` / `sets.heartRate` |
| 时长 / 距离 | 段原值（不简化；合计在持久化层聚合） | `sets.duration` / `sets.distance` |
| 段时间戳 | 逐段原值 | `completedAt` / `timestamp` |
| 强度参数 | 器械档位随组记录（前端扩展域，不进契约字段） | `sets.intensityParams` |

## 7. 感受采集说明

组后弹窗（每段最后一个动作完成后）：`feel` 0-100 无级滑块**原值存储不分档** + `feel_note` 语义文本补充（语音转文本复用 @ 对话框既有实现，原始音频不存）。单段连续执行时，弹窗在会话收口前的该段完成后出现。表单干净简洁。

## 8. 示例 JSON（守门脚本实际校验）

计划卡——25 分钟跑步机慢跑，目标 4 公里：

<!-- spec:example id="run-example-plan" validator="uiHint" -->
```json
{
  "type": "plan_card",
  "data": [
    {
      "exerciseId": "C4rD1oR2uN6nG8tHeA9bCd",
      "name": "跑步机慢跑",
      "exercise_type": "cardio",
      "sets": 1,
      "reps": 1,
      "duration": 1500,
      "distance": 4000
    }
  ]
}
```
<!-- /spec:example -->

执行记录——单段完成 26 分 40 秒 / 4.2 公里，平均心率 142：

<!-- spec:example id="run-example-action" validator="exerciseAction" -->
```json
{
  "protocol_version": "2.0.0",
  "id": "7d1e9f30-a45b-4c82-b6d7-8e9f0a1b2c3e",
  "exerciseId": "C4rD1oR2uN6nG8tHeA9bCd",
  "type": "cardio",
  "sets": [
    { "index": 0, "duration": 1600, "distance": 4200, "rpe": 6, "status": "completed", "timestamp": "2026-09-30T15:02:40Z" }
  ],
  "uiHint": { "cardType": "cardio_running" }
}
```
<!-- /spec:example -->

## 9. 变更记录

| 日期 | 变更 | 依据 |
|---|---|---|
| 2026-09-30 | 样板页创建（手册批分册2） | #88 v2 spec |
