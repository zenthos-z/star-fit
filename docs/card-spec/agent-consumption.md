# 分册4：Agent 消费规范（Agent Consumption）

> Agent 拿到的是**本次运动的完整信息**：卡片数据 + 卡片↔时间线关系 + 卡片↔卡片关系 + 感受序列。
> AI 分析效果的优化后置；但**每次训练传给 Agent 的完整 payload 必须可视化可回看**（§5）。
> 口径真源：#88 v2 spec · 类型真源：`shared/contracts` · 用语：`CONTEXT.md`

## 1. 边界与原则

| 原则 | Agent 侧含义 |
|---|---|
| 数据窄、前端宽 | Agent 消费的数据面在本分册定义死；推理 / 话术自由，数据引用不自由 |
| 无缺漏无错误 | 喂进来的数据经预处理可以变形，但必须完整且正确；缺失字段 = 该类型不采集或无设备，**视为缺席，不是零表现**，禁止编造数字 |
| AI 禁算术（CLAUDE.md 红线） | 一切算术（总量 / 均值 / 配速 / 趋势斜率）由 Service 层完成；Agent 只引用真值，数字必须来自 load_history 等工具返回 |

## 2. 完整信息结构（四要素）

Agent 输入 = 经 `load_history`（+ 按需 `get_session_hr_curve` / `get_hr_trend`）读取的以下四类信息：

### 2.1 卡片数据（history_summary.sessions 条目）

每条会话条目字段语义（写入方 = `POST /api/sessions`，读取方 = load_history）：

| 字段 | 语义 |
|---|---|
| `session_id` | 会话 uuid |
| `start_time` / `end_time` | 实际训练窗口（ISO） |
| `exercises[]` | **一行 = 一个动作的汇总**（格式化训练条目，非原始组），字段按行内 `type` 解释 |
| `stats` | 会话级统计（算好的真值） |
| `notes` | 用户备注（≤2000 字符） |
| `recorded_at` | 入库时刻 |

exercises 行按 type 分字段（缺字段 = 该类型不采集，视为缺席）：

| 行 type | 读哪些字段 |
|---|---|
| `resistance` / `unilateral` / `assisted` / `bodyweight` / `heavy_weight` / `rep_training` | `weight`（均重 kg，assisted 负值）、`reps`（组均次数）、`sets`（计划组数）、`completed_sets`（完成组数） |
| `cardio` / `outdoor` | `duration`（合计秒）、`distance`（合计米）、`avg_hr`（bpm） |
| `isometric` | `duration`（合计秒）、可选 `weight` |
| 全部 | `avg_hr`（组平均心率再均值）、`rest_sec`（组间休息合计，缺省 = 无可推算段） |

stats 字段（总口径已算好，禁止从 exercises 重算）：`totalVolume`（kg）、`setsCount`、`totalCardioDurationSec`（秒）、`totalDistanceM`（米）、`durationMinutes?`、`avgHr?`。

### 2.2 卡片↔时间线关系

| 关系 | 载体 | 说明 |
|---|---|---|
| 会话窗口 | `start_time` / `end_time` | 本条会话在用户状态时间序列上的挂载区间 |
| 会话序列 | sessions 数组时序 | Agent 的历史记忆：最近 N 条（load_history `limit`，默认 10） |
| 动作顺序 | exercises 数组序 | 同一会话内的执行顺序（教练四问「跨动作状态」的「动作顺序」数据源） |
| 未来条目 | 周计划条目（`planned`，挂未来轴） | 上段=未来区投影、三段式统一时间线为已定稿方向，依赖 TimelineEntry 统一模型（契约批，见 README 生命周期节） |

### 2.3 卡片↔卡片关系

| 关系 | 载体 | 说明 |
|---|---|---|
| 双源合并 | load_history 内 `mergeHistorySources` | sessions 表 `raw_json`（权威，每次同步都写）优先去重；`write_session` 工具显式记录的记忆条目为补充源，不可丢弃 |
| 画像约束 | `profile_static` / `profile_dynamic`（load_history 随载） | `load_anchors` 对照做 PR / 降重判断；`active_limitations` / `recovery_state` 为硬约束 |
| 库内引用 | `exerciseId` → 动作库 | 计划只允许库内动作（README 尾节铁律）；关系引用完整性硬校验为目标态（契约缺口清单） |

### 2.4 感受序列

- `feel`：0-100 无级滑块原值，逐组采集（组后弹窗），组间 / 跨动作形成对比序列——Agent 分析状态与理解程度趋势的主数据源。
- `feel_note`：语义文本补充（受伤 / 疼痛 / 力量过大等）。
- 跨动作状态 = 感受序列 + 动作顺序，**暂不新增显式状态标注**（#88 v2 拍板）。
- 现有锚点：`sets.rpe`（0-10 实际主观强度）已在契约；`feel` / `feel_note` 落契约为契约批工作，落地前本节为目标态定义。

### 2.5 心率信息（按需工具）

| 工具 | 输出 | 用途 |
|---|---|---|
| `get_session_hr_curve` | 单会话 5s 粒度曲线（points + avg/max/min stats） | 配速 / 强度区间 / 组间恢复解读；禁止让用户口述心率值 |
| `get_hr_trend` | 跨会话 avg/max/min + 方向（rising/stable/falling/insufficient） | 周 / 月负荷与恢复讨论 |

原始心率样本不直接进上下文（ADR-0001：聚合 / 统计在工具层完成）。

## 3. Agent 输入 payload 形态（load_history 返回）

<!-- spec:example id="agent-load-history-shape" validator="none" -->
```json
{
  "userId": "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  "history_summary": {
    "sessions": [
      {
        "session_id": "3f2b8c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
        "start_time": "2026-09-30T14:15:00Z",
        "end_time": "2026-09-30T15:10:00Z",
        "exercises": [
          {
            "name": "深蹲",
            "type": "resistance",
            "sets": 4,
            "completed_sets": 3,
            "weight": 60.8,
            "reps": 8,
            "avg_hr": 138,
            "rest_sec": 195
          },
          {
            "name": "跑步机慢跑",
            "type": "cardio",
            "sets": 1,
            "completed_sets": 1,
            "duration": 1600,
            "distance": 4200,
            "avg_hr": 142
          }
        ],
        "stats": {
          "totalVolume": 1459,
          "setsCount": 4,
          "totalCardioDurationSec": 1600,
          "totalDistanceM": 4200,
          "avgHr": 139
        },
        "notes": "最后一组深蹲膝盖有点不舒服"
      }
    ]
  },
  "profile_static": { "basic_info": {}, "physiological": {} },
  "profile_dynamic": { "load_anchors": {}, "active_limitations": [], "recovery_state": { "total_score": 55 } }
}
```
<!-- /spec:example -->

（形态示例：字段语义见 §2；实际返回含全部真值，此处截断示意。）

## 4. 预处理规则底线

**预处理允许且必须发生在 Service 层**——Agent 收到的每个数字都是算好的真值：

| 环节 | 预处理 | 硬校验（坏数据抛错拒交付，不静默进 Agent） |
|---|---|---|
| 本地落账 | `workoutSummary` 把逐组原始数据聚合为格式化训练条目 + stats（算术全在模块内） | 无可持久化内容（无动作 / 时间戳非法）返回 null，不上送 |
| 条目入库 | `POST /api/sessions` | Zod 全字段（条目 / stats）校验，失败 400 拒收；`startTime < endTime`；exercises ≥ 1 |
| 心率入库 | `POST /api/sessions/:id/hr-samples` | Zod 校验（bpm 1-250 / ISO 时间戳 / 1-20000 条 / body `session_id` 与路径一致）；重复样本幂等丢弃 |
| Agent 出卡 | uiHintValidator 校验回路 | Zod 全字段（7 类卡判别联合）+ HC-4 黑名单（`hitl_confirm` 拒收）+ `ExercisePlanSchema` superRefine 业务规则（类型必填 / weight 符号 / 禁 0）；失败反馈重试，不降级放行 |
| 出卡数字 | workoutQualityGate | 卡片文本「指标关键词 + 数字」逐项与 session 真值比对：容差绝对 ≤1 或相对 ≤2%；距离 km/m 双向换算候选；心率允许单项动作真值；无真值跳过（无真值即无幻觉判据） |
| 动作引用 | 计划自检 + 工具真值 | exerciseId 必须来自 list/find 工具返回的真实条目（关系引用完整性目标态见契约缺口清单） |

底线复述：允许预处理（聚合 / 降噪 / 简化，见分册5），底线是**无缺漏无错误**；任何校验失败都是抛错重试，**没有「降低要求放行」路径**（不兜底）。

## 5. Agent 输入可视化页（产品规格，批次4 输入）

### 5.1 定位

独立页面，按「**训练后审计**」设计：展示每次训练实际传给 Agent 的完整 payload，解决「黑盒不知道喂了什么」的排障需求。

### 5.2 产品规格

| 项 | 规格 |
|---|---|
| 入口 | 会话完成后的审计入口（从会话详情 / summary 卡可进入；独立路由，不嵌聊天流） |
| 粒度 | 按会话一页：选会话 → 看该次训练的完整输入 |
| 分区 | 四分区对齐 §2 四要素：①卡片数据（条目 + stats，逐字段标注真源）②时间线关系（窗口 / 顺序 / 前后会话）③卡卡关系（合并来源标记：sessions 表权威 / write_session 记忆）④感受序列（feel 曲线 + feel_note 列表） |
| 原始视图 | 附「原始 payload」JSON 视图（load_history 同构），可展开复制 |
| 数据面 | 复用 load_history 同源读取路径（Repository → 组装），**不新造第二套读取逻辑**（防两套口径） |
| 无兜底 | payload 拉取失败直接报错展示错误详情，不出空态占位或猜测内容 |
| 展示红线 | 该页只读；禁止在此页编辑数据（编辑走画像确认流） |

### 5.3 明确不做

AI 分析效果优化（后置）、分享 / 市场机制、原始音频存储、AI 自动修复建议注入。

## 6. 变更记录

| 日期 | 变更 | 依据 |
|---|---|---|
| 2026-09-30 | 分册4 创建（手册批） | #88 v2 spec |
