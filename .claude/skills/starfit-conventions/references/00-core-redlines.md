# MAS 核心红线规范

**版本**: v3.1.0 | **状态**: 强制执行 | **更新**: 2026-02-24

---

## 新架构红线 (NA)

| 编号 | 红线内容 | 违规后果 |
|------|----------|----------|
| **NA-001** | AI 禁止介入算术计算（进阶/1RM/过期时间） | 计算错误、安全隐患 |
| **NA-002** | JSONB 字段写入前必须通过 Zod 验证 | 数据污染 |
| **NA-003** | 向量检索结果必须经过规则引擎安全过滤 | 安全风险 |
| **NA-004** | active_limitations 必须带 expire_at 自动过期 | 状态不一致 |

---

## 快速参考表 (保留的旧红线)

| 编号 | 红线内容 | 违规后果 |
|------|----------|----------|
| **AR-001** | 执行节点禁止设置 `currentAgent` | 并发冲突、路由混乱 |
| **AR-002** | 禁止节点间直接调用 | 架构解耦失败 |
| **AR-003** | 禁止绕过 Router 直接进入业务节点 | 路由逻辑失效 |
| **AR-004** | 禁止绕过 Repository 层访问数据库 | 架构混乱、格式错误 |
| **SM-001** | JSON 字段必须 try-catch 解析（遗留代码） | 前端崩溃 |
| **SM-002** | 禁止绕过 Repository 层访问数据库 | 架构混乱 |
| **SM-003** | 时间戳必须调用 MCP 工具 | 时间不准确 |
| **SM-004** | 所有枚举值必须使用 snake_case 格式 | 数据不一致 |
| **SM-005** | 所有枚举必须包含 `unknown` 防御性值 | 数据解析错误 |
| **HITL-001** | 伤病风险必须用户确认 | 安全风险 |

---

## 1. 新架构红线 (New Architecture)

### NA-001: AI 禁止介入算术计算

```typescript
// ❌ 违规：AI 直接计算进阶增量
const aiResponse = await openai.chat({
  messages: [{ role: 'user', content: '计算进阶：当前80kg，下周增加2.5kg' }]
});
const nextWeight = JSON.parse(aiResponse).weight;  // ❌ AI 计算不可信

// ✅ 正确：Service 负责计算
class ProgressionService {
  calculateNextWeight(current: number, increment: number): number {
    return current + increment;
  }
}
const nextWeight = progressionService.calculateNextWeight(80, 2.5);
```

### NA-002: JSONB 字段写入前必须验证

```typescript
// ❌ 违规：直接写入 JSONB
await db.user_insights.update({
  user_id: uid,
  profile_dynamic: { load_anchors: rawAnchors }  // ❌ 未验证
});

// ✅ 正确：Zod 验证后写入
const validated = ProfileDynamicSchema.parse({
  load_anchors: rawAnchors,
  updated_at: await getCurrentTime()
});
await db.user_insights.update({
  user_id: uid,
  profile_dynamic: validated
});
```

### NA-003: 向量检索结果必须安全过滤

```typescript
// ❌ 违规：直接使用向量检索结果
const similar = await pgvector.search(queryEmbedding, k=5);
return similar[0].exercise_id;  // ❌ 未过滤不适用的动作

// ✅ 正确：规则引擎过滤
const similar = await pgvector.search(queryEmbedding, k=10);
const safe = await ruleEngine.filter({
  exercises: similar,
  constraints: { active_limitations, equipment_available }
});
return safe[0].exercise_id;
```

### NA-004: active_limitations 必须带过期时间

```typescript
// ❌ 违规：永久限制
await db.user_insights.update({
  active_limitations: [{ type: 'injury', body_part: 'knee' }]
  // ❌ 无 expire_at
});

// ✅ 正确：带自动过期
await db.user_insights.update({
  active_limitations: [{
    type: 'injury',
    body_part: 'knee',
    expire_at: '2026-03-01T00:00:00Z',  // ✅ 必须有
    created_at: await getCurrentTime()
  }]
});
```

---

## 2. 架构红线 (Architecture) - 保留

### AR-001: 执行节点禁止设置 currentAgent

```typescript
// ❌ 违规
const plannerNode = async (state: AgentStateType) => {
  return {
    currentAgent: "planner",  // ❌ 禁止
    plannerResults: { ... }
  };
};

// ✅ 正确：只有 Router 设置
const routerNode = async (state: AgentStateType) => {
  return {
    currentAgent: "router",  // ✅ 允许
    next: "planner"
  };
};
```

### AR-002: 禁止节点间直接调用

```typescript
// ❌ 违规
const plannerNode = async (state: AgentStateType) => {
  const responderResult = await responderNode(state);  // ❌
  return { ...responderResult };
};

// ✅ 正确：通过状态传递
const plannerNode = async (state: AgentStateType) => {
  return {
    plannerResults: { data: "processed" },
    next: "responder"  // ✅ 指示下一步
  };
};
```

### AR-004: 禁止绕过 Repository 层访问数据库

```typescript
// ❌ 违规：直接查询数据库
const result = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
const profile = JSON.parse(result.profile_dynamic);

// ❌ 违规：绕过 Repository 直接修改
await db.user_insights.update({
  user_id: uid,
  profile_dynamic: { load_anchors: anchors }
});

// ✅ 正确：通过 Repository 层
const userRepo = new UserRepository(postgresClient);
const profile = await userRepo.getProfileDynamic(userId);
// 数据已自动解析，使用 snake_case 格式

await userRepo.updateProfileDynamic(userId, {
  load_anchors: anchors  // Repository 负责验证和序列化
});
```

---

## 3. 状态管理红线 (State Management) - 保留

### SM-001: JSON 字段必须 try-catch（遗留代码）

```typescript
// ❌ 违规：裸读（遗留代码）
const userProfile = JSON.parse(dbRecord.userProfile);

// ✅ 正确：try-catch + 空对象处理（遗留代码）
let userProfile: UserProfile;
try {
  userProfile = JSON.parse(dbRecord.userProfile || '{}');
} catch (e) {
  userProfile = DEFAULT_USER_PROFILE;
}

// ✅ 推荐：使用 Repository 层（自动处理 JSONB）
const userRepo = new UserRepository(postgresClient);
const profile = await userRepo.getProfileDynamic(userId);
// JSONB 已自动解析，异常已处理
```

### SM-002: Repository 层访问架构

```
┌─────────────────────────────────────────────┐
│           三层存储架构 (v2.0)               │
├─────────────────────────────────────────────┤
│ L1: React State (UI Context)               │
│     ← 毫秒级响应                           │
│     ← 统一使用 snake_case                  │
│                                             │
│ L2: IndexedDB (Client Persistence)         │
│     ← 离线支持                             │
│     ← 统一使用 snake_case                  │
│                                             │
│ L3: PostgreSQL (Cloud Truth)               │
│     ← 唯一真相源                            │
│     ← JSONB 自动反序列化                    │
│     ← 使用 snake_case                       │
│                                             │
│ ┌─────────────────────────────────────────┐ │
│ │     Repository 层（数据访问边界）        │ │
│ │  - JSONB 自动解析和序列化               │ │
│ │  - Zod Schema 数据验证                 │ │
│ │  - 统一命名格式（snake_case）           │ │
│ └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘

红线:
- 禁止前端直连 L3
- 禁止绕过 Repository 层
- 所有 L3 访问必须通过 Repository 层
- Repository 层负责 JSONB 处理和数据验证
```

### SM-003: 时间戳必须调用 MCP 工具

```typescript
// ❌ 违规
const now = new Date().toISOString();

// ✅ 正确
const currentTime = await getCurrentTime({
  format: 'YYYY-MM-DD HH:mm:ss',
  timezone: 'Asia/Shanghai'
});
```

### SM-004: 枚举值必须使用 snake_case 格式

```typescript
// ❌ 违规：SCREAMING_CASE
enum FitnessLevel {
  BEGINNER = 'BEGINNER',  // ❌ 错误格式
  INTERMEDIATE = 'INTERMEDIATE'
}

// ✅ 正确：snake_case + unknown 防御性值
enum FitnessLevel {
  unknown = 'unknown',      // ✅ 防御性值
  beginner = 'beginner',    // ✅ snake_case
  intermediate = 'intermediate',
  advanced = 'advanced'
}
```

### SM-005: 枚举必须包含 `unknown` 防御性值

```typescript
// ❌ 违规：缺少防御性值
enum Scenario {
  chat = 'chat',
  plan = 'plan'
}

// ✅ 正确：包含 unknown
enum Scenario {
  unknown = 'unknown',  // ✅ 必须有
  chat = 'chat',
  plan = 'plan'
}
```

---

## 4. HITL 人机协同红线 - 保留

| 编号 | 红线内容 | 违规后果 |
|------|----------|----------|
| **HITL-001** | 伤病风险标签必须用户确认 | 安全风险 |
| **HITL-002** | HITL 状态必须持久化到 L3 | 状态丢失 |
| **HITL-003** | 禁止自动通过 HITL 确认 | 用户失控 |

---

## 5. 数据库 Schema 红线 (简化版)

### 不可为的操作

| 操作 | 状态 | 原因 |
|------|------|------|
| 删除现有字段 | ❌ 禁止 | 历史数据无法读取 |
| 修改字段类型 | ❌ 禁止 | 数据不一致、应用崩溃 |
| 新增字段 | ✅ 允许 | 向后兼容 |
| 新增索引 | ✅ 允许 | 性能优化 |

---

## 6. 代码提交前检查

在提交代码前，必须确认：

- [ ] AI 没有进行算术计算（NA-001）
- [ ] JSONB 写入前通过 Zod 验证（NA-002）
- [ ] 向量检索结果经过规则过滤（NA-003）
- [ ] active_limitations 带 expire_at（NA-004）
- [ ] 执行节点没有设置 `currentAgent`（AR-001）
- [ ] 没有节点间直接调用（AR-002）
- [ ] 没有绕过 Router 进入业务节点（AR-003）
- [ ] 没有绕过 Repository 层访问数据库（AR-004, SM-002）
- [ ] 所有 JSON 解析都有 try-catch（SM-001）
- [ ] 所有时间戳都通过 MCP 工具获取（SM-003）
- [ ] 所有枚举值使用 snake_case 格式（SM-004）
- [ ] 所有枚举都包含 `unknown` 防御性值（SM-005）
- [ ] 伤病风险标签经过 HITL 确认（HITL-001）

---

**新增架构说明**:
- **Repository 层**: 单一数据访问层，负责 JSONB 处理和数据验证
- **PostgreSQL JSONB**: 自动反序列化为 JavaScript 对象
- **命名规范**: 统一使用 snake_case（数据库层、Repository 层、应用层）
- **格式规范**: 枚举值使用 snake_case，如 `beginner`, `plan_card`, `draft`

**命名规范设计决策**:
- **简化数据流**: 统一使用 snake_case，无需字段名转换
- **PostgreSQL 习惯**: 与 JSONB 字段自然对齐
- **降低复杂度**: 减少 mapper 维护成本
- **实践验证**: 162+ 处代码使用 snake_case，证明设计稳定

**文档版本**: v3.2.0 | **最后更新**: 2026-02-26

> **记住：红线不是限制，而是保护。新架构聚焦 Core-Flex 数据模型、Repository 层隔离、和 AI 边界清晰化。**
