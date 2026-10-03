# spec(survey)：训练画像调研重设计 v2 —— 设计稿

> issue #114 ｜ 批次 B4（设计稿批，禁实现）｜ 基线 main @ 441d0ee
> 输入：深研报告 survey-redesign.md（2026-10-03）+ 代码逐锚点复核（本文所有「现状是 X」均经 grep 复核，
> 与报告冲突处以本文标注为准）
> 术语：遵循仓库根 `CONTEXT.md`；新术语（题库 / 二级选项 / 缺口补全）提案见 PR 描述，待收录

---

## 1. 背景与问题定义（#114 缺口六条逐项）

训练画像调研（首次问卷）是 Agent 出周期化方案的数据入口。用户实测（2026-10-03）暴露问卷过精、
Agent 被迫二次补充。六条缺口逐项如下（全部为代码取证，锚点 = main @ 441d0ee）。

### 缺口 1：必问项缺失——伤病史与体重

Agent 侧门禁（`backend/src/services/mas/skills/plan-generation/knowledge/novice-starting.md:16-33`
§3.2.0 数据依赖链门禁）把 `basic_info.weight` 与 `goal/equipment` 列为「必问」，伤病经
`active_limitations` 约束动作选择；系统提示同样要求
（`backend/src/services/agent/DeepAgentService.ts:203-224`「Plan prerequisites 最小信息集」6 项：
goal / experience / equipment / weekly frequency / injuries / body weight）。

而前端首用问卷只有 4 题：经验/目标/器材/频次（`src/utils/startOnboarding.tsx:228-271`
`NEWBIE_SURVEY_QUESTIONS`）。**伤病史、体重完全没问**。门禁判定缺数据 → 只发 survey_card 不出
plan_card（novice-starting.md:30-31 规则 1）→ 用户被迫二次补充。问卷与门禁清单不同源是根因。

### 缺口 2：器材三档粗选与动作库枚举脱节

现状器材题 3 档单选，value 为 `gym_full / home_dumbbell / bodyweight`
（startOnboarding.tsx:256-258）。全仓检索：这两个自定义值**只存在于 startOnboarding.tsx 这一处**，
后端与知识库无任何映射。写库路径把它拆分后直接塞进 `preferences.equipment`
（`src/hooks/useAICoach.ts:539-540`），而动作库器材枚举是 15 值 `EXERCISE_EQUIPMENT`
（`shared/contracts/exercise-library.ts:89-105`：bodyweight/barbell/dumbbell/kettlebell/cable/
machine/band/bench/rack/pull_up_bar/stability_ball/medicine_ball/foam_roller/weighted/other），
`find_exercises` 的 equipment 过滤是单值 ILIKE（`backend/src/services/agent/mcpTools.ts:494-501`）。
`gym_full` 与 15 值枚举零交集 → Agent 读画像拿不到可过滤的具体器材集合，只能自由发挥。
且现状是单选，无法表达「健身房 + 家里补充」组合。

### 缺口 3：隐性数据 bug 三条

经逐行复核，实际断裂点比 issue 表述**更严重**（issue 说「频次 '3-4' parseInt 成 1」不准确，
详见 §4）：

| # | bug | 现状证据 |
| --- | --- | --- |
| 3a | 频次区间字符串语义任意：`parseInt('1-2')=1`、`parseInt('3-4')=3`、`parseInt('5+')=5`，静默取区间下界 | `src/hooks/useAICoach.ts:549-553` |
| 3b | **频次从未落库**：`weekly_frequency_days` 写在 staticPatch **顶层**（useAICoach.ts:552），而 `PUT /profile/static` 嵌套分支只转发 `basic_info/preferences/physiological/psychological` 四键（`backend/src/controllers/adminController.ts:2332-2355`），顶层键被静默丢弃；且该字段在 `shared/contracts` 无定义（全仓唯一出现 = useAICoach.ts:549,552），即使转发也会被 `validateProfile` 白名单 strip（`backend/src/services/userProfileService.ts:306-360`） | 三重断裂：契约缺字段 + 控制器不转发 + 校验白名单不认 |
| 3c | **raw_injuries 从未落库**：同 3b，写 staticPatch 顶层（useAICoach.ts:556），控制器不转发 | 同上；前端注释自认「实锤踩过」（useAICoach.ts:513-514） |
| 3d | goal 中文子串匹配漏映射：写库靠 `pick()` 模糊 key + 中文映射表 + `includes` 子串兜底，Agent 换措辞即丢字段 | useAICoach.ts:506-537（注释记录 2026-09-17 实锤「增肌塑形」漏映射 fallback 成 general_fitness） |

### 缺口 4：双真源不同步

问卷有两个互不同步的产生源：

- ① 前端静态 4 题：`NEWBIE_SURVEY_QUESTIONS`（startOnboarding.tsx:228），首用分流注入
  （`src/hooks/useAICoach.ts:1124-1187`，`maybeRunFirstUseTriage` 判纯新手 → 直接注入 survey_card，
  绕过 Agent）；
- ② Agent 动态自由发挥：knowledge.md §11.1 前置门槛（`backend/src/services/mas/skills/plan-generation/knowledge.md:389-393`）
  + DeepAgentService 最小信息集，题目文案、选项、id 全由 Agent 现场生成。

无共享题库：同一新用户可能先做 4 题静态问卷，Agent 门禁仍判缺体重/伤病 → 再补一张问卷，二次打扰。

### 缺口 5：契约差距——题型定义多处漂移

同一概念至少四份手写定义，互不一致：

| 定义处 | 字段名 | 枚举 | 锚点 |
| --- | --- | --- | --- |
| Zod 契约（后端校验回路真源） | `inputType` | `text / number / checkbox` | `backend/src/services/agent/schemas/uiHintSchemas.ts:81-91`（枚举在 :90） |
| 前端渲染组件本地 interface | `inputType` | `text / number / select / checkbox / textarea` | `src/components/execution/cards/SurveyCard.tsx:16` |
| plan-generation 知识库 §11.1 | **`input`**（字段名就不同） | `text / number / select / checkbox` | `backend/src/services/mas/skills/plan-generation/knowledge.md:392` |
| workout-complete-handler SKILL.md schema 片段 | `inputType` | `text / number / checkbox` | `backend/src/services/mas/skills/workout-complete-handler/SKILL.md:157-176` |

后果：Agent 依知识库文档输出 `input` 字段 → Zod strip 丢弃；输出 `inputType:'select'` → 枚举不认
→ 校验回路打回重试。`SurveyQuestionOptionSchema` 只有 `label/value`（uiHintSchemas.ts:68-71），
**无 `children`**——器材二级菜单在契约上不可表达（Zod 默认 strip 未知键，Agent 即使输出了也到不了前端）。

### 缺口 6：无自由文本补充框

- 契约层：`inputType` 无 `textarea`（uiHintSchemas.ts:90），Agent 想出补充框会被打回；
- 渲染层：`SurveyCard` 文本输入恒渲染单行 `<input>`（SurveyCard.tsx:278-295，即使
  `inputType:'textarea'` 也是无效 HTML input type，浏览器回退单行文本）；
- 题库层：静态 4 题无任何补充输入（startOnboarding.tsx:228-271）。

用户特殊情况（夜班倒班、产后恢复、旧伤细节）无处安放，只能靠对话补救。

---

## 2. 设计方案

### 2.1 设计原则

1. **单一真源题库**：题目定义（id/文案/题型/选项树）收敛进 `shared/contracts`，前端首用问卷与
   Agent 动态问卷从同一份渲染；Agent 门禁清单（novice-starting.md §3.2.0）的「必问」字段与题库
   id 一一对应。
2. **id = 画像字段路径**：题 id 即写库目标（如 `weight_kg` → `basic_info.weight`），提交即机器可写，
   杜绝中文模糊映射（修缺口 3d）。
3. **一次问完**：多题合并一张卡（novice-starting.md:31 规则 1 已要求，题库扩充后才真正可满足）。
4. **增量兼容**：契约扩展全部 optional，不新增卡型，旧卡零影响（§2.5）。

### 2.2 新问卷结构（profile_intake v2 题目清单）

题库常量名 `PROFILE_INTAKE_QUESTIONS`（落 `shared/contracts/survey.ts`，见 §2.4）。

**Section A 必答（缺一不出计划，与 novice-starting.md §3.2.0 门禁对齐）**

| id | 题干 | inputType | 选项 / 约束 | 落库映射 |
| --- | --- | --- | --- | --- |
| `goal` | 当前最想达成的目标 | `select` | `muscle_gain 增肌变壮 / fat_loss 减脂塑形 / strength 提升力量 / general_fitness 保持健康与体能 / body_recomp 体态改善（新增，见 §2.6 推荐项）` | `preferences.goal`（value 直写，零映射） |
| `experience` | 训练经验 | `select` | `beginner_zero 纯新手 / beginner 3 个月以内 / intermediate 半年到两年 / advanced 两年以上` | `basic_info.training_age`，value→月数确定性 map：`beginner_zero→1 / beginner→3 / intermediate→12 / advanced→36`（写在前端写库模块，非 AI） |
| `weight_kg` | 体重（kg） | `number` | min 30 / max 250 / step 1；hint：「用于推算你的起步重量，只存在你的档案里」 | `basic_info.weight` |
| `equipment_venue` | 主要训练场地 | `select` | `gym 健身房 / home 家里 / outdoor 户外`（children 见 §2.3） | value 本身不落库（派生题，仅驱动二级菜单） |
| `equipment_items` | 可用器材（多选） | 由父题 children 渲染 | 对齐 `EXERCISE_EQUIPMENT` 子集（§2.3 树）；至少勾 1 项 | `preferences.equipment: string[]`（value 即枚举值，与 find_exercises 过滤轴零转换） |
| `weekly_frequency` | 每周能练几次 | `select` | 单值 `1 / 2 / 3 / 4 / 5 / 6` | `preferences.weekly_frequency_days`（契约新增，§4 修法 1） |
| `injuries` | 有无伤病/疼痛部位（多选） | `checkbox` | `none 无 / knee 膝 / lower_back 腰 / shoulder 肩 / wrist 腕 / neck 颈 / other 其他`；「无」与其他互斥 | 部位枚举随原文交 Agent 确认登记（§4 修法 2，形态拍板 = open question 4） |

**Section B 条件必答**

| id | 题干 | inputType | 显示条件 | 落库映射 |
| --- | --- | --- | --- | --- |
| `age` | 年龄 | `number` | `condition: { questionId: 'goal', equals: ['fat_loss', 'general_fitness'] }`（含减脂/体能目标 → 计划含心率目标，HRmax≈208−0.7×age，novice-starting.md:22 同口径）；min 14 / max 90 | `basic_info.age` |

**Section C 选答（折叠在「补充信息（可选）」组内，默认展开但不标星号）**

| id | 题干 | inputType | 约束 | 落库映射 |
| --- | --- | --- | --- | --- |
| `height_cm` | 身高（cm） | `number` | min 120 / max 230 | `basic_info.height` |
| `gender` | 性别 | `select` | `male / female / other`（契约已有枚举，`shared/contracts/index.ts:332`） | `basic_info.gender` |
| `session_minutes` | 单次可训时长 | `select` | `30 / 45 / 60 / 90`（label「30 分钟 / 45 分钟 / 60 分钟 / 90 分钟以上」） | 契约已有 `preferences.time_constraint`（index.ts:344），value 直写 |

**Section D 自由补充（必带）**

| id | 题干 | inputType | 约束 | 落库映射 |
| --- | --- | --- | --- | --- |
| `notes` | 还有什么想让教练知道的？ | `textarea` | 选答；maxLength 500；placeholder「夜班倒班、产后恢复、旧伤细节、不喜欢的动作……都可以写」 | 交 Agent `write_memory`（`backend/src/services/agent/mcpTools.ts:36`），不进静态画像 |

`purpose: 'profile_intake'`（卡级新字段，区分 workout_feedback / plan_gap，见 §2.5）。

### 2.3 器材二级菜单树（场地 → 具体器材多选）

两层结构，子选项 value **直接取 `EXERCISE_EQUIPMENT` 枚举值**
（shared/contracts/exercise-library.ts:89-105），提交后与 find_exercises 过滤轴零转换：

```
equipment_venue（一级，单选 select）
├─ gym 健身房        → children（12 值）：barbell 杠铃 / rack 深蹲架 / bench 训练凳 /
│                       dumbbell 哑铃 / machine 固定器械 / cable 绳索 / kettlebell 壶铃 /
│                       pull_up_bar 单杠 / band 弹力带 / stability_ball 瑞士球 /
│                       medicine_ball 药球 / foam_roller 泡沫轴
├─ home 家里         → children（8 值）：dumbbell / kettlebell / band / bench /
│                       pull_up_bar / stability_ball / medicine_ball / foam_roller
└─ outdoor 户外      → children（3 值）：pull_up_bar / band / weighted 负重背心
```

- `bodyweight` 永远隐式可用（EXERCISE_EQUIPMENT 显式值，exercise-library.ts:90 注释），**不设题**；
  写库时系统固定追加 `'bodyweight'` 到 `preferences.equipment`（确定性代码，非 AI）。
- `other`（枚举兜底值）不面向用户出题。
- 一级未选中时二级不渲染；一级选中后展开对应 children 多选 chips（折叠面板，高度过渡 200ms
  ease-out）；children 至少勾 1 项才允许提交（required 联动，见 §2.5 condition/childKey 语义）。
- `gym` children 头部提供「全选」快捷 chip（点击 = 12 值全勾/全取消，toggle）。
- 「健身房 + 家里补充」表达方式：本期 v1 先按单一场地出题（场地切换时已勾 children 清空并二次
  确认弹层文案「切换场地将清空已选器材」）；跨场地组合留待 open question 3 拍板后增强。

### 2.4 双真源统一方案（共享题库怎么共享）

**真源**：新建 `shared/contracts/survey.ts`，导出：

1. `SurveyQuestionOptionSchema / SurveyQuestionSchema / SurveyCardDataSchema`——从
   `backend/src/services/agent/schemas/uiHintSchemas.ts:68-108` **迁入**（迁移后
   uiHintSchemas.ts 改为 `export { ... } from '../../../shared/contracts/survey.js'` 再导出，
   后端既有 import 路径不变，零调用方改动）；
2. `PROFILE_INTAKE_QUESTIONS` 题库常量（§2.2 全量题目定义）；
3. `PURPOSE_ENUM = ['profile_intake','workout_feedback','plan_gap']`。

**消费方接线**：

| 消费方 | 现状 | 改为 |
| --- | --- | --- |
| 前端首用问卷 | `NEWBIE_SURVEY_QUESTIONS` 本地 4 题（startOnboarding.tsx:228-271，本地 interface :220-225） | 删除本地定义，useAICoach.ts:1180-1186 注入处改传 `PROFILE_INTAKE_QUESTIONS` + `purpose:'profile_intake'`；题库题目以 `as const satisfies SurveyQuestion[]` 保证类型对齐 |
| Agent 动态问卷 | 自由措辞出卡（knowledge.md:389-393 + DeepAgentService.ts:203-224） | 知识库改为「缺口 → 题库 id 子集」映射：缺哪几项就发对应题（支持子集出卡，复用题库 id/文案/选项，禁止自造同义题）；SKILL 文档中的手写 schema 片段（workout-complete-handler/SKILL.md:157-176）改为「以 shared/contracts/survey.ts 为准」引用，文档不再抄 schema |
| 写库映射 | `pick()` 模糊 key + 中文子串匹配（useAICoach.ts:506-557） | 按 id 直取：`responses[id]` → 落库映射表（§2.2 末列），value 已是契约枚举值，无任何文本换算 |

门禁对应关系（Agent 技能批落点）：novice-starting.md §3.2.0 门禁表的「必问」行改注题库 id：
`basic_info.weight ← weight_kg`、`preferences.equipment ← equipment_items`、
`goal ← goal`、频次 ← `weekly_frequency`、伤病 ← `injuries`；knowledge.md §11.1 的卡格式说明
（:392，字段名 `input` 漂移处）同步修正为 `inputType` 并引用题库。

### 2.5 契约扩展点（SurveyQuestionSchema 加什么，向后兼容方式）

对 `uiHintSchemas.ts`（迁移后为 `shared/contracts/survey.ts`）做**全部 optional 的增量扩展**：

```ts
// 选项级：children 递归（缺口 5 的二级菜单能力）
SurveyQuestionOptionSchema = z.object({
  label: z.string().min(1),
  value: z.string().min(1),
  children: z.lazy(() => z.array(SurveyQuestionOptionSchema)).optional(), // 二级选项
});

// 题目级
SurveyQuestionSchema = z.object({
  // ...现有 id/question/required/placeholder/options 不动...
  inputType: z.enum(["text", "number", "checkbox", "select", "textarea"]).optional(), // 扩枚举
  section: z.string().optional(),     // 分组标题（如「必答」/「补充信息（可选）」）
  hint: z.string().optional(),        // 题干辅助说明（如体重用途）
  unit: z.string().optional(),        // number 单位后缀（"kg"/"cm"）
  min: z.number().optional(),         // number 范围（30）
  max: z.number().optional(),         // number 范围（250）
  condition: z.object({               // 条件显示：被引用题的选中值 ∈ equals 时本题才渲染
    questionId: z.string(),
    equals: z.union([z.string(), z.array(z.string())]),
  }).optional(),
  childKey: z.string().optional(),    // children 勾选结果的 answers 键（见下方语义）
});

// 卡级
SurveyCardDataSchema 增加 purpose: z.enum(["profile_intake","workout_feedback","plan_gap"]).optional();
```

**children/childKey 渲染语义（具体规则，渲染批照此实现）**：

1. 当题为单选（`select`，有 options）且某选项带 `children`：选中该父选项后，在其下方渲染
   children 为多选 chips；父选项值写 `answers[id]`，children 勾选结果（string[]）写
   `answers[childKey]`。`equipment_venue` 的 `childKey = 'equipment_items'`。
2. required 联动：父题 required → 父值必答；若选中的父选项带 children 且题设了 childKey →
   children 至少勾 1 项，否则提交按钮禁用（沿用 `allRequiredAnswered` 单一闸门，
   SurveyCard.tsx:167-178 扩展判断，不新增第二套校验）。
3. 切换父选项时清空前一父选项的 children 勾选结果（防止跨场地残留脏数据）。

**condition 渲染语义**：被引用题（goal）当前选中值 ∈ equals → 本题渲染并参与 required 校验；
不满足 → 本题不渲染且**不参与** `allRequiredAnswered`（否则 age 必填会卡死力量目标用户）。

**向后兼容论证（逐层）**：

- 新字段全 optional → 旧 Agent 输出照常通过 `UIHintSchema.safeParse`（uiHintSchemas.ts:468-473
  判别联合的 survey_card 分支 data 自动放宽，`UIHintTypeEnum` 七卡型枚举 :450-458 **不动**，
  无新卡型）；
- Zod 对旧卡未知键本就 strip，扩展后旧卡语义不变；已固化的 submitted 卡持久化在
  `ChatMessage.uiHint`（useAICoach.ts:929-936 `markSurveySubmitted`），新 schema 对其只增不改；
- 校验回路（uiHintValidationLoop.ts）无卡型变化，仅 schema 变更，重试逻辑不动；
- `SurveySubmitRecord.answers` 结构 `Record<string, string | string[]>`（SurveyCard.tsx:39-43）
  不变——children 勾选结果就是 string[]，无持久化结构变更；
- 前端多态渲染走既有 survey_card 回路（符合「多态渲染禁硬编码卡片」红线），不新增组件文件；
- 渲染层必须同步修：`inputType:'textarea'` 时渲染 `<textarea>` 而非 `<input>`
  （SurveyCard.tsx:278-295 现状恒为 `<input>`，否则 textarea 扩了契约仍是单行）。

### 2.6 设计自由度——本稿的推荐项（可调，非硬约束）

| 项 | 推荐值 | 理由 |
| --- | --- | --- |
| goal 是否加 `body_recomp` 档 | 加（契约枚举 `shared/contracts/index.ts:346` 需同步扩一枚举值，加值向后兼容） | 深研报告 §2.1 指出现有档位缺「塑形/体态改善」，减脂增肌两档都套不上 |
| goal 的「健康」档用哪个枚举值 | `general_fitness`（题库出此值）；`health` 保留在契约枚举不动，存量画像读取侧归一 | 现状三口径并存：契约枚举 `health` 与 `general_fitness` 都合法（index.ts:346）、前端静态题 value 用 `health`（startOnboarding.tsx:248）、DeepAgentService 英文提示用 "general fitness"（DeepAgentService.ts:207）。题库收敛为一档，消灭漂移 |
| experience→training_age 映射数值 | `1/3/12/36` 月 | 现状硬编码 `3/12/36` 且纯新手也落 3（useAICoach.ts:541-548），beginner_zero 给 1 个月更符合「几乎零经验」 |
| 二级菜单展开动画 | 高度 auto 过渡 200ms ease-out，无位移 | 沿用项目现有过渡时长量级（SurveyCard 选项 active:scale-95 已是 150-200ms 量级） |
| section 分组视觉 | 组标题 13px / font-semibold / text-gray-400，组间距 16px（`space-y-4` 容器 + 组间 `pt-4`） | 与现有卡片内 12-15px 字阶一致（SurveyCard 题干 font-medium、按钮 text-[15px]） |
| 多选 chip 样式 | 沿用现状 pill：`px-4 py-3 rounded-full text-[15px] font-medium`，选中 `bg-star-accent text-white`，未选 `bg-gray-100 text-gray-700`，active:scale-95 | SurveyCard.tsx:256-261 既有样式零学习成本 |
| textarea 尺寸 | min-height 96px（约 4 行）、`rounded-2xl border-2`、聚焦边框 `border-star-accent`、字数计数器右下 12px text-gray-400 | 与现有输入框风格一致（SurveyCard.tsx:286-292） |
| number 输入 | 键盘 `inputmode="decimal"`，单位后缀 chip（kg/cm）右置，越界即时行内红字提示「请输入 30-250 之间的数值」 | 现状 number 无范围校验（SurveyCard.tsx:278-295），weight 30-250/age 14-90/height 120-230 需要前端闸 |
| 「无」互斥 chip 行为 | 点「无」清空其他勾选；点其他任一项自动取消「无」 | 约定 `value === 'none'` 触发互斥，渲染层硬规则，不进契约 |
| 提交按钮文案 | 首用卡「完成，生成我的计划」；缺口补全卡「提交」；未答完禁用态下方提示「还有 N 项未完成」（N 动态） | 现状「上传补充信息」偏系统视角；N 替代静态文案「请完成所有必填问题」（SurveyCard.tsx:310） |
| 已提交回显 | submitted 态从只显示「问卷已提交 + 日期」（SurveyCard.tsx:80-99）改为只读列表：每题渲染题干 + 答案 chip（多选逗号连接），无「重新填写」入口 | `SurveySubmitRecord.answers` 已收数据未展示（SurveyCard.tsx:41-42）；不提供重填避免双写竞态 |

---

## 3. 数据 bug 修复项（三条，修法方向）

### 修法 1：频次链路（缺口 3a+3b，双重断裂）

1. **契约**：`PreferencesSchema`（shared/contracts/index.ts:341-347）新增
   `weekly_frequency_days: z.coerce.number().int().min(1).max(7).optional()`（训练偏好语义归
   preferences；coerce 兼容表单字符串，与同文件 age/weight 同风格，index.ts:323 注释先例）。
2. **题库**：`weekly_frequency` 改单值 1-6 select（§2.2），消灭区间字符串。
3. **写库**：前端写库模块把该值放进 `preferences.weekly_frequency_days`（嵌套），**不再写
   staticPatch 顶层**——控制器嵌套分支（adminController.ts:2332-2355）只转发四个嵌套键，嵌套后
   无需改控制器即被 `validateProfile` 放行（新契约字段自动过 PreferencesSchema 清洗，
   userProfileService.ts:102/327-333）。
4. **存量核查**：全仓检索 `weekly_frequency_days` 仅 useAICoach.ts:549,552 两处，无契约定义、
   无后端消费、无任何其他写入通道（adminController legacy 分支 :2376-2402 白名单也不含它）
   → **生产库存量预期为零**。实现批补一条 `SELECT` 核查（`profile_static->'preferences'` 键）
   即可闭环，无需迁移脚本。

### 修法 2：伤病原文落库（缺口 3c）

1. **前端止血**：删除 useAICoach.ts:554-557 的顶层 `raw_injuries` 写法（该键经控制器嵌套分支
   从未落库，是死代码）。伤病题（`injuries`）与自由补充（`notes`）原文随问卷提交原文交给 Agent。
2. **Agent 登记通道**：问卷轮后 Agent 按 novice-starting 门禁调用 `update_profile` 追加
   `active_limitations`（工具已支持，mcpTools.ts:1060-1066）。落库形态拍板 = **open question 4**
   （`active_limitations` 自动过期语义 vs 长期旧伤冲突）：若拍板直写，推荐
   `ActiveLimitationSchema`（shared/contracts/index.ts:449-455）增 optional `note` 字段承载原文
   （现状 schema 无文本字段，severity 1-10 装不下「旧伤细节」），并允许 `auto_heal:false`
   显式通道（现状 `createActiveLimitation` 恒 true，index.ts:266-271）；若拍板走 memories，
   则 `write_memory` 记原文 + Agent 在对话上下文中遵守，不改契约。
3. 两条路都消灭「白名单静默丢弃」：不再有任何静态画像顶层私造键。

### 修法 3：goal/经验等文本换算收敛（缺口 3d）

1. 题库 value 即契约枚举值（§2.2），写库模块按 id 直取直写：`goal` → `preferences.goal`、
   `gender` → `basic_info.gender`、`session_minutes` → `preferences.time_constraint`，零文本匹配。
2. 删除 useAICoach.ts:506-537 的 `pick()` + 中文映射表 + `includes` 子串兜底整段（约 30 行），
   仅保留两条确定性 map（experience value→月数；`equipment_items` 追加 `bodyweight`）。
3. 归一兜底：写库前若 `preferences.goal` 值不在契约枚举 → 抛 console.warn 并跳过该字段
   （失败可观测，不静默写错值）——守「Zod 校验失败必须抛错或记录日志」红线。

---

## 4. 边界：明确不做什么

1. **不做多语言**：题库文案中文单语，i18n 不在本期范围。
2. **不迁移存量问卷数据**：历史会话里的旧 4 题卡（含已固化 submitted 卡）不回填、不重渲染成
   新结构；旧画像字段（如存了 `health` 的 goal、training_age 3/12/36）不批量改写。
3. **不新增卡型**：`UIHintTypeEnum` 七卡型不动（uiHintSchemas.ts:450-458），profile_intake /
   plan_gap 靠 `purpose` 字段区分；`survey_success` 等周边卡型（src/types/protocol.ts:129）不动。
4. **不动练后反馈问卷逻辑**：workout-complete-handler 的 Smart Survey 规则
   （SKILL.md:99-155）本期不重构，仅其 schema 片段改引用契约；purpose=workout_feedback 仅打标。
5. **不新增实时通道**：问卷提交仍走 SSE 聊天流 + `[UPLOAD_SURVEY_DATA]:` 消息协议
   （SurveyCard.tsx:157），不引入 WebSocket。
6. **不做题库版本管理 / AB 实验 / 远程配置**：题库随代码发布。
7. **不做跨场地器材组合**（「健身房+家里」）：v1 单场地 + 切换清空确认（§2.3），
   组合增强待 open question 3 结论。
8. **不动 CONTEXT.md**：新术语提案列 PR 描述，由协调者处理（红线）。

---

## 5. 实现拆批建议（依赖顺序）

```
批 1（后端契约批）
  shared/contracts/survey.ts 新建（schema 迁入 + PROFILE_INTAKE_QUESTIONS + PURPOSE_ENUM）
  shared/contracts/index.ts：PreferencesSchema.weekly_frequency_days、（若拍板）goal 枚举 +body_recomp、
                             （若拍板直写）ActiveLimitationSchema +note
  uiHintSchemas.ts：改再导出 + schema 扩展（children/inputType 扩枚举/section/hint/unit/min/max/condition/childKey/purpose）
  测试：uiHintValidator 旧卡回归（现有全部 fixture 必须原样通过）+ 新字段样例
  ↓ 产出：题库 id 枚举定稿（后续两批的公共依赖）
批 2（前端问卷批，可与批 3 并行）
  SurveyCard.tsx：children 折叠渲染、textarea、condition 条件显示与 required 联动、
                  number 范围/单位、section 分组、已提交态 answers 回显
  startOnboarding.tsx：删 NEWBIE_SURVEY_QUESTIONS，接题库
  useAICoach.ts：写库映射收口（§4 修法 3）、注入处传 purpose
  src/types/protocol.ts：卡型定义改 import shared（消本地重复）
  测试：SurveyCard 交互 + startOnboarding 回归
批 3（Agent 技能批，依赖批 1 的 id 定稿，可与批 2 并行）
  plan-generation/knowledge.md §11.1（:389-393）：卡格式改 inputType、指向题库、子集出卡规则
  plan-generation/knowledge/novice-starting.md §3.2.0（:16-33）：门禁表加题库 id 对应列
  DeepAgentService.ts 系统提示 Plan prerequisites（:203-224）：指引指向题库，去「自己拼问题」暗示
  workout-complete-handler/SKILL.md（:157-176）：schema 片段改契约引用
  测试：debug fixtures 增新字段样例
```

风险最高点：① 前端写库映射收口（现网实锤丢过字段，useAICoach.ts:513-514 注释）——批 2 需带
「旧 Agent 措辞卡提交不 crash」回归用例；② schema 扩展的旧卡回归——批 1 全量 fixture 必须零漂移。
建议验收对照 issue #114 验收标准 1-5 逐条勾验（一轮收集齐 / 频次落库正确 / 伤病落库 / 零二次补充 /
契约向后兼容）。

---

## 6. 硬约束与设计自由度

### 硬约束（不可动项）

1. **uiHint 契约向后兼容**：只做 optional 增量扩展，`UIHintTypeEnum` 卡型枚举不动，旧卡/旧
   持久化 uiHint 必须原样通过校验（uiHintSchemas.ts:468-473 判别联合结构不变）。
2. **display_name 规范**：问卷不采集用户名/昵称；用户标识按 `users` 表三字段口径
   （id UUID 程序内用 / display_name 展示用 / device_id 设备区分），题库不引入新的用户标识字段。
3. **AI 不做算术**：一切换算（experience→training_age 月数、器材追加 bodyweight、value→画像
   字段映射）落在确定性代码（前端写库模块 / Service），题库 value 设计为提交即机器值，不留
   换算给 Agent。
4. **静态画像写入走确定性通道**：数据写入走 Service，不依赖 Agent 转述（useAICoach.ts:498-502
   既有原则延续）；前端不私造契约外顶层键（修法 1/2 的根因即此）。
5. **数据契约红线**：与后端交互类型一律 import `shared/contracts`；Zod 校验失败抛错或记录日志；
   数据库/应用层 snake_case。
6. **传输**：问卷提交沿用 SSE 聊天流，不新增 WebSocket 通道。
7. **Repository 边界**：写库经既有 `PUT /profile/static` 路径与 Repository 层，不绕过。

### 自由度（可发挥，推荐值见 §2.6）

色彩 / 字阶 / 间距 / chip 与按钮样式 / 展开动画 / 交互细节（全选、互斥、切换清空确认文案、
按钮文案、已提交回显样式）；Section C/D 的取舍与顺序；goal 档位数量与 body_recomp 取舍。

---

## 7. 硬性要求汇总（视觉/交互全部为具体值，禁模糊实现）

| 项 | 具体值 |
| --- | --- |
| weight_kg | inputmode decimal，min 30 / max 250 / step 1，单位 chip「kg」右置，越界提示「请输入 30-250 之间的数值」 |
| age | min 14 / max 90，同上提示格式；显示条件 goal ∈ {fat_loss, general_fitness} |
| height_cm | min 120 / max 230，单位 chip「cm」 |
| notes | textarea min-height 96px，maxLength 500，计数器「n/500」12px text-gray-400 右下角 |
| 二级菜单 | 一级选中后 200ms ease-out 高度过渡展开；children chips 沿用 pill 样式（px-4 py-3 rounded-full text-[15px]）；gym 组首「全选」chip；切场地清空 + 确认弹层「切换场地将清空已选器材」 |
| injuries 互斥 | 「无」与任意部位互斥，双向清除 |
| 提交闸门 | 必答未满禁用提交，按钮下提示「还有 N 项未完成」（N 实时） |
| 已提交回显 | 题干 + 答案 chip 只读列表，右上日期同现状格式（SurveyCard.tsx:94 的 toLocaleDateString zh-CN） |
| section 分组 | 组标题 13px semibold text-gray-400，组间距 16px |
| 题干辅助 | hint 文案 13px text-gray-500，置于题干下一行；必答星号维持现状红色 `*`（SurveyCard.tsx:235） |
