---
name: "data-contract-check"
description: "在修改数据相关内容前检查是否符合 MAS 数据契约规范，防止破坏稳定的数据基石。"
---

# 数据契约检查 (Data Contract Check)

## 适用场景

- 修改数据库 schema（`backend/src/db/postgresql/schema/*.sql`）
- 修改数据契约（`shared/contracts/index.ts`）
- 修改 Zod Schema 定义
- 修改枚举定义
- 修改 API 数据类型
- 修改时间戳处理
- 修改 Batch Ops 协议
- 修改 JSONB 字段存储方式
- 修改 Repository 层代码

## 核心原则

> **数据契约不变，处理逻辑可演进**
> 节点可以优化、合并，但数据格式、存储结构、协议标准必须保持稳定。

## 检查清单

在修改数据相关内容前，必须确认以下各项：

### 1. 数据库 Schema 红线

- [ ] ❌ 禁止删除现有字段
- [ ] ❌ 禁止修改字段数据类型（如 TEXT → INTEGER）
- [ ] ✅ 允许新增字段（向后兼容）
- [ ] ✅ 允许新增索引

### 2. 数据协议红线

- [ ] ✅ 时间必须使用 ISO 8601 UTC 格式（如 `2026-02-24T10:00:00Z`）
- [ ] ✅ 所有枚举值必须使用 snake_case 格式（如 `beginner`, `plan_card`, `draft`）
- [ ] ✅ 所有枚举必须包含 `unknown` 作为防御性值
- [ ] ✅ 数据库中的 JSON 字段必须存储为 JSONB 类型
- [ ] ✅ 前端读取 JSON 字段通过 Repository 层（自动反序列化）
- [ ] ✅ 所有数据访问必须通过 Repository 层，禁止直连数据库

### 3. 存储分层红线

- [ ] ❌ 禁止前端直连 L3 (PostgreSQL)
- [ ] ❌ 禁止绕过 Repository 层访问数据库
- [ ] ✅ 所有 L3 访问必须通过 Repository 层（格式转换边界）
- [ ] ✅ Repository 层负责 camelCase ↔ snake_case 转换
- [ ] ✅ Repository 层负责 JSONB 自动解析和序列化

### 4. 版本管理红线

- [ ] ✅ 所有可变数据必须携带版本号
- [ ] ✅ Batch Ops 必须携带 `preconditions.version`

## 检查流程

### 步骤 1: 读取契约文档

首先阅读完整的数据契约规范：
```
docs-site/database/postgresql-schema.md
docs-site/database/repository-layer.md
docs-site/architecture/mas-data-contract.md
```

### 步骤 2: 判断修改类型

确认你的修改属于以下哪类：
- [ ] Schema 修改（字段增删改）
- [ ] 协议修改（数据格式变更）
- [ ] 处理逻辑修改（代码重构，不影响数据）

### 步骤 3: 评估影响

如果是 Schema 或协议修改，回答：
1. 是否删除了现有字段？→ ❌ 禁止
2. 是否修改了字段类型？→ ❌ 禁止
3. 是否新增字段？→ ✅ 允许，确保向后兼容
4. 是否影响历史数据？→ 需要迁移方案

### 步骤 4: 执行修改

- 如果是处理逻辑修改 → ✅ 直接执行
- 如果是 Schema/协议修改 → 确认符合红线后执行

## 常见违规示例

### ❌ 违规示例

```typescript
// 违规 1: 删除字段
ALTER TABLE sessions DROP COLUMN raw_json;

// 违规 2: 修改字段类型
ALTER TABLE users ALTER COLUMN id TYPE INTEGER;

// 违规 3: 枚举使用 SCREAMING_CASE
enum FitnessLevel {
  BEGINNER = 'BEGINNER',  // ❌ 错误格式
  INTERMEDIATE = 'INTERMEDIATE'
}

// 违规 4: 绕过 Repository 层直接访问数据库
const userProfile = await db.query('SELECT * FROM users WHERE id = $1', [userId]);

// 违规 5: 推断时间
const now = new Date().toISOString();

// 违规 6: 直接修改 DB
await db.workout.update({ id, weight: 80 });

// 违规 7: JSON 字段使用 TEXT 而非 JSONB
profile_json TEXT  // ❌ 错误
```

### ✅ 正确示例

```typescript
// 正确 1: 新增字段
ALTER TABLE user_insights ADD COLUMN hr_baseline JSONB;

// 正确 2: 枚举使用 snake_case + 包含 unknown
enum FitnessLevel {
  unknown = 'unknown',    // ✅ 防御性值
  beginner = 'beginner',   // ✅ snake_case
  intermediate = 'intermediate'
}

// 正确 3: 通过 Repository 层访问
const userRepo = new UserRepository(postgresClient);
const profile = await userRepo.getProfileDynamic(userId);

// 正确 4: 使用 MCP time 工具获取当前时间
const now = await mcp__time__current_time();

// 正确 5: Batch Ops
await applyBatchOps({
  ops: [{ op: "replace", path: "/workout/sets/1/weight", value: 80 }],
  preconditions: { version: 42 }
});

// 正确 6: JSONB 字段定义
profile_dynamic JSONB NOT NULL DEFAULT '{}'  // ✅ PostgreSQL JSONB
```

## 输出要求

检查完成后，输出：
1. 修改类型判断（Schema/协议/逻辑）
2. 是否触碰红线的结论
3. 如果违规，说明违规点和建议的修复方案
4. 如果合规，确认可以继续

## 示例交互

**用户**: "我想给 user_insights 表新增一个 hr_baseline 字段"

**Assistant**:
```
【数据契约检查】

✅ 修改类型：Schema 修改（新增字段）

📋 检查结果：
- ✅ 不是删除字段
- ✅ 不是修改字段类型
- ✅ 是新增字段（向后兼容）

📄 参考规范：
根据 postgresql-schema.md 和 repository-layer.md：
"✅ 允许新增字段（向后兼容）"
"Repository 层处理 camelCase ↔ snake_case 转换"

✅ 结论：符合规范，可以继续执行

💡 建议：
- 字段类型使用 JSONB（如果需要存储 JSON）
- Repository 层自动处理格式转换
- 更新 shared/contracts 中的类型定义
```

---

**参考文档**:
- `docs-site/database/postgresql-schema.md`
- `docs-site/database/repository-layer.md`
- `docs-site/architecture/mas-data-contract.md`

**版本**: v2.1.0 (PostgreSQL + Repository Layer)
