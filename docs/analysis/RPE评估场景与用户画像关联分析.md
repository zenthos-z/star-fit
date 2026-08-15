# RPE Assessment 场景与用户画像关联分析

## 文档信息

| 项目 | 内容 |
|------|------|
| 文档版本 | 1.0.0 |
| 创建日期 | 2026-01-25 |
| 核心问题 | RPE 参数推荐未基于用户画像，使用硬编码基准值 |
| 关键场景 | `rpe_assessment` (运动设置界面) |
| 优先级 | P1 (影响个性化推荐质量) |

---

## 1. 问题概述

### 1.1 核心问题

当前 RPE assessment 场景中的参数推荐逻辑**未利用用户画像中的负荷锚点数据**，导致推荐值无法反映用户的真实训练水平。

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           当前 RPE 计算问题                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  用户画像 (L3 - DB)                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ load_anchors: {                                                      │    │
│  │   "barbell_bench_press": { "1rm": 80, "current": 70, ... },          │    │
│  │   "barbell_squat": { "1rm": 120, "current": 100, ... },              │    │
│  │   "deadlift": { "1rm": 140, "current": 120, ... }                    │    │
│  │ }                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                              │                                               │
│                              │ 未使用 ❌                                      │
│                              ▼                                               │
│  前端启发式计算 (L1 - State)                                                 │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ // services/geminiService.ts:320-330                                 │    │
│  │ if (lowerName.includes('bench')) base = 60;  // 硬编码 ❌            │    │
│  │ if (lowerName.includes('squat')) base = 80;   // 硬编码 ❌            │    │
│  │ if (lowerName.includes('deadlift')) base = 100; // 硬编码 ❌          │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                              │                                               │
│                              ▼                                               │
│  AI 推荐: 60kg × 8次 @8  (对 1RM=80kg 的用户太轻 ❌)                         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 影响范围

| 影响维度 | 描述 | 严重程度 |
|---------|------|---------|
| **个性化不足** | 新手用户可能被推荐过重，高手用户被推荐过轻 | 高 |
| **数据冗余** | 用户画像的 `load_anchors` 字段存在但未被使用 | 中 |
| **性能浪费** | 前端每次都需要重新解析用户画像 | 低 |
| **用户体验** | 推荐值偏离预期，降低对 AI 教练的信任度 | 高 |

---

## 2. 当前架构分析

### 2.1 RPE Assessment 场景现状

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        rpe_assessment 场景数据流                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  用户操作                                                                    │
│    └─> 打开运动设置界面 (ExerciseSettingsModal)                               │
│    └─> 调整 RPE 滑块 (6-10, step 0.5)                                       │
│                                                                              │
│  前端处理 (500ms 防抖)                                                       │
│    └─> useEffect 触发 [targetRpe 变化]                                       │
│        ├─> Tanaka Max HR Heuristic (Cardio 类型)                             │
│        ├─> 1RM Safety Boundary (Strength 类型)                               │
│        ├─> WebSocket 发送 intent_update (未使用)                             │
│        └─> predictMetrics() 调用                                             │
│                                                                              │
│  启发式计算 (services/geminiService.ts:282-350)                               │
│    └─> 根据动作类型和名称计算推荐值                                           │
│        ├─> Cardio: 基于时长/距离                                             │
│        ├─> Isometric: 基于时长                                               │
│        ├─> Bodyweight: 基于次数                                               │
│        └─> Strength: 硬编码 base 值 × RPE 系数                                │
│                                                                              │
│  AI 建议显示                                                                 │
│    └─> 用户点击"应用建议" → 更新 sets 数据                                    │
│                                                                              │
│  后端集成 (可选，当前未启用)                                                  │
│    └─> rpe_assessor Tool (基于历史 RPE 趋势)                                 │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 关键代码位置

| 文件 | 路径 | 职责 |
|------|------|------|
| 前端组件 | `src/v2/components/settings/ExerciseSettingsModal.tsx` | RPE 设置弹窗 |
| 启发式计算 | `services/geminiService.ts:282-350` | `predictMetrics()` 函数 |
| 用户画像服务 | `backend/src/services/userProfileService.ts` | `load_anchors` 管理 |
| RPE 评估工具 | `backend/src/services/mas/tools/rpeAssessorTool.ts` | MAS 工具 (未集成) |
| WebSocket 服务 | `backend/src/services/wsService.ts` | 用户画像推送 |

### 2.3 用户画像数据结构

```typescript
// backend/src/services/userProfileService.ts

interface LoadAnchor {
  '1rm'?: number;          // 1RM 极限重量 (kg)
  current?: number;        // 当前训练重量 (kg)
  last_updated?: number;   // 更新时间戳
}

interface LoadAnchors {
  [exerciseId: string]: LoadAnchor;
}

interface UserInsight {
  user_id: string;

  // 核心字段 (列存储)
  fitness_level: 'beginner' | 'intermediate' | 'advanced';
  red_flags: string;       // JSON array: ["knee_pain", ...]
  updated_at: number;
  modified_by: 'mas' | 'admin' | 'user' | 'system';

  // 扩展字段 (JSON 存储)
  load_anchors: string | null;  // 关键字段！当前未被 RPE 计算使用
  // ... 其他字段
}
```

### 2.4 当前推送机制

```typescript
// backend/src/services/userProfileService.ts:254-258

// 用户画像更新时的 WebSocket 推送 (当前实现)
wsService.broadcastToUser(update.userId, 'user_update', {
  timestamp: Date.now(),
  modifiedBy: update.modifiedBy,
  fields: Object.keys(validated)  // 仅推送字段名，不推送具体数据
}, 'admin-console');
```

**问题**：前端收到 `user_update` 事件后，不知道具体哪些 `load_anchors` 变化，需要重新查询完整画像。

---

## 3. 问题根因分析

### 3.1 数据流断裂

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              数据流断裂点                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  L3: DB (user_insights 表)                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ load_anchors = '{"barbell_bench_press":{...}}'                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                              │                                               │
│                              │ ❌ 断裂：无专用推送                             │
│                              ▼                                               │
│  L2: IDB (IndexedDB)                                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ userProfileStore 存在，但无 loadAnchors 子表                          │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                              │                                               │
│                              │ ❌ 断裂：predictMetrics 未读取                 │
│                              ▼                                               │
│  L1: State (React State)                                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ ExerciseSettingsModal 无用户画像状态                                  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                              │                                               │
│                              ▼                                               │
│  启发式计算使用硬编码 base 值                                                │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 问题分类

| 问题类别 | 具体表现 | 修复优先级 |
|---------|---------|-----------|
| **数据孤岛** | `load_anchors` 存在但未被 RPE 计算使用 | P0 |
| **硬编码基准** | `predictMetrics` 使用固定 base 值 | P0 |
| **无缓存机制** | 前端无 `loadAnchors` 缓存，每次需重新解析 | P1 |
| **推送不完整** | WebSocket 推送未包含具体锚点数据 | P1 |
| **动作映射缺失** | `exerciseId` 到动作族的映射关系未定义 | P2 |

---

## 4. 改进方案

### 4.1 目标架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           优化后的 RPE Assessment 数据流                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  后端: MAS Training Summary                                          │    │
│  │  ┌──────────────────────────────────────────────────────────────┐    │    │
│  │  │ 训练结束后，分析用户实际完成的重量/次数                         │    │    │
│  │  │ 例如: bench_press 完成 75kg × 8 × 3 组                         │    │    │
│  │  │ → 更新 load_anchors.barbell_bench_press.current = 75           │    │    │
│  │  └──────────────────────────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────┬───────────────────────────────┘    │
│                                        │                                     │
│                                        │ WebSocket 推送                      │
│                                        │ load_anchors_update                 │
│                                        ▼                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  前端: L2 Cache (IndexedDB)                                         │    │
│  │  ┌─────────────────────────────────────────────────────────────┐    │    │
│  │  │ loadAnchorsStore                                             │    │    │
│  │  │ {                                                            │    │    │
│  │  │   "barbell_bench_press": { "1rm": 80, "current": 70, ... }  │    │    │
│  │  │ }                                                            │    │    │
│  │  └─────────────────────────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────┬───────────────────────────────┘    │
│                                        │                                     │
│                                        │ 组件初始化时读取                     │
│                                        ▼                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  用户调整 RPE (ExerciseSettingsModal)                              │    │
│  │  ┌─────────────────────────────────────────────────────────────┐    │    │
│  │  │ useEffect(() => {                                           │    │    │
│  │  │   const anchor = loadAnchorsStore.get(exerciseId);          │    │    │
│  │  │   const base = anchor?.current ?? anchor?.['1rm'] * 0.7     │    │    │
│  │  │              ?? getDefaultBase(exerciseId);                 │    │    │
│  │  │   const predicted = predictMetricsWithBase(base, targetRpe);│    │    │
│  │  │   setAiSuggestion(predicted);                               │    │    │
│  │  │ }, [targetRpe, exerciseId]);                                │    │    │
│  │  └─────────────────────────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                        │                                     │
│                                        ▼                                     │
│  个性化推荐: 70kg × 8次 @8 (基于用户实际能力 1RM=80kg ✅)                      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 实施方案

#### 阶段一：后端推送优化 (P0)

**目标**：当 `load_anchors` 更新时，推送具体数据到前端。

```typescript
// backend/src/services/userProfileService.ts

// 修改 updateProfile 函数
async updateProfile(update: UserProfileUpdate): Promise<void> {
  // ... 现有验证和事务逻辑 ...

  // 新增：专用推送事件
  if (validated.load_anchors !== undefined) {
    const anchorsData = oldProfile?.load_anchors
      ? { ...JSON.parse(oldProfile.load_anchors), ...validated.load_anchors }
      : validated.load_anchors;

    wsService.broadcastToUser(update.userId, 'load_anchors_update', {
      anchors: anchorsData,
      timestamp: Date.now(),
      modifiedBy: update.modifiedBy
    });
  }

  // 保留现有通用推送
  wsService.broadcastToUser(update.userId, 'user_update', {
    timestamp: Date.now(),
    modifiedBy: update.modifiedBy,
    fields: Object.keys(validated)
  }, 'admin-console');
}
```

**验收标准**：
- [ ] 用户训练完成后，MAS 更新 `load_anchors`
- [ ] 前端收到 `load_anchors_update` 事件
- [ ] 事件 payload 包含完整的锚点数据

#### 阶段二：前端 IDB 缓存 (P0)

**目标**：新增 `loadAnchorsStore` 存储负荷锚点数据。

```typescript
// src/services/storage/index.ts

export const loadAnchorsStore = {
  async getAnchors(): Promise<LoadAnchors> {
    const db = await getDB();
    return db.get('userProfile', 'loadAnchors') || {};
  },

  async updateAnchors(anchors: LoadAnchors): Promise<void> {
    const db = await getDB();
    const existing = await this.getAnchors();
    const merged = { ...existing, ...anchors };
    await db.put('userProfile', merged, 'loadAnchors');
  },

  async getAnchor(exerciseId: string): Promise<LoadAnchor | null> {
    const anchors = await this.getAnchors();
    return anchors[exerciseId] || null;
  }
};

// WebSocket 订阅
socketService.subscribe('load_anchors_update', async (payload) => {
  await loadAnchorsStore.updateAnchors(payload.anchors);
  console.log('[LoadAnchors] Updated:', payload.anchors);
});
```

**验收标准**：
- [ ] `loadAnchorsStore` 正常读写 IDB
- [ ] 收到 `load_anchors_update` 事件后自动更新缓存
- [ ] 页面刷新后缓存持久化

#### 阶段三：RPE 计算优化 (P0)

**目标**：`predictMetrics` 函数基于用户画像锚点计算。

```typescript
// services/geminiService.ts

export const predictMetrics = async (
  exerciseName: string,
  type: string,
  targetRpe: number,
  exerciseId?: string  // 新增参数
): Promise<AiMetrics> => {
  const result: AiMetrics = {};
  const lowerName = exerciseName.toLowerCase();

  // Cardio 类型保持原逻辑
  if (type === 'cardio') {
    if (targetRpe <= 6) { result.duration = 20; result.distance = 3; }
    else if (targetRpe <= 8) { result.duration = 30; result.distance = 5; }
    else { result.duration = 45; result.distance = 8; }
    return result;
  }

  // 力量类型：优先使用用户画像锚点
  if (type === 'strength' || type === 'resistance') {
    let base = 20;  // 默认值

    // 1. 尝试从 IDB 读取用户锚点
    if (exerciseId) {
      const anchor = await loadAnchorsStore.getAnchor(exerciseId);
      if (anchor?.current) {
        base = anchor.current;
        console.log(`[RPE] Using user anchor for ${exerciseId}: ${base}kg`);
      } else if (anchor?.['1rm']) {
        base = anchor['1rm'] * 0.7;  // 70% 1RM 作为基准
        console.log(`[RPE] Using 1RM for ${exerciseId}: ${anchor['1rm']}kg → ${base}kg`);
      }
    }

    // 2. 回退到硬编码 (动作名称匹配)
    if (base === 20) {
      if (lowerName.includes('deadlift') || lowerName.includes('硬拉')) base = 100;
      else if (lowerName.includes('squat') || lowerName.includes('深蹲')) base = 80;
      else if (lowerName.includes('bench') || lowerName.includes('卧推')) base = 60;
      else if (lowerName.includes('dumb') || lowerName.includes('哑铃')) base = 15;
      else if (lowerName.includes('curl') || lowerName.includes('弯举')) base = 10;
      else if (lowerName.includes('raise') || lowerName.includes('平举')) base = 5;
      console.log(`[RPE] Using hardcoded base for ${exerciseName}: ${base}kg`);
    }

    // 3. RPE 系数调整
    const rpeModifier = 1 + ((targetRpe - 7) * 0.1);  // RPE 7 为基准
    result.weight = Math.round(base * rpeModifier / 2.5) * 2.5;

    // 4. 次数建议
    if (targetRpe >= 9) result.reps = 3;
    else if (targetRpe >= 8) result.reps = 5;
    else if (targetRpe >= 7) result.reps = 8;
    else result.reps = 12;
  }

  // 其他类型保持原逻辑...
  return result;
};
```

**验收标准**：
- [ ] 有锚点数据时使用用户实际能力
- [ ] 无锚点时回退到硬编码
- [ ] Console 输出计算依据

#### 阶段四：组件预热 (P1)

**目标**：`ExerciseSettingsModal` 初始化时加载用户锚点。

```typescript
// src/v2/components/settings/ExerciseSettingsModal.tsx

export const ExerciseSettingsModal: React.FC<ExerciseSettingsModalProps> = ({
  exercise,
  onClose,
  onSave,
  exerciseIndex
}) => {
  // 新增：用户锚点状态
  const [userAnchor, setUserAnchor] = useState<LoadAnchor | null>(null);

  // 组件挂载时预热用户画像
  useEffect(() => {
    const loadUserAnchor = async () => {
      const cleanExerciseId = exercise.exerciseId.replace('fit://library/exercise/', '');
      const anchor = await loadAnchorsStore.getAnchor(cleanExerciseId);
      setUserAnchor(anchor);

      if (anchor) {
        console.log('[ExerciseSettings] User anchor loaded:', anchor);
      }
    };
    loadUserAnchor();
  }, [exercise.exerciseId]);

  // 传递 exerciseId 给 predictMetrics
  useEffect(() => {
    const timer = setTimeout(async () => {
      setIsCalculating(true);
      const cleanExerciseId = exercise.exerciseId.replace('fit://library/exercise/', '');
      const predicted = await predictMetrics(
        name,
        type.toLowerCase() as any,
        targetRpe,
        cleanExerciseId  // 新增参数
      );
      setAiSuggestion(predicted);
      setIsCalculating(false);
    }, 500);
    return () => clearTimeout(timer);
  }, [targetRpe, name, type, sets, exercise.exerciseId]);

  // UI 显示用户当前能力 (可选)
  return (
    // ...
    {userAnchor && (
      <div className="mb-4 p-3 bg-blue-50 rounded-xl text-xs">
        <span className="font-bold text-blue-600">你的能力</span>
        <span className="text-gray-600 ml-2">
          1RM: {userAnchor['1rm']}kg | 当前: {userAnchor.current}kg
        </span>
      </div>
    )}
    // ...
  );
};
```

**验收标准**：
- [ ] 打开设置弹窗时自动加载用户锚点
- [ ] UI 显示用户当前能力 (可选)
- [ ] RPE 调整时基于锚点计算

#### 阶段五：动作映射优化 (P2)

**目标**：建立 `exerciseId` 到动作族的映射关系。

```typescript
// src/services/exerciseMapping.ts

// 动作族映射表 (用于模糊匹配)
const EXERCISE_FAMILY_MAP: Record<string, string[]> = {
  'barbell_bench_press': [
    'bench_press', 'barbell_bench_press', 'flat_bench_press',
    '卧推', '杠铃卧推', '平板卧推'
  ],
  'barbell_squat': [
    'squat', 'barbell_squat', 'back_squat',
    '深蹲', '杠铃深蹲', '后蹲'
  ],
  'deadlift': [
    'deadlift', 'conventional_deadlift',
    '硬拉', '传统硬拉'
  ],
  // ... 更多映射
};

export function matchExerciseFamily(exerciseId: string): string | null {
  const cleanId = exerciseId.replace('fit://library/exercise/', '').toLowerCase();

  // 精确匹配
  for (const [family, variants] of Object.entries(EXERCISE_FAMILY_MAP)) {
    if (variants.some(v => v.toLowerCase() === cleanId)) {
      return family;
    }
  }

  // 模糊匹配
  for (const [family, variants] of Object.entries(EXERCISE_FAMILY_MAP)) {
    if (variants.some(v => cleanId.includes(v.toLowerCase()) || v.toLowerCase().includes(cleanId))) {
      return family;
    }
  }

  return null;
}

// 使用示例
export const predictMetrics = async (exerciseName, type, targetRpe, exerciseId) => {
  let anchor = await loadAnchorsStore.getAnchor(exerciseId);

  // 尝试动作族匹配
  if (!anchor) {
    const family = matchExerciseFamily(exerciseId);
    if (family) {
      anchor = await loadAnchorsStore.getAnchor(family);
      if (anchor) {
        console.log(`[RPE] Matched to family: ${family}`);
      }
    }
  }

  // ... 后续逻辑
};
```

**验收标准**：
- [ ] 精确匹配正常工作
- [ ] 模糊匹配能处理变体动作
- [ ] 无法匹配时返回 null

---

## 5. 风险评估

### 5.1 技术风险

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|---------|
| IDB 存储失败 | 低 | 中 | 添加 try-catch，降级到内存缓存 |
| 动作 ID 匹配不准确 | 中 | 中 | 建立完善的映射表，支持手动关联 |
| 旧数据无锚点 | 高 | 低 | 回退到硬编码，逐步积累数据 |
| WebSocket 推送丢失 | 低 | 低 | 前端定期轮询作为备份 |

### 5.2 用户体验风险

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|---------|
| 推荐值变化过大 | 中 | 中 | 渐进式调整，添加"保持原值"选项 |
| 初次使用无数据 | 高 | 低 | 显示"正在学习你的能力"提示 |
| 锚点数据过时 | 低 | 中 | 显示 last_updated，超过 30 天警告 |

---

## 6. 验收标准

### 6.1 功能验收

| 功能 | 验收条件 | 优先级 |
|------|---------|--------|
| **后端推送优化** | `load_anchors` 更新时推送 `load_anchors_update` 事件 | P0 |
| **前端 IDB 缓存** | `loadAnchorsStore` 正常存储和读取锚点数据 | P0 |
| **RPE 计算优化** | 有锚点时使用用户数据，无锚点时回退到硬编码 | P0 |
| **组件预热** | 打开设置弹窗时自动加载用户锚点 | P1 |
| **动作映射** | 动作变体能正确匹配到动作族 | P2 |

### 6.2 性能验收

| 指标 | 目标 | 测量方法 |
|------|------|---------|
| **冷启动延迟** | < 100ms (从打开弹窗到显示推荐) | Performance.mark() |
| **RPE 调整响应** | < 500ms (防抖后) | 现有机制 |
| **IDB 读取时间** | < 50ms | performance.now() |

### 6.3 数据质量验收

| 检查项 | 标准 | 优先级 |
|--------|------|--------|
| **锚点覆盖率** | > 80% 用户有至少 1 个动作的锚点数据 | P1 |
| **锚点时效性** | > 90% 锚点 last_updated 在 90 天内 | P2 |
| **推荐准确率** | > 70% 用户接受 AI 推荐 (点击"应用建议") | P1 |

---

## 7. 后续优化方向

### 7.1 短期优化 (1-2 周)

1. **MAS 集成 rpe_assessor 工具**
   - 基于历史 RPE 趋势预测
   - 考虑疲劳度和适应性因素

2. **视觉反馈增强**
   - 显示推荐值的置信度 (高/中/低)
   - 显示与上次训练的对比

3. **手动锚点设置**
   - 允许用户在设置界面手动输入 1RM
   - 管理后台支持批量导入

### 7.2 中期优化 (1-2 月)

1. **智能锚点更新**
   - 训练后自动更新 current 值
   - 检测到 1RM 突破时更新

2. **动作推荐引擎**
   - 基于 load_anchors 推荐合适重量
   - 渐进超负荷建议

3. **多维度画像**
   - 整合生理周期 (stress_level, cycle_focus)
   - 考虑伤病历史 (red_flags)

### 7.3 长期优化 (3-6 月)

1. **机器学习模型**
   - 基于用户历史训练数据预测最佳负荷
   - 个性化 RPE-负荷曲线

2. **跨用户数据分析**
   - 同能力水平用户的负荷对比
   - 动作难度评级

3. **实时调整**
   - 训练中根据表现实时调整建议
   - 结合可穿戴设备数据

---

## 8. 参考资料

### 8.1 相关文档

| 文档 | 路径 | 说明 |
|------|------|------|
| MAS 场景流转分析 | `docs/analysis/MAS系统场景流转与风险评估.md` | rpe_assessment 场景详解 |
| 用户画像服务 | `backend/src/services/userProfileService.ts` | load_anchors 数据结构 |
| 前端设置组件 | `src/v2/components/settings/ExerciseSettingsModal.tsx` | 当前实现 |
| 启发式计算 | `services/geminiService.ts:282-350` | predictMetrics 函数 |

### 8.2 关键代码位置

| 组件 | 文件 | 行号 |
|------|------|------|
| UserProfileService | `backend/src/services/userProfileService.ts` | 32-72 (类型), 145-259 (更新逻辑) |
| predictMetrics | `services/geminiService.ts` | 282-350 |
| ExerciseSettingsModal | `src/v2/components/settings/ExerciseSettingsModal.tsx` | 69-107 (RPE 处理) |
| WebSocket 推送 | `backend/src/services/wsService.ts` | 24-44 |
| rpeAssessorTool | `backend/src/services/mas/tools/rpeAssessorTool.ts` | 全文 |

---

## 附录

### A. 动作族映射表示例

```typescript
const EXERCISE_FAMILY_MAP: Record<string, string[]> = {
  // 推类
  'barbell_bench_press': ['bench_press', 'barbell_bench_press', 'flat_bench_press', '卧推', '杠铃卧推', '平板卧推'],
  'incline_bench_press': ['incline_press', 'incline_bench', '上斜卧推', '上斜杠铃卧推'],
  'dumbbell_bench_press': ['dumbbell_bench', 'db_bench_press', '哑铃卧推'],

  // 蹲类
  'barbell_squat': ['squat', 'barbell_squat', 'back_squat', '深蹲', '杠铃深蹲', '后蹲'],
  'front_squat': ['front_squat', '前蹲'],
  'goblet_squat': ['goblet_squat', '高脚杯深蹲'],

  // 拉类
  'deadlift': ['deadlift', 'conventional_deadlift', '硬拉', '传统硬拉'],
  'sumo_deadlift': ['sumo_deadlift', '相扑硬拉'],
  'romanian_deadlift': ['rdl', 'romanian_deadlift', '罗马尼亚硬拉'],

  // 肩部
  'overhead_press': ['press', 'overhead_press', '推举', '站姿推举'],
  'lateral_raise': ['lateral_raise', 'side_raise', '侧平举'],

  // 臂部
  'barbell_curl': ['curl', 'barbell_curl', '弯举', '杠铃弯举'],
  'tricep_extension': ['tricep_extension', 'skullcrusher', '臂屈伸'],

  // ... 更多映射
};
```

### B. 负荷锚点数据示例

```json
{
  "user_id": "user_123",
  "load_anchors": {
    "barbell_bench_press": {
      "1rm": 80,
      "current": 70,
      "last_updated": 1706140800000,
      "history": [65, 67.5, 70, 70, 72.5, 70]
    },
    "barbell_squat": {
      "1rm": 120,
      "current": 100,
      "last_updated": 1706140800000,
      "history": [90, 95, 100, 100, 100, 102.5]
    },
    "deadlift": {
      "1rm": 140,
      "current": 120,
      "last_updated": 1706140800000,
      "history": [110, 115, 120, 120, 120, 120]
    }
  }
}
```

### C. 修订历史

| 版本 | 日期 | 修订内容 | 作者 |
|------|------|---------|------|
| 1.0.0 | 2026-01-25 | 初始版本，完整问题分析与实施方案 | Claude |
