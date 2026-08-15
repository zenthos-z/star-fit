---
name: starfit-conventions
description: Starfit 项目规范技能 - 包含新架构红线、数据契约原则、视觉设计、动效交互规范。触发场景: (1) 数据库相关 - Core-Flex架构、JSONB字段、数据契约 (2) UI开发 - 调整配色、字体、布局、组件样式 (3) 动画实现 - 添加过渡效果、手势交互、微交互 (4) AI边界 - 算术计算、向量检索、安全过滤
---

# Starfit 项目规范技能

## 核心原则

**数据契约不变，处理逻辑可演进** - 这是 MAS 系统的基石。在修改任何数据相关内容前，必须先查阅 `references/00-core-redlines.md`。

## 快速导航

```
按需加载规范文件
│
├─ 数据契约/架构红线 (references/00-core-redlines.md)
│  └─ 触发词: database, schema, API, 存储, 数据, 架构, 红线
│
├─ 数据协议 (references/data/)
│  ├─ contract.md      - 数据契约核心原则
│
├─ 视觉规范 (references/visual/)
│  ├─ 00-color.md      - 颜色系统
│  ├─ 01-typography.md - 字体排印
│  ├─ 02-spacing.md    - 间距布局
│  └─ 03-components.md - 组件视觉规范
│
└─ 动画规范 (references/animation/)
   ├─ 00-principles.md     - 设计原则与令牌
   ├─ 01-framer-presets.md - Framer Motion预设
   ├─ 02-interactions.md   - 微交互与手势
   └─ 03-special-effects.md- 特殊效果
```

## 新架构红线速查

**最高优先级规则 - 违反将导致系统不稳定**

| 类别 | 红线 | 一句话描述 |
|------|------|------------|
| **新架构** | NA-001 | AI 禁止介入算术计算 |
| **新架构** | NA-002 | JSONB 写入前必须验证 |
| **新架构** | NA-003 | 向量检索结果必须规则过滤 |
| **新架构** | NA-004 | active_limitations 必须带 expire_at |
| **架构** | AR-001 | 执行节点禁止设置 `currentAgent` |
| **架构** | AR-002 | 禁止节点间直接调用 |
| **状态** | SM-001 | JSON 字段必须 try-catch 解析 |
| **状态** | SM-002 | 禁止前端直连 DB |
| **状态** | SM-003 | 时间戳必须调用 MCP 工具 |
| **状态** | SM-004 | 所有 Enum 必须包含 UNKNOWN |

**完整红线规范**: 见 `references/00-core-redlines.md`

## 常见场景规范

### 场景1: Core-Flex 数据架构

```
用户请求 → 立即加载 00-core-redlines.md
          → 检查 NA-001 ~ NA-004
```

**关键检查**:
- ❌ AI 不得进行算术计算（Service 负责）
- ❌ JSONB 不得直接写入（必须 Zod 验证）
- ❌ 向量检索结果不得直接使用（必须规则过滤）
- ✅ active_limitations 必须带 expire_at

### 场景2: 调整UI配色

```
用户请求 → 加载 visual/00-color.md
          → 使用设计令牌而非硬编码
```

**关键规范**:
- 主色: `#3B82F6` (Blue-500)
- 强调色: `#BCEF08` (黄绿系)
- 状态色: rose-500(进行中), green-500(完成), red-500(错误)

### 场景3: 添加动画效果

```
用户请求 → 加载 animation/01-framer-presets.md
          → 使用预设而非内联动画
```

**关键规范**:
- 时长: fast(150ms), normal(200ms), slow(300ms)
- 缓动: easeOut(入场), spring(弹性)
- 无障碍: 支持 `prefers-reduced-motion`

### 场景4: AI 边界检查

```
用户请求 → 加载 00-core-redlines.md
          → 检查是否违反 NA-001
```

**关键规范**:
- ❌ AI 不得计算进阶/1RM/过期时间
- ✅ Service 负责所有算术计算
- ✅ AI 负责意图理解、话术生成、创意组合

## 设计令牌速查

所有视觉数值必须从 `src/v2/lib/design-tokens.ts` 导出：

| 类别 | 令牌 | 值 |
|------|------|-----|
| **颜色** | primary | `#3B82F6` |
| **间距** | base | `16px` (4px网格) |
| **圆角** | lg | `16px` |
| **阴影** | md | `0 4px 6px -1px rgba(0,0,0,0.1)` |
| **动画** | fast | `150ms` |
| **字体** | base | `16px` |

## 新架构核心概念

### Core-Flex 数据架构
```
Core 层：关系型列（ID、外键、索引）
  └─ 用途：JOIN、WHERE、索引查询

Flex 层：JSONB 容器
  ├─ profile_static   - 生物学/心理学特征
  ├─ profile_dynamic  - 负荷锚点/伤病限制
  └─ history_summary  - 压缩历史
```

### 三态模型
- **静态态**: 长期特征，半年/年更新
- **动态态**: 实时状态，每次训练后更新
- **摘要态**: 压缩历史，每周更新

### AI 与代码边界
- **AI 负责**: 意图理解、话术生成、创意组合
- **Service 负责**: 算术计算、安全过滤、数据校验
- **红线**: AI 绝对禁止介入算术计算

## 开发决策树

```
是否涉及 AI 计算？
│
├─ 是 → 是否为算术运算？
│       │
│       ├─ 是 → ❌ 禁止 AI 计算，移至 Service
│       │
│       └─ 否 → ✅ 允许（意图理解、话术生成）
│
└─ 否 → 是否写入 JSONB？
        │
        ├─ 是 → 是否通过 Zod 验证？
        │       │
        │       ├─ 否 → ❌ 禁止，必须验证
        │       │
        │       └─ 是 → ✅ 允许
        │
        └─ 否 → 是否向量检索？
                │
                ├─ 是 → 是否规则过滤？
                │       │
                │       ├─ 否 → ❌ 禁止，必须过滤
                │       │
                │       └─ 是 → ✅ 允许
                │
                └─ 否 → ✅ 常规操作
```

## 代码提交前检查

在提交代码前，确认：

- [ ] AI 没有进行算术计算（NA-001）
- [ ] JSONB 写入前通过 Zod 验证（NA-002）
- [ ] 向量检索结果经过规则过滤（NA-003）
- [ ] active_limitations 带 expire_at（NA-004）
- [ ] 执行节点没有设置 `currentAgent`（AR-001）
- [ ] 所有 JSON 解析都有 try-catch（SM-001）
- [ ] 没有前端直连数据库（SM-002）
- [ ] 所有时间戳都通过 MCP 工具获取（SM-003）
- [ ] 所有 Enum 都包含 UNKNOWN（SM-004）
- [ ] 颜色/字体使用设计令牌而非硬编码
- [ ] 动画支持 `prefers-reduced-motion`

## 相关文档源

完整文档位置: `docs-site\`

| 域 | 文档路径 |
|---|---------|
| 数据契约 | `architecture/mas-data-contract.md` |
| 架构红线 | `architecture/mas-red-lines.md` |
| 颜色系统 | `ui-guides/color-system.md` |
| 动画规范 | `ui-guides/motion-design-system.md` |
| 设计令牌 | `src/v2/lib/design-tokens.ts` |

---

> **记住**: 有疑问时，不触碰红线。先查阅 `references/00-core-redlines.md`
