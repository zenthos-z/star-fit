# Repository 层架构文档

**版本**: v2.0.0
**创建日期**: 2026-02-24
**最后更新**: 2026-02-26
**状态**: 生产就绪

---

## 概述

Repository 层是 Starfit 系统中应用层与数据库层之间的**唯一数据访问边界**，负责：

1. **JSONB 处理**: 解析和序列化 JSONB 字段
2. **数据验证**: 使用 Zod Schema 验证数据完整性
3. **统一命名**: 确保数据在数据库层和应用层使用统一的 snake_case 格式
4. **向后兼容**: 处理 SQLite 迁移遗留的字符串 JSON 格式

**命名规范设计决策**:
- **统一使用 snake_case**: 数据库层、Repository 层、应用层保持一致
- **简化数据流**: 无需字段名转换，减少映射错误
- **PostgreSQL 习惯**: 与 JSONB 字段自然对齐
- **实践验证**: 162+ 处代码使用 snake_case，证明设计稳定

---

## 架构设计

### 分层架构

```
┌─────────────────────────────────────────────────────────────┐
│                    应用层 (Application Layer)                 │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  - 前端 UI (React Components)                          │  │
│  │  - API 层 (Express Controllers)                         │  │
│  │  - Agent 服务 (Deep Agents + Skill 路由)                │  │
│  └───────────────────────────────────────────────────────┘  │
│                         │ snake_case                          │
│                         ▼                                    │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              Repository 层 (数据访问边界)                │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │  BaseRepository                                  │  │  │
│  │  │    - parseJSONB(): JSONB 解析与验证              │  │  │
│  │  │    - stringifyJSONB(): 数据序列化                 │  │  │
│  │  │    - queryOne/Many/query: 统一查询接口           │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │  UserRepository                                  │  │  │
│  │  │    - getProfileStatic() → ProfileStatic         │  │  │
│  │  │    - updateProfileStatic(data: ProfileStatic)   │  │  │
│  │  │    - getProfileDynamic() → ProfileDynamic       │  │  │
│  │  │    - updateProfileDynamic(data: ProfileDynamic) │  │  │
│  │  │    - 自动处理 JSONB 和验证                      │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │  ExerciseRepository                              │  │  │
│  │  │    - findByFilters() → ExerciseInfo[]           │  │  │
│  │  │    - getById() → ExerciseInfo                   │  │  │
│  │  │    - vectorSearch() → VectorSearchResult[]      │  │  │
│  │  │    - 向量搜索 + 规则过滤                          │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
│                         │ snake_case                          │
│                         ▼                                    │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              数据库层 (PostgreSQL)                      │  │
│  │  - users: { profile_static, profile_dynamic, ... }     │  │
│  │  - exercises: { exercise_type, targets, ... }          │  │
│  │  - sessions: { exercises, metadata, ... }              │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 目录结构

```
backend/src/db/postgresql/repository/
├── base.repository.ts          # Repository 基类
├── user.repository.ts           # 用户数据访问
└── exercise.repository.ts       # 动作库数据访问

shared/contracts/
├── database/                    # 数据库 Schema (snake_case)
│   ├── index.ts
│   ├── user-profile.schema.ts
│   ├── exercise.schema.ts
│   └── session.schema.ts
│
├── index.js                     # 统一导出 (snake_case)
│   ├── ProfileStaticSchema
│   ├── ProfileDynamicSchema
│   ├── ExerciseSchema
│   └── SessionSchema
│
└── mapping/                     # 类型映射 (仅类型断言)
    ├── index.ts
    ├── user-profile.mapper.ts
    ├── exercise.mapper.ts
    └── session.mapper.ts
```

**说明**:
- `database/` 目录包含数据库 Schema 定义
- `index.js` 统一导出所有类型，使用 snake_case 格式
- `mapping/` 目录包含类型映射函数，当前仅做类型断言（无字段名转换）

---

## BaseRepository

### 核心方法

```typescript
// backend/src/db/postgresql/repository/base.repository.ts

export abstract class BaseRepository {
  constructor(protected client: PostgresClient) {}

  /**
   * 解析 JSONB 数据
   *
   * PostgreSQL pg 驱动会自动将 JSONB 反序列化为 JavaScript 对象
   * 此方法处理以下情况：
   * 1. PostgreSQL JSONB 自动反序列化的对象
   * 2. SQLite 迁移遗留的 JSON 字符串
   * 3. null 或空值
   */
  protected parseJSONB<T>(
    data: unknown,
    schema: z.ZodType<T>
  ): T {
    // PostgreSQL JSONB 返回已解析的对象
    if (typeof data === 'object' && data !== null) {
      return schema.parse(data);
    }

    // SQLite 或字符串输入需要解析
    if (typeof data === 'string' && data.length > 0) {
      const parsed = JSON.parse(data);
      return schema.parse(parsed);
    }

    // null 或空字符串
    if (data === null || data === '') {
      return schema.parse(null);
    }

    throw new ServiceError(
      ServiceErrorCode.VALIDATION_ERROR,
      `Failed to parse JSONB data: unexpected type ${typeof data}`
    );
  }

  /**
   * 将数据序列化为 JSONB 字符串
   */
  protected stringifyJSONB(data: unknown): string {
    try {
      return JSON.stringify(data);
    } catch (error) {
      throw new ServiceError(
        ServiceErrorCode.VALIDATION_ERROR,
        `Failed to stringify data for JSONB: ${error}`
      );
    }
  }

  /**
   * 查询单行数据
   */
  protected async queryOne<T extends QueryResultRow = any>(
    sql: string,
    params: Record<string, unknown> = {}
  ): Promise<T | null> {
    const result = await this.client.query<T>(sql, params);
    return result.rows[0] || null;
  }

  /**
   * 查询多行数据
   */
  protected async queryMany<T extends QueryResultRow = any>(
    sql: string,
    params: Record<string, unknown> = {}
  ): Promise<T[]> {
    const result = await this.client.query<T>(sql, params);
    return result.rows;
  }

  /**
   * 执行影响数据的查询
   */
  protected async execute(
    sql: string,
    params: Record<string, unknown> = {}
  ): Promise<number> {
    const result = await this.client.query(sql, params);
    return result.rowCount ?? 0;
  }
}
```

---

## UserRepository

### 接口定义

```typescript
// backend/src/db/postgresql/repository/user.repository.ts

export class UserRepository extends BaseRepository {
  /**
   * 获取用户静态画像
   *
   * @param userId - 用户 ID (UUID)
   * @returns 用户静态画像 (camelCase 格式)
   */
  async getProfileStatic(userId: string): Promise<ProfileStatic | null>;

  /**
   * 更新用户静态画像
   *
   * @param userId - 用户 ID (UUID)
   * @param data - 画像数据 (camelCase 格式)
   */
  async updateProfileStatic(userId: string, data: ProfileStatic): Promise<void>;

  /**
   * 获取用户动态画像
   *
   * @param userId - 用户 ID (UUID)
   * @returns 用户动态画像 (camelCase 格式)
   */
  async getProfileDynamic(userId: string): Promise<ProfileDynamic | null>;

  /**
   * 更新用户动态画像
   *
   * @param userId - 用户 ID (UUID)
   * @param data - 画像数据 (camelCase 格式)
   */
  async updateProfileDynamic(
    userId: string,
    data: Partial<ProfileDynamic>
  ): Promise<void>;

  /**
   * 通过用户名获取用户 ID
   *
   * @param username - 用户名
   * @returns 用户 ID (UUID)，不存在返回 null
   */
  async getIdByUsername(username: string): Promise<string | null>;

  /**
   * 通过用户 ID 获取用户名
   *
   * @param userId - 用户 ID (UUID)
   * @returns 用户名，不存在返回 null
   */
  async getUsernameById(userId: string): Promise<string | null>;

  /**
   * 解析用户引用（ID 或用户名）
   *
   * @param userRef - 用户 ID (UUID) 或用户名
   * @returns 用户 ID (UUID)
   * @throws {ServiceError} 用户不存在
   */
  async resolveUserId(userRef: string): Promise<string>;
}
```

### 实现示例

```typescript
// 获取用户静态画像
async getProfileStatic(userId: string): Promise<ProfileStatic | null> {
  const sql = `
    SELECT profile_static
    FROM users
    WHERE id = $userId
  `;

  const row = await this.queryOne<{ profile_static: unknown }>(sql, { userId });

  if (!row) {
    return null;
  }

  // 解析 JSONB 并使用数据库 Schema 验证
  const dbData = this.parseJSONB(
    row.profile_static,
    ProfileStaticDatabaseSchema  // snake_case
  );

  // 转换为 API 格式 (camelCase)
  return toApiFormat(dbData);
}

// 更新用户静态画像
async updateProfileStatic(userId: string, data: ProfileStatic): Promise<void> {
  // 转换为数据库格式 (snake_case)
  const dbData = toDatabaseFormat(data);

  const sql = `
    UPDATE users
    SET
      profile_static = $profileStatic::jsonb,
      updated_at = NOW()
    WHERE id = $userId
  `;

  const affectedRows = await this.execute(sql, {
    userId,
    profileStatic: this.stringifyJSONB(dbData),
  });

  if (affectedRows === 0) {
    throw new ServiceError(
      ServiceErrorCode.NOT_FOUND,
      `User not found: ${userId}`
    );
  }
}
```

---

## 字段映射

### 映射规则

```typescript
// camelCase → snake_case
basicInfo      → basic_info
fitnessLevel   → fitness_level
redFlags       → red_flags
loadAnchors    → load_anchors
riskPreference → risk_preference
permanentInjuries → permanent_injuries
```

### 映射函数

```typescript
// shared/contracts/mapping/user-profile.mapper.ts

export function toDatabaseFormat(
  data: ProfileStatic
): ProfileStaticDatabase {
  return {
    basic_info: data.basicInfo,
    fitness_level: data.fitnessLevel,
    red_flags: data.redFlags,
    risk_preference: data.riskPreference,
    load_anchors: data.loadAnchors,
    permanent_injuries: data.permanentInjuries,
  };
}

export function toApiFormat(
  data: ProfileStaticDatabase
): ProfileStatic {
  return {
    basicInfo: data.basic_info,
    fitnessLevel: data.fitness_level,
    redFlags: data.red_flags,
    riskPreference: data.risk_preference,
    loadAnchors: data.load_anchors,
    permanentInjuries: data.permanent_injuries,
  };
}
```

---

## 使用指南

### 在 Agent 服务中使用

```typescript
// backend/src/services/mas/services/ProfileService.ts

import { UserRepository } from '@/db/postgresql/repository/user.repository';
import type { ProfileStatic } from 'shared/contracts';

export class ProfileService {
  private userRepo: UserRepository;

  constructor(postgresClient: PostgresClient) {
    this.userRepo = new UserRepository(postgresClient);
  }

  async getUserProfile(userId: string): Promise<ProfileStatic | null> {
    return this.userRepo.getProfileStatic(userId);
  }

  async updateUserProfile(
    userId: string,
    data: ProfileStatic
  ): Promise<void> {
    await this.userRepo.updateProfileStatic(userId, data);
  }
}
```

### 在 Agent 工具中使用

```typescript
// backend/src/services/mas/tools/memoryTools.ts

import { UserRepository } from '@/db/postgresql/repository/user.repository';

export const loadUserInsightTool = {
  description: '加载用户画像数据',

  async execute(params: { userId: string }) {
    const userRepo = new UserRepository(getPostgresClient());

    // 返回 camelCase 格式数据
    const profile = await userRepo.getProfileStatic(params.userId);

    return {
      profile,
      timestamp: new Date().toISOString(),
    };
  },
};
```

---

## 核心原则

1. **单一转换点**: 所有命名格式转换集中在 Repository 层
2. **应用层透明**: 应用层代码始终使用 camelCase，无需关心数据库格式
3. **数据库原生**: 数据库始终使用 snake_case，遵循 PostgreSQL 约定
4. **类型安全**: 通过 Zod Schema 分别验证数据库格式和 API 格式
5. **向后兼容**: Repository 层处理 SQLite 迁移遗留的字符串 JSON 格式

---

## 迁移指南

### 从直接 SQL 查询迁移到 Repository

#### 修改前

```typescript
// ❌ 旧代码：直接查询，手动转换
const result = await db.query(
  'SELECT profile_static FROM users WHERE id = $1',
  [userId]
);

const profileRaw = JSON.parse(result.rows[0].profile_static);

// 手动转换字段名
const profile = {
  basicInfo: profileRaw.basic_info,
  fitnessLevel: profileRaw.fitness_level,
  redFlags: profileRaw.red_flags,
};
```

#### 修改后

```typescript
// ✅ 新代码：通过 Repository
import { UserRepository } from '@/db/postgresql/repository/user.repository';

const userRepo = new UserRepository(db);

// 自动转换，返回 camelCase
const profile = await userRepo.getProfileStatic(userId);
// profile: { basicInfo, fitnessLevel, redFlags, ... }
```

---

## 常见问题

### Q1: 为什么需要 Repository 层？

**A**: TypeScript 和 PostgreSQL 有不同的命名约定：
- TypeScript: camelCase (basicInfo, fitnessLevel)
- PostgreSQL: snake_case (basic_info, fitness_level)

如果不统一管理，会导致：
1. 转换代码分散在各个服务中
2. 容易出现字段名不一致
3. 难以维护和扩展

### Q2: Repository 层会影响性能吗？

**A**: 影响极小：
- 字段重命名只是对象属性的读写操作
- 不涉及网络或 I/O 操作
- 相比数据库查询本身，开销可以忽略

### Q3: 如何处理嵌套对象的转换？

**A**: 映射函数会递归处理嵌套对象：

```typescript
export function toApiFormat(
  data: ProfileStaticDatabase
): ProfileStatic {
  return {
    basicInfo: data.basic_info ? {
      age: data.basic_info.age,
      weight: data.basic_info.weight,
      // ... 其他字段
    } : undefined,
    // ... 其他字段
  };
}
```

---

**文档版本**: v1.0.0
**最后更新**: 2026-02-24
**维护者**: Starfit Development Team
