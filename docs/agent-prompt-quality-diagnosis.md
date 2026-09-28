# star-fit 后端 Agent Harness 提示词/技能/工作流质量诊断报告

**调研对象**：`/Users/Admin/orca/workspaces/star-fit/b5-plan/backend`（DeepAgentService 单 Agent 循环 + deepagents 原生 Skills/Filesystem）
**问题**：测试用户实测一轮「出训练计划」对话 thinking 块 7000-14000 个，耗时 80-370 秒
**方法**：全部结论来自对仓库源码与 node_modules/deepagents 运行时的静态审计 + 实际执行 `buildSystemPrompt()` 的量化探针（非估算的数字均为真实执行输出）
**日期**：2026-09-28

---

## 1. 量化总量：每轮进模型的 system prompt 到底有多大

### 1.1 自有 systemPrompt（实测，tsx 直接执行 `buildSystemPrompt()`）

| 场景 | systemPrompt 字符数 | 行数 |
|---|---|---|
| **plan**（出计划） | **24,505** | 395 |
| workout_complete | 22,938 | 374 |
| update_profile | 23,183 | 377 |
| chat / default | 21,505 | 349 |

构成（plan 场景）：
- `BASE_SYSTEM_PROMPT` 13,836 字符 / 209 行（`DeepAgentService.ts:104-314`）
- `PLAN_SCENARIO_QUICKREF` 2,998 字符 / 45 行（`DeepAgentService.ts:388-434`，plan 场景追加）
- `SCENARIO_DATA_GUIDES` 1,300-1,400 字符（workout_complete / update_profile 场景各注入，plan 场景无）
- `loadUiHintFormatSkill()` 8,181 字符（`uiHintFormat.ts:50-191`，所有场景注入）

### 1.2 框架注入（deepagents 运行时，读 node_modules/dist 实测）

`createDeepAgent` 会额外拼进以下内容（`deepagents/dist/langsmith-DjCMSywL.js:5791` createDeepAgent）：

| 组件 | 字符数 | 说明 |
|---|---|---|
| `BASE_AGENT_PROMPT` | 1,704 | 框架通用行为提示词，**永远追加在自定义 systemPrompt 之后**（createAgent 的 contentBlocks 第二块） |
| `SKILLS_SYSTEM_PROMPT` | 2,031 | Skills 索引头（progressive disclosure 使用说明 + 示例工作流） |
| 9 个技能的 name+description 索引 | ≈1,400 | 见 §1.3 |
| `FILESYSTEM_SYSTEM_PROMPT` | 685 | 文件系统工具说明 |
| `TASK_SYSTEM_PROMPT` | 2,194 | **subagent 工具说明——本项目完全不用 subagent，纯死重** |
| todoListMiddleware 提示 | ≈600-800 | todo 工具说明（本项目不用 todo） |
| 文件工具描述（read_file 1464 + grep 545 + glob 376 + edit 447 + write 199 + ls 214） | ≈3,245 | 随工具 schema 走 |

### 1.3 技能是全量挂载、索引进 prompt，正文按需 read_file

`skillLoader.ts:325-339 loadAllSkills()` 枚举 `mas/skills/` 下**全部** 9 个技能目录挂载（`tmp/` 无 SKILL.md 未挂载，已验证）。注入 prompt 的只有 frontmatter description（合计 1,024 字符），SKILL.md 正文由 Agent 用 `read_file` 按需拉取——这部分**设计是好的**（progressive disclosure）。

但 SKILL.md 正文一旦被 read 就整块进上下文，单技能最大 13KB（plan-generation）：
| 技能 | SKILL.md 字节 | knowledge/ 合计字节 |
|---|---|---|
| plan-generation | 13,321 | knowledge.md 24,406 |
| workout-complete-handler | 10,566 | 40 |
| profile-update-reviewer | 11,026 | 113 |
| fitness-data-tools | 5,542 | — |
| volume-landmarks | 5,540 | 63 |
| exercise-type-guide | 5,789 | 索引 64 + 10 类共 892 行 |
| program-progression | 3,636 | 148 |
| strength-training-designer | 2,832 | 52 |
| exercise-suggestion-advisor | 2,361 | — |

### 1.4 工具层

- 10 个 MCP 工具（`mcpTools.ts:866-1167`）：工具描述合计 1,157 字符 + 42 个字段 `.describe()` 合计 3,642 字符 → 序列化为 JSON schema 约 12-17K 字符
- deepagents 自动加 general-purpose subagent 声明（`createDeepAgent` 中 gpConfig 默认启用，且继承主 agent 全部 skills+tools）——又是一条本项目用不到的死重路径，且把 TASK_SYSTEM_PROMPT 一并带进 prompt

### 1.5 每轮真实总量（plan 场景首轮估算）

| 层 | 字符数 |
|---|---|
| 自有 systemPrompt（实测） | 24,505 |
| deepagents 框架注入（BASE_AGENT+SKILLS 头+技能索引+FILESYSTEM+TASK+todo） | ≈8,600 |
| 工具 schema（MCP 10 个 + 文件 6 个 + subagent + todo） | ≈18,000-23,000 |
| **system 区合计** | **≈51,000-56,000 字符（≈25-28K tokens，中文占大头）** |
| + Agent read_file 拉的技能正文（plan-generation 13.3KB + knowledge.md 24.4KB + program-progression 等，实测常见链路） | +40,000-60,000 |
| + list_exercises 返回全库 354 条 JSON（每条 ≈200-260 字符） | +70,000-90,000 |
| + load_history 返回 | +2,000-10,000 |

**一轮「出训练计划」的首个模型调用前，上下文 ≈17-21 万字符；多步循环中每次工具返回都全量重算进下一轮。** GLM 对超长中文指令的思考长度高度敏感（llm.ts:132-136 自己注释了「实测 GLM 深思考轮 5-6 分钟」），这是 80-370 秒耗时的第一性根因。

---

## 2. 冗余点清单（逐处带证据）

### 2.1 【最大冗余】周/日粒度五规则在 4 个地方重复陈述

同一套「无框架先出整周 / 临时改日 / 框架级重算 / 原因不明必反问 / 常规整周更新」规则 + split 五枚举 + 「必须反问长期/临时」出现在：

1. `DeepAgentService.ts:157-198`（BASE_SYSTEM_PROMPT「Weekly-plan proposal rules」5 条规则全文）
2. `DeepAgentService.ts:388-434`（PLAN_SCENARIO_QUICKREF 又复述 apply.split 枚举、AMBIGUOUS 反问规则）
3. `mas/skills/plan-generation/SKILL.md:22-47`（五规则判定表 + 判定锚）
4. `mas/skills/plan-generation/knowledge.md:462-479`（§11.1 同一张表再抄一遍）

**且 #1 与 #3 表述不完全一致**（SKILL.md 的判定锚「2026-09-28 GLM 实测返工」比 BASE 里 rule 4 更严：要求时长线索必须"在用户原话里显式出现"）——模型面对两份近似但有细微差异的硬规则，会在思考里反复比对措辞差异，这是典型的思考放大器。讽刺的是 QUICKREF 头部写着「do NOT read_file that skill for the main flow」，但 QUICKREF 并不能覆盖 SKILL.md 全部细节，Agent 实测仍会去读（读全文又把重复规则第三遍拉进上下文）。

### 2.2 新手起步重量规则三处重复

「空杆 20kg / 最小增量 2.5-5kg / 「第一次找感觉」话术」逐字出现在：
- `DeepAgentService.ts:237-258`（BASE，PRE WEIGHT RULE 全文）
- `DeepAgentService.ts:396-401`（QUICKREF 又复述）
- `plan-generation/knowledge.md §3.2.0`（被 BASE 和 QUICKREF 双双引用）

### 2.3 卡片格式规则两处重复

- `DeepAgentService.ts:288-313`（BASE 里「uiHint output format」+ target marker + tomorrow-plan 三节）
- `uiHintFormat.ts:50-191`（8,181 字符完整卡格式技能，BASE 之后又整块注入）
type 枚举、target:"next_day"、name_zh 规则各讲两遍。BASE 里的三节完全可删（uiHintFormat 都覆盖了）。

### 2.4 name_zh 中文优先规则四处重复

`DeepAgentService.ts:195-197`（BASE）、`DeepAgentService.ts:425-426`（QUICKREF）、`list_exercises` 工具描述（`mcpTools.ts:936-944`）、`plan-generation/SKILL.md:115-121`。同一规则 4 个载体。

### 2.5 「绝不 prose-only / 必须出卡」约束至少 6 次反复

BASE 两处（191-194、306-313）+ QUICKREF 两处（415-417、423-424）+ SKILL.md + knowledge.md。每处还都带不同 emphasis（"a rule violation" / "silently fails" / "failed delivery"）。

### 2.6 框架级死重（项目不用的能力占着 prompt）

- `TASK_SYSTEM_PROMPT`（2,194 字符）+ general-purpose subagent 声明 + subagent 工具 schema：本项目零 subagent 使用（`DeepAgentService.ts:567-588` createDeepAgent 调用无 subagents 参数 → 框架默认注入 general-purpose）
- todoListMiddleware + write_todos 工具及说明：健身教练场景完全不用
- execute 工具描述（2,555 字符）因 read-only permissions 不会注册，但 FILESYSTEM/EDIT/WRITE 描述仍在工具集中（edit_file/write_file 因 permissions 只允许 read 而无法执行，但**它们的 schema 仍进模型上下文**——工具注册与权限是两层，框架只挡执行不挡展示）

### 2.7 强制词密度

实测统计（正则计数）：
- BASE：MUST×9、NEVER×6、各类硬约束词合计 21 处 / 209 行
- QUICKREF：9 处 / 45 行
- uiHintFormat：14 处

合计 44+ 处 MUST/NEVER/rejected/violation，平均每 5 行一个硬约束。约束密度越高，模型在思考链中逐条自检的概率越大（每条 CRITICAL 都会被「过一遍」）。

---

## 3. 工作流清晰度（plan-generation 5.0）

**总体判断：5.0 提案-确认制本身是自洽的，但有三个摩擦点。**

1. **QUICKREF 与 SKILL.md 的双真源尴尬**（`DeepAgentService.ts:381-387` 注释自认「技能文件本身不动，Agent 仍可自选深读」）：预注入速查表是为了省一次 read_file（省 5-20s），但 QuickRef 覆盖不了 SKILL.md 的判定锚细则，GLM 实际行为里仍会读 SKILL.md「确认细节」（判定锚 2026-09-28 的返工注释就是证据——规则已经在 prompt 里了模型还是违反了，说明复制规则进 prompt 解决不了遵循问题，反而加了上下文税）。结果是最坏情况：prompt 里一份 + read_file 又一份。
2. **knowledge.md §11 与 SKILL.md 内容重复**（五规则表两份、apply 载荷形态两份）：Agent 常规链路会两个都读（SKILL.md 指向 knowledge.md §9.3/§11），同一规则第三次进上下文。
3. **一处过时残留**：`uiHintFormat.ts:90-91` weekly_plan 描述写「use it instead of plan_card **after `save_weekly_plan` succeeds**」——save_weekly_plan 已在 5.0 移除（SKILL.md:71 明言），这是 5.0 改造漏改的过时措辞，会诱导模型寻找不存在的工具或困惑。
4. **version 历史膨胀**：SKILL.md 尾部 1.0-5.0 共 8 条版本历史（`plan-generation/SKILL.md:200-208`）纯考古信息，read_file 时全量进上下文。

---

## 4. 思考放大器（为什么 thinking 块 7000-14000 个）

按影响排序：

1. **上下文绝对量**（§1.5）：首轮模型调用 17-21 万字符，其中 60%+ 是规则/格式/枚举类指令而非用户数据。GLM 思考长度与指令长度正相关，llm.ts:132-136 自证「GLM 深思考轮 5-6 分钟」。
2. **自检清单式措辞**：`DeepAgentService.ts:430-433`「SELF-CHECK before emitting the card: real ids / type matches library / integer sets+reps / no weight=0 on resistance / target marker if tomorrow」——这是明确的逐条自检指令，直接诱导模型在思考链里逐项验证（对每个动作×每个字段）；QUICKREF 中「Validation failures come back as feedback retries…fix the named fields and re-emit the whole card」进一步让模型倾向「先在脑内跑一遍校验」。
3. **多步骤工具链的每步都触发思考**：plan 主链路 = 并行读(get_current_plan/load_history) → list_exercises → read_file(SKILL.md/knowledge.md) → 组装 weekly_plan 卡。每步之间模型都要在 5 万字符规则背景下重新推理，4-6 个模型轮次 × 每轮长思考 = 80-370s。
4. **冲突/近似重复规则**（§2.1）：两份粒度规则措辞不一，模型在思考里做「规则对齐」。
5. **「reasoning OUTLOUD allowed on intermediate steps」**（`DeepAgentService.ts:217-219`）：中间步叙述被合法化且展示在 thinking 面板，模型被鼓励在每步 narrate + 内部推理，观察到的 thinking 块数量被这条策略放大。
6. **温度 1.0 + 默认开启思考**（`llm.ts:187-189`）：GLM plan/chat 场景无 thinking 控制（只有 workout_complete 在 THINKING_DISABLED_SCENARIOS 里关了，`llm.ts:136-138`），maxTokens 16384 给思考留足了空间。

---

## 5. 优化建议（分层）

### 立刻可做（1-2 天，纯删/缩，零架构变更）

| 动作 | 预期收益 | 证据锚点 |
|---|---|---|
| 删 BASE 中与 uiHintFormat 重复的三节（uiHint output format / plan_card target marker / tomorrow-plan） | -2,500 字符 | §2.3 |
| 删 BASE 中 PRE WEIGHT RULE 细节，只留一行指向 QUICKREF | -1,800 字符 | §2.2 |
| 粒度五规则收敛为**单真源**：QUICKREF 保留表格化版，BASE 只留一句「follow granularity rules in quick reference」；SKILL.md 与 knowledge.md §11.1 二选一 | -3,000 字符 + 消除规则对齐思考 | §2.1 |
| 修 uiHintFormat weekly_plan 过时措辞（save_weekly_plan 残留） | 消除工具幻觉风险 | §3.3 |
| 删 SKILL.md 版本历史节、knowledge.md 尾注 | read_file 时 -1,500 字符 | §3.4 |
| name_zh 规则只保留 list_exercises 工具描述一处 | -800 字符 | §2.4 |

合计可砍自有 prompt 约 8-9K 字符（-35%），并显著降低规则冲突。

### 中期（按需加载 / 场景化裁剪）

1. **关闭用不到的框架注入**：`createDeepAgent` 支持不传 skills 时跳过 SkillsMiddleware；但 TASK/todo/subagent 是默认中间件——可在 customMiddleware 里替换/禁用（deepagents 的 `generalPurposeAgent: false` 路径或自组装 middleware 列表），砍掉 ≈3,000 字符 prompt + subagent/todo 工具 schema。
2. **场景化技能子集**：loadAllSkills 目前全量挂 9 个；可按 scenario 挂子集（plan 场景不需要 workout-complete-handler/profile-update-reviewer 的索引位），虽然索引只占 1,400 字符，但可减少模型「要不要读这个技能」的决策思考。
3. **list_exercises 分页/过滤参数**：354 条全量 ≈7-9 万字符每轮重进上下文，是上下文最大单项。给工具加 `equipment`/`body_part` 过滤或 `fields` 精简参数，能把该项压掉 70%+。（注意与「在上下文里自行筛选」的现有设计哲学权衡——B5b 备注说明全量是有意为之，但 354×260 字符的成本已经超过收益。）
4. **knowledge.md 拆分**：533 行单文件按需拆（§11 周计划模式独立文件），read_file 支持 offset/limit 但模型经常整读。

### 架构级（思考预算 / 分车道）

1. **thinking 预算控制**：GLM OpenAI 兼容端点支持 `thinking:{type:'disabled'}`（llm.ts 已在 workout_complete 用了）。为 plan 场景的**首轮工具编排步**（get_current_plan/load_history/list_exercises 等纯数据步）关思考——这些步不需要深推理，只有最终组装卡片步开思考。deepagents 的中间件 wrapModelCall 可按步注入 modelKwargs。
2. **卡片组装外包**：weekly_plan 卡的 entries 组装（date/exercise_id/sets/load 的机械填表）可下沉为确定性代码（progressionPolicy.ts 已有 selectSplit 真源），Agent 只产「分化+动作选择+理由」，格式化由 Service 拼——直接消灭 SELF-CHECK 逐项自检环节（§4.2）和最大的一坨格式规则。
3. **双车道**：闲聊/简单调整走轻量 prompt（现 default 21.5K → 可压到 8-10K），只有新周计划走全量规则。场景车道已存在（scenario → cached agent key，`DeepAgentService.ts:511`），缺的只是按场景差异化 BASE 内容。
4. **校验回路前置提示瘦身**：uiHintValidationLoop 的 retry 语义（rejected turn 全部计入 thinking 展示）使得每次返工都再加一轮长思考；配合 §架构级-2 把返工率打下去比优化 retry 更根本。

---

## 附：核心证据文件索引

| 结论 | 文件:行号 |
|---|---|
| BASE_SYSTEM_PROMPT 全文 | backend/src/services/agent/DeepAgentService.ts:104-314 |
| PLAN_SCENARIO_QUICKREF | DeepAgentService.ts:388-434 |
| buildSystemPrompt 组装 | DeepAgentService.ts:445-456 |
| 技能全量挂载 | backend/src/services/agent/skillLoader.ts:325-339 |
| 五规则表 ×4 | DeepAgentService.ts:157-198 / 388-434; mas/skills/plan-generation/SKILL.md:22-47; knowledge.md:462-479 |
| SELF-CHECK 措辞 | DeepAgentService.ts:430-433 |
| reasoning-outloud 合法化 | DeepAgentService.ts:210-219 |
| GLM thinking 5-6 分钟自证 | backend/src/services/llm.ts:130-138 |
| THINKING_DISABLED_SCENARIOS 仅 workout_complete | llm.ts:136-138 |
| save_weekly_plan 过时残留 | backend/src/services/agent/uiHintFormat.ts:90-91 |
| 框架注入实测 | node_modules/deepagents/dist/langsmith-DjCMSywL.js:5791-5930, 3080, 2239, 1540-1620 |
| list_exercises 全量返回 | mcpTools.ts:934-960, 383-390 |
| 实测 prompt 尺寸 | tsx 探针执行 buildSystemPrompt()（plan=24,505 / default=21,505） |
