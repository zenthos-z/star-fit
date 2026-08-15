# 数据库 Schema 规范

**Core-Flex 数据架构 (PostgreSQL + Repository Layer)**

---

## Repository 层集成

> **重要**: 所有数据访问必须通过 Repository 层进行
> **详见**: [Repository 层架构文档](../../../../../../docs-site/database/repository-layer.md)

### Repository 层职责
- **JSONB 处理**: PostgreSQL `pg` 驱动自动将 JSONB 反序列化为 JavaScript 对象
- **数据验证**: 使用 Zod Schema 验证 JSONB 数据完整性
- **统一命名**: 确保数据在数据库层和应用层使用统一的 snake_case 格式
- **向后兼容**: 处理 SQLite 迁移遗留的字符串 JSON 格式

### 访问模式
```typescript
// ❌ 错误：直接访问数据库
const data = await db.query('SELECT profile_dynamic FROM users WHERE id = $1', [userId]);
const profile = JSON.parse(data.profile_dynamic);  // 手动解析

// ✅ 正确：通过 Repository 层
const userRepo = new UserRepository(postgresClient);
const profile = await userRepo.getProfileDynamic(userId);
// profile 已经是 JavaScript 对象，使用 snake_case 格式
```

---

## Core 层：关系型列

用于 JOIN、WHERE、索引查询的结构化字段：

| 字段类型 | 说明 | 示例 |
|----------|------|------|
| 主键 | UUID | `id: uuid PRIMARY KEY` |
| 外键 | 关联关系 | `user_id: uuid REFERENCES users(id)` |
| 时间戳 | UTC 时间 | `created_at: timestamptz` |
| 过期时间 | 自动过期 | `expire_at: timestamptz` |
| 版本号 | 乐观锁 | `version: integer DEFAULT 1` |
| 协议版本 | 兼容性 | `protocol_version: text DEFAULT '2.0.0'` |

---

## Flex 层：JSONB 容器

用于灵活数据、压缩历史、AI 输入：

| 字段 | 内容 | 更新频率 | 格式处理 |
|------|------|----------|----------|
| `profile_static` | 生物学/心理学长期特征 | 半年/年 | Repository 自动解析 |
| `profile_dynamic` | 负荷锚点、伤病限制、恢复状态 | 每次训练后 | Repository 自动解析 |
| `history_summary` | 压缩的历史趋势和摘要 | 每周 | Repository 自动解析 |

### JSONB 自动反序列化
```typescript
// PostgreSQL JSONB 字段由 pg 驱动自动处理
const dbRecord = await db.query('SELECT profile_dynamic FROM users WHERE id = $1', [userId]);
console.log(typeof dbRecord.profile_dynamic);  // "object" (自动反序列化)

// Repository 层进一步验证格式
const validated = ProfileDynamicSchema.parse(dbRecord.profile_dynamic);
```

---

## 操作许可矩阵

| 操作 | 状态 | 说明 |
|------|------|------|
| **删除字段** | ❌ 禁止 | 历史数据无法读取 |
| **修改字段类型** | ❌ 禁止 | 数据不一致、应用崩溃 |
| **新增字段** | ✅ 允许 | 向后兼容 |
| **新增索引** | ✅ 允许 | 性能优化 |
| **字段重命名** | ⚠️ 需迁移 | 旧字段 → 新字段（保留兼容） |

---

## 特殊字段说明

### active_limitations (伤病限制)

**必须包含**:
- `type`: 限制类型（injury/recovery/other）
- `body_part`: 受影响部位
- `expire_at`: 过期时间（**红线 NA-004**）
- `created_at`: 创建时间

```typescript
// ✅ 正确
await db.user_insights.update({
  active_limitations: [{
    type: 'injury',
    body_part: 'knee',
    expire_at: '2026-03-01T00:00:00Z',  // ✅ 必须有
    created_at: await getCurrentTime()
  }]
});
```

### training_strategy (用户训练策略)

- **类型**: TEXT（灵活文本，类似 AI 系统提示词）
- **用途**: 用户自定义训练规则
- **存储**: 直接存储文本，不需要 JSON 解析
- **前端读取**: 直接使用字符串，不需要 try-catch JSON.parse
- **Repository 处理**: 直接返回字符串，无需特殊处理

**与其他 JSONB 字段的区别**:

```typescript
// Repository 层处理差异

// load_anchors: JSONB → Repository 自动解析为对象
const profile = await userRepo.getProfileDynamic(userId);
console.log(profile.loadAnchors);  // JavaScript 对象

// training_strategy: TEXT → Repository 直接返回字符串
console.log(profile.trainingStrategy);  // 字符串
```

---

## Schema 变更流程

```
1. 评估变更是否违反红线
   │
   ├─ 删除字段 → ❌ 禁止
   ├─ 修改类型 → ❌ 禁止
   └─ 新增字段 → ✅ 继续

2. 设计向后兼容的迁移方案

3. 创建 migration 文件

4. 在测试环境验证

5. 执行迁移

6. 更新相关文档
```

---

**完整规范**:
- `docs-site\database\postgresql-schema.md`
- `docs-site\database\repository-layer.md`
- `docs-site\architecture\mas-data-contract.md`

**版本**: v2.1.0 (PostgreSQL + Repository Layer)
