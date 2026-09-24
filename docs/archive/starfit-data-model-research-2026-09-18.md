# 数据模型调研报告（2026-09-18）

> 两个子任务调研：运动科学指标体系 + 主流 App 实践。本文是给数据模型定稿用的证据底稿。
> 来源标注在各节；完整 URL 列表在文末。

---

## 一、核心裁决：容量（tonnage）怎么算

### 1.1 运动科学口径

- **NSCA 标准 volume load 定义 = 组数 × 次数 × 外部负荷**。自重动作外部负荷为零，不计入。
 学术上有 VLwD（含位移/体重的变体）研究，但非主流（PMC6316164）。
- **Stronger by Science（Nuckols）**：volume load 本身跨动作不可比（腿举 tonnage 远高于深蹲但刺激未必更高），
 推荐「有效组数（hard sets，RIR≤3）」或 relative volume（%1RM）做容量主计量。
- **RP / Israetel**：容量体系完全以「每肌群每周有效组数」（MEV/MAV/MRV）为单位，不用 tonnage；
 自重动作按组数计入肌群容量。
- **行业分裂**：Hevy 把体重计容（要求 app 内先录体重），Strong/JEFIT/Fitbod/AlphaProgression 均不计。

### 1.2 Starfit 裁决建议（待用户确认）

**容量 = 外部负荷 × 次数，自重不计入 tonnage。**

- resistance/weight_only：weight × reps（不变）
- **bodyweight：容量 0**，进度轴 = 次数/组数/变式难度（+可选负重 vest 按 weight × reps 计）
- **assisted：max(0, 体重 − 辅助) × reps**（真实负荷语义，用户已拍板；但前提是有体重画像）
- unilateral：weight × reps × 2（不变）
- isometric：**容量 0**，进度轴 = 时长（维持时间本身就是成绩）
- 无体重画像时：bodyweight/assisted/isometric 容量一律 0（与 2026-09-18 已改的兜底一致），
 **并提示用户补体重**（见第四节 Agent 漏洞）

**展示语义**：History 卡的「容量」对纯自重训练日会显示 0 → 需要替换为更合适的会话主指标
（见第三节展示层设计：组数 + 有效组数做主指标）。

---

## 二、采集层定稿（每组/每会话采什么）

### 2.1 组级字段

| 字段 | 现状 | 定稿建议 | 依据 |
|---|---|---|---|
| reps / weight / duration / distance | ✅ 已有 | 保持 | — |
| **RPE（或 RIR）** | ⚠️ 采集但落库丢弃 | **必须落库**。二选一：RIR（对周期化/渐进算法更友好，AlphaProgression 验证）或 RPE（行业更普遍，Strong/Hevy 原生）。**建议：采 RIR，UI 可标 RPE 换算**（Helms 表：RPE10=RIR0, 9=1, 8=2, 7=3） | Zourdos 2016 / Helms 2016（PMC4961270） |
| 组级心率 | ✅ 聚合为 avg_hr | 保持聚合，原始值可丢 | HR 类指标会话级够用 |
| 休息时长 | ✅ rest_sec 已落库 | **保持（差异化点）**：全行业只做计时器不落数据 | 调研确认无先例 |
| completedAt | ✅ | 保持 | rest_sec 依赖 |
| 备注（组级） | ❌ 无 | 低优先级，可不做 | Strong 有但非必需 |
| 变式/难度标记（自重动作） | ❌ 无 | 中优先级：自重进阶靠变式（斜坡俯卧撑→标准→下斜），先靠动作库多动作解决，schema 后续再加 | SbS no-gym 指南 |

### 2.2 会话级字段（新增）

| 字段 | 用途 | 依据 |
|---|---|---|
| **session RPE**（结束页 1-10 一问） | 内部负荷 = sRPE × 分钟，负荷管理/ACWR 的输入，依从性最高 | Foster 1998（PMC5673663） |
| 会话时长 / 有氧时长 / 距离 / avgHr | ✅ 已有 | — |
| 静息心率/HRV/睡眠 | **不做问卷**，走 HealthKit 硬件同步（行业全一致）；无穿戴设备用户先跳过 | Whoop/Garmin/Apple/Keep 全硬件驱动 |

### 2.3 明确不采（过度工程）

- ACWR / monotony / strain：可**从已落数据推导**，不需要单独采集。且 ACWR 伤病预测效度近年
 被方法学批评严重（Sports Med 2020：慢性项用随机数也能得到相似伤害 OR），只做描述性趋势，不做红线。
- TRIMP / Edwards：需要全程心率+个体 HRmax/HRrest，穿戴设备用户走 HealthKit 同步后再说。
- 左右分侧字段：行业无先例（Hevy 社区惯例「每侧各记一组」），不做。

---

## 三、展示层定稿（给用户看什么）

行业统一三层结构（强弱两类 App 高度同构）：

### 3.1 会话卡片（结算页 / History 列表）

| 动作类型主导 | 主指标 | 次指标 |
|---|---|---|
| 力量日（resistance 为主） | 总容量（外部负荷 tonnage） | 组数、平均 RIR、PR 标记 |
| 自重日（bodyweight 为主） | **总组数 / 总次数** | 时长、最高难度变式 |
| 有氧日（cardio/outdoor） | 时长 + 距离 | 平均心率、配速 |
| 等长（isometric） | 总保持时长 | 组数 |

- History 卡的「容量」字段改为**按训练日类型自适应**（纯自重日显示组数/次数而非 0 容量）
- 结算页维持现有布局，容量语义改为外部负荷口径
- **RPE/RIR 采而不展**（对齐 Hevy：落库、可选展示，不进图表）

### 3.2 趋势图（后续迭代，不急）

- 单动作：重量 × 次数、e1RM 曲线（Epley：1RM = w×(1+reps/30)，≤5 次误差 ±2-3%）
- 每肌群周组数（对齐 volume-landmarks 技能的 MEV/MRV 口径——这是 Agent 做计划的直接输入）

### 3.3 周报/月报（后续迭代）

- 与上一周期对比高亮（Hevy 月报 / Apple Trends 90v365 模式）
- 负荷趋势：周 sRPE 总量 + 「本周比上月 +30%」提示（ACWR 描述性使用）

---

## 四、Agent 漏洞修复（计划生成前先问体重）

**现状**：plan-generation 技能知识 §3.2 重量推算依赖「用户体重」，但新用户 basic_info.weight 为空时
Agent 不询问、直接按 0 配重出计划 → 触发 9-17 真机那条 bug 链。

**修复**（skill 文档改动，backend/src/services/mas/skills/plan-generation/）：

1. SKILL.md「典型流程」加一步：load_history 后检查 `basic_info.weight`，
 **缺失且计划含 bodyweight/assisted/isometric 动作 → 先发一条问卷卡（survey_card）问体重，拿到再出计划**
2. knowledge.md §3.2 补充：「自重动作不推算外部配重（weight=0 正确）；助力动作的辅助重量
 参考体重百分比（如引体辅助 30-50% 体重）；无体重时禁止虚构数值」
3. 后端动作库 exercise_type_guide 的 bodyweight.md 已写「weight 通常 0」✓ 不动

---

## 五、执行清单（按优先级）

1. ✅ setVolume 兜底 75→0（已完成，35/35 测试过）
2. ✅ ResistanceCard 显示语义「自重±配重」（已完成）
3. ⬜ 容量口径切换：bodyweight/isometric 容量=0，History/结算页自适应主指标（**待确认**）
4. ⬜ 组级 RIR/RPE 落库（workoutSummary + 后端 schema + 结算页 sRPE 采集）
5. ⬜ plan-generation 技能：先问体重再出计划
6. ⬜ 趋势图/周报（二期）

## 附：关键来源

- NSCA volume load 定义: nsca.com/education/articles/kinetic-select/quantifying-training-and-competition-load
- SbS 容量计量: strongerbyscience.com/the-new-approach-to-training-volume/
- RIR-RPE 量表: PMC4961270 (Helms), Zourdos 2016 JSCR
- session-RPE/monotony/strain: PMC5673663 (Foster)
- ACWR 方法学批评: link.springer.com/article/10.1007/s40279-020-01378-6, bjsm.bmj.com/content/55/2/108
- HRV-guided training meta: PubMed 34639599
- 睡眠与伤病: PMC9960533
- 主观监测优于客观: PMC4789708 (Saw 2016)
- Hevy 自重三类建模: help.hevyapp.com/hc/en-us/articles/38386262243223
- Hevy 统计: help.hevyapp.com/hc/en-us/articles/35702030346903
