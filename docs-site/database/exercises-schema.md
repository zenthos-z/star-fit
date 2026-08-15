# 动作数据库 (exercises) 字段说明文档

**版本**: v2.0.0
**创建日期**: 2026-01-29
**最后更新**: 2026-02-24
**数据库**: PostgreSQL

---

## 概述

`exercises` 表存储动作库的所有训练动作，是 AI 教练和 Admin Console 的核心知识库。

---

## 表结构

### SQL 定义 (PostgreSQL)

```sql
CREATE TABLE IF NOT EXISTS exercises (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  exercise_type VARCHAR(20) DEFAULT 'resistance',
  targets JSONB,
  equipment_required JSONB DEFAULT '[]',
  difficulty VARCHAR(20) DEFAULT 'beginner',
  content_html TEXT,
  assets JSONB,
  tags JSONB DEFAULT '[]',
  modified_by VARCHAR(20) DEFAULT 'system',
  modified_at INTEGER DEFAULT (EXTRACT(EPOCH FROM NOW())),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

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

-- 向量搜索
CREATE INDEX idx_exercises_embedding ON exercises USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);
```

---

## 字段详细说明

### 核心字段 (Core Fields)

| 字段名 | 类型 | 约束 | 说明 |
|--------|------|------|------|
| `id` | TEXT | PRIMARY KEY | 动作唯一标识符 (UUID) |
| `name` | TEXT | NOT NULL, UNIQUE | 动作名称 (必须唯一，防止重复创建) |

---

### 分类字段 (Category Fields)

#### `exercise_type` - 动作类型

| 数据库值 | 说明 |
|----------|------|
| `resistance` | 抗阻训练 (默认) |
| `unilateral` | 单侧训练 |
| `bodyweight` | 自重训练 |
| `assisted` | 辅助训练 |
| `isometric` | 等长训练 |
| `cardio` | 有氧训练 |
| `flexibility` | 柔韧性训练 |
| `heavy_weight` | 大重量/举次训练 |
| `rep_training` | 次数训练 |
| `outdoor` | 户外运动 |

---

### 目标字段 (Target Fields)

#### `targets` - 锻炼目标肌肉

**格式**: JSON 字符串
**结构**:
```typescript
{
  "primary": MuscleTarget[],      // 主要目标（至少1个）
  "secondary": MuscleTarget[]     // 次要目标（可选）
}
```

**肌肉选项池 (MuscleTarget)**:

| 选项 | 选项 | 选项 |
|------|------|------|
| 上胸 | 中下胸 | 前束 |
| 中束 | 后束 | 二头 |
| 三头 | 小臂 | 背部 |
| 下背 | 斜方肌 | 腹肌 |
| 侧腹 | 股四 | 腘绳 |
| 小腿 | 上臀部 | 下臀部 |

**示例**:
```json
{
  "primary": ["上胸", "前束"],
  "secondary": ["中束", "三头"]
}
```

```json
{
  "primary": ["股四"]
}
```

---

### JSON 字段 (JSONB)

> **注意**: JSON 字段使用 PostgreSQL JSONB 类型，PostgreSQL 自动反序列化为 JavaScript 对象

#### `equipment_required` - 所需器械

**格式**: JSONB 数组
**结构**: `string[]`

**示例**:
```json
["dumbbell", "bench", "barbell"]
```

常见器械:
- `dumbbell` - 哑铃
- `barbell` - 杠铃
- `bench` - 卧推凳
- `cable` - 拉力器
- `kettlebell` - 壶铃
- `machine` - 器械
- `bodyweight` - 自重 (无器械)

---

### 难度与元数据

#### `difficulty` - 难度等级

| 数据库值 | 说明 |
|----------|------|
| `beginner` | 初级 (默认) |
| `intermediate` | 中级 |
| `advanced` | 高级 |

#### `modified_by` - 修改来源

| 数据库值 | 说明 |
|----------|------|
| `admin` | 管理员修改 |
| `system` | 系统生成 |
| `mas` | AI 智能体修改 |

---

### 扩展字段 (Extended Fields)

#### `content_html` - 动作说明内容

存储动作的 HTML 格式说明文字，用于教学页面展示。

#### `assets` - 媒体资源 (JSONB)

**格式**: JSONB 对象
**结构**:
```typescript
{
  "cover": string,   // 封面图 URL
  "video": string    // 视频文件 URL
}
```

#### `tags` - 标签扩展 (JSONB)

可选的标签数组，用于扩展分类和检索功能。

#### `updated_at` - 更新时间戳

TIMESTAMPTZ 类型，PostgreSQL 自动管理。

---

### 已废弃字段 (Deprecated Fields)

| 字段名 | 状态 | 说明 |
|--------|------|------|
| `category` | @deprecated | v1.1.0 删除，已被 `targets` 替代 |
| `body_category` | @deprecated | v1.2.0 删除，已被 `targets` 替代 |
| `muscle_groups` | @deprecated | v1.2.0 删除，已被 `targets` 替代 |

---

## TypeScript 类型定义

```typescript
/**
 * 肌肉目标选项 - 完整的肌肉分区列表
 */
export type MuscleTarget =
  | '上胸' | '中下胸'
  | '前束' | '中束' | '后束'
  | '二头' | '三头' | '小臂'
  | '背部' | '下背' | '斜方肌'
  | '腹肌' | '侧腹'
  | '股四' | '腘绳' | '小腿'
  | '上臀部' | '下臀部';

/**
 * 动作目标结构
 */
export interface ExerciseTargets {
  primary: MuscleTarget[];      // 主要目标（至少1个）
  secondary?: MuscleTarget[];   // 次要目标（可选）
}

export interface Exercise {
  id: string;
  name: string;
  exercise_type: 'resistance' | 'unilateral' | 'bodyweight' | 'assisted' | 'isometric' | 'cardio' | 'flexibility' | 'heavy_weight' | 'rep_training' | 'outdoor';
  targets: ExerciseTargets;       // JSONB object
  equipment_required: string[];    // JSONB array
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  content_html?: string;
  assets?: {                      // JSONB object
    cover?: string;
    video?: string;
  };
  tags?: string[];                // JSONB array
  modified_by: 'admin' | 'system' | 'mas';
  modified_at: number;
  created_at?: string;            // TIMESTAMPTZ
  updated_at?: string;            // TIMESTAMPTZ
  protocol_version?: string;
  version?: number;
  metadata?: Record<string, any>; // JSONB
  embedding?: number[];            // VECTOR(1536)
}
```

---

## 前端读取规范

### JSONB 字段读取

PostgreSQL JSONB 字段由 pg 驱动自动反序列化为 JavaScript 对象：

```typescript
// ✅ 正确：PostgreSQL JSONB 自动反序列化
const targets: ExerciseTargets = dbRecord.targets;

// ✅ 正确：使用 Repository 层（推荐）
import { ExerciseRepository } from '@/db/postgresql/repository/exercise.repository';

const exerciseRepo = new ExerciseRepository(postgresClient);
const exercise = await exerciseRepo.getById('ex001');
// exercise.targets 已经是 JavaScript 对象
```

---

## 服务接口

### ExerciseLibraryService

位置: `backend/src/services/exerciseLibraryService.ts`

| 方法 | 说明 |
|------|------|
| `getAllExercises()` | 获取所有动作 |
| `getByTarget(target)` | 按目标肌肉筛选 |
| `getById(id)` | 按 ID 获取单个动作 |
| `getByName(name)` | 按名称获取 (用于教学页面) |
| `getByDifficulty(difficulty)` | 按难度筛选 |
| `getByEquipment(equipment)` | 按器械筛选 |
| `updateExercise(update)` | 更新动作 (管理员) |
| `createExercise(data, createdBy)` | 新增动作 |
| `deleteExercise(id)` | 删除动作 |
| `getStats()` | 获取统计信息 |

---

## AI 上下文转换

### 转换为 AI 提示词

```typescript
// 后端服务
function formatTargetsForAI(exercise: Exercise): string {
  const targets = parseTargets(exercise.targets);

  const primary = targets.primary.join('、');
  const secondary = targets.secondary?.join('、');

  if (secondary) {
    return `${exercise.name} - 主要目标: ${primary}；辅助目标: ${secondary}`;
  }
  return `${exercise.name} - 主要目标: ${primary}`;
}

// 示例输出
// "上斜卧推 - 主要目标: 上胸、前束；辅助目标: 中束、三头"
// "平板卧推 - 主要目标: 中下胸"
```

---

## 数据契约规范

参考: 数据契约见 [数据协议](../concepts/data-protocol.md) 与 [数据流规范](../architecture/data-flow.md)

### 红线 (禁止操作)

- ❌ 删除现有字段
- ❌ 修改字段数据类型
- ❌ 前端直连数据库

### 允许操作

- ✅ 新增字段 (向后兼容)
- ✅ 新增索引
- ✅ 新增枚举值 (保持 UNKNOWN 优先)

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v2.0.0 | 2026-02-24 | PostgreSQL 迁移，JSON 字段改为 JSONB，更新 SQL 语法 |
| v1.3.0 | 2026-01-29 | 新增 `heavy_weight`, `rep_training`, `outdoor` 运动类型 |
| v1.2.0 | 2026-01-29 | 新增 `targets` 字段，删除 `body_category` 和 `muscle_groups` |
| v1.1.0 | 2026-01-29 | 移除 `category` 字段，统一使用 `body_category` |
| v1.0.0 | 2026-01-29 | 初始版本 |

---

**文档版本**: v2.0.0
**最后更新**: 2026-02-24
**维护者**: Starfit Development Team
