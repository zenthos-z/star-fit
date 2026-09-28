---
name: "data-schema"
description: "数据结构参考 - 周计划/画像表结构与契约字段速查"
category: "knowledge"
version: "1.0.0"
---

# 数据结构参考 (Data Schema)

数据结构单一参考：表结构 + 契约字段说明。其他技能引用本技能，
**不各自复述字段表**。契约真源 = `shared/contracts/`（Zod schema）+
`backend/src/db/postgresql/migrations/`（DDL）；本技能只是 Agent 可读的
速查层，冲突时以真源为准。命名统一 snake_case。

## 知识文件（read_file 按域拉取）

- **计划域**（weekly_plans / plan_entries 表、PlanEntryInput、apply 载荷、
  条目状态机、week_id、今日课表三态）：
  `/data-schema/knowledge/plan.md`
- **画像域**（users 表三态模型、profile_static / profile_dynamic 字段、
  update_profile 写入语义）：
  `/data-schema/knowledge/profile.md`
- suggestion / session 域：下批迁移（本期未覆盖）

## 使用时机

- 组 weekly_plan 卡 `data.apply` 载荷、核对 PlanEntryInput 字段 → plan.md
- 判断画像数据有哪些字段可读/可写（load_history 返回结构、update_profile
  目标字段）→ profile.md
- 表结构/枚举/约束层面的疑问一律先查这里，再不确定才读契约源码

## 边界

- 只读参考：本技能不含操作规则（何时出卡/何时写入）——操作语义在各流程技能
  （plan-generation / profile-update-reviewer / fitness-data-tools）
- 字段校验由 Zod 契约在服务端强制；本速查表与契约同步维护
