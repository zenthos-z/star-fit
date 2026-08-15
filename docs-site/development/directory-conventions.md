# 目录规范

## 概述

本文档定义 Starfit 项目的目录组织规范。

## 前端目录规范

### `src/v2/` - V2 架构目录

**用途：** 所有新功能、新组件

**子目录：**
- `components/` - 组件
- `hooks/` - Hooks
- `services/` - 服务
- `storage/` - 存储层
- `types/` - 类型定义

**规则：**
- 新功能必须在此目录下实现
- 使用插件模式组织代码

### `components/` - 旧组件目录

**用途：** 过渡期保留的旧组件

**规则：**
- 仅保留必要的旧组件
- 必须标记 @deprecated
- 迁移后立即删除

## 后端目录规范

### `backend/src/services/agent/` - Agent 内核

**用途：** Deep Agents 内核（单 Agent + Skill 路由）

**核心文件：**
- `AgentService.ts` - Agent 服务端口（chat/plan 等能力接口）
- `DeepAgentService.ts` - Deep Agents 内核实现
- `skillLoader.ts` - 领域技能加载（挂载 `services/mas/skills/` 下的知识）
- `mcpTools.ts` - 把 Repository 能力暴露为 Agent 工具
- `uiHint*.ts` - uiHint 卡片协议的提取 / 校验 / 重试回路

**规则：**
- 新的 Agent 能力以 Skill 形式扩展，不新增独立智能体
- 数据访问一律经 `mcpTools.ts` 走 Repository 层

### `backend/src/services/mas/skills/` - 领域技能知识

**用途：** 健身领域技能知识库（训练动作指南、计划生成、力量训练设计等）

**规则：**
- 知识文件（`knowledge/*.md`）由 `skillLoader` 挂载给 Agent
- 目录名沿用历史路径，仅作知识资产，不含运行时代码

### `backend/src/services/` - 领域服务

**用途：** 业务服务（动作库、视频处理、用户画像、导出等）

**规则：**
- 一个领域一个 Service 文件
- 数据访问必须经 Repository 层

## 文档目录规范

### `docs/` - 领域资料与分析

**用途：** 领域分析、参考资料、截图、变更记录

**规则：**
- 面向主题沉淀，不存放一次性工作草稿
- 过程性内容完成后移至 docs-site 或删除

### `docs-site/` - 固化规范

**用途：** 架构、API、指南

**规则：**
- 面向开发者/用户
- 长期维护
- 使用 VitePress 构建

## 文件命名规范

| 类型 | 格式 | 示例 |
|------|------|------|
| 组件 | PascalCase | ExerciseCardV2.tsx |
| Hook | camelCase + use 前缀 | useAICoach.ts |
| 服务 | camelCase | userProfileService.ts |
| 类型 | PascalCase | ExerciseProtocol.ts |
| 工具 | camelCase | typeBridge.ts |

## 禁止的命名

- ❌ backup_*.txt
- ❌ *_temp.*
- ❌ *_backup.*
- ❌ aaaa.md（无意义名称）
- ❌ test_*.json（测试数据）

## 参考资源

- [数据流](../architecture/data-flow.md)
