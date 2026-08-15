# 数据协议


**版本**: v2.0.0
**创建日期**: 2026-01-16
**最后更新**: 2026-02-24
**状态**: 生产就绪

---

本文档定义了 Starfit 中使用的核心数据结构。

> **架构说明**: 所有数据访问通过 Repository 层进行，详见 [Repository 层架构文档](../database/repository-layer.md)。

## 类型定义来源

### Backend Shared Types
来源: `backend/src/types/shared.ts`

使用 TypeScript `const` 对象定义，类型安全。

### V2 Protocol Types
来源: `shared/v2/types/protocol.ts`

使用 **Zod** Schema 定义，提供运行时类型验证。

详细的类型定义请参考: [共享类型](/api/shared-types)

---

## 核心数据结构

### 健身水平 (Fitness Level)
定义用户经验水平的枚举。

来源: `backend/src/types/shared.ts`

- `beginner` (初学者)
- `intermediate` (中级)
- `advanced` (高级)
- `unknown` (未知，防御性编程)

---

### 智能体场景 (Agent Scenarios)
AI 智能体运行的上下文。

来源: `backend/src/types/shared.ts`

**枚举值 (snake_case)**:
- `chat` - 一般对话
- `plan` - 训练计划模式
- `summary` - 训练后总结
- `tutorial` - 动作解释
- `workout_complete` - 训练完成
- `update_profile` - 更新用户资料
- `unknown` - 未知场景（防御性编程）

---

## V2 Protocol Schema

所有 V2 Protocol Schema 定义在 `shared/v2/types/protocol.ts` 中，使用 Zod 进行运行时验证。

### 生物指标 (BiometricMetric)
生理数据指标。

**Schema:**
```typescript
{
  type: 'hr' | 'hrv' | 'spo2' | 'vo2max' | 'weight' | 'bodyfat' | 'unknown',
  value: number,
  unit: string,
  timestamp: string, // ISO 8601 UTC
  metadata?: Record<string, any>
}
```

**类型枚举:**
- `hr` - 心率
- `hrv` - 心率变异性
- `spo2` - 血氧饱和度
- `vo2max` - 最大摄氧量
- `weight` - 体重
- `bodyfat` - 体脂率
- `unknown` - 未知

**代码位置:** [shared/v2/types/protocol.ts:9-17](file:///g:/code_library/gemini_gym/shared/v2/types/protocol.ts#L9)

---

### 动作执行 (ExerciseAction)
单个动作组或动作。

**Schema:**
```typescript
{
  id: string, // UUID
  exerciseId: string,
  type: 'strength' | 'cardio' | 'hiit' | 'stretch' | 'unknown',
  sets: Array<{
    index: number,
    reps?: number,
    weight?: number,
    duration?: number, // seconds
    distance?: number, // meters
    rpe?: number, // 0-10
    status: 'planned' | 'completed' | 'skipped',
    timestamp?: string
  }>,
  uiHint?: {
    cardType?: string,
    pluginId?: string
  },
  metadata?: Record<string, any>
}
```

**类型枚举:**
- `strength` - 力量
- `cardio` - 有氧
- `hiit` - 高强度间歇训练
- `stretch` - 拉伸
- `unknown` - 未知

**状态枚举:**
- `planned` - 计划中
- `completed` - 已完成
- `skipped` - 已跳过

**代码位置:** [shared/v2/types/protocol.ts:20-41](file:///g:/code_library/gemini_gym/shared/v2/types/protocol.ts#L20)

---

### 训练会话 (WorkoutSession)
完整的训练事实（L2）。

**Schema:**
```typescript
{
  id: string, // UUID
  userId: string,
  status: 'draft' | 'in_progress' | 'completed' | 'cancelled',
  startTime: string, // ISO 8601 UTC
  endTime?: string, // ISO 8601 UTC
  exercises: ExerciseAction[],
  environment: 'indoor' | 'outdoor' | 'home' | 'gym' | 'unknown',
  version: number,
  metadata?: Record<string, any>
}
```

**状态枚举:**
- `draft` - 草稿
- `in_progress` - 进行中
- `completed` - 已完成
- `cancelled` - 已取消

**环境枚举:**
- `indoor` - 室内
- `outdoor` - 户外
- `home` - 家
- `gym` - 健身房
- `unknown` - 未知

**代码位置:** [shared/v2/types/protocol.ts:44-56](file:///g:/code_library/gemini_gym/shared/v2/types/protocol.ts#L44)

---

### 用户资料 (UserProfile)
生理标签和用户资料。

**Schema:**
```typescript
{
  userId: string,
  tags: string[], // namespace:category:key=value
  fitnessLevel: 'beginner' | 'intermediate' | 'advanced' | 'unknown',
  biometrics?: Record<string, BiometricMetric>,
  lastWorkoutTime?: string, // ISO 8601 UTC
  version: number
}
```

**健身水平枚举:**
- `beginner` - 初学者
- `intermediate` - 中级
- `advanced` - 高级
- `unknown` - 未知

**代码位置:** [shared/v2/types/protocol.ts:59-68](file:///g:/code_library/gemini_gym/shared/v2/types/protocol.ts#L59)

---

### UI 提示 (UIHint)
元数据驱动的 UI 指令。

**Schema:**
```typescript
{
  type: 'plan_card' | 'summary_card' | 'survey_card' | 'deviation_card' | 'instruction_card' | 'skeleton' | 'unknown',
  pluginId?: string,
  priority: number,
  data?: Record<string, any>,
  actionUri?: string // fit://...
}
```

**类型枚举:**
- `plan_card` - 计划卡片
- `summary_card` - 摘要卡片
- `survey_card` - 调查卡片
- `deviation_card` - 偏差卡片
- `instruction_card` - 指导卡片
- `skeleton` - 骨架
- `unknown` - 未知

**代码位置:** [shared/v2/types/protocol.ts:71-87](file:///g:/code_library/gemini_gym/shared/v2/types/protocol.ts#L71)

---

### 智能体交互 (AgentInteraction)
智能体与用户的交互记录（L3: Fluid Context）。

**Schema:**
```typescript
{
  traceId: string, // UUID
  agentId: string,
  timestamp: string, // ISO 8601 UTC
  content: Array<{
    type: 'text' | 'image' | 'uri' | 'uiHint',
    text?: string,
    uri?: string,
    uiHint?: UIHint
  }>,
  role: 'assistant' | 'user' | 'system'
}
```

**内容类型枚举:**
- `text` - 文本
- `image` - 图片
- `uri` - URI
- `uiHint` - UI 提示

**角色枚举:**
- `assistant` - 助手
- `user` - 用户
- `system` - 系统

**代码位置:** [shared/v2/types/protocol.ts:90-103](file:///g:/code_library/gemini_gym/shared/v2/types/protocol.ts#L90)

---

## 验证

我们使用 **Zod** schema 在运行时验证数据完整性。

所有 Schema 定义在 `shared/v2/types/protocol.ts` 中。

**使用示例:**
```typescript
import { WorkoutSessionSchema } from '@/v2/types/protocol';

const session = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  userId: 'user_123',
  status: 'in_progress',
  startTime: '2024-01-01T00:00:00.000Z',
  exercises: [],
  environment: 'gym',
  version: 1
};

const validated = WorkoutSessionSchema.parse(session);
```

---

## 动作库 (Exercise Library)

动作库定义了所有可用的训练动作，支持离线缓存和增量同步。

### Exercise Schema
```typescript
interface Exercise {
  id: string;
  name: string;
  body_category: 'push' | 'pull' | 'legs' | 'core' | 'cardio' | 'shoulders' | 'arms';
  exercise_type: 'resistance' | 'cardio' | 'bodyweight' | 'flexibility';
  muscle_groups: {
    primary?: string[];
    secondary?: string[];
    stabilizers?: string[];
  };
  equipment_required?: string[];
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  content_html?: string;
  assets_json?: string;
  tags_json?: string;
  modified_at: number;
  modified_by: 'admin' | 'system' | 'mas';
}
```

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `string` | 动作唯一标识符 |
| `name` | `string` | 动作名称 |
| `body_category` | `enum` | 身体分类：胸部/背部/腿部/核心/有氧/肩部/手臂 |
| `exercise_type` | `enum` | 训练类型：力量/有氧/徒手/柔韧 |
| `muscle_groups` | `object` | 目标肌群，包含 primary/secondary/stabilizers |
| `equipment_required` | `string[]` | 所需器械列表 |
| `difficulty` | `enum` | 难度：初级/中级/高级 |
| `content_html` | `string` | HTML 格式的动作说明 |
| `assets_json` | `string` | JSON 字符串，包含视频/封面等资源 |
| `tags_json` | `string` | JSON 字符串，包含标签列表 |
| `modified_at` | `number` | Unix 时间戳，用于增量同步 |
| `modified_by` | `enum` | 修改者：管理员/系统/AI 智能体 |

### 缓存协议

#### 缓存结构
```typescript
interface ExerciseLibraryCache {
  exercises: Exercise[];
  meta: {
    version: number;
    lastSyncTime: number;
    hash: string;
    count: number;
  };
}
```

#### 同步机制
1. **版本控制**: `version` 字段标识缓存格式版本，不匹配时失效
2. **哈希校验**: `hash` 字段用于检测数据变化
3. **过期检查**: 超过 24 小时自动标记为过期
4. **增量更新**: 基于 `modified_at` 时间戳拉取变更

#### 存储层级
- **L1 (State)**: 当前页面的动作列表，可读写
- **L2 (IDB)**: 完整的动作库缓存，优先读取
- **L3 (DB)**: 后端 PostgreSQL，通过 API 同步

### 防御性编程
- 所有 JSON 字段（`muscle_groups`, `equipment_required`, `assets_json`, `tags_json`）解析时必须使用 try-catch
- 字符串和对象两种格式都要支持处理
- 解析失败时使用合理的默认值（空数组、空对象）

### 使用示例
```typescript
import { ExerciseLibraryService } from '@/services/exerciseLibraryService';

// 获取动作库（优先缓存）
const exercises = await ExerciseLibraryService.getExercises();

// 强制刷新
const fresh = await ExerciseLibraryService.forceRefresh();

// 监听缓存更新
const unsubscribe = ExerciseLibraryService.subscribe(() => {
  console.log('Exercise library updated');
});

// 检查缓存状态
const status = await ExerciseLibraryService.getCacheStatus();
console.log({
  hasCache: status.hasCache,
  isExpired: status.isExpired,
  lastSyncTime: status.lastSyncTime
});
```

**代码位置:** 
- Schema: [storage/schemas.ts:35-50](file:///g:/code_library/gemini_gym/storage/schemas.ts#L35)
- Service: [src/services/exerciseLibraryService.ts](file:///g:/code_library/gemini_gym/src/services/exerciseLibraryService.ts)

---

## 重要说明

### 时间格式
所有时间戳字段使用 ISO 8601 UTC 格式：
```typescript
timestamp: '2024-01-01T00:00:00.000Z'
```

### UNKNOWN 值
所有枚举类型都包含 `UNKNOWN` 值，用于处理未知或未定义的情况。这是防御性编程的最佳实践。

### 默认值
大多数枚举字段都有默认值 `UNKNOWN`，以确保系统在遇到未知值时能够正常运行。

### 存储层级
- **L1 (State)**: React State，可读写
- **L2 (IDB)**: IndexedDB，仅 SyncService
- **L3 (DB)**: PostgreSQL，禁止直连，仅通过 Repository 层访问

---

## Repository 层集成

所有数据访问必须通过 Repository 层进行，Repository 层负责：

### 格式转换
```
应用层 (camelCase) ←→ Repository 层 (转换边界) ←→ 数据库层 (snake_case)
```

### JSONB 处理
- **读取**: PostgreSQL `pg` 驱动自动将 JSONB 反序列化为 JavaScript 对象
- **写入**: Repository 层将对象序列化为 JSONB 格式
- **验证**: 使用 Zod Schema 验证 JSONB 数据完整性
- **向后兼容**: 支持 SQLite 迁移遗留的 JSON 字符串格式

### 字段映射示例
```typescript
// camelCase (应用层) → snake_case (数据库层)
basicInfo      → basic_info
fitnessLevel   → fitness_level
redFlags       → red_flags
loadAnchors    → load_anchors
```

**详细参考**: [Repository 层架构文档](../database/repository-layer.md)

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v2.0.0 | 2026-02-24 | 枚举值统一为 snake_case，添加 Repository 层说明，PostgreSQL 迁移 |
| v1.0.0 | 2026-01-16 | 初始数据协议文档 |

---

**文档版本**: v2.0.0
**最后更新**: 2026-02-24
**维护者**: Starfit Development Team
