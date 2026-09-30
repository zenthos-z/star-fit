# 分册5：采集流协议（Data Collection）

> 采集以**够 Agent 判断用**为准——复杂数据先简化再入库，不追求无限分辨率。
> 口径真源：#88 v2 spec · 决策引用：`docs/adr/0001`（心率样本 5s 降采样）· 用语：`CONTEXT.md`

## 1. 总则：复杂数据简化

1. 每个采集项先回答「Agent 判断需要什么粒度」，按该粒度采集；更细分辨率不进系统（心率真源在 HealthKit，需要时可重拉——ADR-0001）。
2. 简化只发生在采集 / 聚合层（手表固件、`workoutSummary`、工具层统计），Agent 收到的都是算好的单值或定长序列。
3. 缺失即缺席：某采集项缺省只代表「该类型不采集」或「无设备接入」，下游禁止把缺席解释为零表现。

既有简化决策（引用，不在本册重设）：

| 决策 | 出处 |
|---|---|
| 心率样本 5s 降采样入库（时序表 + 真源在 HealthKit，废弃手动录入链路） | ADR-0001 |
| 组平均心率单值（由样本聚合写入组字段，不接受手动录入） | ADR-0001 / `CONTEXT.md` |
| 训练中每分钟 1 均值仅作展示推送（心率低频推送 HR Live Peek），完整样本流训后批量同步 | ADR-0001 |

## 2. 数据链全景

```
手表（HealthKit 采集）
  │ WatchConnectivity（手机中继；手表不直接调用后端 API）
  ▼
手机
  ├─ 训练中：心率低频推送（每分钟 1 均值，仅展示，不入库）
  ├─ 会话完成：workoutSummary 预处理 → 格式化训练条目 + stats
  │    ├─ POST /api/sessions ──────────► users.history_summary.sessions
  │    └─ 本地落账 → sync 队列 → POST /api/sync/push ──► sessions 表（raw_json，权威）
  └─ 训后批量：心率样本（5s 均值）
       └─ POST /api/sessions/:id/hr-samples ──► heart_rate_samples 时序表
                                                │
Agent 回读 ◄── load_history / get_session_hr_curve / get_hr_trend ─┘
  （原始样本不进上下文，聚合在工具层完成）
```

写入流是两条独立的通路：**同步通路**（sync 队列 → sessions 表 raw_json，承载完整本地会话）与**条目通路**（训练完成即 `POST /api/sessions` → history_summary，承载格式化训练条目，供 Agent 立即回读）。Agent 回读时双源合并、sessions 表权威（分册4 §2.3）。

## 3. 教练四问 → 采集清单（数据需求侧倒推，#88 v2 定稿）

| 教练问题 | 数据 |
|---|---|
| 动作参数 | sets 参数（已有） |
| 休息间隔 / 是否跳过 / 时长 | 组时间戳 + 60s 默认休息倒计时数据链推断；不确定情况实际训练中逐步微调（**先采数后微调，不做超前设计**） |
| 动作感受 / 状态 | feel 滑块 + feel_note 语义补充 |
| 跨动作状态 | 感受序列 + 动作顺序，暂不新增显式状态标注 |

## 4. 采集项规格

### 4.1 动作参数（逐组原值，不简化）

reps / weight / duration / distance / rpe 逐组记录，符号语义随细类（assisted 负值助力）。落点 `ExerciseAction.sets.*`（字段清单见各规范卡 §4.2）。

### 4.2 组时间戳（逐组原值）

| 项 | 规格 |
|---|---|
| 采集 | 每组完成时刻自动落值（前端 `completedAt` ms；契约层 `timestamp` ISO 8601） |
| 用途 | 休息推断链输入；会话内动作顺序还原 |
| 契约现状 | 契约中 `timestamp` 为可选——**目标必填化，契约批**（契约缺口清单 #2） |

### 4.3 休息（推断量，不单独存储）

- 默认 60s 倒计时开始休息；手机长按加 20 秒，手表双按钮（结束休息 / 加 10 秒）。
- 每段落值 `restEndTime`（epoch ms）。
- 推断公式（`workoutSummary.sumRestSeconds`）：每段休息 = `min(restEndTime, 下一组 completedAt) − 本组 completedAt`；任一时间戳缺失或计算为负（提前结束休息后又完成下一组）→ 丢弃该段，不猜值。
- 动作级合计为 `rest_sec` 进格式化训练条目。
- 节奏：先采数后微调——倒计时默认值等实际数据积累后再调，不做超前设计。

### 4.4 心率样本（5s 降采样）

| 项 | 规格 |
|---|---|
| 采集端 | 手表（HealthKit），训练场景全程 |
| 入库分辨率 | 每 5 秒 1 个均值 |
| 表 | `heart_rate_samples`（user_id / session_id / exercise_index / set_index / bpm / recorded_at / source） |
| source | `watch`（默认）/ `manual`（仅审计区分存量，手动链路已废弃） |
| 组外样本 | `exercise_index` / `set_index` 可空（组间休息期样本） |
| 聚合 | 组平均心率（单值，写入组字段）；会话曲线（get_session_hr_curve，5s 粒度 points + avg/max/min）；跨会话趋势（get_hr_trend） |

心率样本字段（真源 `shared/contracts` `HeartRateSampleSchema`）：

<!-- spec:fields id="dc-hr-sample" expect="HeartRateSample" -->
| 字段 | 说明 |
|---|---|
| `bpm` | 1-250 |
| `recorded_at` | ISO 8601 时刻 |
| `source` | `watch` / `manual`（默认 watch） |
| `exercise_index` | 动作序号（组外样本可空） |
| `set_index` | 组序号（组外样本可空） |
<!-- /spec:fields -->

单条样本示例：

<!-- spec:example id="dc-hr-sample-one" validator="hrSample" -->
```json
{ "bpm": 142, "recorded_at": "2026-09-30T14:20:35Z", "source": "watch", "exercise_index": 0, "set_index": 2 }
```
<!-- /spec:example -->

训后批量载荷示例（1-20000 条；body `session_id` 必须与路径一致；重复样本幂等丢弃）：

<!-- spec:example id="dc-hr-samples-batch" validator="hrBatch" -->
```json
{
  "session_id": "3f2b8c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  "samples": [
    { "bpm": 118, "recorded_at": "2026-09-30T14:15:05Z", "source": "watch", "exercise_index": 0, "set_index": 0 },
    { "bpm": 142, "recorded_at": "2026-09-30T14:20:35Z", "source": "watch", "exercise_index": 0, "set_index": 2 }
  ]
}
```
<!-- /spec:example -->

### 4.5 感受（组后弹窗，#88 v2 定稿交互）

| 项 | 规格 |
|---|---|
| 时机 | 每组最后一个动作完成后弹窗（表单干净简洁） |
| feel | 感受滑块：无级 0-100 **连续值，原值存储不分档** |
| feel_note | 语义化文本补充（受伤 / 疼痛 / 力量过大等滑块说不清的内容）；语音输入复用 @ 对话框已实现的语音转文本，**原始音频不存** |
| 序列 | 组间形成对比序列 + 跨动作按动作顺序排列，供 Agent 分析状态与理解程度趋势 |
| 契约现状 | `feel` / `feel_note` 字段未落契约——**契约批**（契约缺口清单 #1），落地前本节为目标态定义 |

目标态载荷（草案形态，落地以契约批为准）：

<!-- spec:example id="dc-feel-draft" validator="none" -->
```json
{ "set_index": 2, "feel": 62, "feel_note": "最后一组膝盖外侧有点紧" }
```
<!-- /spec:example -->

## 5. 同步协议

### 5.1 推送（push，队列驱动）

| 规则 | 说明 |
|---|---|
| 队列 | 本地落账后 enqueue（sessionId 去重；刚从服务端拉回的会话跳过入队防回声） |
| 批量 | 每批 ≤ 10 个会话，批间连续推进；删除队列整批随行 |
| 载荷 | `{ deviceId, sessions[], deletedSessionIds[] }`；待同步会话附带偏差缓冲（deviation）进 meta |
| 成功 | 移出队列、清删除项、清偏差缓冲；失败保留重试 |
| 心跳 | 队列为空也发空推送（设备注册保活） |
| 触发 | 初始化、入队后、每 5 分钟（在线时） |

### 5.2 拉取（pull，全量）

| 规则 | 说明 |
|---|---|
| 范围 | 全量拉取（`since=0`；数据量小，全量比增量更可靠——现有拍板） |
| 合并 | 服务器优先：远端较新覆盖本地；待删除项跳过合并 |
| 对账 | 服务端返回 `activeSessionIds`，本地不在册且不在推送队列中的条目移除（防旧服务端误清：仅当服务端提供该列表时对账） |
| 防回声 | 拉回的 sessionId 记入 `pulledSessionIds`，enqueue 时跳过 |
| 附加 | 动作库缓存合并 + 应用配置合并 |

### 5.3 服务端写路径

- `POST /api/sync/push` → `SessionRepo.upsertSessions`（sessions 表 `raw_json`，权威数据源）+ 删除处理 + 向同用户其他设备广播 `sync_needed`。
- `GET /api/sync/pull` → sessions / 动作库 / 引导 / 配置 / activeSessionIds。

## 6. 入库端点与载荷（条目通路）

### 6.1 `POST /api/sessions`（训练完成即持久化，Agent 分析前置）

先持久化再调 Agent：数据不依赖 Agent 存活（防超时丢数），Agent 始终读库防幻觉。

| 字段 | 语义 |
|---|---|
| `sessionId` | 可选（缺省服务端生成 uuid） |
| `startTime` / `endTime` | epoch ms，必须 `startTime < endTime` |
| `exercises[]` | 格式化训练条目（字段清单见各规范卡 §4.3；≥1 行） |
| `stats` | 会话级统计（字段见分册4 §2.1） |
| `notes` | 用户备注（≤2000 字符） |

硬校验：Zod 全字段，失败 400 拒收（不兜底）。完整载荷示例：

<!-- spec:example id="dc-session-payload" validator="none" -->
```json
{
  "sessionId": "3f2b8c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  "startTime": 1790775300000,
  "endTime": 1790778600000,
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
```
<!-- /spec:example -->

### 6.2 `POST /api/sessions/:sessionId/hr-samples`

Zod 校验（bpm 1-250 / ISO 时间戳 / 1-20000 条 / body 与路径 session_id 一致）；session 行缺失时按用户补建最小行；写入幂等（`ON CONFLICT DO NOTHING`）。

## 7. 质量门判据（workoutQualityGate，出卡数字一致性）

| 项 | 判据 |
|---|---|
| 比对对象 | 卡片可见文本（正文 + 序列化 data）中的「指标关键词 + 数字」对 vs session 真值 stats |
| 指标域 | 总容量 / 组数 / 有氧时长 / 时长（分钟）/ 距离 / 平均心率（中英关键词匹配，数字前后窗口识别） |
| 容差 | 绝对差 ≤1 或相对偏差 ≤2%（四舍五入 / 单位换算正常浮动） |
| 距离 | km/m 双向换算候选（4.5km 与 4500m 均合法） |
| 心率 | 全局 avgHr 之外，允许任一单项动作组均值作为合法真值 |
| 复合单位排除 | 「6 分/公里」类配速数字不判为距离 / 时长主张 |
| 无真值 | stats 无该指标（如本次无有氧）→ 跳过，不误伤 |
| 失败 | 反馈重试（校验回路），不放行 |

## 8. 明确不做

秒级心率推送、原始音频存储、原始 GPS 轨迹全量入库、超采样（高于 Agent 判断所需的分辨率）、休息推断的超前个性化（先采数后微调）。

## 9. 变更记录

| 日期 | 变更 | 依据 |
|---|---|---|
| 2026-09-30 | 分册5 创建（手册批） | #88 v2 spec · ADR-0001 |
