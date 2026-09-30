# 卡片规范卡：`resistance_standard`（力量卡 / 抗阻标准卡）

> **状态**：已定义（样板页）· 覆盖 6 个细类共用本卡
> 口径真源：#88 v2 spec · 类型真源：`shared/contracts/card-types.ts` · 用语：`CONTEXT.md`

## 1. 身份声明

| 项 | 值 |
|---|---|
| cardType | `resistance_standard` |
| 大类（major） | `resistance`（抗阻训练） |
| 覆盖细类（fine） | `resistance`（抗阻力训练）/ `unilateral`（单侧训练）/ `bodyweight`（自重训练）/ `assisted`（辅助训练）/ `heavy_weight`（大重量训练）/ `rep_training`（次数训练）——六细类共用本卡，差异全部体现在 weight 符号语义与必填约束上 |
| interactionMode | `active`（活动卡：开始运动 → 逐组执行采集 → 完成） |

**无兜底声明（逐字保留，不得删改）**：本卡基本功能按理想情况开发、必须 100% 成功，**不设降级路径**；本页不出现任何降级路径章节。

## 2. 数据输入

### 2.1 计划参数（Agent / 用户下发；真源 = `ExercisePlanSchema` superRefine 业务规则）

| 细类 | 必填约束 | 可选参数 | 禁止值 |
|---|---|---|---|
| `resistance` / `unilateral` / `heavy_weight` | `weight > 0`（负重动作禁 0：新手给空杆 20kg 或最小配重 2.5-5kg 起步；有经验用户先出 instruction 卡做 PRE 自测，或直接用用户给出的重量） | — | `weight = 0` |
| `bodyweight` / `rep_training` | 无（`weight` 默认 0） | `weight`（追加配重，=0） | — |
| `assisted` | `weight <= 0`（负值助力，`-20` = 辅助 20kg；`0` = 无助力标准动作） | — | `weight > 0` |

### 2.2 执行中输入（手机 / 手表采集）

| 输入 | 来源 | 写入 |
|---|---|---|
| 每组实际 reps / weight | 手机执行卡交互 | `sets.reps` / `sets.weight` |
| 每组实际 RPE | 手机执行卡交互 | `sets.rpe`（0-10） |
| 组完成时刻 | 手机（自动） | `sets.completedAt`（前端 ms）/ `sets.timestamp`（契约 ISO；目标必填化，契约批） |
| 组间休息结束时刻 | 手机（60s 默认倒计时 + 长按加 20 秒）/ 手表（双按钮：结束休息 / 加 10 秒） | `sets.restEndTime`（epoch ms） |
| 组平均心率 | 手表心率样本聚合（ADR-0001，手动链路已废弃） | `sets.heartRate`（bpm 单值） |
| 感受 | 组后弹窗（见 §7） | `feel` / `feel_note`（契约批落契约） |

## 3. 数据输出（uiHint 卡）

- 计划流出 `plan_card`：data = `ExercisePlan` 数组，每行一层字段 + 上表 §2.1 约束。
- 训练后可出 `summary_card` / `survey_card`（数字必须来自 load_history 真值，过质量门）。
- data 允许键清单 = `ExercisePlanSchema` 字段全集（见 §4.1），本卡**无私有扩展键**——扩键先扩契约再扩本页（数据窄）。

## 4. 存储字段清单（三层，与 shared/contracts 对拍）

### 4.1 计划参数层（plan_card data 每行；真源 `ExercisePlanSchema`）

<!-- spec:fields id="res-plan-data" expect="ExercisePlanSchema" -->
| 字段 | 必填 | 本卡语义 |
|---|---|---|
| `exerciseId` | ✅ | 动作库内 id（NanoID），只用库内动作 |
| `name` | ✅ | 动作名（中文名以库直出 `name_zh` 为准，禁止自行翻译） |
| `exercise_type` | ✅ | 本卡域内取 6 细类之一 |
| `sets` | ✅ | 组数，正整数 |
| `reps` | ✅ | 每组次数，正整数 |
| `weight` | ✅（默认 0） | kg；符号语义见 §2.1（assisted 负值助力，端到端不换算） |
| `duration` | ⛔ 本卡不适用 | 秒（抗阻组按次数计量，不写） |
| `distance` | ⛔ 本卡不适用 | 米（不写） |
<!-- /spec:fields -->

plan_card 卡级外层键：

<!-- spec:fields id="res-plan-card-outer" expect="UIHintPlanCard" -->
| 字段 | 必填 | 说明 |
|---|---|---|
| `type` | ✅ | 判别键，字面量 `plan_card` |
| `data` | ✅ | `ExercisePlan` 数组（≥1 行） |
| `diff` | ⛔ 可选 | 计划变更摘要（added/modified/removed） |
| `target` | ⛔ 可选 | `next_day` 明日卡标记 |
<!-- /spec:fields -->

### 4.2 执行记录层（`ExerciseAction.sets` 每组；真源 `shared/contracts`）

<!-- spec:fields id="res-action-sets" expect="ExerciseActionSets" -->
| 字段 | 本卡语义 |
|---|---|
| `index` | 组序号（0 起） |
| `reps` | 实际完成次数 |
| `weight` | 实际重量 kg（assisted 保留负值，容量口径见 §6 注） |
| `duration` | 本卡不写（按次数计量） |
| `distance` | 本卡不写 |
| `rpe` | 实际 RPE（0-10，可选） |
| `status` | `planned` / `completed` / `skipped`（跳过 = 教练四问「是否跳过」的数据源） |
| `timestamp` | 组完成时刻 ISO 8601（休息推断链输入；目标必填化，契约批） |
| `restEndTime` | 休息结束时刻 epoch ms（下一组开始前） |
<!-- /spec:fields -->

### 4.3 持久化条目层（`POST /api/sessions` exercises[] 每行；格式化训练条目）

<!-- spec:fields id="res-session-entry" expect="SessionExerciseEntry" -->
| 字段 | 本卡语义 |
|---|---|
| `name` | 动作名 |
| `type` | 细类原值（6 细类之一） |
| `sets` | 计划组数 |
| `completed_sets` | 实际完成组数（`completed_sets < sets` = 未完成工作量信号） |
| `reps` | 完成组平均次数（四舍五入） |
| `weight` | 完成组平均重量 kg（assisted 负值保留，1 位小数） |
| `duration` | 本卡不写 |
| `distance` | 本卡不写 |
| `avg_hr` | 组平均心率再均值 bpm（无可用心率则缺省） |
| `rest_sec` | 组间休息合计秒（时间戳推算，见 §6；无可推算段则缺省） |
| `metadata` | 扩展元数据（透传） |
<!-- /spec:fields -->

容量口径（Service 层算术，AI 禁入）：`totalVolume` 按真实配重语义逐组累加——resistance 类 `weight×reps`；bodyweight `(体重+配重)×reps`；assisted `max(0, 体重−|助力|)×reps`；unilateral `weight×reps×2`。总容量已在 stats 算好，Agent 禁止重算。

## 5. 全局事件挂钩表（事件总表见 README）

| 事件 | 挂钩 | 本卡产出 |
|---|---|---|
| 计划生成 | ✅ | plan_card（ExercisePlan 行 × N） |
| 计划确认 | ✅ | 周计划条目 planned（挂未来轴） |
| 开始运动 | ✅ | 本地训练会话 active，动作按计划展开为 planned 组 |
| 组完成 | ✅ | `status=completed` + 组时间戳 + 实际 reps/weight/rpe |
| 组间休息 | ✅ | `restEndTime`（60s 默认倒计时 + 加时/提前结束交互） |
| 组后感受弹窗 | ✅ | `feel` + `feel_note`（每组最后一个动作完成后） |
| 动作完成 | ✅ | ExerciseAction 收口（全组完结） |
| 会话完成 | ✅ | 本地落账 → 格式化训练条目 + stats |
| 本地入队 / 同步入库 / 条目持久化 | ✅ | 见分册5 数据链 |
| 心率样本入库 | ✅ | 组平均心率由样本聚合写入单值 |
| 质量门 / Agent 回读 / 时间线展示 | ✅ | 见分册4 |

本卡挂钩全部事件（active 卡全链路参与）。

## 6. 运动时段采集数据清单（分辨率与简化规则详见分册5）

| 数据 | 分辨率 / 简化规则 | 落点 |
|---|---|---|
| 心率样本 | 5s 1 均值入库（ADR-0001）；组平均心率 = 样本聚合单值 | `heart_rate_samples` / `sets.heartRate` |
| 组时间戳 | 逐组原值（不简化） | `completedAt` / `timestamp` |
| 休息 | 60s 默认倒计时；每段 = `min(restEndTime, 下一组 completedAt) − 本组 completedAt`，缺时间戳或负值段丢弃；合计为 `rest_sec` | 推断量，不单独存储 |
| 动作参数 | 逐组原值（reps/weight/rpe） | `sets.*` |

## 7. 感受采集说明

组后弹窗（每组最后一个动作完成后）：`feel` 0-100 无级滑块**原值存储不分档**（组间形成对比序列，供 Agent 分析状态与理解程度趋势）+ `feel_note` 语义文本补充（受伤 / 疼痛 / 力量过大等滑块说不清的内容；语音转文本复用 @ 对话框既有实现，原始音频不存）。表单干净简洁。

## 8. 示例 JSON（守门脚本实际校验）

计划卡——一卡三细类（resistance + bodyweight + assisted 符号语义）：

<!-- spec:example id="res-example-plan" validator="uiHint" -->
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
    },
    {
      "exerciseId": "V8H2kQ9wL3mNpR4sT6vX",
      "name": "俯卧撑",
      "exercise_type": "bodyweight",
      "sets": 3,
      "reps": 12
    },
    {
      "exerciseId": "Yb3Jm6Pq8Rt0Vx2Wz4Aa",
      "name": "助力引体",
      "exercise_type": "assisted",
      "sets": 3,
      "reps": 6,
      "weight": -10
    }
  ]
}
```
<!-- /spec:example -->

执行记录——深蹲 4 组做 3 组，第 2 组后休息被提前结束（数据链推断素材）：

<!-- spec:example id="res-example-action" validator="exerciseAction" -->
```json
{
  "protocol_version": "2.0.0",
  "id": "3f2b8c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  "exerciseId": "V1StGXR8_Z5jdHi6B-myT",
  "type": "resistance",
  "sets": [
    { "index": 0, "reps": 8, "weight": 60, "rpe": 7, "status": "completed", "timestamp": "2026-09-30T14:20:31Z", "restEndTime": 1790778091000 },
    { "index": 1, "reps": 8, "weight": 60, "rpe": 8, "status": "completed", "timestamp": "2026-09-30T14:22:05Z" },
    { "index": 2, "reps": 7, "weight": 62.5, "rpe": 9, "status": "completed", "timestamp": "2026-09-30T14:24:12Z", "restEndTime": 1790778312000 },
    { "index": 3, "status": "skipped" }
  ],
  "uiHint": { "cardType": "resistance_standard" }
}
```
<!-- /spec:example -->

## 9. 变更记录

| 日期 | 变更 | 依据 |
|---|---|---|
| 2026-09-30 | 样板页创建（手册批分册2） | #88 v2 spec |
