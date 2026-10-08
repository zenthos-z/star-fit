# 计划生成知识指南 (Plan Generation Knowledge Guide)

> 本指南由 Starfit MAS 系统维护，基于当前运动科学研究和最佳实践设计。
> AI Agent 在生成训练计划时应参考本指南，确保计划的科学性和安全性。
>
> 42c 起知识按主题拆分（SKILL.md 知识索引按需 read_file）：
>
> - 新手起步/重量推算（§3.2.0 前置检查 + 起步分支 + 公式）→ `knowledge/novice-starting.md`
> - 容量分配/三大项/等级目标适配（§2/§4/§7.1/§7.2）→ `knowledge/volume-progression.md`
> - 伤病降载/安全协议（§3.3 伤病项/§8）→ `knowledge/injury-adjustment.md`

---

## 一、动作选择原则

### 1.1 复合动作优先原则

- **复合动作占比**：60-70% 的训练量应来自复合动作
- **优先级排序**：
  1. 大肌群复合动作（深蹲、卧推、硬拉、引体向上、划船）
  2. 多关节孤立动作（侧平举、弯举、三头下压）
  3. 单关节孤立动作（飞鸟、腿屈伸）

### 1.2 推拉腿平衡原则

- **推类训练日**：胸部、肩部、肱三头肌
- **拉类训练日**：背部、肱二头肌、后肩
- **腿部训练日**：股四头肌、腘绳肌、臀部

### 1.3 动作多样性原则

- 每周避免完全相同的训练组合
- 相同肌群使用不同角度刺激（如上斜/下斜卧推）
- 每 4-6 周轮换动作变式

### 1.4 选动作工具链（5.3，T2/#54）

选动作一律 `find_exercises` 组合筛选（肌群×模式×器械×难度一次收窄，返回精排
短列表，主肌群命中优先），**≤3 次调用收敛**：候选不够按 `relax_hint` 放宽单一
维度补查；**禁止 `list_exercises` 翻页遍历**。周计划首选模板路径（§9.3），
本节工具链用于模板外补充 / 单日 / 自由生成回退（流程真源 = SKILL.md）。

---

## 二、容量分配规则（已拆分）

容量分配、三大项 MEV/MRV、等级/目标适配已拆至
`knowledge/volume-progression.md`（read_file 按需拉取）。

---

## 三、重量推算逻辑（已拆分，§3.2.0 真源在 novice-starting.md）

**PRE 重量规则单一真源（§3.2.0 推算前置检查 + 新手起步重量分支）已拆至
`knowledge/novice-starting.md`**——缺锚点时按经验分支给起步重量（空杆 20kg /
最小配重 2.5-5kg / PRE 自测），禁止编造重量。伤病恢复期降载见
`knowledge/injury-adjustment.md`。read_file 按需拉取。

---

## 四、三大项科学计算（已拆分）

见 `knowledge/volume-progression.md`。

---

## 五、自定义动作规范

### 5.1 何时允许自定义动作

在以下情况下，Agent 可以创建自定义动作：

1. **动作库不足**：没有合适的动作匹配
2. **特殊需求**：用户有明确的康复或功能训练需求
3. **器械限制**：用户只有特定器械，动作库无匹配

### 5.2 动作库不足时的处理

动作创建走管理端（admin 后台），**Agent 没有创建动作的工具**。当动作库中没有合适的动作时：

1. 调用 `find_exercises`（必要时放宽维度）再次核对动作库（确认没有遗漏的合适动作；`list_exercises` 关键词查询可兜底）
2. 找不到就用最接近的库内替代动作，并在 explanation 中说明替代理由
3. 绝不编造库外动作 id 或名称——plan 卡校验要求 id 来自 `find_exercises`/`list_exercises` 返回

**禁止使用 custom\_ 前缀或自造 id**：

- 计划卡中的动作 id 必须来自 `find_exercises`/`list_exercises` 返回的真实条目

### 5.3 自定义动作限制

- 禁止创建高风险动作（颈后推举、早安式等）
- 自定义动作优先使用低负荷、低风险
- 明确标注动作来源（"用户自定义"）

---

## 六、格式验证规则

### 6.1 字段验证

| 字段          | 类型   | 有效范围                            | 必填   |
| ------------- | ------ | ----------------------------------- | ------ |
| id            | string | NanoID (12-24 chars)                | 是     |
| name          | string | 任意非空                            | 是     |
| exercise_type | string | resistance/cardio/isometric/outdoor | 是     |
| sets          | number | 1-20                                | 是     |
| reps          | number | 1-200（整数）                       | 是     |
| weight        | number | >= 0                                | 否     |
| duration      | number | > 0（秒）                           | 视类型 |
| distance      | number | > 0（米）                           | 视类型 |

### 6.2 常见错误及修正

| 错误                   | 修正方法                                        |
| ---------------------- | ----------------------------------------------- |
| sets > 20              | 限制为最大 20 组                                |
| reps > 200             | 限制为最大 200 次                               |
| reps 使用字符串 "8-12" | 必须使用整数，如 12                             |
| weight < 0             | 设置为 0（自重）                                |
| 缺少 exercise_type     | 设置为 resistance/cardio/isometric/outdoor 之一 |

自检清单（输出 plan 卡前逐项核对）：

- id 来自 `find_exercises`/`list_exercises` 返回的真实条目（禁止编造）
- exercise_type 与动作库中该动作的类型一致
- sets/reps 为整数（reps 不能是 "8-12" 这类范围字符串）
- weight >= 0；抗阻动作无 load_anchor 时按 beginner/有经验 分支给起步
  重量（空杆 20kg / 最小配重 2.5-5kg / 问用户），禁止留 0（会被打回）；
  bodyweight 动作 weight=0 正确。无 load_anchor 时在 explanation 中
  说明「第一次找感觉：动作标准优先，练完把实际重量告诉我」
- explanation 为非空字符串
- **target 标记**：用户明确要「明天/第二天」的计划（非训练结束时），
  在卡片顶层加 `target: "next_day"`（例：`{ "type": "plan_card",
"target": "next_day", "data": [...] }`）；普通当次训练计划不要加

格式错误会被 uiHint 校验回路打回重试（修订文本以 thinking 事件呈现），
届时按错误信息修正字段后重新输出整张卡片。

---

## 七、器械限制适配（§7.3）

- **仅哑铃**：增加单侧训练，注意弱侧平衡
- **仅器械**：增加孤立动作，控制节奏
- **自重为主**：增加次数，减少间歇

（健身等级适配 §7.1 / 训练目标适配 §7.2 已拆至 `knowledge/volume-progression.md`）

---

## 八、安全协议（已拆分）

红线停止条件、动作标准、呼吸节奏已拆至 `knowledge/injury-adjustment.md`。

---

## 九、输出格式规范

### 9.1 plan 卡输出方式（单日/会话级）

plan_card 承载单日 / 明日**会话级**计划（周计划见 §9.3 模板路径）。生成
完整计划后，直接在回复正文中输出一个 ```json 围栏包裹的 plan 卡（字段
规格与必填清单见 uiHint 格式技能 + §6 自检清单），正文其余部分保持简短
说明。**此处不维护示例卡 JSON**——示例卡是模型复述泄漏（#73）与伪造 id
（#136）的源头，字段契约以 uiHint 格式技能为单一真源。

**常见错误**：

- ❌ 调用不存在的 submit_plan / calculate_capacity 工具
- ❌ 将 data 写成嵌套的 JSON 字符串而非数组
- ❌ reps 使用字符串 "8-12" 而非数字 8
- ✅ data 直接传递数组对象
- ✅ 动作 id 必须来自 find_exercises / list_exercises 返回

### 9.2 uiHint 结构（校验回路使用）

plan 卡由 uiHint 校验回路（M5c）程序化校验：schema 不通过 → 打回重试，
被拒轮次的文本以 thinking 事件呈现，不会泄漏为正文。

校验要点：

| 字段  | 要求                                              |
| ----- | ------------------------------------------------- |
| type  | "plan_card"（兼容期别名 "plan" 不再被校验器接受） |
| data  | ExercisePlan[]（≥1 个动作）                       |
| title | 非空字符串                                        |

### 9.3 weekly_plan 卡（周计划提案卡；6.0 起首选模板实例化路径）

**周计划请求首选模板路径（#151 S3）**——Agent 只做选型与参数化，不逐动作
展开（日期对齐/器械替换/剂量查表/伤病过滤/周次递进全部由程序层算好，
AI 绝不介入算术）：

```
load_history → pick_template（目录：键/人群/分化/器械面/天数档）
  → instantiate_weekly_plan（模板键 + 覆盖参数：tier / days_per_week /
    week_offset / equipment / sex / training_age_months / active_limitations）
  → 返回的 card 原样经 submit_weekly_plan 提交（数据一比一转述，
    禁改剂量/日期/动作 id）
```

- 选型依据：分化与器械面贴合 load_history 读到的用户画像；用户实际器械
  覆盖不了模板器械面时，换更贴近的模板或传 `equipment` 覆盖参数
- 未显式覆盖的字段自动从用户 profile 回填（器械面/性别/训练龄/周频率/
  已登记伤病）；**伤病恒并集**——对话中新提及的部位传 `active_limitations`
  追加，已登记伤病不可能被 `[]` 豁免。回填清单见工具返回的
  `profile_defaults_applied`
- 修改轮（「这周只能练 2 天 / 换自重」）：带新覆盖参数**重调**
  instantiate_weekly_plan 再提交新卡，不要手改旧卡
- `ok:false` 结构化错误（UNKNOWN_TEMPLATE / INVALID_PARAMS）按 errors/hint
  修正参数后重调，**不要降级为散文交付**
- 通道为 fence（回滚位）时按 uiHint 格式技能走正文围栏，数据面不变

**自由生成回退（模板覆盖不了时）**：无匹配分化 / 模板器械面空洞过多 →
按 SKILL.md 三段式（策略→选动作→配参数）自行构造 weekly_plan 卡数据
（结构化四件套与 apply 载荷契约不变，字段表见
`/data-schema/knowledge/plan.md`）提交。**此处不维护示例卡 JSON**——示例卡
是模型复述泄漏（#73）与伪造 id（#136）的源头，字段契约以
`/data-schema/knowledge/plan.md` 为单一真源。

要点（两路径通用）：

- `data` 是**对象**不是数组（与 plan_card 相反）；`days` 覆盖周一至周日整周
- `exercise_id` 必须来自 instantiate_weekly_plan 返回 / find_exercises /
  list_exercises，禁止编造
- **结构化四件套（5.4 起）**：`day_focus` + `rationale`（同日各条目同值，
  与展示层 `days[].focus` / `days[].rationale` 同值）+ `category` 段位
  `warmup|main|cooldown`（同日按**热身→正式→收尾拉伸**三段排 sort_order）
  - `sets` 逐组处方 `[{set_no, weight_kg?, reps, rpe}]`（组数=target_sets、
    set_no 从 1 连续、rpe 逐组可不同）。模板路径由内核保证展示层 per-set
    与落库处方同源；自由生成路径按同一契约构造
- **算术红线**：模板路径天然满足（剂量/日期/递进程序层产出）；自由生成
  时重量/RPE 照 §3.2.0 起步表或 load_anchors **直取**，禁止在思考阶段
  逐组换算。**围栏通道下出卡消息不得携带 tool_calls**——需要的知识先
  读完再进出卡段（工具轮消息的正文会被流层归为思考，卡无法送达）
- **`apply` 载荷（5.0 必带）**：确认落库的唯一数据面。scope=week 整周
  （split 必带，严格五枚举）；scope=days 单日覆盖（dates 列出被替换日，
  entries 只含该日条目）。展示层 `days[].exercises[].name` 用 **name_zh**
  （禁自翻译）；`sets.length` 必须与对应 `apply.entries[].target_sets`
  一致（展示与落库同源）
- **纯净新生成**：卡上没有进度/状态/执行率字段——那是执行层的职责
- 休息日：`rest: true`、exercises 留空，前端弱化为灰行
- 确认前数据库无此计划；说明文案点一句「点下方确认后生效」

### 9.4 explanation 编写指南

**推荐结构**：

- 训练目标
- 动作要点（3-5个）
- 重量安排
- 注意事项
- 鼓励语

**内容要求**：

- 根据用户健身水平调整语气
- 初学者提供更详细的说明
- 适当使用 Markdown 格式

---

## 十、用户画像最高宪法

### 10.1 最高宪法原则

用户画像是所有计划决策的最高约束条件。

**用户画像包含的约束**：

- fitness_level: 决定训练强度、容量、动作复杂度
- basic_info: 体重、身高、年龄影响重量推算
- preferences.method: 训练目标决定动作选择
- preferences.equipment: 器械限制是硬约束
- tags: 如 "fitness_level:beginner", "goal:muscle_gain"

### 10.2 自定义动作的画像约束

当动作库不足需要创建自定义动作时：

- 不得超出用户的器械限制
- 不得安排用户伤病部位的动作
- 重量、难度必须符合用户的 fitness_level

### 10.3 突破画像的后果

突破用户画像的计划会被 uiHint 校验与质量要求视为违规输出——画像约束是硬边界，不要赌校验放行。

---

## 十一、周计划模式（提案-确认，5.0 / B5b）

> 5.0 起（B5b/issue #38）：计划仍是持久化实体，但写入改为**提案-确认**——
> Agent 提案轮算好 entries 随卡携带，用户确认后 App 直调确定性端点落库。
> 表结构与状态机契约见 `shared/contracts/weekly-plan.ts`（数据契约唯一定义源）；
> 面向 Agent 的字段速查表见 `/data-schema/knowledge/plan.md`。

### 11.0 提案-确认架构（5.0 核心变化）

```
Agent 提案轮（编排，无写入工具）
  → weekly_plan 卡（data.apply 载荷 = 确认落库的唯一数据面）
  → 用户点「确认启用」
  → App 直调 POST /api/schedule/weekly-plan/apply（无 LLM，毫秒级）
  → 信息栏（本周计划）即刻同步刷新
```

- **确认之前计划绝不进数据库**（根治「计划不知什么时候就出现了」）
- `save_weekly_plan` 写工具已移除：Agent 侧没有任何写计划的入口，
  「先落库再告知」从此在结构上不可能
- 确认语义：scope=week 整周 upsert（条目整体替换）；scope=days 仅替换
  `dates` 所列日期的条目（其余六天不动）
- 用户不确认（关掉对话/不点）= 提案自然作废，无残留数据

### 11.1 周/日粒度判断（单一真源，5.4 自 SKILL.md 迁入）

粒度=f(原因影响范围, 框架存在性)；**周计划=训练框架，日计划=框架内某天的
覆盖**。先 `get_current_plan` 判框架再查表：

**前置门槛（先于本表）**：`load_history` 后关键输入（目标/经验/器械/频次/
伤病/体重）大多未知（典型空档案新用户）先发 **survey_card** 调研，不按保守
假设排计划（「档案空按最保守自重排一周」违规）。

问卷题库单一真源 = `shared/contracts/survey.ts` 的 `PROFILE_INTAKE_QUESTIONS`
（与 App 首用问卷同源，#114 起双真源收敛）：

- 新用户（画像大多为空）→ `data.purpose: "profile_intake"`，题库全量一次问完；
- 仅个别字段缺口 → `data.purpose: "plan_gap"` + 缺口对应的题库 id 子集
  （缺哪几项发哪几题，禁止自造同义题、禁止重问已答字段）；
- 出卡只需给对 `purpose` + 题库 id + `title`/`message` 话术——题目文案/选项/
  二级菜单/inputType 由后端按 id 从题库原文替换（题面写了也会被对齐，写对
  id 才是关键；id 全不在题库 → 校验回路打回）；
- 条件题：`age` 仅 goal ∈ {fat_loss, general_fitness} 时渲染——含 `age` 的
  子集必须同时含 `goal`。

题库 id → 画像缺口映射（plan_gap 选 id 依据；字段名注意是 `inputType` 不是
`input`）：

| 题库 id                                    | 收集内容                                                          | 画像落点                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `goal`                                     | 目标（muscle_gain/fat_loss/strength/general_fitness/body_recomp） | `preferences.goal`（value 直写）                                          |
| `experience`                               | 训练经验四档（beginner_zero/beginner/intermediate/advanced）      | `basic_info.training_age`（写库端确定性换算月数）                         |
| `weight_kg`                                | 体重（number 30-250）                                             | `basic_info.weight`                                                       |
| `equipment_venue`                          | 场地单选（gym/home/outdoor，children 二级菜单）                   | 派生题，驱动 `equipment_items`                                            |
| `equipment_items`                          | 器材多选（childKey 答案键，值=EXERCISE_EQUIPMENT）                | `preferences.equipment`（写库端追加 bodyweight）                          |
| `weekly_frequency`                         | 每周次数（1-6 单值）                                              | `preferences.weekly_frequency_days`                                       |
| `injuries`                                 | 伤病部位多选（none/knee/lower_back/shoulder/wrist/neck/other）    | 部位交 Agent 确认后登记 `active_limitations`（原文进 `note`）             |
| `age`                                      | 年龄（number 14-90，条件必答）                                    | `basic_info.age`                                                          |
| `height_cm` / `gender` / `session_minutes` | 选答补充                                                          | `basic_info.height` / `basic_info.gender` / `preferences.time_constraint` |
| `notes`                                    | 自由补充（textarea，≤500 字）                                     | 对话上下文 / `write_memory`                                               |

问卷轮交付 = ```json survey_card 卡（data.purpose + questions=[题库 id 子集]），
**纯文本问题清单 = 失败交付**；问卷轮不带 data.apply，完成后下一轮按 #1 出
整周卡。

<!-- prettier-ignore -->
| # | 条件 | 动作 | scope |
| --- | --- | --- | --- |
| 1 | 无周计划（框架不存在；空档案走前置门槛） | **一律先出整周计划**，哪怕点名「明天的」——单日依附框架，缺失无处安放。只问「明天练什么」（疑问句）→ 答复并引导建框架，不凭空报一天动作 | `week` |
| 2 | 框架在 + 点名某天 + 原因**临时**（雨天/没空/出差） | 只改该天：卡仍展示整周，apply.entries 只含该日、dates 列该日，其余六天不动 | `days` |
| 3 | 框架在 + 原因**长期框架级**（退卡/搬家/伤病数周/器械永久变化） | 整周重算：先读旧条目参考，按新约束重建全部条目 | `week` |
| 4 | **原因不明**（「改成居家练」没说为什么） | **必须先反问**「长期还是就这几天？」，不许猜；答复后回 #2/#3 | 先问 |
| 5 | 常规「根据我的信息调整一下」 | 默认整周更新 | `week` |

**#4 判定锚**：临时/长期线索必须在**用户原话里显式出现**（今天/明天/出差
几天=临时；退卡/搬家/长期/没健身房了=长期）。原话无时长线索时**禁止出卡**，
只回一句反问；思考里替用户「按长期处理」再出整周卡=违规。

### 11.2 落库数据形态（已迁移）

PlanEntryInput 字段表与条目状态机已迁至 `/data-schema/knowledge/plan.md`
（data-schema 技能，数据结构单一参考）；契约真源
`shared/contracts/weekly-plan.ts`。

### 11.3 训练前读取路径（AI 隐形）

- 今日课表走确定性 API `GET /api/schedule/today`（纯 DB 读、无 LLM）：
  返回三态 `planned / rest_day / no_plan` + 当日条目（动作名中文优先
  COALESCE(name_zh, name)，5.0）
- **已确认的计划不需要 Agent 在场**——用户问「今天练什么」时前端直读；
  本技能只在「排周计划 / 换计划 / 调整条目」时介入

### 11.4 缺勤顺延（查表规则，Agent 只解释）

用户错过训练日时，处置由 Service 纯函数确定性完成
（`backend/src/services/schedule/planAdjustment.ts`）：

| 条目状态            | 错过？ | 今日状态 | 处置                 |
| ------------------- | ------ | -------- | -------------------- |
| completed / skipped | —      | —        | 不动（终态）         |
| planned / adjusted  | 否     | —        | 照常执行             |
| planned / adjusted  | 是     | 休息日   | 顺延并入今日         |
| planned / adjusted  | 是     | 已有训练 | 置换为跳过（不补课） |

Agent 职责边界：解释规则 + 引导按下一次训练正常执行；**绝不重新生成
周计划、绝不重排条目、绝不把错过容量叠加到今天**。

### 11.5 与 program-progression 的关系

- 分化（split）选择 → 该技能的分化决策表；**代码真源**为
  `backend/src/services/schedule/progressionPolicy.ts`（selectSplit 等纯函数）
- 渐进超负荷 / deload 判定 → 同一真源（selectProgressionStrategy /
  shouldDeload）；加重步进等算术一律引用 Service 结果，Agent 不自行计算

### 11.6 动作名中文优先（5.0）

单一陈述见 SKILL.md「动作名中文优先」：动作查询工具（find_exercises /
list_exercises）直出 `name_zh`（354/354 已回填），面向用户输出一律用
name_zh、禁止自行翻译或音译；存储/引用层（exercise_id）与展示层
（name_zh）分离，今日课表 API 同口径中文优先（COALESCE(name_zh, name)）。

---

_最后更新时间: 2026-10-08_
_版本: 6.0.0 - #151 S3：§9.3 周计划首选模板实例化路径（pick_template → instantiate_weekly_plan → submit_weekly_plan，Agent 只选型与参数化）；§9.1/§9.3 示例卡 JSON 删除（#73 复述源 + #136 伪造 id 示例源治理，字段契约单一真源迁 data-schema）；三段式降为自由生成回退_
_历史: 5.4.1 - T9/#66：§9.3 结构化四件套一次成型模板 + 思考不预写/出卡轮零工具/热身拉伸检索归选动作段（防膨胀）；§11.1 粒度判定表自 SKILL.md 迁入（单一真源随迁）；5.3.0 - T2/#54：§1.4 选动作工具链（find_exercises 组合筛选 ≤3 次收敛）；id 真源表述同步；5.2.0 - 42c 场景化拆分：容量/新手/伤病知识拆至 knowledge/ 子目录，§11.2 迁移 data-schema 技能；5.0.0 - 提案-确认模式 + 粒度规则 + 中文名（B5b/issue #38）；4.0.0 - 周计划生成模式（E3/issue #2）；3.1.0 - 移除幻影工具文档，plan 卡直出链路_
