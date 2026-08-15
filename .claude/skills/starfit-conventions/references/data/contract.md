# 数据契约核心规范

**核心原则**: 数据契约不变，处理逻辑可演进

---

## 协议版本

所有数据契约必须包含 `protocol_version: '2.0.0'`

---

## Repository 层架构

> **重要**: 所有数据访问必须通过 Repository 层进行，详见 [Repository 层架构文档](../../../../../../docs-site/database/repository-layer.md)

### Repository 层职责
- **JSONB 处理**: 自动反序列化和序列化 JSONB 字段
- **数据验证**: 使用 Zod Schema 验证数据完整性
- **统一命名**: 确保数据在数据库层和应用层使用统一的 snake_case 格式
- **向后兼容**: 处理 SQLite 迁移遗留的字符串 JSON 格式

### 数据访问模式
```typescript
// ❌ 错误：直接访问数据库
const data = await db.query('SELECT * FROM users WHERE id = $1', [userId]);

// ✅ 正确：通过 Repository 层
const userRepo = new UserRepository(postgresClient);
const profile = await userRepo.getProfileDynamic(userId);
// profile 数据已经是 snake_case 格式，JSONB 已自动解析
```

---

## Core-Flex 数据架构 (PostgreSQL)

### Core 层（关系型列）
- 用途：JOIN、WHERE、索引查询
- 示例：`id`, `user_id`, `created_at`, `expire_at`

### Flex 层（JSONB 容器）
- 用途：灵活数据、压缩历史、AI 输入
- 示例：`profile_static`, `profile_dynamic`, `history_summary`
- **处理**: PostgreSQL `pg` 驱动自动将 JSONB 反序列化为 JavaScript 对象

```typescript
// Core 层：关系型列
user_id: uuid,
created_at: timestamptz,
expire_at: timestamptz,

// Flex 层：JSONB 容器
profile_static: jsonb,   // 生物学/心理学特征
profile_dynamic: jsonb,  // 负荷锚点/伤病限制
history_summary: jsonb   // 压缩历史
```

### 命名规范
**设计决策**: 统一使用 snake_case 格式（数据库层、Repository 层、应用层）

```typescript
// 统一命名示例（snake_case）
fitness_level: 'beginner',
red_flags: ['knee_issue'],
load_anchors: { bench_press: { last_weight: 80 } },
active_limitations: [{ type: 'injury', body_part: 'knee' }]
```

**优势**:
- 简化数据流，无需字段名转换
- 与 PostgreSQL JSONB 自然对齐
- 降低 mapper 维护成本
- 实践验证（162+ 处代码使用）

---

## 三态数据契约（概念性）

### 静态态 (ProfileStatic)
- **内容**: 生物学和心理学长期特征
- **更新频率**: 半年/年
- **示例**: 年龄、身高、基础代谢率、训练经验

### 动态态 (ProfileDynamic)
- **内容**: 负荷锚点、伤病限制、恢复状态
- **更新频率**: 每次训练后
- **示例**: `load_anchors`, `active_limitations`

### 摘要态 (HistorySummary)
- **内容**: 压缩的历史趋势和摘要
- **更新频率**: 每周
- **示例**: 过去 4 周平均训练量、伤病历史摘要

---

## 验证要求

### Repository 层自动验证
```typescript
// ✅ Repository 层自动处理验证
const userRepo = new UserRepository(postgresClient);
const profile = await userRepo.getProfileDynamic(userId);
// JSONB 自动解析，Zod Schema 自动验证
```

### 使用 parseJSONSafe() (仅限遗留代码)
```typescript
// ❌ 违规：裸 JSON.parse
const data = JSON.parse(dbRecord.json_field);

// ✅ 正确：parseJSONSafe (遗留代码兼容)
const data = parseJSONSafe(dbRecord.json_field, defaultValue);
```

### 验证失败必须处理
```typescript
// ❌ 违规：静默降级掩盖错误
try {
  validate(data)
} catch {
  return {};  // ❌ 掩盖错误
}

// ✅ 正确：记录日志或抛出错误
validateWithLogging(data, 'ProfileDynamic');
// 或
validateOrThrow(data, ProfileDynamicSchema);
```

---

## 时间格式规范

所有时间戳必须使用 **ISO 8601 UTC** 格式：

```typescript
// ❌ 禁止
const timestamp = Date.now();
const time = "2026-02-09 10:00:00";

// ✅ 必须使用 ISO 8601 UTC
const timestamp = "2026-02-09T10:00:00Z";
```

**获取当前时间**: 必须调用 MCP time 工具，禁止自行生成。

---

## 枚举定义规范

### 命名格式
- **枚举值**: 必须使用 **snake_case** 格式
- **防御性值**: 必须包含 `unknown` 作为第一个值

```typescript
// ❌ 错误：SCREAMING_CASE
enum FitnessLevel {
  BEGINNER = 'BEGINNER',
  INTERMEDIATE = 'INTERMEDIATE'
}

// ✅ 正确：snake_case + unknown
enum FitnessLevel {
  unknown = 'unknown',      // 防御性值
  beginner = 'beginner',
  intermediate = 'intermediate',
  advanced = 'advanced'
}
```

### 数据库枚举约束
```sql
-- PostgreSQL CHECK 约束
ALTER TABLE users
ADD CONSTRAINT chk_fitness_level
CHECK (fitness_level IN ('unknown', 'beginner', 'intermediate', 'advanced'));
```

---

## API 接口规范

### Backend API
```typescript
// ✅ 正确：返回 Zod 验证的数据
app.get('/api/users/:uid', async (req, res) => {
  const user = await db.getUser(req.params.uid);
  const validated = UserProfileSchema.parse(user);
  res.json(validated);
});
```

### WebSocket 消息 (CloudEvents 格式)
```typescript
// ✅ 正确
{
  "specversion": "1.0",
  "type": "fit.workout.set_completed",
  "source": "/agent/responder/01",
  "id": "evt_abc123",
  "time": "2026-02-09T10:00:00Z",
  "data": { "exerciseId": "squat_001", "set": { "reps": 10, "weight": 80 } }
}
```

---

**完整规范**:
- `docs-site\database\postgresql-schema.md`
- `docs-site\database\repository-layer.md`
- `docs-site\architecture\mas-data-contract.md`

**版本**: v2.1.0 (PostgreSQL + Repository Layer)
