# 调整语义 (Adjustment Semantics)

## 字段与模式

| field | 合法 mode | 建议幅度 | 语义 |
| --- | --- | --- | --- |
| `weight` | multiply / delta | multiply 0.85~1.05；delta ±2.5 | 每组负重（kg） |
| `reps` | multiply / delta | delta ±2 | 每组次数 |
| `duration_sec` | multiply / delta | multiply 0.8~1.1 | 时长（秒），有氧/等长类 |
| `distance_m` | multiply / delta | multiply 0.8~1.1 | 距离（米），户外/有氧类 |
| `set_count` | **仅 delta** | -2 ~ +1 | 组数（容量敏感，下调为主） |
| `target_rpe` | **仅 delta** | -1 ~ +1 | 目标主观强度 |

- multiply 作用于该字段的公式基准值（如 weight ×0.9 = 降 10%）。
- delta 是绝对增量（如 reps +2）。
- 同一字段只出一条 action；每动作 actions ≤ 6。
- 没有把握就整个省略该动作 —— **不调整是合法且常是最优的输出**。

## 典型场景 → 意图映射

| 画像信号 | 建议意图 |
| --- | --- |
| 活跃伤病（severity ≥ 4）该部位相关 | weight multiply 0.7~0.8；必要时 set_count delta -1 |
| 恢复分 < 50 / 疲劳高 / CNS 低迷 | weight multiply 0.85~0.95 |
| 长期未练该动作（锚点置信度 ≤ 0.6） | weight multiply 0.8~0.9（重新适应） |
| 中级+、恢复好、目标 strength | weight multiply 1.05（小幅递增） |
| 目标 endurance/fat_loss、恢复好 | duration/distance multiply 1.05~1.1 或 reps delta +2 |
| 新手（fitness_level beginner） | 通常不调（公式已按 0.7 上限保守） |
| 单次训练含 >6 个动作 | 每肌群 set_count delta -1（容量控制） |
