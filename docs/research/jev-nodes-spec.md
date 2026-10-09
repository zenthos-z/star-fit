# 线G' · Jev 决策节点深化研究 spec（#160 二次定调 + #155 联合调研）

- 分支 `research/jev-nodes`，基线 main=61485921（已核）
- 性质：**纯调研 spec，零产品代码改动**。脚本与原始数据：`backend/scripts/jev-nodes-research/`
- 日期：2026-10-09（UTC）｜实测环境：GLM-5.3-flash（CodingPlan 通道）+ dmx jev-1.13.0

---

## 0. TL;DR

1. **实锤（本批回放 3 运行 6 turn）——同一条 S3 模板链，命中与半命中差 4.5 倍**：

   | 计划轮实测 | thinking 字符 | 墙钟 | 模型轮次 | 形态 |
   | --- | --- | --- | --- | --- |
   | 矩阵命中（新手×居家×3练→t1） | **28,071** | **168s** | 4 | 指纹逐字命中，剂量全程序化 |
   | 半命中陷阱（中级×居家×4练，×2 复现） | **116,909 / 127,090** | **469s / 590s** | 7-8 | 空壳实例化被弃 → 自由手搓 |

   半命中机制：模型选中唯一 4 练中级模板 t3（健身房模板）→ instantiate 返回 `ok:true` 但 **9 个核心槽位被器械过滤删除**（卧推/划船/推举/深蹲全灭）→ 模型弃用空壳转自由路径（find_exercises×3-6），pick+instantiate 两轮白付。#160「S3 未降低推理时长」的准确定性是**覆盖问题而非机制问题**——且半命中比干净落空更贵。命中路径自身仍有 -50% 空间（45.9% 选型辩论 + 12.9% 知识复读 + 终步 13,682 字符逐字转述）。
2. **问卷轮基线**：~400 块/6.3K 字符/27s/3 工具轮，其中 69% thinking 是知识复读——一个「问六个问题」的轮次，2/3 的思考在逐行复读门禁表。
3. **Jev 判定质量（本批 probe 22 次 $0.00088）**：事实抽取类节点好——问卷六项缺口判定 11/12、容量档位判定 10/10（含 5/6/7 月训练龄边界、停训回归、口语样本）；**路径选择类节点弱（7/12）**——结论：Jev 判「事实」，程序判「路由」，路径决策写成确定性函数而非 Jev 选择题。
4. **推荐落地节奏 = B（A 先行）**：A=纯程序化预制（参数映射表+模板选择矩阵+引用式提交+路径函数，零 Jev 零新依赖）；B=A+两个已被实测验证的 Jev 判定节点（缺口抽取、档位判定，fail-open 兜底已由 spike+本批双证）；C=全节点 Jev 化（收益递减、criteria 维护面陡增，不推荐）。量化预期（详见 §5.2）：问卷轮 thinking -80%/墙钟 -60%；计划轮矩阵命中 thinking -50%/转述归零；半命中场景以矩阵扩容消灭（127K→28K 水位，-78%）。

---

## 1. 背景与命题

- **#160（2026-10-10 二次定调）**：撤回「入口路由」实施目标（chat/plan 分流收益存疑）；Jev 的真正潜力=**决策节点拆解**——思考压力大、内容多的场景拆成多个预制节点，Jev 在节点间做廉价判定/分流，压缩部分自由推理。实锤教训：S3 四个训练模板未降低推理时长——覆盖范围有限；「制定计划的策略没有充分利用预制素材」（选完模板后参数配置仍靠大模型自由推理）。
- **#155（2026-10-08）**：4 套模板未显著加速计划制定；卡点=初始动作参数配置（剂量/组数起步值）。方向：模板参数化档位再前置（画像维度直接映射起步剂量表）；出卡轮思考时长可复用快车道开关（A2b：关思考 2-3× 提速，S2.5 未做实验）。新方向：新用户引导（问卷→首个计划→首个训练）旅程设计。
- **#172（spike，已合 main）**：dmx jev-1.13.0 技术测试五项结论——协议可行（专用端点 `/typesafe/v1/systemone`）、判定质量达标（调优 criteria 97.2-100%）、错误形态全可捕获（fail-open 前提成立）、延迟 P50 ~0.8s、成本可忽略（~$0.000025/条）。完整数据 `backend/scripts/jev-spike/REPORT.md`。

**本 spec 回答**：节点怎么拆、每节点预制什么/判什么/剩什么给大模型、每步量化预期、判错代价、落地节奏。

---

## 2. 现状架构事实（代码真源，2026-10-09 读自 main=61485921）

### 2.1 计划生成链（S3 后的实际形态）

```
用户消息（scenario=chat，#160 实锤 isPlanMode 死路）
 → Agent 自由推理【策略步】：load_history 读画像 → 按 program-progression
   知识定分化方向与周频率（selectSplit 纯函数存在但无生产调用方——
   分化决策 100% 是 LLM 自由推理）
 → pick_template（只读目录，4 模板 × 1,406 字符）
 → 【矩阵命中】instantiate_weekly_plan(template_key + 7 参数)
     ——日期对齐/器械替换/剂量查表/伤病过滤/周次递进全部程序化
   → submit_weekly_plan(全卡 13.7K 字符逐字转述) ← 纯抄写成本
 →【矩阵空洞】自由生成回退：find_exercises ≤3 次 + 配参数
     ——读 novice-starting.md §3.2.1 公式表（体重×系数）自由换算剂量
     ——结构化四件套一次成型 + submit
```

关键代码事实：

| 事实 | 出处 |
| --- | --- |
| 剂量=模板 JSON 每槽位每档位查表（sets/reps 区间/RPE 爬坡/起始重量锚），展开全在内核 | `planTemplates.ts` TemplateDosage/expandSlotDosage |
| instantiate 7 参数（template_key/tier/days_per_week/week_offset/equipment/sex/training_age_months/active_limitations），缺省自动从 profile 回填 | `templateTools.ts` mergeProfilePlanDefaults |
| `selectSplit(days, level)` 纯函数存在但**无任何生产调用方**；`selectProgressionStrategy` 仅被 instantiate 内核调用 | `progressionPolicy.ts`（grep 全仓） |
| submit_weekly_plan「参数即完整卡数据……把返回的 card 原样作为参数提交」 | `cardSubmit.ts` 工具描述 |
| 模板覆盖矩阵（见 2.1.1）：tier 只有 novice/intermediate 两档（问卷 experience 有 4 档） | `planTemplates.ts` TEMPLATE_TIERS |
| thinking 按场景可关：`resolveThinkingConfig`（DB/env `THINKING_DISABLED_<SCENARIO>`，现仅 workout_complete 默认关） | `modelConfigService.ts:311` |

#### 2.1.1 模板覆盖矩阵与空洞

| 模板 | tier | split | 场地 | 天数 |
| --- | --- | --- | --- | --- |
| t1-novice-fullbody-home | novice | full_body | 居家（哑铃+凳+自重） | 2-3 |
| t2-novice-fullbody-gym | novice | full_body | 健身房 | 2-3 |
| t3-int-upper-lower | intermediate | upper_lower | 健身房 | 4 |
| t4-int-ppl | intermediate | push_pull_legs | 健身房 | 5-6 |

常见组合空洞（tier × 场地 × 天数，常见 12 格只覆盖 5 格）：**中级×居家**（本批回放实证落入）、新手×4练、3练上/下分化、intermediate×3练以下、高级档（experience=advanced 无对应档位）、7练。

### 2.2 新用户引导链

- 前端：`startOnboarding.tsx` 纯前端 triage（有历史→引导发资料/截图；纯新手→基础调研卡，题源=共享题库 `PROFILE_INTAKE_QUESTIONS`，survey_card 多态渲染）。
- Chat 侧（本 spec 的目标链）：BASE prompt「Plan prerequisites」六项必答门禁 → Agent 读 plan-generation SKILL + knowledge §11.1 + novice-starting §3.2.0 门禁表 → 判缺哪几项 → `submit_survey`（**只收意图**：purpose=profile_intake/plan_gap + question_ids + title/message 话术；题目内容后端按题库原文替换 `surveyConvergence.ts`）→ 用户答完 → 下一轮出计划。
- 题库：Section A 必答 7 题（goal/experience/weight_kg/equipment_venue/weekly_frequency/injuries）+ B 条件（age）+ C 选答 + D 自由补充（`shared/contracts/survey.ts`）。

### 2.3 静态上下文重量（prompt-size-probe 实测，2026-10-09）

| scenario | systemPrompt 字符 |
| --- | --- |
| chat（真实路径） | 20,636 |
| plan（死路，对照） | 22,113 |

外加技能 read_file 注入（plan-generation SKILL+knowledge、novice-starting 等）与工具返回（动作库 JSON、模板目录）。t2 验收已实锤：知识全文涌入 thinking 后模型逐行复读（R2 ~53K 字符段）。

---

## 3. 现状实测基线（本批回放，真 LLM 6 轮：问卷×3 + 计划×3）

方法：`replay-baseline.ts` 进程内回放（Fastify 临时端口 + login-or-create 新用户 + composeCardValidatingService.chat()，scenario=chat）。剧本 turn1=「帮我制定一份这周的训练计划」（问卷轮）；turn2=六项必答一次补齐（计划轮）。两组对照消息：**自由路径组**（中级×居家×4练，×2 运行）与**模板命中组**（新手×居家哑铃×3练 → t1，×1 运行）。thinking 块数=thinking 事件数、字符数=Σlen；工具序列从 checkpointer 实取（thread 消息按 human 切 turn）。

### 3.1 问卷轮（turn1，档案全空 → survey_card）

| 运行 | thinking 块 | thinking 字符 | ≈tok(÷3.31) | 墙钟 | 模型轮次 | 工具序列 |
| --- | --- | --- | --- | --- | --- | --- |
| free-run1 | 445 | 6,402 | 1.9K | 28.9s | 3 | load_history → read_file → get_current_plan → submit_survey |
| free-run2 | 391 | 6,114 | 1.8K | 26.7s | 3 | read_file → load_history → get_current_plan → submit_survey |
| 模板组 | 487 | 6,475 | 2.0K | 25.9s | 3 | load_history → read_file → get_current_plan → submit_survey |

（问卷轮与 turn2 消息内容无关——三行即三次独立采样，工具序列完全一致，形态高度稳定。）

**问卷轮观察**：卡均正确（survey_card，零吞卡零泄漏）；thinking 稳定在 ~400 块/6.1-6.4K 字符/~29s——其中 ~69% 是知识复读（read_file 门禁表逐行复述，§3.2 分桶）。即：**一个「问六个问题」的轮次，模型花了 29 秒推理 + 3 个工具轮，其中 2/3 的思考在复读知识**。

### 3.2 计划轮 · 自由路径组（中级×居家×4练，矩阵半命中 → 手搓全周）

| 运行 | thinking 块 | thinking 字符 | ≈tok | 墙钟 | 模型轮次 | 工具序列 |
| --- | --- | --- | --- | --- | --- | --- |
| free-run1 | **20,563** | **127,090** | **38.4K** | **590s（9.8min）** | 8 | read_file → pick_template → **instantiate(gutted)** → find_exercises×3 → read_file×2 → submit_weekly_plan → write_memory×2 |
| free-run2 | **15,297** | **116,909** | **35.3K** | **469s（7.8min）** | 7 | pick_template → **instantiate(gutted)** → find_exercises×6 → read_file×3 → submit_weekly_plan |

对照 #68 基线（S3 上线前、剧本相近的 t2 验收口径）：计划轮 13,555 块/91,898 字符。**本批两运行为 15.3K-20.6K 块/117-127K 字符——对这类半命中请求，S3 模板链不但没让其变轻，反而更重**（多付 pick+instantiate 两轮 + 空壳实例化全文入上下文）。token 字符（正文）仅 119-215 字符——**计划轮 99.8% 的生成流量是 thinking**。

### 3.3 计划轮 · 模板命中组（新手×居家×3练 → t1-novice-fullbody-home）

| 指标 | 模板命中 | 自由路径组（对照，§3.2） | 倍率 |
| --- | --- | --- | --- |
| thinking 块 | **2,917** | 15,297 / 20,563 | 5.2-7.0× |
| thinking 字符 | **28,071**（≈8.5K tok） | 116,909 / 127,090 | **4.2-4.5×** |
| 墙钟 | **168s（2.8min）** | 469s / 590s | **2.8-3.5×** |
| 模型轮次 | **4** | 7-8 | ~2× |
| 工具序列 | pick_template → instantiate → submit_weekly_plan（零 find_exercises、零 read_file） | pick → instantiate(空壳) → find_exercises×3-6 → read_file×2-3 → submit | — |
| 模板指纹 | **「新手 · 居家全身」逐字命中** | 无 | — |
| submit 参数 | **13,682 字符逐字转述**（≈4.1K completion tok） | 5,503 / 12,828 字符 | — |

**两个结论**：① **S3 模板链在矩阵命中时是真实有效的**——28K thinking/168s/4 轮，全部剂量与编排程序化，模型只做选型+参数+转述。#160「S3 未降低推理时长」的准确表述应是：**S3 没有降低「矩阵半命中」用户的推理时长**（覆盖问题，不是机制问题）。② 即使命中，28K thinking 里仍含 45.9% 选型辩论 + 12.9% 知识复读 + 终步 13.7K 转述——B3 矩阵化+B4 引用提交+B5 瘦身轮在这条路径上仍有 ~50% 的进一步压缩空间。分桶：模板命中组 45.9% 选型 / 38.8% 其他（英文流）/ 12.9% 复读——与自由路径组同构但总量小一个量级。

### 3.4 推理占比启发式分桶（analyze-thinking.mjs；口径说明必须先读）

**口径**：thinking 流是逐词 delta（每事件几字符~几十字符），分桶按每条 delta 头 240 字符的关键词命中归类；GLM 思考是**中英双语混合流**——中文段（知识复读/模板辩论）关键词可命中，英文段是逐词 delta，关键词分桶天然漏检。因此「其他推理」≈英文自由推理流（61.5K 字符中仅 188 字符超过 30 字符/条——全部是 3-15 字符的英文词级 delta），其内容经连续窗口人工抽读归为：动作编排组合、剂量算术、动作 id 检索、规则权衡（缺勤顺延/周对齐）。

自由路径组 run1 事件全量（133K thinking 字符 = 问卷轮 6.4K + 计划轮 127K）：

| 桶 | 占比 | 内容 |
| --- | --- | --- |
| 其他推理（英文自由推理流） | 46.0% | 动作编排/剂量算术/id 检索/规则权衡（人工抽读归类） |
| 模板/选型推理 | 27.2% | pick/instantiate 辩论、分化取舍、器械面适配、空壳实例化复读 |
| 知识复读（行号复述） | 24.4% | read_file 门禁表/技能知识逐行复读 |
| 参数/剂量推理 | 1.3% | （中文显式剂量词仅此——剂量算术主体在英文流里） |
| 卡片格式/校验 + 工具编排 + 问卷 | 1.0% | 杂项 |

run2 同构（34.6%/31.0%/32.5% 其他/选型/复读）。**节点拆解的可消除面**：知识复读 24-33%（A3/B5 瘦身轮不注入即消失）+ 模板/选型 27-31%（B3 矩阵化）+ 英文流中的剂量算术与编排论证（B2 表接管算术、B4 引用提交接管转述）——合计覆盖 60-70% 的 thinking 质量面，与 §5.2 的 -50~-80% 预估互为印证。

### 3.5 关键实锤①：自由路径不是「矩阵干净落空」，而是「半命中陷阱」（run1 全景）

run1 turn2（中级×居家哑铃×4练）的完整工具序列（checkpointer 实取）：

```
read_file → pick_template → instantiate_weekly_plan(ok:t3-int-upper-lower)
→ find_exercises → find_exercises → read_file → read_file → find_exercises
→ submit_weekly_plan → write_memory ×2          （8 个模型轮次）
```

机制拆解：

1. 模型按「中级×4练」选中唯一匹配天数的 t3-int-upper-lower——**但它是健身房模板**（杠铃/器械/绳索为骨）。
2. instantiate 返回 `ok:true` 但 adjustments=12 条：**9 个核心槽位「无可用替代，已删除」**（平板杠铃卧推/俯身划船/军事推举/后深蹲/站姿提踵/坐姿反向飞鸟/绳索三头下压/山羊挺身/坐姿提踵），仅 3 个被哑铃替代。四练上/下分化失去全部主复合动作——一张空壳计划。
3. 模型正确地弃用它，转入自由路径 find_exercises×3 手搓全部 4 天——**但 pick/instantiate 两个工具轮已付、空壳实例化全文已入上下文**，自由路径的 127K thinking 照付不误。

**设计含义（进 B3/B4）**：① B3 矩阵必须把场地/器械面做为一等维度，器械可行性不足时**实例化前**就判 MISS（直接省掉两个工具轮）；② instantiate 内核建议：核心槽位删除超阈值（如任一主复合动作被删或删除>30% 槽位）时返回结构化 INFEASIBLE 而非空壳 ok:true——现状行为让模型白付两轮再自行废弃。

**关键实锤②：get_current_plan 的工具文案在推模型走自由路径**——其「No plan for this week yet」消息原文是「Build one (load_history → find_exercises per split day → weekly_plan card…)」，即模板链之外的默认指引就是自由手搓。工具文案与 S3 模板策略相互打架，是模板利用率不足的一个隐性原因（run1/run2 turn1 问卷轮也各读到一次该文案）。

### 3.6 校准与价格锚

- GLM-5.3-flash thinking 文本 ≈ **3.31 字符/token**（直连 API 定标：5,082 字符 reasoning = 1,537 reasoning tokens）。
- 按量刊例（bigmodel 开放平台）：GLM-5.3-Flash 输入 ¥0.8/M、输出 ¥2.8/M tokens（[定价页](https://docs.bigmodel.cn/cn/guide/start/pricing)）。生产实际跑 CodingPlan 订阅——**真实货币是延迟与周/月配额**（thinking 消耗 completion 额度），按量价仅用于跨方案折算。
- 历史锚（#68 口径，glm-5.3-flash）：新用户两轮 thinking 合计 16,478 块 / 120,514 字符（问卷轮 2,923/28.6K + 计划轮 13,555/91.9K）。按 3.31 折算 ≈ 36.4K thinking tokens/两轮。

---

## 4. 节点拆解设计（核心交付）

### 4.0 设计原则

1. **AI 判事实，程序判路由，预制素材承载算术**（CLAUDE.md AI/代码边界在决策节点层的具体化）：Jev/小模型只回答「事实问题」（缺什么、什么档、什么意图），一切「下一步走哪」写成确定性代码路径函数——本批 probe 的 N2 教训（Jev 路径选择题 7/12）与 spike 意图分类（调优后 97-100%）共同支撑这个分工。
2. **fail-open**：Jev 失败/超时/conf<阈值 → 回落现状全量自由推理（spike 实证错样本置信度恒 <0.5，T=0.6~0.8 硬错误恒 0）。
3. **feature flag 默认关**（#151 双轨惯例）：`jev_nodes` flag（DB `app_configs` 优先 + env 回落），关闭时行为与现状逐字节一致；flag 进 channelSignature（缓存键兼容，spike §5.2 方案复用）。
4. **预制素材先行**：能做成表/矩阵/纯函数的绝不做判定节点（判定节点只出现在「必须读自然语言」的地方）。

### 4.1 场景A · 新用户引导节点图

```
用户消息 ──┐
档案摘要 ──┤（程序构建：load_history 六项必答字段的确定性投影）
对话尾部 ──┘
   │
   ▼
[A1 前提判定节点 · Jev 1 次调用 · choice×6+1]
   六项必答各一问（missing|known）+ 意图问（plan_request|chat|other）
   │ missing_set, intent, confidences
   ▼
[A2 路径函数 · 纯代码 · 0 成本]
   intent≠plan_request → 现状 chat 全量
   |missing|≥3 或档案全空 → full_intake（question_ids=题库全量）
   1≤|missing|≤2         → gap_fill（question_ids=missing∩题库）
   |missing|=0           → 直入场景B 计划链
   ▼
[A3 问卷卡交付 · 瘦身 LLM 轮（或纯模板）]
   submit_survey(purpose + ids 已由 A1/A2 定死；LLM 只写 title/message 话术)
   ——prompt 只含问卷指引，不注入计划知识 → thinking 收敛到话术级
```

| 节点 | 输入 | 输出 | 判定类型 | 预期压缩 | 失败兜底/判错代价 |
| --- | --- | --- | --- | --- | --- |
| A1 前提判定 | 消息+档案摘要+对话尾 | missing_set×6 + intent + 逐项置信 | Jev choice（实测 11/12（injuries 三值化后可清零）；意图问沿用 spike 调优 criteria 97-100%） | 替代问卷轮里「读门禁知识+逐项对齐」的推理（本批实测问卷轮 69% thinking 是知识复读） | conf<0.7/超时/网络失败 → 回落现状全量（fail-open）；判错=多问或少问 1-2 题（下一轮可补），**不产生错误计划** |
| A2 路径函数 | missing_set, intent | full_intake/gap_fill/direct/chat | 纯代码（阈值显式） | 替代「profile_intake vs plan_gap vs 直接出」的规则张力辩论（t2 验收点名的数千 token 权衡） | 无失败面；阈值（≥3 全量）可在代码评审中显式定夺 |
| A3 问卷话术 | purpose+ids（已定） | survey_card | 瘦身 LLM 轮（话术生成=AI 本职） | 问卷轮 thinking 预期 -80%+（本批实测 6.4K 字符里 4.5K 是知识复读，A3 不再读计划知识） | LLM 失败 → 确定性兜底文案（题库已有默认 title/message 可预制） |

### 4.2 场景B · 计划生成节点图

```
[A1 前提判定]（复用：|missing|=0 才进入）
   ▼
[B1 档位判定节点 · Jev 1 次调用]
   tier choice（novice|intermediate）+ readiness score（恢复/信息充分度参考位）
   （输入=档案事实+消息信号：训练龄/经验档/停训回归/口语自述）
   │ tier + confidence
   ▼
[B2 参数映射表 · 纯预制素材 · 0 成本]（★ S3 缺的预制深化，#155 卡点的直接解）
   画像维度 × 档位 → 起步剂量表：把 novice-starting §3.2.1 的体重×系数公式
   与 volume-landmarks MEV/MAV 区间做成 Service 查表函数
   `lookupStartingDosage(tier, exercise_type, bodyweight)` +
   `lookupVolumeTarget(tier, goal)`——自由路径与模板路径共用同一张表
   │ 起步剂量/容量目标（数值，非话术）
   ▼
[B3 模板选择 · 纯代码矩阵 · 0 成本]
   resolveTemplate(split=selectSplit(days, tier), tier, venue, days) →
   key 或 MISS；miss → 自由路径（动作编排留给 LLM，剂量照 B2 表）
   （selectSplit 已有纯函数，接上第一个生产调用方即可）
   ▼
[B4 实例化+引用式提交]
   矩阵命中：instantiate_weekly_plan（现状不变）+
   submit_weekly_plan_by_ref{template_key, params}（新：服务端重展开并
   过 L2 闸门，替代 13.7K 字符逐字转述）
   矩阵空洞：find_exercises ≤3（现状）→ 剂量照 B2 表直取 → submit
   ▼
[B5 残余大模型推理 · 瘦身 LLM 轮]
   只做：动作编排微调（伤病替代确认/偏好替换）、day_focus/rationale
   话术、个性化 note——剂量/日期/递进/ids 已全部由 B2-B4 定死
```

| 节点 | 输入 | 输出 | 判定类型 | 预期压缩 | 失败兜底/判错代价 |
| --- | --- | --- | --- | --- | --- |
| B1 档位判定 | 档案事实+消息信号 | tier + conf（+readiness 参考） | Jev choice（实测 10/10，含 5/6/7 月边界、停训回归、口语样本；最低 conf 0.56） | 替代「经验档→容量档」推理；档位直接驱动 B2 查表与 B3 矩阵 | conf<0.7 → 缺省=保守 novice 档（宁轻勿伤原则）；**判错代价有界**：novice↔intermediate 的剂量差=表内两行保守起步值，差 1 周即可由 PRE 反馈回路校正——对比现状自由换算的无界误差（幻觉体重系数）严格更优 |
| B2 参数映射表 | tier + 动作类型 + 体重 | 起步剂量（组/次/RPE/重量）+容量目标 | 纯代码查表（公式来自既有知识文件，零新知识） | **自由路径的最大单点压缩**：本批实测自由路径轮 117-127K thinking 中剂量算术与编排论证是英文推理流的主体（§3.4 分桶口径）；表化后归零 | 无失败面（纯函数）；口径变化=改表+单测 |
| B3 模板矩阵 | split/tier/venue/days + 器械可行性 | 模板 key 或 MISS | 纯代码（selectSplit 首次接线 + 4 模板矩阵；**器械可行性前置判**，见 §3.5 半命中陷阱） | 替代 pick_template 选择推理；**矩阵空洞时直接进自由路径，省掉半命中的 pick+instantiate 两轮** | 矩阵 MISS → 现状自由路径（fail-open 同构）；矩阵错选=仍是一张完整合法计划（有界） |
| B4 引用式提交 | template_key + params | weekly_plan 卡（服务端展开+L2 闸门） | 纯代码 | 终步转述 13.7K 字符（≈4.2K completion tokens）归零；消除转述漂移风险；**配套建议**：instantiate 对核心槽位删除超阈值返回结构化 INFEASIBLE（§3.5），杜绝空壳 ok:true | 兜底=现状全卡转述（双轨期保留原通道） |
| B5 残余推理 | B1-B4 全部预制产物 | 话术+微调+提交 | 瘦身 LLM 轮 | 计划轮 thinking 预期 -50%（矩阵命中）~-60%（空洞路径剂量接管后） | 失败 → 现状校验回路（uiHintValidator 重试链不变） |

### 4.3 Jev 判定质量实测（jev-node-probe，22 次调用，0 失败，$0.00088）

| 节点 | 判定 | 命中 | 错样本剖析 |
| --- | --- | --- | --- |
| N1 问卷完整性 | 6×choice missing\|known | **11/12** | 唯一错 v09（「最近膝盖有点不舒服」应记 injuries=缺失待补，Jev 判 known）——标签口径争议而非误读：设计上 injuries 问题改为「确认伤病状态：unknown|none|injured」三值即可消除 |
| N2 引导路径 | choice full_intake\|gap_fill\|direct_plan\|clarify | **7/12** | 5 错中 2 个 conf 0.24/0.31（fail-open 区，T=0.5 阈值下不生效）；3 个 conf 0.52-0.88 全是**阈值/口径边界**（缺4项算全量还是补缺、改目标算不算要重问）——判据本身是产品决策不是事实 |
| N3 画像档位 | choice novice\|intermediate + score readiness | **10/10** | 含 5/6/7 月训练龄三连边界、停训回归（练3年停2年→novice）、口语化（「没怎么练过」「练了好几年」档案空）；tier conf 0.56-1.0；readiness score 型输出正常（观察位，未定标） |
| 延迟/成本 | — | P50 748ms（min 625 / max 2127） | 20,943 input tok + 3,342 output tok = $0.00088 |

**N2 的结构性教训**：路径选择题 7/12（错样本 conf 0.24-0.88）——「缺 3 项算 full_intake 还是 gap_fill」这类阈值题对 Jev 是坏问题（判据本身模糊）；同一信息在 A1 缺口抽取 + A2 代码阈值下是精确解。**决策节点拆解的第一设计律：判定节点只出事实，路由由代码消费事实。**

### 4.4 开关与缓存兼容（沿用 spike §5 方案）

- `jev_nodes` flag 默认关；关闭时零 jev 调用、行为与现状一致。
- flag 进 channelSignature（#151 S2 机制复用），翻转即弃缓存重建。
- 程序化 scenario 直通优先（workout_complete/update_profile 显式触发不进判定链）。
- 判定调用：`/typesafe/v1/systemone`，硬超时 3s，失败/低置信不重试直接 fail-open。
- 观测：每轮 `{node, decision, confidence, latencyMs, fallbackReason}` 进现有 logging 契约，验收取数用。

---

## 5. 成本收益模型

### 5.1 单位经济

| 项 | 值 | 出处 |
| --- | --- | --- |
| Jev 单次调用 | 输入 ~600-950 tok × $0.042/M ≈ **$0.000025-0.00004**；输出免费 | spike + 本批 probe（22 次共 20,943 input tok = $0.00088） |
| Jev 延迟 | P50 748ms（本批）/775-869ms（spike）；3s 硬超时 | 两批独立实测 |
| GLM thinking | 3.31 字符/token；输出 ¥2.8/M（按量折算用） | §3.6 定标 |
| 被压缩对象 | 问卷轮 ~6.1-6.5K 字符 ≈ 1.9K tok；计划轮自由路径 117-127K 字符 ≈ 35-38K tok；计划轮模板命中 28K 字符 ≈ 8.5K tok，其中终步转述 13,682 字符 ≈ 4.1K completion tok | §3 基线 |

### 5.2 分场景压缩预估（基线=§3 实测；预估标注口径）

| 场景 | 现状基线（实测） | 节点链 | Jev 成本/轮 | thinking 预期 | 墙钟预期 | completion 配额预期 |
| --- | --- | --- | --- | --- | --- | --- |
| 问卷轮 | ~440 块/6.3K 字符/27s | A1→A2→A3 | 1 次 ≈$0.00003 + 0.8s | **-80%** → ~1.3K 字符（A3 不注入知识，69% 复读消失，只剩话术级推理） | **-60%** → ~10s（省 17s） | -1.5K tok |
| 计划轮·矩阵命中 | 28,071 字符/168s/4 轮（§3.3 实测） | B1→B2→B3→B4→B5 | 1 次 ≈$0.00003 + 0.8s | **-50%±** → ~14K 字符（45.9% 选型辩论由 B3 矩阵消除、12.9% 复读由 B5 消除） | **-45%±** → ~90s | **-4.1K tok**（13,682 字符转述实测归零） |
| 计划轮·矩阵空洞（本次实测主角） | **117-127K 字符/469-590s** | B1→B2→(B3=MISS 直接自由路径)→B5 | 1 次 ≈$0.00003 + 0.8s | **-60%±** → ~45-50K 字符（剂量算术+id 检索表化；省 pick+instantiate 两轮及其上下文） | **-55%±** → ~4-5min（仍受自由编排上限约束） | -21K tok± |

三行合计（新用户前两轮，空洞场景）：现状 ~123K 字符 ≈ 37K thinking tok + 转述 4.2K tok → 节点链后 ~46K 字符 ≈ 14K tok + 转述 0 → **completion 配额 -60%，墙钟从 ~9min 到 ~4min**；代价 = 2 次 Jev 调用 ≈ $0.00006 + 1.6s 串联。

> 预估依据：§3.4 分桶的可消除面（60-70%）打折到 50-60% 给出（英文自由推理流中编排组合部分仍需 LLM）；矩阵命中行的 -50% 待节奏 A 上线后以同剧本复核。

### 5.3 三种落地节奏对比

| 维度 | A 纯预制+程序化（零 Jev） | B = A + Jev 判档/缺口（推荐） | C 全节点 Jev 化 |
| --- | --- | --- | --- |
| 内容 | B2 参数映射表 + B3 模板矩阵 + B4 引用提交 + A2 路径函数（缺口判定的档案侧程序化，消息侧仍靠 LLM 读） | A 全部 + A1 前提判定 + B1 档位判定（两个 probe 实测达标节点） | B + 模板选择也 Jev 化 + 引导对话逐轮 Jev 分流 + 调整轮参数 diff 判定 |
| 问卷轮预期 | thinking -50%±（档案侧缺口程序判定+瘦身话术轮；消息语义抽取仍留 LLM） | **thinking -80%+，墙钟 -60%+**（A1 接管消息语义，A3 只剩话术） | 与 B 基本持平（该场景没有更多可拆节点） |
| 计划轮预期 | 矩阵命中：转述归零 + 选型推理程序化；空洞路径：剂量表化（-40~-60%） | 同 A + 档位判定免推理（经验信号含口语/停训的场景收益放大） | 边际 +5-10%（模板选择本就可矩阵化，Jev 无增量） |
| 新增工程量 | 中（查表函数+矩阵+by-ref 提交+路径函数，全部纯代码可单测） | 中+（A1/B1 两个调用点 + flag + 观测；协议层 spike 已验证） | 大（criteria 版本化管理面×节点数；每轮多次 0.8s 串联风险） |
| 新增风险 | 低（无新依赖，纯函数） | 低-中（dmx 依赖；fail-open 双证；+0.8s×1-2 次/轮） | 中-高（延迟叠加、criteria 漂移维护、N2 型坏问题扩散） |
| 判错面 | 无判定节点（表/矩阵错=显式 bug，测试可锁） | 有界（§4.2 表；全部可 fail-open） | 判定面最大 |

**推荐：B（A 先行）**。A 是 B 的地基且零风险，两者不冲突；C 的增量节点本批 probe 已示警（N2 型）。实施顺序建议 A → 观测基线复核 → B 开 flag 灰度。

---

## 6. 与 #155 合流建议

1. **同一批实施**：#155 的「模板参数化档位再前置」= 本 spec B2 节点，同一件事的两个入口（#155 从提速视角、#160 从节点拆解视角），**必须合流成一个实施批**避免两拨人各写一张剂量表。
2. **依赖顺序**：B2/B3/B4（纯代码）→ A1/B1（Jev 节点，flag 灰度）→ A3/B5 瘦身轮（prompt 重构，依赖前面节点就位才有「可瘦」的前提）。新用户引导旅程（#155 第二诉求）以 A 链节点为骨架做 UX 梳理。
3. **验收口径（双指标，剧本复用本批脚本）**：
   - thinking 块数/字符（`replay-baseline.ts` 已内置计量）——基线锚点：问卷轮 ~400 块/6.3K 字符、计划轮矩阵命中 2,917/28K、计划轮半命中 15.3-20.6K/117-127K；目标：问卷轮 -80%（B 后）、计划轮矩阵命中 -50%、半命中场景先以矩阵扩容消灭（目标=把半命中轮降到命中轮水位）；
   - TTFT/首卡时延——基线：问卷轮 ~27s、命中 168s、半命中 469-590s；目标：问卷 -60%、命中 -45%、半命中归入命中水位（≤180s）；
   - 出卡质量门沿用 S3（模板指纹逐字命中/零吞卡/零泄漏——`replay-baseline.ts` 已带模板指纹判定，本批三 turn 全过）。
4. **A2b 快车道开关（#155 提到的关思考 2-3× 提速）**：与本方案正交且互补——节点拆解压缩「要想多少」，快车道压缩「想的速度」。建议作为 B5 瘦身轮的叠加实验（`THINKING_DISABLED_PLAN=1` 配置已存在，`resolveThinkingConfig` 现成），但须先有节点拆解基线才能归因（否则关思考的是全量推理，质量风险不可控）。

---

## 7. 风险清单与待裁决项

### 7.1 风险

| 风险 | 实证 | 缓解 |
| --- | --- | --- |
| dmx 网络失败 ~3.2% | spike §3bis | 3s 硬超时 + 立即 fail-open（不重试） |
| Jev 每轮 +0.8s×1-2 次串联 | spike §3 + 本批 P50 748ms | A1/B1 与上下文构建并行发起；问卷轮净收益仍为正（省 20s+ 墙钟） |
| criteria 措辞敏感 | spike v1 88%→v2 97-100%；本批 N2 7/12 | 判定问题只出事实题；criteria 进版本管理；上线按观测迭代 |
| 模板矩阵覆盖不足导致 B 链收益打折 | 本批实测：半命中比命中贵 4.2-4.5×（127K vs 28K thinking 字符），且 instantiate 空壳 `ok:true` 让模型白付两轮（§3.5） | **优先矩阵扩容**（中级×居家、新手×4练是纯内容工程）+ B3 器械可行性前置判 + instantiate INFEASIBLE 结构化返回；B2 表对空洞路径同样生效（剂量才是卡点） |
| 转述改 by-ref 的契约影响面 | submit_weekly_plan 描述「参数即完整卡」 | 双轨：by_ref 新参数与全卡参数并存，L2 闸门两条路都过 |

### 7.2 待裁决（呈项目主人）

1. **节奏批准**：本 spec 推荐 B（A 先行）——是否按 A→B 两段排期？
2. **矩阵扩容是否同批**：中级×居家、新手×4练模板补齐（纯内容工程，无判定节点）与 A/B 是否同一批。
3. **A3 问卷话术的最终形态**：瘦身 LLM 轮（保留话术个性）vs 纯模板文案（零 LLM，题库默认文案）——影响问卷轮能否归零 LLM 依赖。
4. **B5 瘦身轮是否叠加 A2b 关思考实验**（依赖顺序见 §6.4）。

---

## 附录 A · 复现

```bash
# 现状基线回放（真实 LLM，配额纪律默认 3 运行 × 2 turn）
cd backend
GLM_API_KEY=… DATABASE_URL=postgresql://starfit:starfit@localhost:5432/starfit \
  npx tsx scripts/jev-nodes-research/replay-baseline.ts
# 模板命中对照：TURN2_MSG 换「新手×居家×3练」全要素消息（见 README）

# Jev 判定节点 probe（22 次调用 ≈ $0.0009）
DMXAPI_API_KEY=… node scripts/jev-nodes-research/jev-node-probe.mjs

# thinking 主题占比（启发式）
node scripts/jev-nodes-research/analyze-thinking.mjs
```

原始数据：`backend/scripts/jev-nodes-research/results/`——`replay-baseline-free.json` + `replay-events-free-run{1,2}.jsonl.gz`（自由路径组×2）、`replay-baseline.json` + `replay-events-run1.jsonl.gz`（模板命中组）、`jev-node-probe.json`（Jev 判定 22 调用）。事件流 gzip 压缩存档（解压后为逐事件 JSONL）。密钥只经环境变量注入，不入任何被跟踪文件。测试用户与 checkpoints 已清理（users 0 残留、checkpoints 138 行删净）。
