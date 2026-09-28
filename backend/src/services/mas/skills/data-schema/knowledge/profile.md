# 画像域数据结构（users 表三态模型）

> 真源：`shared/contracts/index.ts`（ProfileStaticSchema / ProfileDynamicSchema）+
> `backend/src/db/postgresql/migrations/000_baseline.sql`（DDL）。
> 本文件是 Agent 速查层（42c 新建）。

## 一、users 表与三态模型

| 列              | 类型  | 说明                                                    |
| --------------- | ----- | ------------------------------------------------------- |
| id              | uuid  | 程序内部唯一标识（数据库查询、程序内部逻辑）            |
| display_name    | text  | 用户自定义 ID（给用户展示、AI 上下文，1-50 字符 CHECK） |
| device_id       | text  | 设备标识符（区分同一用户的不同设备）                    |
| profile_static  | jsonb | 长期生物/心理特征（6-12 个月量级更新），默认 `{}`       |
| profile_dynamic | jsonb | 高频状态（每次训练后更新），默认 `{}`                   |
| history_summary | jsonb | 压缩历史（AI token 优化，按周更新），默认 `{}`          |

标识符约定：变量名表程序内部 ID 用 `Id`（UUID），表用户展示 ID 用
`displayName`；AI/用户层用 display_name，程序内部用 id（UUID）。
工具调用的 user_id 由服务器注入，LLM 不可指定。

## 二、profile_static 字段

| 字段                          | 说明                                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| basic_info                    | { age, weight(kg), height(cm), body_fat(%), training_age(月), gender: male/female/other } |
| preferences                   | { method（训练目标）, equipment（可用器械，硬约束）… }                                    |
| tags                          | string[]，如 "fitness_level:beginner"、"goal:muscle_gain"                                 |
| physiological / psychological | 生理 / 心理特征（psychological: neuro_type / risk_preference / accountability）           |
| psycho_os                     | 神经类型操作系统画像                                                                      |

## 三、profile_dynamic 字段

| 字段               | 说明                                                                                                                                                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| load_anchors       | 按动作名的负荷锚点 map：{ best_weight, best_reps, est_1rm, progression_level(自重), best_duration(等长), best_distance/best_pace(有氧), max_hr/resting_hr/zone_2_threshold(心率), last_updated(epoch ms，必填) } |
| active_limitations | 自愈式伤病窗口数组：{ part(部位), severity(1-10), expire_at(ISO，到期自动失效), logged_at(ISO), auto_heal }                                                                                                      |
| recovery_state     | { total_score(0-100), cns_fusing, last_assessed(ISO), acute_load?, chronic_load? }；新用户可为空                                                                                                                 |
| memories           | write_memory 写入的键值文本备忘（key → note）                                                                                                                                                                    |

## 四、update_profile 写入语义

- 深合并进目标 JSONB（`profile_dynamic` 或 `profile_static.psychological`），
  浅合并语义：传入对象整体替换对应键
- `load_anchors` 传整表**替换**——更新单个锚点前必须先 load_history 读出、
  合并后传全表；`active_limitations` 同理（新增 = 读出后 append 再传全数组）
- 可写目标：load_anchors / active_limitations / recovery_state（profile_dynamic）
  与 psychological 三字段（profile_static）；始终作用于当前调用用户
