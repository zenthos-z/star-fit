# 动作卡片规范手册（Card Spec Handbook）

> issue #88 手册批：分册2 卡片规范卡 + 分册4 Agent 消费规范 + 分册5 采集流。
> 口径真源 = #88 评论区 **v2 spec**（2026-09-30 夜定稿）；类型真源 = `shared/contracts/card-types.ts`。
> 本批只写文档与守门脚本，不改产品代码。

## 系统本质

插件化解耦的动作卡片系统——**给项目自己留的架构退路**：动作类型太多、当前想不好最优交互，先把「换/改一类卡片」做成低成本操作。一类动作卡片 = 一类动作类型，数据输入输出、全局事件挂钩、采集数据清单均可在规范体系下自定义。

非用户内容平台：分享 / 市场机制明确不做。

## 三条红线（全手册适用，写任何一页前必读）

| # | 红线 | 含义 | 落点 |
|---|---|---|---|
| 1 | **数据窄、前端宽** | 数据层（输入 / 输出 / 存储）与 Agent 消费层定义死；前端视觉 / 交互放开做体验 | 每页「存储字段清单」+ 分册4 |
| 2 | **不兜底** | 基本功能按理想情况开发、必须 100% 成功；**禁止为渲染失败设计降级路径**（推翻 #88 原文「无 uiHint 降级路径」要求；既有降级逻辑由契约批核查清理） | 每页规范卡显式声明 |
| 3 | **无缺漏无错误** | 喂给 Agent 的数据允许预处理，底线是完整正确；交付边界加硬校验（Zod 全字段 + 关系引用完整性），坏数据抛错拒交付，不许静默进 Agent | 分册4 预处理规则 + 守门脚本 |

守门脚本：`node scripts/check-card-spec.mjs` —— 每页字段清单与 shared/contracts 真源对拍 + 示例 JSON 实际过 uiHintValidator，不一致退出码 1。

## 类型体系速览

两级体系，单一真源 `shared/contracts/card-types.ts`（分册1 已合，禁手写第二套）：

- **5 大类**（major）：`resistance` / `cardio` / `hiit` / `isometric` / `stretch`
- **10 细类**（fine）：`resistance` `unilateral` `bodyweight` `assisted` `isometric` `cardio` `flexibility` `heavy_weight` `rep_training` `outdoor` —— 动作库检索轴，值域 = exercises 表枚举 = 技能知识库文件键
- **cardType**（分发键）：`{major}_{variant}`，如 `resistance_standard`、`cardio_running`。variant 是渲染变体，多个细类可共用一张标准卡

统一生命周期（已定稿方向；通用生命周期层进契约为契约批工作）：

```
planned → in_progress(活动卡) / filled(记录卡) → completed / confirmed → archived(时间序列历史)
```

现有契约锚点：`ExerciseAction.sets.status`（`planned`/`completed`/`skipped`，运动子集）、周计划条目 `PLAN_ENTRY_STATUSES`（`planned`/`adjusted`/`completed`/`skipped`）。

## 手册目录

```
docs/card-spec/
├── README.md                     # 本文件：总览 + 三红线 + 必答清单 + 全局事件总表 + 入库流程（尾节）
├── templates/
│   └── card-spec-template.md     # 空白规范卡模板（= 默认模板；谁上新类型谁复制一页）
├── resistance_standard.md        # 力量卡样板（状态：已定义）
├── cardio_running.md             # 跑步卡样板（状态：已定义）
├── fine/                         # 10 细类占位页（状态：未定义）
│   ├── resistance.md             # ├── 单侧/自重/辅助/等长/柔韧/大重量/次数/户外 各一页
│   ├── ...                       # └── 每页只含标题 + 状态 + 「未定义≠不能跑，走默认模板」
│   └── outdoor.md
├── agent-consumption.md          # 分册4：Agent 消费规范（完整信息结构 + 预处理底线 + 可视化页规格）
└── data-collection.md            # 分册5：采集流协议（采集清单 + 简化规则 + 同步 + 质量门）
```

规范卡状态一览：

| cardType | 状态 | 覆盖细类 | 规范卡 |
|---|---|---|---|
| `resistance_standard` | 已定义 | resistance / unilateral / bodyweight / assisted / heavy_weight / rep_training | [resistance_standard.md](resistance_standard.md) |
| `cardio_running` | 已定义 | cardio | [cardio_running.md](cardio_running.md) |
| `cardio_outdoor` | 未定义（占位） | outdoor | [fine/outdoor.md](fine/outdoor.md) |
| `hiit_timer` | 未定义（占位） | —（无细类） | 走默认模板 |
| `isometric_static` | 未定义（占位） | isometric | [fine/isometric.md](fine/isometric.md) |
| `stretch_standard` | 未定义（占位） | flexibility | [fine/flexibility.md](fine/flexibility.md) |

## 必答清单（定义一个新卡片类型的全部必答题）

一页规范卡 = 以下 8 组必答全部回答，缺一不成立。空白模板见 [templates/card-spec-template.md](templates/card-spec-template.md)。

1. **身份**：cardType（`{major}_{variant}`，值域对拍 `CARD_TYPE_VALUES`）？覆盖哪些细类？`interactionMode`（`active` 活动卡 / `passive` 记录卡）？
2. **数据输入**：用户 / Agent 下发哪些计划参数（字段 + 必填约束，对拍 `ExercisePlanSchema` + superRefine 业务规则）？执行中设备 / 交互采集哪些？
3. **数据输出（uiHint）**：出什么卡（type）？data 允许键清单？示例 JSON 必须实际通过 uiHintValidator（守门脚本抽取校验）。
4. **存储字段清单**：三层逐字段列全并与 shared/contracts 对拍——计划参数（ExercisePlan 域）/ 执行记录（`ExerciseAction.sets` 域）/ 持久化条目（格式化训练条目域，`POST /api/sessions`）。
5. **全局事件挂钩表**：下节事件总表 × 本卡是否挂钩 × 挂钩产出什么数据。
6. **运动时段采集数据清单**：训练执行中采什么（心率样本 / 组时间戳 / 休息链 / 执行参数），各自分辨率与简化规则（详见分册5）。
7. **感受采集说明**：组后弹窗的 `feel`（0-100 无级滑块，原值存储）与 `feel_note`（语义文本补充）在本卡的采集时机与语义（详见分册5 §感受采集）。
8. **无兜底声明**：逐字声明「本卡不设降级路径」，规范卡内禁出现降级路径章节。

## 全局事件总表（规范卡「事件挂钩」的候选项全集）

| # | 事件 | 触发点 | 数据落点（现有实现） |
|---|---|---|---|
| 1 | 计划生成 | Agent 出 plan_card / weekly_plan 卡 | uiHint → uiHintValidator 校验回路 |
| 2 | 计划确认 | 用户确认卡片 | 周计划 apply 落库（条目 `planned`，挂未来轴） |
| 3 | 开始运动 | 用户点开始 | 本地训练会话（status=active） |
| 4 | 组完成 | 一组执行完成 | `sets.status=completed` + 组时间戳（completedAt / timestamp） |
| 5 | 组间休息 | 组完成后倒计时 | `restEndTime`；默认 60s 倒计时（数据链推断，先采数后微调） |
| 6 | 组后感受弹窗 | 每组最后一个动作完成后 | `feel`（0-100 原值）+ `feel_note`（契约批落契约） |
| 7 | 动作完成 | 该动作全部组完结 | `ExerciseAction` 收口 |
| 8 | 会话完成 | 结束训练 | 本地落账（`buildSessionPayload` 预处理） |
| 9 | 本地入队 | 落账后 | sync 队列 enqueue（防回声过滤） |
| 10 | 同步入库 | `POST /api/sync/push` | sessions 表 `raw_json`（权威数据源） |
| 11 | 条目持久化 | `POST /api/sessions` | `history_summary.sessions`（格式化训练条目 + stats） |
| 12 | 心率样本入库 | `POST /api/sessions/:id/hr-samples` | `heart_rate_samples` 时序表（5s 样本） |
| 13 | 质量门 | Agent 出 summary/survey 卡前 | `workoutQualityGate` 数字一致性校验 |
| 14 | Agent 回读 | 训练后分析 | `load_history` / `get_session_hr_curve` / `get_hr_trend` |
| 15 | 时间线展示 | 信息页 | 今天区 / 历史区（三段式统一时间线为已定稿方向，依赖 TimelineEntry 统一模型落地） |

规范卡只需在「全局事件挂钩表」一节声明本卡挂钩哪些行、挂钩时产出什么；不挂钩的行显式标「不挂钩」。

## 尾节：新动作类型入库流程（原分册6 并入）

### 前提铁律：只用库内动作

Agent 生成的计划只允许引用动作库内的 `exerciseId`（#81 / #86 返工实证的事实约束）。库内缺合适动作时，走 `create_exercise` 工具入库（服务端生成 NanoID、用户可见），再引用返回的 id——禁止计划卡里出现编造的 exerciseId。

### 新增细类（fine type）

1. `shared/contracts/card-types.ts` 的 `EXERCISE_TYPE_DEFS` 补条目（唯一手写处：major / variant / label_zh / plan_required / plan_optional / scenario_zh / example / anchor_fields）
2. DB 枚举迁移：exercises 表 `exercise_type_enum` 同步扩值
3. 同源生成：`node scripts/gen-exercise-type-index.mjs` 重出技能知识索引（漂移由 exerciseTypeSync 测试守门，忘跑即红）
4. 本手册 `fine/{type}.md` 占位页建页；若该细类需要专属卡，按「新增 cardType 变体」流程写规范卡

### 新增 cardType 变体（渲染变体）

1. 复制 [templates/card-spec-template.md](templates/card-spec-template.md) → `docs/card-spec/{cardType}.md`，逐项回答必答清单
2. 示例 JSON 实际通过 uiHintValidator；`node scripts/check-card-spec.mjs` 退出码 0
3. 类型扩展评审门：`CARD_TYPE_VALUES` / DB 枚举变更走契约批评审（数据契约红线：Zod 验证失败必须抛错）
4. 分册3 注册 API（`register(cardType, component, spec)`，编译时注册先行）落地后补注册；当前编译时映射在 `ExerciseRenderer.tsx`，注册 API 等分册2 定稿后做

## 守门与自查

```bash
node scripts/check-card-spec.mjs        # 字段对拍 + 示例 JSON 校验，退出码 0 = 过
env -u NODE_ENV npm run typecheck       # 根目录类型检查（脚本不污染类型面）
```

文档用语以 `CONTEXT.md` 领域术语表为准（Avoid 词禁用）。
