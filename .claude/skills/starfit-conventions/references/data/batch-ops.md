# Batch Ops 协议规范

所有状态变更必须通过 Batch Ops 协议

---

## 协议格式

```typescript
{
  "method": "planner.applyBatchOps",
  "params": {
    "ops": [
      {
        "op": "replace",  // 操作类型
        "path": "/workout/sets/1/weight",  // JSON Pointer
        "value": 80
      }
    ],
    "preconditions": {
      "version": 42  // 版本校验（必须）
    }
  }
}
```

---

## 操作类型 (op)

| op | 说明 | 示例 |
|----|----|-----|
| `replace` | 替换字段值 | `{"op": "replace", "path": "/weight", "value": 80}` |
| `add` | 添加字段/数组元素 | `{"op": "add", "path": "/tags/-", "value": "cardio"}` |
| `remove` | 删除字段/数组元素 | `{"op": "remove", "path": "/note"}` |
| `copy` | 复制字段值 | `{"op": "copy", "from": "/old", "path": "/new"}` |
| `move` | 移动字段值 | `{"op": "move", "from": "/old", "path": "/new"}` |
| `test` | 测试字段值 | `{"op": "test", "path": "/status", "value": "active"}` |

---

## 路径格式 (JSON Pointer)

```
/workout/sets/1/weight     → workout.sets[1].weight
/user/profile/age         → user.profile.age
/exercises/-              → exercises 数组末尾添加
/exercises/0              → exercises[0]
```

---

## 前置条件 (preconditions)

### 版本校验（必须）

```typescript
// ✅ 正确
{
  "ops": [{ "op": "replace", "path": "/weight", "value": 80 }],
  "preconditions": { "version": 42 }  // ✅ 必须有
}

// ❌ 错误：缺少版本校验
{
  "ops": [{ "op": "replace", "path": "/weight", "value": 80 }]
  // ❌ 缺少 preconditions
}
```

### 其他前置条件

```typescript
{
  "preconditions": {
    "version": 42,
    "status": "IN_PROGRESS",  // 状态校验
    "userId": "user_123"      // 权限校验
  }
}
```

---

## 使用示例

### 修改单个值

```typescript
await applyBatchOps({
  ops: [
    { op: "replace", path: "/workout/sets/1/weight", value: 80 }
  ],
  preconditions: { version: currentVersion }
});
```

### 批量操作

```typescript
await applyBatchOps({
  ops: [
    { op: "replace", path: "/workout/sets/0/reps", value: 12 },
    { op: "replace", path: "/workout/sets/0/weight", value: 80 },
    { op: "replace", path: "/workout/sets/1/reps", value: 10 },
    { op: "replace", path: "/workout/sets/1/weight", value: 85 }
  ],
  preconditions: { version: currentVersion }
});
```

### 数组操作

```typescript
// 添加标签
await applyBatchOps({
  ops: [
    { op: "add", path: "/tags/-", value: "cardio" }
  ],
  preconditions: { version: currentVersion }
});

// 删除标签
await applyBatchOps({
  ops: [
    { op: "remove", path: "/tags/0" }
  ],
  preconditions: { version: currentVersion }
});
```

---

## 错误处理

### 版本冲突

```typescript
try {
  await applyBatchOps({ ops, preconditions });
} catch (e) {
  if (e.code === 'BATCH_PRECONDITION_FAILED') {
    // 版本冲突，重新获取最新数据
    const latest = await getSession(sessionId);
    showConflictDialog(latest);
  }
}
```

### 路径错误

```typescript
// { "code": "PATCH_PATH_INVALID", "path": "/nonexistent" }
```

### 操作失败

```typescript
// { "code": "PATCH_OP_FAILED", "op": "replace", "path": "/weight" }
```

---

## 禁止的操作

```typescript
// ❌ 禁止：直接修改 DB
await db.workout.update({ id, weight: 80 });

// ❌ 禁止：绕过 Repository 层
await db.query('UPDATE workouts SET weight = 80 WHERE id = $1', [workoutId]);

// ❌ 禁止：跳过版本校验
await applyBatchOps({
  ops: [{ op: "replace", path: "/weight", value: 80 }]
  // 缺少 preconditions
});

// ✅ 正确：通过 Batch Ops + 版本校验 + Repository 层
await applyBatchOps({
  ops: [{ op: "replace", path: "/workout/sets/1/weight", value: 80 }],
  preconditions: { version: currentVersion }
});

// ✅ 正确：通过 Repository 层访问数据
const workoutRepo = new WorkoutRepository(postgresClient);
const workout = await workoutRepo.getById(workoutId);
```

---

## 写入流程

```
┌─────────────┐
│  前端 UI    │
└──────┬──────┘
       │ 1. 用户操作
       ▼
┌─────────────┐
│  L1 State   │ (React State) - 乐观更新
└──────┬──────┘
       │ 2. 同步请求
       ▼
┌─────────────┐
│  API 层     │
└──────┬──────┘
       │ 3. Batch Ops
       ▼
┌─────────────┐
│ Repository  │ (格式转换边界)
│   层       │ camelCase → snake_case
└──────┬──────┘
       │ 4. 数据库操作
       ▼
┌─────────────┐
│  L3 DB      │ (PostgreSQL) - 版本校验
│             │ JSONB 自动处理
└─────────────┘

红线：
- 禁止从 L1 直接写 L3
- 禁止跳过 Batch Ops
- 禁止绕过 Repository 层
- 所有 L3 写入必须携带 version
```

---

**完整规范**:
- `docs-site\database\postgresql-schema.md`
- `docs-site\database\repository-layer.md`
- `docs-site\architecture\mas-data-contract.md`

**版本**: v2.1.0 (PostgreSQL + Repository Layer)
