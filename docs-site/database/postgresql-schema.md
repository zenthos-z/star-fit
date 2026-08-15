# PostgreSQL Schema Documentation

**版本**: v2.1.0
**创建日期**: 2026-02-09
**最后更新**: 2026-02-24
**状态**: Core-Flex Architecture + Repository Layer

---

## 概述

本文档描述 Starfit 系统的 PostgreSQL 数据库架构，采用 **Core-Flex 数据架构** 设计，并通过 **Repository 层**实现应用层与数据库层之间的数据格式转换。

### Core-Flex 架构原则

```
┌─────────────────────────────────────────────────────────────┐
│                    Core-Flex 数据架构                        │
├─────────────────────────────────────────────────────────────┤
│  Core Layer (关系型列):                                      │
│  - ID、外键、索引字段                                         │
│  - 用于 JOIN 和 WHERE 查询                                    │
│  - 严格的类型约束                                            │
│                                                              │
│  Flex Layer (JSONB 容器):                                     │
│  - profile_static: 静态态 (生物学/心理学特征)                 │
│  - profile_dynamic: 动态态 (负荷锚点/伤病限制)                │
│  - history_summary: 摘要态 (压缩历史)                         │
│  - 灵活的结构，支持演进                                       │
└─────────────────────────────────────────────────────────────┘
```

---

## Repository 层架构

### 架构分层

```
┌─────────────────────────────────────────────────────────────┐
│                    应用层 (Application Layer)                 │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  - 前端 UI (React)                                     │  │
│  │  - API 层 (Express Controllers)                         │  │
│  │  - Agent 服务 (Deep Agents + Skill 路由)                │  │
│  └───────────────────────────────────────────────────────┘  │
│                         │ camelCase                          │
│                         ▼                                    │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              Repository 层 (转换边界)                    │  │
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
│  │  │    - 自动调用 toApiFormat/toDatabaseFormat      │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │  ExerciseRepository                              │  │  │
│  │  │    - findByFilters() → ExerciseInfo[]           │  │  │
│  │  │    - vectorSearch() → VectorSearchResult[]      │  │  │
│  │  │    - 向量搜索 + 规则过滤                          │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
│                         │ snake_case                          │
│                         ▼                                    │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              数据库层 (PostgreSQL)                      │  │
│  │  - profile_static: { basic_info, fitness_level, ... }  │  │
│  │  - profile_dynamic: { load_anchors, ... }             │  │
│  │  - history_summary: { last_pattern, trends, ... }     │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 契约目录结构

```
shared/contracts/
├── database/                    # 数据库 Schema (snake_case)
│   ├── index.ts                # 统一导出
│   ├── user-profile.schema.ts  # ProfileStaticDatabase, ProfileDynamicDatabase
│   ├── exercise.schema.ts      # ExerciseInfoDatabase
│   └── session.schema.ts       # WorkoutSessionDatabase
│
├── api/                         # API 契约 (camelCase)
│   ├── index.ts                # 统一导出
│   ├── user-profile.ts         # ProfileStatic, ProfileDynamic
│   ├── exercise.ts             # ExerciseInfo
│   └── session.ts              # WorkoutSession
│
├── mapping/                     # 字段映射函数
│   ├── index.ts                # 统一导出
│   ├── user-profile.mapper.ts  # toDatabaseFormat, toApiFormat
│   ├── exercise.mapper.ts      # Exercise 映射
│   └── session.mapper.ts       # Session 映射
│
└── identifiers/                 # 标识符规范
    └── user-id.ts              # UUID vs username 规范
```

### 字段映射约定

#### 命名转换规则

```typescript
// camelCase → snake_case
basic_info     // basicInfo
fitness_level  // fitnessLevel
red_flags      // redFlags
load_anchors   // loadAnchors
risk_preference // riskPreference
```

#### 映射函数示例

```typescript
// shared/contracts/mapping/user-profile.mapper.ts

export function toDatabaseFormat(data: ProfileStatic): ProfileStaticDatabase {
  return {
    basic_info: data.basicInfo,
    fitness_level: data.fitnessLevel,
    red_flags: data.redFlags,
    risk_preference: data.riskPreference,
    load_anchors: data.loadAnchors,
    permanent_injuries: data.permanentInjuries,
  };
}

export function toApiFormat(data: ProfileStaticDatabase): ProfileStatic {
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

### Repository 实现

#### BaseRepository

```typescript
// backend/src/db/postgresql/repository/base.repository.ts

export abstract class BaseRepository {
  constructor(protected client: PostgresClient) {}

  /**
   * 解析 JSONB 数据（支持 PostgreSQL 自动反序列化）
   */
  protected parseJSONB<T>(data: unknown, schema: z.ZodType<T>): T {
    // PostgreSQL JSONB 返回已解析的对象
    if (typeof data === 'object' && data !== null) {
      return schema.parse(data);
    }
    // 兼容字符串格式（SQLite 迁移遗留）
    if (typeof data === 'string' && data.length > 0) {
      return schema.parse(JSON.parse(data));
    }
    return schema.parse(null);
  }

  /**
   * 将数据序列化为 JSONB 字符串
   */
  protected stringifyJSONB(data: unknown): string {
    return JSON.stringify(data);
  }

  protected async queryOne<T>(sql: string, params: Record<string, unknown>): Promise<T | null>;
  protected async queryMany<T>(sql: string, params: Record<string, unknown>): Promise<T[]>;
  protected async execute(sql: string, params: Record<string, unknown>): Promise<number>;
}
```

#### UserRepository

```typescript
// backend/src/db/postgresql/repository/user.repository.ts

export class UserRepository extends BaseRepository {
  /**
   * 获取用户静态画像（返回 API 格式 camelCase）
   */
  async getProfileStatic(userId: string): Promise<ProfileStatic | null> {
    const sql = `SELECT profile_static FROM users WHERE id = $userId`;
    const row = await this.queryOne<{ profile_static: unknown }>(sql, { userId });

    if (!row) return null;

    // 使用数据库 Schema 验证（snake_case）
    const dbData = this.parseJSONB(row.profile_static, ProfileStaticDatabaseSchema);

    // 转换为 API 格式（camelCase）
    return toApiFormat(dbData);
  }

  /**
   * 更新用户静态画像（接受 API 格式 camelCase）
   */
  async updateProfileStatic(userId: string, data: ProfileStatic): Promise<void> {
    // 转换为数据库格式（snake_case）
    const dbData = toDatabaseFormat(data);

    const sql = `
      UPDATE users
      SET profile_static = $profileStatic::jsonb,
          updated_at = NOW()
      WHERE id = $userId
    `;

    await this.execute(sql, {
      userId,
      profileStatic: this.stringifyJSONB(dbData),
    });
  }

  // ... 其他方法
}
```

### 核心原则

1. **单一转换点**: 所有命名格式转换集中在 Repository 层
2. **应用层透明**: 应用层代码始终使用 camelCase，无需关心数据库格式
3. **数据库原生**: 数据库始终使用 snake_case，遵循 PostgreSQL 约定
4. **类型安全**: 通过 Zod Schema 分别验证数据库格式和 API 格式
5. **向后兼容**: Repository 层处理 SQLite 迁移遗留的字符串 JSON 格式

---

## 核心表结构

### user_profiles_v2 (用户画像 - 三态模型)

**协议版本**: 2.0.0

#### SQL 定义

```sql
CREATE TABLE user_profiles_v2 (
  -- Core Layer: 关系型列
  user_id UUID PRIMARY KEY,
  protocol_version VARCHAR(10) DEFAULT '2.0.0' NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  -- Flex Layer: JSONB 容器
  profile_static JSONB DEFAULT '{}',
  profile_dynamic JSONB DEFAULT '{}',
  history_summary JSONB DEFAULT '{}',

  -- Legacy 兼容字段 (用于渐进迁移)
  tags TEXT[] DEFAULT '{}',
  fitness_level VARCHAR(20) DEFAULT 'UNKNOWN',
  red_flags TEXT[] DEFAULT '{}',
  training_strategy TEXT,

  -- 索引
  CONSTRAINT chk_protocol_version CHECK (protocol_version = '2.0.0'),
  CONSTRAINT chk_fitness_level CHECK (fitness_level IN (
    'UNKNOWN', 'beginner', 'intermediate', 'advanced'
  ))
);

-- 性能索引
CREATE INDEX idx_user_profiles_updated_at ON user_profiles_v2(updated_at DESC);
CREATE INDEX idx_user_profiles_fitness_level ON user_profiles_v2(fitness_level);
CREATE INDEX idx_user_profiles_tags ON user_profiles_v2 USING GIN(tags);

-- JSONB 索引
CREATE INDEX idx_profile_static ON user_profiles_v2 USING GIN(profile_static);
CREATE INDEX idx_profile_dynamic ON user_profiles_v2 USING GIN(profile_dynamic);
CREATE INDEX idx_history_summary ON user_profiles_v2 USING GIN(history_summary);
```

#### Flex Layer 字段说明

##### profile_static (静态态)

**更新频率**: 6个月 - 1年

**用途**: 存储长期稳定的生物学和心理学特征

**字段结构**:
```typescript
interface ProfileStatic {
  // 生物学特征
  age?: number;
  weight?: number;        // kg
  height?: number;        // cm
  body_fat_percentage?: number;

  // 神经心理学特征
  neuro_type?: 'UNKNOWN' | 'type_1' | 'type_2a' | 'type_2b' | 'type_3';
  risk_preference?: 'UNKNOWN' | 'conservative' | 'moderate' | 'aggressive';
  accountability?: 'UNKNOWN' | 'low' | 'medium' | 'high';

  // 永久性限制
  permanent_injuries?: PermanentInjury[];
}

interface PermanentInjury {
  part: string;           // 身体部位 (e.g., "left_shoulder", "lower_back")
  note: string;           // 伤病描述
  diagnosed_at?: string;  // ISO 8601 UTC
}
```

##### profile_dynamic (动态态)

**更新频率**: 每次训练后

**用途**: 存储高频变化的状态数据

**字段结构**:
```typescript
interface ProfileDynamic {
  // 负荷锚点: 当前能力映射
  load_anchors?: LoadAnchors;

  // 短期限制: 自愈伤病窗口
  active_limitations?: ActiveLimitation[];

  // 恢复状态: 疲劳监控
  recovery_state?: RecoveryState;
}

interface LoadAnchors {
  [exerciseName: string]: LoadAnchor;
}

interface LoadAnchor {
  // 力量训练字段
  best_weight?: number;
  best_reps?: number;
  est_1rm?: number;

  // 自重训练字段
  progression_level?: number;

  // 等长收缩字段
  best_duration?: number;

  // 有氧训练字段
  best_distance?: number;
  best_pace?: number;

  // 心率字段
  max_hr?: number;
  resting_hr?: number;
  zone_2_threshold?: number;

  // 时间戳 (必需)
  last_updated: number;
}

interface ActiveLimitation {
  part: string;                    // 身体部位
  severity: number;                // 1-10 严重程度
  expire_at: string;               // ISO 8601 UTC - 自愈时间戳
  logged_at: string;               // ISO 8601 UTC - 记录时间
  auto_heal: boolean;              // 是否自动过期
}

interface RecoveryState {
  total_score: number;             // 0-100 恢复分数
  cns_fusing: boolean;             // CNS 疲劳指标
  last_assessed: string;           // ISO 8601 UTC
  acute_load?: number;
  chronic_load?: number;
}
```

##### history_summary (摘要态)

**更新频率**: 每周

**用途**: 压缩历史数据以减少 AI token 消耗

**压缩比**: ~98.6% (从 ~365,000 tokens/year 降至 ~5,200 tokens/year)

**字段结构**:
```typescript
interface HistorySummary {
  // 最后训练序列
  last_pattern?: {
    sequence: 'UNKNOWN' | 'A' | 'B' | 'C';
    date: string;                  // ISO 8601 UTC
    exercises: string[];           // 动作 ID 列表
  };

  // 趋势分析
  trends?: {
    rpe_trend: 'UNKNOWN' | 'rising' | 'stable' | 'falling';
    volume_trend: 'UNKNOWN' | 'increasing' | 'stable' | 'decreasing';
    recent_avg_rpe?: number;
    fatigue_level?: number;
  };

  // 压缩摘要 (50-100 words)
  recent_summary?: string;

  // 周数追踪
  week_number?: number;

  // 关键指标
  key_metrics?: {
    total_sessions: number;
    personal_records: number;
    injury_count: number;
  };
}
```

---

### workout_sessions (训练会话)

**协议版本**: 2.0.0

#### SQL 定义

```sql
CREATE TABLE workout_sessions (
  -- Core Layer
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_profiles_v2(user_id),
  protocol_version VARCHAR(10) DEFAULT '2.0.0' NOT NULL,
  status VARCHAR(20) DEFAULT 'DRAFT' NOT NULL,
  start_time TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  end_time TIMESTAMPTZ,
  environment VARCHAR(20) DEFAULT 'UNKNOWN',

  -- Flex Layer
  exercises JSONB DEFAULT '[]',
  metadata JSONB DEFAULT '{}',
  version INTEGER DEFAULT 1,

  -- 索引
  CONSTRAINT chk_protocol_version CHECK (protocol_version = '2.0.0'),
  CONSTRAINT chk_status CHECK (status IN (
    'UNKNOWN', 'DRAFT', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'
  )),
  CONSTRAINT chk_environment CHECK (environment IN (
    'UNKNOWN', 'INDOOR', 'OUTDOOR', 'HOME', 'GYM'
  ))
);

CREATE INDEX idx_workout_sessions_user_id ON workout_sessions(user_id);
CREATE INDEX idx_workout_sessions_start_time ON workout_sessions(start_time DESC);
CREATE INDEX idx_workout_sessions_status ON workout_sessions(status);
```

#### exercises 字段结构

```typescript
interface ExerciseAction {
  protocol_version: '2.0.0';
  id: string;                    // UUID
  exerciseId: string;            // 动作库 ID
  type: 'UNKNOWN' | 'STRENGTH' | 'CARDIO' | 'HIIT' | 'STRETCH';
  sets: ExerciseSet[];
  uiHint?: {
    cardType?: string;
    pluginId?: string;
  };
  metadata?: Record<string, any>;
}

interface ExerciseSet {
  index: number;
  reps?: number;
  weight?: number;
  duration?: number;
  distance?: number;
  rpe?: number;                  // 0-10
  status: 'UNKNOWN' | 'PLANNED' | 'COMPLETED' | 'SKIPPED';
  timestamp?: string;            // ISO 8601 UTC
  restEndTime?: number;
}
```

---

### exercises (动作库)

**协议版本**: 2.0.0

#### SQL 定义

```sql
CREATE TABLE exercises (
  -- Core Layer
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  exercise_type VARCHAR(20) DEFAULT 'resistance',
  difficulty VARCHAR(20) DEFAULT 'beginner',

  -- Flex Layer
  targets JSONB,
  equipment_required JSONB DEFAULT '[]',
  content_html TEXT,
  assets JSONB,
  tags JSONB DEFAULT '[]',
  metadata JSONB DEFAULT '{}',

  -- 元数据
  modified_by VARCHAR(20) DEFAULT 'system',
  modified_at INTEGER DEFAULT (EXTRACT(EPOCH FROM NOW())),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- 向量搜索
  embedding VECTOR(1536),

  -- 约束
  CONSTRAINT chk_exercise_type CHECK (exercise_type IN (
    'resistance', 'unilateral', 'bodyweight', 'assisted',
    'isometric', 'cardio', 'flexibility', 'heavy_weight',
    'rep_training', 'outdoor'
  )),
  CONSTRAINT chk_difficulty CHECK (difficulty IN (
    'beginner', 'intermediate', 'advanced'
  )),
  CONSTRAINT chk_modified_by CHECK (modified_by IN (
    'admin', 'system', 'mas'
  ))
);

-- 性能索引
CREATE INDEX idx_exercises_type ON exercises(exercise_type);
CREATE INDEX idx_exercises_difficulty ON exercises(difficulty);
CREATE INDEX idx_exercises_targets ON exercises USING GIN(targets);

-- 向量相似度搜索索引
CREATE INDEX idx_exercises_embedding ON exercises USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);
```

#### targets 字段结构

```typescript
interface ExerciseTargets {
  primary: MuscleTarget[];       // 主要目标 (至少1个)
  secondary?: MuscleTarget[];    // 次要目标 (可选)
}

type MuscleTarget =
  | '上胸' | '中下胸'
  | '前束' | '中束' | '后束'
  | '二头' | '三头' | '小臂'
  | '背部' | '下背' | '斜方肌'
  | '腹肌' | '侧腹'
  | '股四' | '腘绳' | '小腿'
  | '上臀部' | '下臀部';
```

---

### agent_interactions (智能体交互记录)

**协议版本**: 2.0.0

#### SQL 定义

```sql
CREATE TABLE agent_interactions (
  -- Core Layer
  trace_id UUID PRIMARY KEY,
  agent_id VARCHAR(100) NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  role VARCHAR(20) DEFAULT 'assistant' NOT NULL,

  -- Flex Layer
  content JSONB NOT NULL,
  metadata JSONB DEFAULT '{}',

  -- CloudEvents 规范
  specversion VARCHAR(10) DEFAULT '1.0',
  type VARCHAR(100) NOT NULL,
  source VARCHAR(200) NOT NULL,
  datacontenttype VARCHAR(50) DEFAULT 'application/json',
  traceparent TEXT,

  -- 索引
  CONSTRAINT chk_role CHECK (role IN (
    'UNKNOWN', 'assistant', 'user', 'system'
  ))
);

CREATE INDEX idx_agent_interactions_trace_id ON agent_interactions(trace_id);
CREATE INDEX idx_agent_interactions_timestamp ON agent_interactions(timestamp DESC);
CREATE INDEX idx_agent_interactions_agent_id ON agent_interactions(agent_id);
```

---

## 命名规范

### 数据库层 (snake_case)

| 类型 | 规范 | 示例 |
|------|------|------|
| 表名 | 复数形式，小写下划线 | `user_profiles`, `workout_sessions` |
| 列名 | 小写下划线 | `profile_static`, `fitness_level`, `basic_info` |
| 枚举值 | 小写下划线 | `'beginner'`, `'intermediate'`, `'advanced'` |
| JSONB 键 | 小写下划线 | `basic_info`, `load_anchors`, `red_flags` |

### 应用层 (camelCase)

| 类型 | 规范 | 示例 |
|------|------|------|
| 接口类型 | PascalCase | `ProfileStatic`, `LoadAnchor` |
| 属性名 | camelCase | `basicInfo`, `fitnessLevel`, `loadAnchors` |
| 枚举值 | 小写下划线 | `'beginner'`, `'intermediate'`, `'advanced'` |
| 方法名 | camelCase | `getProfileStatic()`, `updateProfileDynamic()` |

### 枚举值统一标准

```typescript
// ✅ 正确：枚举值使用 snake_case
export const FitnessLevel = {
  UNKNOWN: 'unknown',
  BEGINNER: 'beginner',
  INTERMEDIATE: 'intermediate',
  ADVANCED: 'advanced',
} as const;

export const UIHintType = {
  PLAN_CARD: 'plan_card',
  SUMMARY_CARD: 'summary_card',
  SURVEY_CARD: 'survey_card',
  SURVEY_SUCCESS: 'survey_success',
  DEVIATION_CARD: 'deviation_card',
  STRATEGY_CONFIRM: 'strategy_confirm',
  SKELETON: 'skeleton',
  UNKNOWN: 'unknown',
} as const;

// ❌ 错误：枚举值使用 SCREAMING_SNAKE_CASE
export const UIHintType = {
  PLAN_CARD: 'PLAN_CARD',     // 错误！
  SUMMARY_CARD: 'SUMMARY_CARD', // 错误！
};
```

**原因**:
- 枚举值会存储在数据库中，应使用 snake_case 与数据库保持一致
- TypeScript 中的常量名（键）可以是 SCREAMING_SNAKE_CASE，但值必须是 snake_case

---

## 数据契约红线

### 不可违反的原则

1. **所有与后端交互的类型必须从 `shared/contracts` 导入**
   ```typescript
   // ✅ 正确
   import type { LoadAnchor } from 'shared/contracts'

   // ❌ 错误
   interface LoadAnchor { ... }
   ```

2. **禁止在组件中重新定义数据契约类型**
   - 违规检测: 搜索 `interface LoadAnchor` 或 `type LoadAnchor` 在非 shared/contracts 文件中

3. **禁止使用不安全的 JSON 解析**
   - 必须使用 `parseJSONSafe()` 代替 `JSON.parse()`
   - 违规检测: ESLint 规则检测裸 JSON.parse

4. **Zod 验证失败必须记录详细日志或抛出错误**
   - 禁止静默降级到默认值而掩盖错误
   - 使用 `validateWithLogging()` 或 `validateOrThrow()`

5. **禁止在核心数据路径上静默降级**
   - 验证失败要么抛出错误（开发），要么记录详细日志（生产）
   - 不允许 `try-catch { return {} }` 模式掩盖数据问题

### 允许的操作

- ✅ 新增字段 (向后兼容)
- ✅ 新增索引
- ✅ 新增枚举值 (保持 UNKNOWN 优先)
- ✅ 扩展 JSONB 结构

### 违规检测

运行以下命令检测数据契约违规:
```bash
npm run lint:contracts
```

CI/CD 自动检测违规并阻止合并。

---

## 迁移指南

### 从 SQLite 迁移到 PostgreSQL

详见 `docs-site/database/migration-guide.md`

### 数据流图

详见 `docs-site/architecture/data-flow.md`

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v2.1.0 | 2026-02-24 | 新增 Repository 层架构，命名规范统一为 snake_case |
| v2.0.0 | 2026-02-09 | Core-Flex 架构，三态模型 |
| v1.0.0 | 2026-01-29 | 初始 SQLite schema |

---

**文档版本**: v2.1.0
**最后更新**: 2026-02-24
**维护者**: Starfit Development Team
