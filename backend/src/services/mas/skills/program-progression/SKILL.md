---
name: "program-progression"
description: "计划进阶与周期化知识包 - 分化选择、渐进超负荷规则、deload 减载与自主调节"
category: "planning"
version: "1.0.0"
---

# 计划进阶与周期化知识包 (Program Progression Skill)

## 概述

本技能包为训练计划的**中长期演进**提供知识支撑：如何按每周可用天数选分化、
计划如何逐周变难（渐进超负荷）、何时减载（deload）、以及用户状态不好时如何
自主调节。与 `plan_generation`（单次计划参数计算）互补：

- `plan_generation` 回答"今天的计划长什么样"
- `program_progression` 回答"接下来 4-12 周计划如何演进"

## 知识文档

- `knowledge/split-selection.md` - 分化方案选择决策表（按每周天数与经验等级）
- `knowledge/progression-rules.md` - 渐进超负荷规则、deload 节奏、自主调节与弹性周目标

## 使用方式

Agent 在以下场景读取本知识包（通过文件系统工具按需读取）：

1. 用户要求"给我排一个每周 X 练的计划" → 先读 `split-selection.md`
2. 用户问"重量怎么加/什么时候该减/感觉练不动了" → 先读 `progression-rules.md`
3. 为用户生成跨周计划或调整现有计划节奏时 → 两份都读

## 设计原则（与本产品哲学一致）

- **坚持胜过最优**：计划首先要用户真的能执行；编排永远围绕用户偏好与真实日程
- **不补课**：用户漏练几天不"补回来"，直接从当下最高价值的下一次训练恢复
- **温柔而非教官**：坏状态日的调节是正常策略而非失败，不制造愧疚感

## 依赖服务

无新增工具。本技能包为纯知识，计算仍由 `plan_generation` / `strength_training_designer`
的既有工具完成。

## 来源与版本历史

- **1.0.0** (2026-09-06) - 初始版本。知识提炼自开源 Agent 技能调研：
  workout-planner（JayRHa/AgentSkills, MIT）的分化/进阶/deload 框架，
  fitness-coach（neilberget/fitness-skill, MIT）的弹性周目标与复盘模式，
  结合本产品容量知识（MEV/MRV）本地化改写。
