# 心率数据：时序样本表 + 真源在 HealthKit，废弃手动录入链路

手动输入的心率单值链路被判定为错误链路（数据不可信、无法支撑趋势分析）。决定：新建
`heart_rate_samples` 时序表（user_id / session_id / exercise_index / set_index / bpm /
recorded_at / source，snake_case，标准迁移），存 5 秒分辨率的分析级样本；每组平均值仍写
入 session `raw_json` 的 set 单值字段（由样本聚合，兼容现有链路）。真源永远是 HealthKit
（手表 HKWorkoutSession 采集），本库是分析级副本。

同步策略：训练中手表每分钟推 1 个均值到手机做展示（HR Live Peek，WatchConnectivity），
完整样本流训后批量同步：手表 → 手机 → 后端，手表不直连 API。Agent 分析经预处理工具
读取样本表（聚合/统计在工具层完成，原始样本不直接进上下文）。

## Considered Options

- 塞 session `raw_json` 的 metadata 数组：趋势查询需整包解析 MB 级 JSON，范围查询无索引，弃。
- 手表直连后端 API：需重做鉴权与弱网处理，训练场景手机就在旁边，WatchConnectivity 足够，弃。
- 保留手动输入作兜底：数据不可信会污染分析集，直接废弃（用户拍板「现有链路是错误的」）。

## Consequences

- 现有手动录入 UI（RunningCard 手填框等）需拆除或降级为「未连接手表」占位。
- 历史数据中已手动录入的 set 单值无样本背书，分析脚本须可区分（source 字段保留区分能力）。
