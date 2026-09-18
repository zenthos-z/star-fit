# 数据模型盘点（2026-09-18，代码实地核实）

## 现状：三层各有什么

### 采集层（每组，前端 ExerciseSet）
| 字段 | 类型 | 状态 |
|---|---|---|
| reps | number | ✅ 采集 |
| weight | number | ✅ 采集（assisted 为负值=辅助重量） |
| duration | number | ✅ 采集（秒） |
| distance | number | ✅ 采集（米） |
| rpe | number | ⚠️ **采集但落库丢弃**（formatExerciseEntry 不输出，后端 ExerciseEntrySchema 无此字段） |
| heartRate | number | ✅ 组级心率，落库为动作级 avg_hr（均值，原始值丢） |
| completedAt / restEndTime | timestamp | ✅ 采集，聚合为动作级 rest_sec（原始时间戳丢） |
| status / completed | string/bool | ✅ |

### 动作级 9 类（ExerciseType）
resistance / bodyweight / assisted / unilateral / isometric / cardio / outdoor / weight_only / reps_only
（后端动作库还有 flexibility / heavy_weight / rep_training，前端类型系统缺 flexibility）

### 记录层（会话汇总，POST /api/sessions）
- 动作行：name/type/sets/completed_sets/weight(均值)/reps(均值)/duration/distance/avg_hr/rest_sec
- 会话行：totalVolume/setsCount/totalCardioDurationSec/totalDistanceM/avgHr

### 展示层
- History 卡：时长 / 容量 / 组数
- 结算页：总容量 / 组数 / 平均心率 + 每动作 maxWeight/totalReps
- Agent 上下文：historySummary（最近3次压缩文本）

## 已知问题（2026-09-17 真机实证）
1. 新用户无体重 → bodyweight/isometric 容量虚增（75kg 硬编码兜底）
2. 组级 RPE 采集但不落库 → e1RM/session-RPE 都算不了
3. 组级原始数据（每组重量/次数）落库即丢，只存均值 → 后端无法复算容量、无法做组间分析
4. 动作类型 fragmentation：前端9类 vs 后端动作库10类 vs 协议 v2 弱 enum

## 待调研定稿
- 容量口径（tonnage 是否含自重）
- 需要新增采集项（RIR？静息心率？主观 readiness？）
- 哪些只采不展示、哪些给用户看
