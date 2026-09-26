---
name: "program-progression"
description: "计划进阶与周期化知识包 - 分化选择、渐进超负荷规则、deload 减载与自主调节"
category: "planning"
version: "1.1.0"
---

# 计划进阶与周期化知识包 (Program Progression Skill)

## 概述

本技能包为训练计划的**中长期演进**提供知识支撑：如何按每周可用天数选分化、
计划如何逐周变难（渐进超负荷）、何时减载（deload）、以及用户状态不好时如何
自主调节。与 `plan_generation`（周计划生成与落库）互补：

- `plan_generation` 回答"这周计划长什么样、怎么落库复用"
- `program_progression` 回答"接下来 4-12 周计划如何演进"

## 决策表代码化（1.1 起，重要）

本技能的核心决策表已**代码化为 Service 纯函数**（真源）：

| 决策                    | 真源函数（backend/src/services/schedule/progressionPolicy.ts） |
| ----------------------- | -------------------------------------------------------------- |
| 分化选择（天数 × 等级） | `selectSplit(daysPerWeek, fitnessLevel)`                       |
| 渐进超负荷策略          | `selectProgressionStrategy(level, trainingAge, has1RM)`        |
| 加重步进 / 线性加重算术 | `doubleProgressionStepKg` / `nextLinearProgressionWeight`      |
| Deload 节拍判定         | `shouldDeload(signals)`                                        |

知识 `.md` 保留为**解释性知识**（Agent 向用户解释"为什么"的话术与依据）；
决策口径与算术以代码真源为准，冲突时**以代码为准**。缺勤顺延的查表规则
同理由代码承载（`planAdjustment.ts` 的 `resolveMissedEntries`）。

**红线**：算术永远留 Service——加重多少公斤、何时减载，Agent 引用结果并
解释，不自行计算。

## 知识文档

- `knowledge/split-selection.md` - 分化方案选择决策表（按每周天数与经验等级）
- `knowledge/progression-rules.md` - 渐进超负荷规则、deload 节奏、自主调节与弹性周目标

## 使用方式

Agent 在以下场景读取本知识包（通过文件系统工具按需读取）：

1. 用户要求"给我排一个每周 X 练的计划" → 先读 `split-selection.md`
2. 用户问"重量怎么加/什么时候该减/感觉练不动了" → 先读 `progression-rules.md`
3. 为用户生成跨周计划或调整现有计划节奏时 → 两份都读
4. 需要给出具体数值（加重步进、减载判定）→ 转述 progressionPolicy 纯函数
   的输出与 rationale；不确定时让 Service/前端计算

## 设计原则（与本产品哲学一致）

- **坚持胜过最优**：计划首先要用户真的能执行；编排永远围绕用户偏好与真实日程
- **不补课**：用户漏练几天不"补回来"，直接从当下最高价值的下一次训练恢复
- **温柔而非教官**：坏状态日的调节是正常策略而非失败，不制造愧疚感

## 依赖服务

无新增工具。本技能包为纯知识；计算与决策由
`backend/src/services/schedule/progressionPolicy.ts` 纯函数承载。

## 来源与版本历史

- **1.1.0** (2026-09-26) - 决策表代码化声明（E3/issue #2）：分化/进阶/deload
  决策真源移至 progressionPolicy.ts 纯函数；md 降格为解释性知识
- **1.0.0** (2026-09-06) - 初始版本。知识提炼自开源 Agent 技能调研：
  workout-planner（JayRHa/AgentSkills, MIT）的分化/进阶/deload 框架，
  fitness-coach（neilberget/fitness-skill, MIT）的弹性周目标与复盘模式，
  结合本产品容量知识（MEV/MRV）本地化改写。
