# 向量检索功能调查报告

**日期**: 2026-02-12
**版本**: v3.0.0
**调查范围**: Embedding 模型配置、向量检索实现、动作库搜索功能

---

## 执行摘要

### 整体状态: ⚠️ 部分完成

| 组件 | 状态 | 说明 |
|------|------|------|
| pgvector 扩展 | ✅ 已配置 | schema.sql 中已安装 |
| exercises 表结构 | ✅ 已配置 | embedding 列 (vector(1536)) |
| HNSW 索引 | ✅ 已创建 | idx_exercises_embedding_hnsw |
| PostgresClient.vectorSearch | ✅ 已实现 | 完整的向量检索方法 |
| VectorSearchService.searchExercises | ✅ 框架完成 | 接口和流程正确 |
| VectorSearchService.vectorSearchByEmbedding | ❌ 未实现 | 抛出 NOT_SUPPORTED 错误 |
| Embedding 数据 | ❓ 待确认 | 需要运行生成脚本 |
| 规则引擎 | ⚠️ 框架仅存 | 业务逻辑待实现 |

### 核心问题

**`VectorSearchService.vectorSearchByEmbedding` 方法未连接数据库**

该方法（VectorSearchService.ts:813-843）仅包含 TODO 注释，并抛出 NOT_SUPPORTED 错误：
```typescript
private async vectorSearchByEmbedding(
  queryEmbedding: number[],
  limit: number,
  threshold: number
): Promise<SearchResultItem[]> {
  // TODO: 实现 pgvector 查询
  throw new ServiceError(
    ServiceErrorCode.NOT_SUPPORTED,
    'Vector search not yet implemented. Please configure pgvector.',
    { limit, threshold }
  );
}
```

而 `PostgresClient.vectorSearch` 方法（postgres-client.ts:334-365）已经完整实现，但未被调用。

---

## 详细分析

### 1. 基础设施配置

#### 1.1 PostgreSQL Schema (`backend/src/db/postgresql/schema/schema.sql`)

| 配置项 | 状态 | 行号 |
|---------|------|------|
| pgvector 扩展 | ✅ `CREATE EXTENSION IF NOT EXISTS "vector"` | 18 |
| embedding 列 | ✅ `embedding vector(1536)` | 139 |
| HNSW 索引 | ✅ `USING hnsw (embedding vector_cosine_ops)` | 175-178 |
| JSONB 索引 | ✅ `attributes`, `targets`, `equipment_required` | 181-185 |

#### 1.2 Embedding 模型配置 (`VectorSearchService.ts:32-37`)

```typescript
const EMBEDDINGS_CONFIG = {
  defaultModel: 'text-embedding-3-small' as const,
  defaultDimensions: 1536,
  apiEndpoint: 'https://api.openai.com/v1/embeddings',
  maxBatchSize: 100
};
```

| 配置项 | 值 | 说明 |
|---------|-----|------|
| 模型 | text-embedding-3-small | OpenAI 官方 embedding 模型 |
| 维度 | 1536 | 与数据库列定义匹配 |
| API 密钥来源 | `process.env.OPENAI_API_KEY` | 从 .env 读取 |

### 2. 服务层实现分析

#### 2.1 PostgresClient (postgres-client.ts:328-365)

```typescript
async vectorSearch(
  tableName: string,
  embeddingColumn: string,
  queryVector: number[],
  limit: number = 10,
  threshold: number = 0.3,
  filters?: string
): Promise<Array<{ id: string; similarity: number; ... }>>
```

| 功能 | 状态 |
|------|------|
| 向量相似度计算 | ✅ 使用 `<=>` 余弦距离操作符 |
| 阈值过滤 | ✅ `AND ... < threshold` |
| 结果排序 | ✅ `ORDER BY embedding <=> query` |
| 数组格式化 | ✅ `[${embedding.join(',')}]` |

#### 2.2 VectorSearchService (VectorSearchService.ts:87-153)

`searchExercises` 方法流程：

```
1. 参数验证 ✅
2. generateEmbedding(query) ✅
3. vectorSearchByEmbedding() ❌ 抛出 NOT_SUPPORTED
4. ruleEngineFilter() ✅ (框架存在，逻辑为空)
5. 返回结果
```

#### 2.3 ExerciseQueryService (ExerciseQueryService.ts:632-648)

`getVectorSearchService()` 方法尝试从全局 ServiceContainer 获取 VectorSearchService：
```typescript
private getVectorSearchService(): any {
  try {
    if (typeof (global as any).ServiceContainer !== 'undefined') {
      const container = (global as any).ServiceContainer.getInstance();
      return container.get('vectorSearchService');
    }
  } catch (error) {
    this.logger.warn('[ExerciseQueryService] Failed to get VectorSearchService');
  }
  return null;
}
```

### 3. Embedding 生成脚本

#### 3.1 generateEmbeddings.ts

| 功能 | 状态 |
|------|------|
| 批量处理 | ✅ `DEFAULT_BATCH_SIZE = 20` |
| 进度追踪 | ✅ 支持断点续传 |
| 错误重试 | ✅ `MAX_RETRIES = 3` |
| 文本构建 | ✅ 包含 name, type, targets, equipment 等 |
| 数据存储 | ✅ 使用 `UPDATE ... SET embedding = $1::vector` |

#### 3.2 嵌入文本构建 (generateEmbeddings.ts:355-402)

```typescript
private buildEmbeddingText(exercise: Exercise): string {
  return [
    `Exercise: ${exercise.name}`,
    `Type: ${exercise.exercise_type}`,
    `Primary Targets: ${targets.primary.join(', ')}`,
    `Equipment: ${equipment_required.join(', ')}`,
    `Pattern: ${pattern}`,
    `Movement Plane: ${movement_plane}`,
    `Impact: ${JSON.stringify(impact_level)}`
  ].join('\n');
}
```

### 4. 服务注册与依赖注入

#### 4.1 ServiceRegistry (serviceRegistry.ts:157-160)

```typescript
container.register('vectorSearchService', () => new VectorSearchService(
  container.get('logger')
));
```

| 问题 | 说明 |
|------|------|
| ❌ 缺少 PostgresClient 依赖 | VectorSearchService 构造函数只接收 Logger |
| ❌ 无数据库访问能力 | 无法调用 PostgresClient.vectorSearch |
| ❌ 环境变量读取硬编码 | `process.env.OPENAI_API_KEY` 直接在构造函数中读取 |

---

## 问题汇总

### 严重问题 (P0)

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| 1 | `vectorSearchByEmbedding` 抛出 NOT_SUPPORTED | VectorSearchService.ts:838 | 向量搜索完全不可用 |
| 2 | VectorSearchService 缺少 PostgresClient 依赖 | serviceRegistry.ts:158 | 无法访问数据库进行检索 |

### 中等问题 (P1)

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| 3 | 规则引擎业务逻辑未实现 | VectorSearchService.ts:401-497 | 无法按伤病/设备过滤 |
| 4 | ExerciseQueryService 无法获取 VectorSearchService | ExerciseQueryService.ts:632-648 | 依赖注入机制未完成 |
| 5 | Embedding 数据可能未生成 | exercises 表 | 运行 `generateEmbeddings` 前无法测试 |

### 低优先级问题 (P2)

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| 6 | Embedding 配置分散 | VectorSearchService 硬编码 | 应迁移到 modelConfigService |
| 7 | `saveExerciseEmbedding` 空实现 | VectorSearchService.ts:848-864 | 索引新练习时无法存储 embedding |

---

## 修复方案

### 方案 A: 快速修复 (最小改动)

**目标**: 让向量检索功能立即可用

```typescript
// VectorSearchService.ts
export class VectorSearchService implements IVectorSearchService {
  private postgres: PostgresClient;  // 新增依赖

  constructor(
    private readonly logger: Logger,
    postgres?: PostgresClient  // 可选注入
  ) {
    // 从全局获取或使用传入的实例
    this.postgres = postgres || getGlobalPostgresClient();
    this.openaiApiKey = process.env.OPENAI_API_KEY || '';
  }

  private async vectorSearchByEmbedding(
    queryEmbedding: number[],
    limit: number,
    threshold: number
  ): Promise<SearchResultItem[]> {
    const results = await this.postgres.vectorSearch(
      'exercises',
      'embedding',
      queryEmbedding,
      limit,
      threshold
    );

    return results.map(r => ({
      exerciseId: r.id,
      similarity: r.similarity,
      matchedAt: new Date().toISOString()
    }));
  }

  private async saveExerciseEmbedding(
    exerciseId: string,
    embedding: number[]
  ): Promise<void> {
    await this.postgres.insertEmbeddings([{ id: exerciseId, embedding }]);
  }
}
```

### 方案 B: 完整重构 (推荐)

**目标**: 符合 MAS 架构的依赖注入模式

1. **修改服务注册** (serviceRegistry.ts)
```typescript
container.register('vectorSearchService', () => new VectorSearchService(
  container.get('logger'),
  container.get('postgresClient')  // 注入 PostgresClient
));
```

2. **更新接口定义** (IVectorSearchService.ts)
```typescript
export interface IVectorSearchService {
  searchExercises(params: SearchParams): Promise<SearchResults>;
  generateEmbedding(params: GenerateEmbeddingParams): Promise<GenerateEmbeddingResult>;
  indexExercise(params: IndexExerciseParams): Promise<IndexExerciseResult>;
  // ... 其他方法
}
```

3. **实现缺失方法**
- `getExerciseEmbedding()`: 从数据库查询已有 embedding
- `deleteExerciseIndex()`: 删除过时的 embedding

4. **集成规则引擎**
```typescript
private async ruleEngineFilter(
  exerciseIds: string[],
  filters: RuleFilterParams
): Promise<RuleEngineFilterResult> {
  const exercises = await this.postgres.query(`
    SELECT id, attributes
    FROM exercises
    WHERE id = ANY($1)
  `, [exerciseIds]);

  // 实现业务规则：
  // - equipment_required 过滤
  // - impact_level 限制检查
  // - movement_plane 兼容性
  // ...
}
```

---

## 测试计划

### Phase 1: 数据准备

```bash
# 1. 生成 embeddings
cd backend
npx tsx src/db/migrations/postgresql/generateEmbeddings.ts

# 2. 验证数据
psql -h localhost -U postgres -d starfit -c "
  SELECT COUNT(*) as total, COUNT(embedding) as with_embeddings FROM exercises;
"
```

### Phase 2: 功能测试

```typescript
// test-vector-search.ts
import { VectorSearchService } from './services/mas/services/VectorSearchService';
import { PostgresClient } from './db/postgresql/client/postgres-client';

const postgres = new PostgresClient();
const service = new VectorSearchService(logger, postgres);

const results = await service.searchExercises({
  query: '胸部训练推胸动作',
  limit: 5,
  threshold: 0.7
});

console.log('Found exercises:', results.results);
```

### Phase 3: 集成测试

1. 在 plannerNode 中调用 `ExerciseQueryService.queryForPlan()`
2. 验证返回的动作列表符合语义搜索预期
3. 检查规则引擎过滤是否生效

---

## 数据库配置检查清单

| 检查项 | 命令 | 预期结果 |
|---------|------|----------|
| pgvector 扩展 | `SELECT extname FROM pg_extension WHERE extname='vector';` | vector |
| embedding 列 | `SELECT column_name, data_type FROM information_schema.columns WHERE table_name='exercises' AND column_name='embedding';` | vector(1536) |
| HNSW 索引 | `SELECT indexname FROM pg_indexes WHERE indexname='idx_exercises_embedding_hnsw';` | idx_exercises_embedding_hnsw |
| Embedding 覆盖率 | `SELECT COUNT(*), COUNT(embedding) FROM exercises;` | total = with_embeddings (100%) |

---

## 附录

### A. 相关文件清单

| 文件 | 作用 | 优先级 |
|------|------|--------|
| `backend/src/services/mas/services/VectorSearchService.ts` | 向量检索服务 | P0 |
| `backend/src/services/mas/services/interfaces/IVectorSearchService.ts` | 接口定义 | P0 |
| `backend/src/db/postgresql/client/postgres-client.ts` | 数据库客户端 | P0 |
| `backend/src/db/migrations/postgresql/generateEmbeddings.ts` | Embedding 生成 | P1 |
| `backend/src/services/mas/services/ExerciseQueryService.ts` | 动作库查询 | P1 |
| `backend/src/services/mas/config/serviceRegistry.ts` | 服务注册 | P1 |

### B. 环境变量要求

```bash
# PostgreSQL
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/starfit
PGHOST=localhost
PGPORT=5432
PGDATABASE=starfit
PGUSER=postgres
PGPASSWORD=postgres

# OpenAI Embeddings
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1
```

### C. 参考 SQL 查询

```sql
-- 查找无 embedding 的练习
SELECT id, name FROM exercises WHERE embedding IS NULL LIMIT 10;

-- 手动测试向量搜索
SELECT id, name, 1 - (embedding <=> '[0.1,0.2,...]') as similarity
FROM exercises
WHERE embedding IS NOT NULL
ORDER BY embedding <=> '[0.1,0.2,...]'
LIMIT 5;

-- 检查 HNSW 索引使用情况
SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE indexname = 'idx_exercises_embedding_hnsw';
```

---

**报告生成时间**: 2026-02-12
**下一步行动**: 修复 VectorSearchService 数据库集成，运行 embedding 生成脚本
