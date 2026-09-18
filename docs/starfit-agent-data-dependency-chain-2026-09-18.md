# Agent 计划生成的数据依赖链（2026-09-18）

> 回答「Agent 做计划前需要哪些数据、缺了哪些必须先问用户」。
> 证据来源：mcpTools.ts / DeepAgentService.ts / plan-generation 技能实地核实 + 前期调研报告。

---

## 一、依赖链全景（计划生成的输入 → 去处）

```
用户画像 (profile_static)                动态画像 (profile_dynamic)
├─ basic_info.weight  ←──【依赖1】自重/助力/有氧强度推算
├─ basic_info.age      ←──【依赖2】最大心率 HRmax=208-0.7×age → 心率区间
├─ basic_info.height   ←──【依赖3】体重基准合理性校验（次要）
├─ basic_info.gender   ←──【依赖4】推算系数微调（knowledge.md 3.2「女性取下限」）
├─ preferences.method  ←──【依赖5】训练目标 → 动作选择/容量
├─ preferences.equipment ←─【依赖6】器械限制（硬约束）
├─ fitness_level(tags) ←──【依赖7】容量/难度定位
├─ load_anchors        ←──【依赖8】训练重量 = 历史1RM×80% / 历史重量×85-95%
├─ active_limitations  ←──【依赖9】伤病部位动作排除（硬约束）
└─ recovery_state      ←──【依赖10】减量判断（fatigue高→容量-20~30%）

动作库 (list_exercises)
└─ exercise_type        ←──【依赖11】类型决定必需字段与依赖链走向
```

## 二、逐条依赖明细（含缺口分析）

### 依赖1：体重 → bodyweight/assisted/抗阻推算【当前最大缺口】
- **下游用途**：
  a) 抗阻重量推算（knowledge.md §3.2：深蹲=体重×0.4-0.6 等）
  b) assisted 辅助重量定位（assisted.md 进阶表 -40~-5kg 是绝对值，**隐含假设 ~60kg 体重**；
     真实负荷=体重−辅助，没有体重就无法算真实负荷）
  c) bodyweight 有效负荷展示（用户拍板：显示配重=自重−辅助）
  d) BMI/容量归一化
- **现状**：basic_info.weight 为空时 Agent **不询问直接出计划** → 9-17 真机 bug 根因
- **采集方式**：survey_card（inputType:"number"）一题即可

### 依赖2：年龄 → 心率区间【有氧计划的隐性依赖】
- **下游用途**：cardio.md 心率五区全部按 %HRmax 定义；HRmax=208−0.7×age(Tanaka)；
  load_anchors 里 max_hr/resting_hr/zone_2_threshold 字段已预留但**没有采集链路**
- **现状**：age 缺失时 Agent 无法给心率区间目标 → 有氧计划只给时长/距离，区间目标凭空
- **采集方式**：有氧需求出现时 survey_card 问年龄（+可选静息心率）

### 依赖3：身高（次要）
- 下游：体重合理性参照、体成分评估。缺失不阻断计划。

### 依赖4：性别（次要）
- 下游：推算系数微调（knowledge.md 3.2）。缺失时用保守下限即可，不阻断。

### 依赖5：训练目标 preferences.method/goal
- **现状**：DeepAgentService 系统提示「Plan prerequisites」已要求：goal 未知时先问 ✓
- 缺口：**只在 prompt 里**，plan-generation 技能文档没有对应条文（双保险缺失）

### 依赖6：器械限制 preferences.equipment【硬约束】
- **现状**：prompt 已要求先问 ✓；equipment 为空时无法过滤动作库
- 风险：空 equipment 被当成「无器械」处理会错杀健身房用户的动作选择

### 依赖7：fitness_level（tags）
- **现状**：prompt 已要求先问 ✓
- 影响：容量定位（MEV 起步）、动作复杂度。缺失时保守处理可接受

### 依赖8：load_anchors（历史负荷锚点）
- **现状**：已有完整的 PRE-test 规则（DeepAgentService「PREREQ TEST (PRE WEIGHT) RULE」）：
  无锚点的抗阻动作禁止 weight=0 出卡，先发 instruction card 教用户做预备组测重 ✓（设计良好）
- **bodyweight/assisted 没有对应规则** ← 本轮要补的对称缺口

### 依赖9：active_limitations（伤病）【硬约束】
- **现状**：prompt + profile-update-reviewer 技能已覆盖（受伤→确认卡→写入）✓

### 依赖10：recovery_state
- **现状**：prompt 已有「empty → 正常周但说明假设」✓
- 结构上已有 acute_load/chronic_load 字段（ACWR 原料），暂无填充链路（可接受，二期）

### 依赖11：exercise_type → 必需字段映射
- **现状**：list_exercises 返回 exercise_type，uiHintFormat 要求出卡前核对类型字段 ✓

## 三、修法定稿

### 3.1 plan-generation/knowledge.md §3.2 重写（核心改动）

在「无历史记录的推算」表格前加**前置检查条文**：

```
### 3.2.0 推算前置检查（数据依赖链门禁）

重量推算依赖链：抗阻/自重/助力动作的重量都锚定在用户体重上。
出计划前必须核对 load_history 返回的 profile_static：

| 依赖数据 | 下游用途 | 缺失时动作 |
|---|---|---|
| basic_info.weight | 抗阻推算/assisted辅助定位/bodyweight有效负荷 | **必问**（survey_card 数字题）|
| basic_info.age | 有氧心率区间(%HRmax) | 计划含 cardio/outdoor 心率目标时必问 |
| preferences.equipment | 动作过滤 | **必问**（多选）|
| goal/method | 容量与动作选择 | **必问** |
| load_anchors（抗阻） | 训练重量 | 走既有 PRE-test 规则 |
| fitness_level | 容量定位 | 可假设 beginner 并声明 |

规则：
1. 缺「必问」数据 → 本轮只发 survey_card 收集，不出 plan_card（与 PRE-test 规则同构）
2. bodyweight 动作 weight=0 是正确值，不需要为此询问；询问体重是为了
   assisted 辅助定位与容量口径，文案要说清楚用途（用户才知道为什么问）
3. 用户拒绝回答 → 以 weight=0 + 「首次自选重量」文案出计划（既有 fallback）
```

### 3.2 DeepAgentService.ts「Plan prerequisites」补一行（symmetry）

现有 5 项 prerequisites 后追加第 6 项：
`(6) body weight (needed for bodyweight/assisted loading and resistance
estimation) — ask via survey card if missing`

### 3.3 assisted.md 补依赖说明

进阶表的绝对值辅助重量注明「按 ~60-70kg 体重用户标定；实际辅助量 ≈ 体重 × (40%~15%)，
用户体重大幅偏离时按比例修正——体重数据见 plan-generation §3.2.0」

## 四、不做的事

- ❌ 不做强制 onboarding 向导（打断首次体验；依赖链检查在出计划时触发即可）
- ❌ 不把 ACWR/HRV 加进依赖链（二期硬件同步后再说）
- ❌ 不给 survey_card 扩 schema（现有 questions/inputType 已够问体重/年龄）
