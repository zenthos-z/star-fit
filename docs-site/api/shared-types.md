# 共享类型

这些类型在后端和前端之间共享，以确保类型安全。

## Backend Shared Types

来源: `backend/src/types/shared.ts`

### FitnessLevel (健身水平)

**定义方式:** TypeScript `const` 对象

```typescript
export const FitnessLevel = {
  BEGINNER: 'beginner',
  INTERMEDIATE: 'intermediate',
  ADVANCED: 'advanced',
  UNKNOWN: 'unknown'
} as const;
```

**枚举值:**
- `beginner` - 初学者
- `intermediate` - 中级
- `advanced` - 高级
- `unknown` - 未知（防御性编程，用于处理未知值）

**类型:** `FitnessLevelType`

**代码位置:** [backend/src/types/shared.ts:12-19](file:///g:/code_library/gemini_gym/backend/src/types/shared.ts#L12)

---

### AgentScenario (智能体场景)

**定义方式:** TypeScript `const` 对象

```typescript
export const AgentScenario = {
  CHAT: 'chat',
  PLAN: 'plan',
  SUMMARY: 'summary',
  TUTORIAL: 'tutorial',
  WORKOUT_COMPLETE: 'workout_complete',
  UPDATE_PROFILE: 'update_profile',
  UNKNOWN: 'UNKNOWN'
} as const;
```

**枚举值:**
- `CHAT` - 一般对话
- `PLAN` - 训练计划模式
- `SUMMARY` - 训练后总结
- `TUTORIAL` - 动作解释
- `WORKOUT_COMPLETE` - 训练完成
- `UPDATE_PROFILE` - 更新用户资料
- `UNKNOWN` - 未知（防御性编程，用于处理未知值）

**类型:** `AgentScenarioType`

**代码位置:** [backend/src/types/shared.ts:25-35](file:///g:/code_library/gemini_gym/backend/src/types/shared.ts#L25)

---

### UIHintType (UI 提示类型)

智能体用于指示前端渲染特定卡片。

**定义方式:** TypeScript `const` 对象

```typescript
export const UIHintType = {
  PLAN_CARD: 'plan_card',
  SUMMARY_CARD: 'summary_card',
  SURVEY_CARD: 'survey_card',
  DEVIATION_CARD: 'deviation_card',
  SURVEY_SUCCESS: 'survey_success',
  SKELETON: 'skeleton',
  UNKNOWN: 'unknown'
} as const;
```

**枚举值:**
- `plan_card` - 计划卡片
- `summary_card` - 摘要卡片
- `survey_card` - 调查卡片
- `deviation_card` - 偏差卡片
- `survey_success` - 问卷成功确认卡片
- `skeleton` - 骨架
- `unknown` - 未知（防御性编程，用于处理未知值）

**类型:** `UIHintTypeType`

**代码位置:** [backend/src/types/shared.ts:41-51](file:///g:/code_library/gemini_gym/backend/src/types/shared.ts#L41)

---

## V2 Protocol Types

来源: `shared/v2/types/protocol.ts`

所有 V2 Protocol 类型使用 **Zod** Schema 定义，提供运行时类型验证。

### BiometricMetric (生物指标)

生理数据指标。

```typescript
export const BiometricMetricSchema = z.object({
  type: z.enum(['HR', 'HRV', 'SpO2', 'VO2MAX', 'WEIGHT', 'BODYFAT', 'UNKNOWN']).default('UNKNOWN'),
  value: z.number(),
  unit: z.string(),
  timestamp: z.string().datetime(),
  metadata: z.record(z.string(), z.any()).optional(),
});
```

**type 枚举值:**
- `hr` - 心率
- `hrv` - 心率变异性
- `spo2` - 血氧饱和度
- `vo2max` - 最大摄氧量
- `weight` - 体重
- `bodyfat` - 体脂率
- `unknown` - 未知

**代码位置:** [shared/v2/types/protocol.ts:9-17](file:///g:/code_library/gemini_gym/shared/v2/types/protocol.ts#L9)

---

### ExerciseAction (动作执行)

单个动作组或动作。

```typescript
export const ExerciseActionSchema = z.object({
  id: z.string().uuid(),
  exerciseId: z.string(),
  type: z.enum(['STRENGTH', 'CARDIO', 'HIIT', 'STRETCH', 'UNKNOWN']).default('UNKNOWN'),
  sets: z.array(z.object({
    index: z.number(),
    reps: z.number().optional(),
    weight: z.number().optional(),
    duration: z.number().optional(),
    distance: z.number().optional(),
    rpe: z.number().min(0).max(10).optional(),
    status: z.enum(['PLANNED', 'COMPLETED', 'SKIPPED']).default('PLANNED'),
    timestamp: z.string().datetime().optional(),
  })),
  uiHint: z.object({
    cardType: z.string().optional(),
    pluginId: z.string().optional(),
  }).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});
```

**type 枚举值:**
- `strength` - 力量
- `cardio` - 有氧
- `hiit` - 高强度间歇训练
- `stretch` - 拉伸
- `unknown` - 未知

**status 枚举值:**
- `planned` - 计划中
- `completed` - 已完成
- `skipped` - 已跳过

**代码位置:** [shared/v2/types/protocol.ts:20-41](file:///g:/code_library/gemini_gym/shared/v2/types/protocol.ts#L20)

---

### WorkoutSession (训练会话)

完整的训练事实（L2）。

```typescript
export const WorkoutSessionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string(),
  status: z.enum(['DRAFT', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).default('DRAFT'),
  startTime: z.string().datetime(),
  endTime: z.string().datetime().optional(),
  exercises: z.array(ExerciseActionSchema),
  environment: z.enum(['INDOOR', 'OUTDOOR', 'HOME', 'GYM', 'UNKNOWN']).default('UNKNOWN'),
  version: z.number().default(1),
  metadata: z.record(z.string(), z.any()).optional(),
});
```

**status 枚举值:**
- `draft` - 草稿
- `in_progress` - 进行中
- `completed` - 已完成
- `cancelled` - 已取消

**environment 枚举值:**
- `indoor` - 室内
- `outdoor` - 户外
- `home` - 家
- `gym` - 健身房
- `unknown` - 未知

**代码位置:** [shared/v2/types/protocol.ts:44-56](file:///g:/code_library/gemini_gym/shared/v2/types/protocol.ts#L44)

---

### UserProfile (用户资料)

生理标签和用户资料。

```typescript
export const UserProfileSchema = z.object({
  userId: z.string(),
  tags: z.array(z.string()),
  fitnessLevel: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'UNKNOWN']).default('UNKNOWN'),
  biometrics: z.record(z.string(), BiometricMetricSchema).optional(),
  lastWorkoutTime: z.string().datetime().optional(),
  trainingStrategy: z.string().optional(), // 用户自定义训练策略（灵活文本）
  version: z.number().default(1),
});
```

**fitnessLevel 枚举值:**
- `beginner` - 初学者
- `intermediate` - 中级
- `advanced` - 高级
- `unknown` - 未知

**代码位置:** [shared/v2/types/protocol.ts:59-68](file:///g:/code_library/gemini_gym/shared/v2/types/protocol.ts#L59)

---

### UIHint (UI 提示)

元数据驱动的 UI 指令。

```typescript
export const UIHintSchema = z.object({
  type: z.enum([
    'PLAN_CARD',
    'SUMMARY_CARD',
    'SURVEY_CARD',
    'DEVIATION_CARD',
    'SURVEY_SUCCESS',
    'SKELETON',
    'UNKNOWN'
  ]).default('UNKNOWN'),
  pluginId: z.string().optional(),
  priority: z.number().default(0),
  data: z.record(z.string(), z.any()).optional(),
  actionUri: z.string().optional(),
});
```

**type 枚举值:**
- `plan_card` - 计划卡片
- `summary_card` - 摘要卡片
- `survey_card` - 调查卡片
- `deviation_card` - 偏差卡片
- `survey_success` - 问卷成功确认卡片
- `skeleton` - 骨架
- `unknown` - 未知

**代码位置:** [shared/v2/types/protocol.ts:71-87](file:///g:/code_library/gemini_gym/shared/v2/types/protocol.ts#L71)

---

### AgentInteraction (智能体交互)

智能体与用户的交互记录（L3: Fluid Context）。

```typescript
export const AgentInteractionSchema = z.object({
  traceId: z.string().uuid(),
  agentId: z.string(),
  timestamp: z.string().datetime(),
  content: z.array(z.object({
    type: z.enum(['text', 'image', 'uri', 'uiHint']),
    text: z.string().optional(),
    uri: z.string().optional(),
    uiHint: UIHintSchema.optional(),
  })),
  role: z.enum(['assistant', 'user', 'system']).default('assistant'),
});
```

**content.type 枚举值:**
- `text` - 文本
- `image` - 图片
- `uri` - URI
- `uiHint` - UI 提示

**role 枚举值:**
- `assistant` - 助手
- `user` - 用户
- `system` - 系统

**代码位置:** [shared/v2/types/protocol.ts:90-103](file:///g:/code_library/gemini_gym/shared/v2/types/protocol.ts#L90)

---

---

## Three-State Model Types (v2.0.0)

来源: `shared/contracts/index.ts`

基于 Core-Flex 架构的三态模型类型定义。

### LoadAnchor (负荷锚点)

记录个人最佳表现，用于训练进展追踪。

```typescript
export const LoadAnchorSchema = z.object({
  // 力量训练字段
  best_weight: z.number().optional(),
  best_reps: z.number().optional(),
  est_1rm: z.number().optional(),

  // 自重训练字段
  progression_level: z.number().optional(),

  // 等长收缩字段
  best_duration: z.number().optional(),

  // 有氧训练字段
  best_distance: z.number().optional(),
  best_pace: z.number().optional(),

  // 心率字段
  max_hr: z.number().optional(),
  resting_hr: z.number().optional(),
  zone_2_threshold: z.number().optional(),

  // 时间戳 (必需)
  last_updated: z.number(),
});
```

**用途**:
- 力量训练: 记录最大重量和次数
- 自重训练: 记录最多次数或进阶等级
- 等长收缩: 记录最长保持时间
- 有氧训练: 记录最佳配速

**代码位置**: [shared/contracts/index.ts:119-144](file:///g:/code_library/gemini_gym/shared/contracts/index.ts#L119)

---

### ProfileStatic (静态态)

存储长期稳定的生物学和心理学特征。

**更新频率**: 6个月 - 1年

```typescript
export const ProfileStaticSchema = z.object({
  // 生物学特征
  age: z.number().optional(),
  weight: z.number().optional(),        // kg
  height: z.number().optional(),        // cm
  body_fat_percentage: z.number().optional(),

  // 神经心理学特征
  neuro_type: z.enum(['UNKNOWN', 'type_1', 'type_2a', 'type_2b', 'type_3']).default('UNKNOWN'),
  risk_preference: z.enum(['UNKNOWN', 'conservative', 'moderate', 'aggressive']).default('UNKNOWN'),
  accountability: z.enum(['UNKNOWN', 'low', 'medium', 'high']).default('UNKNOWN'),

  // 永久性限制
  permanent_injuries: z.array(z.object({
    part: z.string(),                   // 身体部位
    note: z.string(),                   // 伤病描述
    diagnosed_at: z.string().datetime().optional(),
  })).default([]),
});
```

**字段说明**:
- `neuro_type`: 神经类型 (type_1: 爆发型, type_2a: 平衡型, type_2b: 耐力型, type_3: 混合型)
- `risk_preference`: 风险偏好 (影响训练计划激进度)
- `accountability`: 自律性 (影响监督频率)
- `permanent_injuries`: 永久性伤病 (不会自动愈合)

**代码位置**: [shared/contracts/index.ts:317-331](file:///g:/code_library/gemini_gym/shared/contracts/index.ts#L317)

---

### ProfileDynamic (动态态)

存储高频变化的状态数据。

**更新频率**: 每次训练后

```typescript
export const ProfileDynamicSchema = z.object({
  // 负荷锚点: 当前能力映射
  load_anchors: z.record(z.string(), LoadAnchorSchema).default({}),

  // 短期限制: 自愈伤病窗口
  active_limitations: z.array(z.object({
    part: z.string(),                    // 身体部位
    severity: z.number().min(1).max(10),  // 1-10 严重程度
    expire_at: z.string().datetime(),     // ISO 8601 UTC
    logged_at: z.string().datetime(),     // ISO 8601 UTC
    auto_heal: z.boolean().default(true),
  })).default([]),

  // 恢复状态: 疲劳监控
  recovery_state: z.object({
    total_score: z.number().min(0).max(100),
    cns_fusing: z.boolean().default(false),
    last_assessed: z.string().datetime(),
    acute_load: z.number().optional(),
    chronic_load: z.number().optional(),
  }).optional(),
});
```

**字段说明**:
- `load_anchors`: 每个动作的当前最佳表现
- `active_limitations`: 会自动过期的伤病限制
- `recovery_state`: CNS 疲劳和恢复评分

**自愈机制**:
```typescript
// 检查并过期限制
const now = new Date();
const expired = profile_dynamic.active_limitations.filter(
  limit => new Date(limit.expire_at) <= now
);
```

**代码位置**: [shared/contracts/index.ts:368-377](file:///g:/code_library/gemini_gym/shared/contracts/index.ts#L368)

---

### HistorySummary (摘要态)

压缩历史数据以减少 AI token 消耗。

**更新频率**: 每周

**压缩比**: ~98.6%

```typescript
export const HistorySummarySchema = z.object({
  // 最后训练序列
  last_pattern: z.object({
    sequence: z.enum(['UNKNOWN', 'A', 'B', 'C']).default('UNKNOWN'),
    date: z.string().datetime(),
    exercises: z.array(z.string()),       // 动作 ID 列表
  }).optional(),

  // 趋势分析
  trends: z.object({
    rpe_trend: z.enum(['UNKNOWN', 'rising', 'stable', 'falling']).default('UNKNOWN'),
    volume_trend: z.enum(['UNKNOWN', 'increasing', 'stable', 'decreasing']).default('UNKNOWN'),
    recent_avg_rpe: z.number().optional(),
    fatigue_level: z.number().optional(),
  }).optional(),

  // 压缩摘要 (50-100 words)
  recent_summary: z.string().optional(),

  // 周数追踪
  week_number: z.number().optional(),

  // 关键指标
  key_metrics: z.object({
    total_sessions: z.number().default(0),
    personal_records: z.number().default(0),
    injury_count: z.number().default(0),
  }).default({}),
});
```

**字段说明**:
- `last_pattern`: 最后一次训练的模式 (A/B/C 循环)
- `trends`: RPE 和容量趋势分析
- `recent_summary`: AI 生成的压缩摘要
- `key_metrics`: 重要训练指标

**AI Token 节省**:
```
原始数据: ~365,000 tokens/year
压缩后:   ~5,200 tokens/year
节省:    ~98.6%
```

**代码位置**: [shared/contracts/index.ts:424-439](file:///g:/code_library/gemini_gym/shared/contracts/index.ts#L424)

---

### UserProfileV2 (用户画像 V2)

完整的三态模型用户画像。

**协议版本**: 2.0.0

```typescript
export const UserProfileV2Schema = z.object({
  protocol_version: z.literal('2.0.0').default('2.0.0'),

  // Core layer fields (关系型列)
  user_id: z.string().uuid(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime().default(() => new Date().toISOString()),

  // Flex layer fields (JSONB 容器)
  profile_static: ProfileStaticSchema.default({}),
  profile_dynamic: ProfileDynamicSchema.default({}),
  history_summary: HistorySummarySchema.default({}),

  // Legacy 兼容字段
  tags: z.array(z.string()).default([]),
  fitness_level: z.enum(['UNKNOWN', 'beginner', 'intermediate', 'advanced']).default('UNKNOWN'),
  red_flags: z.array(z.string()).default([]),
  training_strategy: z.string().optional().nullable(),
});
```

**数据契约红线**:
1. 所有与后端交互的类型必须从 `shared/contracts` 导入
2. 禁止在组件中重新定义数据契约类型
3. 禁止使用不安全的 JSON 解析 (使用 `parseJSONSafe()`)
4. Zod 验证失败必须记录详细日志或抛出错误

**代码位置**: [shared/contracts/index.ts:448-466](file:///g:/code_library/gemini_gym/shared/contracts/index.ts#L448)

---

## 重要说明

### 定义方式
- **Backend Types**: 使用 TypeScript `const` 对象（而非 `enum`）
- **V2 Protocol Types**: 使用 Zod Schema（提供运行时验证）
- **Three-State Model**: 所有类型使用 Zod Schema 定义

### UNKNOWN 值
所有枚举类型都包含 `UNKNOWN` 值，用于处理未知或未定义的情况。这是防御性编程的最佳实践。

### 时间格式
所有时间戳字段使用 ISO 8601 UTC 格式：
```typescript
timestamp: z.string().datetime()
// 示例: "2026-02-09T10:00:00Z"
```

### 默认值
大多数枚举字段都有默认值 `UNKNOWN`，以确保系统在遇到未知值时能够正常运行。

### 数据验证
所有三态模型类型都使用 Zod Schema 进行运行时验证：

```typescript
import { UserProfileV2Schema, ProfileDynamicSchema } from 'shared/contracts';

// 验证数据
const result = UserProfileV2Schema.safeParse(data);
if (!result.success) {
  console.error('验证失败:', result.error.errors);
  throw new Error('Invalid user profile data');
}

// 类型断言
const profile: UserProfileV2 = result.data;
```
