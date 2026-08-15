# Vector Search API Usage Guide

**版本**: v2.0.0
**创建日期**: 2026-02-09
**状态**: Semantic Exercise Search

---

## 概述

本文档描述如何使用向量搜索 API 进行语义化的动作库搜索。

### 什么是向量搜索？

向量搜索 (Vector Search) 使用 AI 嵌入 (Embeddings) 将文本转换为向量，然后计算向量之间的相似度。相比关键词搜索，向量搜索能够理解语义含义。

**示例对比**:
```
关键词搜索: "chest exercise"
→ 只匹配包含 "chest" 的动作

向量搜索: "锻炼胸肌的复合动作"
→ 理解意图，匹配 "卧推"、"上斜哑铃卧推" 等
```

---

## API 端点

### POST /api/exercises/search

语义搜索动作库。

#### 请求体

```typescript
interface SearchRequest {
  query: string;                  // 搜索查询 (自然语言)
  limit?: number;                 // 返回数量 (默认: 10)
  threshold?: number;             // 相似度阈值 0-1 (默认: 0.7)
  filters?: {
    exerciseType?: string;        // 动作类型筛选
    difficulty?: string;          // 难度筛选
    equipment?: string[];         // 器械筛选
    targets?: string[];           // 目标肌肉筛选
  };
}
```

#### 响应体

```typescript
interface SearchResponse {
  results: SearchResult[];
  total: number;
  query_embedding?: number[];     // 查询向量 (调试用)
}

interface SearchResult {
  exerciseId: string;
  name: string;
  similarity: number;             // 0-1 相似度分数
  relevanceReason?: string;       // AI 解释为什么相关
  exercise_type: string;
  difficulty: string;
  targets: {
    primary: string[];
    secondary?: string[];
  };
  equipment_required: string[];
}
```

---

## 使用示例

### 示例 1: 基础语义搜索

**请求**:
```bash
curl -X POST http://localhost:3000/api/exercises/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "锻炼胸肌的复合动作"
  }'
```

**响应**:
```json
{
  "results": [
    {
      "exerciseId": "ex001",
      "name": "平板杠铃卧推",
      "similarity": 0.92,
      "relevanceReason": "主要锻炼中下胸，经典复合动作",
      "exercise_type": "resistance",
      "difficulty": "intermediate",
      "targets": {
        "primary": ["中下胸"],
        "secondary": ["前束", "三头"]
      },
      "equipment_required": ["barbell", "bench"]
    },
    {
      "exerciseId": "ex002",
      "name": "上斜哑铃卧推",
      "similarity": 0.89,
      "relevanceReason": "主要锻炼上胸，使用哑铃的复合动作",
      "exercise_type": "resistance",
      "difficulty": "intermediate",
      "targets": {
        "primary": ["上胸", "前肩"],
        "secondary": ["中束", "三头"]
      },
      "equipment_required": ["dumbbell", "bench"]
    }
  ],
  "total": 2
}
```

### 示例 2: 带筛选条件的搜索

**请求**:
```bash
curl -X POST http://localhost:3000/api/exercises/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "锻炼胸肌",
    "filters": {
      "exerciseType": "resistance",
      "equipment": ["dumbbell"],
      "difficulty": "beginner"
    },
    "limit": 5
  }'
```

**响应**:
```json
{
  "results": [
    {
      "exerciseId": "ex003",
      "name": "平板哑铃卧推",
      "similarity": 0.88,
      "relevanceReason": "适合初学者的哑铃卧推动作",
      "exercise_type": "resistance",
      "difficulty": "beginner",
      "targets": {
        "primary": ["中下胸"]
      },
      "equipment_required": ["dumbbell", "bench"]
    }
  ],
  "total": 1
}
```

### 示例 3: 高相似度阈值搜索

**请求**:
```bash
curl -X POST http://localhost:3000/api/exercises/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "背部宽度训练",
    "threshold": 0.85,
    "limit": 3
  }'
```

**响应**:
```json
{
  "results": [
    {
      "exerciseId": "ex010",
      "name": "引体向上",
      "similarity": 0.91,
      "relevanceReason": "增加背部宽度的最佳动作",
      "exercise_type": "bodyweight",
      "difficulty": "intermediate",
      "targets": {
        "primary": ["背部", "二头"]
      },
      "equipment_required": []
    }
  ],
  "total": 1
}
```

---

## 前端集成

### React Hook

```typescript
import { useState } from 'react';
import { searchExercises } from '@/services/exerciseSearch';

export function useExerciseSearch() {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async (query: string, filters?: SearchFilters) => {
    setLoading(true);
    setError(null);

    try {
      const response = await searchExercises({ query, ...filters });
      setResults(response.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : '搜索失败');
    } finally {
      setLoading(false);
    }
  };

  return { results, loading, error, search };
}
```

### 搜索组件

```typescript
import { useExerciseSearch } from './useExerciseSearch';

export function ExerciseSearch() {
  const { results, loading, error, search } = useExerciseSearch();
  const [query, setQuery] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    search(query, {
      exerciseType: 'resistance',
      equipment: ['dumbbell']
    });
  };

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索动作，例如：锻炼胸肌的复合动作"
        />
        <button type="submit" disabled={loading}>
          {loading ? '搜索中...' : '搜索'}
        </button>
      </form>

      {error && <div className="error">{error}</div>}

      <ul>
        {results.map((result) => (
          <li key={result.exerciseId}>
            <h3>{result.name}</h3>
            <p>相似度: {(result.similarity * 100).toFixed(1)}%</p>
            <p>{result.relevanceReason}</p>
            <div>
              {result.targets.primary.map(target => (
                <span key={target}>{target}</span>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

---

## 高级用法

### 相似度阈值调整

根据应用场景调整相似度阈值:

```typescript
// 精确搜索 (高质量结果)
const preciseSearch = await searchExercises({
  query: "卧推进阶",
  threshold: 0.9
});

// 宽泛搜索 (更多结果)
const broadSearch = await searchExercises({
  query: "胸部训练",
  threshold: 0.7
});
```

### 多目标搜索

搜索同时锻炼多个肌肉群的动作:

```typescript
const multiTargetSearch = await searchExercises({
  query: "同时锻炼胸肌和三头肌",
  filters: {
    targets: ["中下胸", "三头"]
  }
});
```

### 器材限制搜索

基于可用器材搜索:

```typescript
const equipmentSearch = await searchExercises({
  query: "全身训练",
  filters: {
    equipment: ["dumbbell", "bodyweight"]
  }
});
```

---

## 嵌入向量生成

### 批量生成

为所有动作生成向量嵌入:

```bash
npm run generate:embeddings
```

或通过 API:

```bash
curl -X POST http://localhost:3000/api/exercises/generate-embeddings \
  -H "Content-Type: application/json" \
  -d '{
    "exerciseIds": ["ex001", "ex002", "ex003"]
  }'
```

### 验证向量质量

```bash
curl http://localhost:3000/api/exercises/embeddings/stats
```

响应:
```json
{
  "total": 100,
  "embedded": 98,
  "pending": 2,
  "failed": 0,
  "last_updated": "2026-02-09T10:00:00Z"
}
```

---

## 错误处理

### 常见错误

#### 1. 向量索引未就绪

**错误**: `Vector index not ready`

**解决**:
```bash
# 等待索引构建完成
curl http://localhost:3000/api/exercises/embeddings/status
```

#### 2. 相似度计算失败

**错误**: `Failed to compute similarity`

**解决**:
```typescript
// 降级到关键词搜索
try {
  const results = await searchExercises({ query });
} catch (error) {
  if (error.message.includes('similarity')) {
    // 降级到关键词搜索
    const results = await searchByKeyword({ query });
  }
}
```

#### 3. 嵌入生成失败

**错误**: `Failed to generate embedding`

**解决**:
```bash
# 检查 AI 服务配置
echo $AI_SERVICE_API_KEY

# 重新生成嵌入
npm run generate:embeddings -- --force
```

---

## 性能优化

### 缓存查询结果

```typescript
const cache = new Map<string, SearchResult[]>();

async function cachedSearch(query: string): Promise<SearchResult[]> {
  if (cache.has(query)) {
    return cache.get(query)!;
  }

  const results = await searchExercises({ query });
  cache.set(query, results.results);

  // 5分钟后清除缓存
  setTimeout(() => cache.delete(query), 5 * 60 * 1000);

  return results.results;
}
```

### 批量搜索

```typescript
async function batchSearch(queries: string[]): Promise<SearchResult[][]> {
  return Promise.all(
    queries.map(query => searchExercises({ query }).then(r => r.results))
  );
}
```

---

## 最佳实践

1. **使用自然语言查询**: 向量搜索擅长理解语义
   - ✅ "锻炼胸肌的复合动作"
   - ❌ "chest exercise"

2. **合理设置相似度阈值**: 平衡准确性和召回率
   - 高质量匹配: 0.85-0.95
   - 一般搜索: 0.70-0.85
   - 宽泛搜索: 0.60-0.70

3. **结合筛选条件**: 使用 filters 提高搜索精度
   ```typescript
   searchExercises({
     query: "胸部训练",
     filters: { equipment: ["dumbbell"] }
   });
   ```

4. **处理空结果**: 提供降级方案
   ```typescript
   const results = await searchExercises({ query });
   if (results.total === 0) {
     // 降级到关键词搜索
     return await searchByKeyword({ query });
   }
   ```

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| v2.0.0 | 2026-02-09 | 向量搜索 API 文档 |
| v1.0.0 | 2026-01-29 | 初始版本 |

---

**文档版本**: v2.0.0
**最后更新**: 2026-02-09
**维护者**: Starfit Development Team
