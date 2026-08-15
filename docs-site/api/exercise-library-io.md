# Exercise Library Import/Export API

**Version**: 1.0.0
**Base Path**: `/api/exercises`

动作库导入/导出 API 提供完整的动作库备份和恢复功能，包括：

- 导出所有动作数据、视频文件、封面图片为 ZIP 归档
- 从 ZIP 归档导入动作库，支持冲突处理
- 实时进度查询和取消功能

---

## 目录

- [认证](#认证)
- [导出功能](#导出功能)
- [导入功能](#导入功能)
- [进度查询](#进度查询)
- [错误处理](#错误处理)
- [ZIP 文件格式](#zip-文件格式)
- [速率限制](#速率限制)

---

## 认证

所有请求需要在请求头中包含用户 ID：

```
X-User-Id: {userId}
```

---

## 导出功能

### GET /api/exercises/export

导出动作库为 ZIP 文件。

#### 查询参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `includeVideos` | boolean | `true` | 是否包含视频文件 |
| `includeCovers` | boolean | `true` | 是否包含封面图片 |
| `videoQuality` | `'360p' \| '720p' \| '1080p'` | `'1080p'` | 导出视频的清晰度 |
| `difficulty` | string | - | 按难度筛选（逗号分隔） |
| `target` | string | - | 按目标肌肉筛选（逗号分隔） |

#### 响应

**Content-Type**: `application/zip`

**Content-Disposition**: `attachment; filename="exercises_{timestamp}.zip"`

响应体为 ZIP 文件的二进制数据。

#### 示例

```bash
# 导出所有动作（1080p 视频）
curl "http://localhost:3000/api/exercises/export" \
  -H "X-User-Id: admin" \
  --output exercises.zip

# 导出初级动作（不包含视频）
curl "http://localhost:3000/api/exercises/export?includeVideos=false&difficulty=beginner" \
  -H "X-User-Id: admin" \
  --output exercises_beginner.zip

# 导出胸部动作（720p 视频）
curl "http://localhost:3000/api/exercises/export?videoQuality=720p&target=上胸,中下胸" \
  -H "X-User-Id: admin" \
  --output exercises_chest.zip
```

#### ZIP 文件结构

导出的 ZIP 文件包含以下结构：

```
exercise-library-export.zip
├── manifest.json          # 元数据
├── exercises.json         # 动作数据数组
├── videos/               # 视频文件（可选）
│   └── {exercise_id}/
│       └── {video_id}/
│           ├── original.mp4
│           ├── 1080p.mp4
│           └── poster.jpg
└── covers/               # 封面图片（可选）
    └── {exercise_id}/
        └── cover.jpg
```

---

## 导入功能

### POST /api/exercises/import/precheck

预检导入文件，返回冲突信息而不执行导入。

#### 请求

**Content-Type**: `multipart/form-data`

| 字段 | 类型 | 说明 |
|------|------|------|
| `file` | File | ZIP 文件 |

#### 响应

```typescript
{
  manifest: {
    version: string;           // 导出格式版本
    exportedAt: string;        // ISO 8601 UTC
    exportedBy: string;        // 导出者用户 ID
    totalExercises: number;
    totalVideos: number;
    totalCovers: number;
    options: {
      includeVideos: boolean;
      includeCovers: boolean;
      videoQuality: string;
    };
  };
  exercises: Exercise[];       // 动作数据数组
  conflicts: Array<{
    exerciseName: string;
    existing: Exercise | null;  // null 表示无冲突
    suggestedRename: string;    // 建议的重命名
  }>;
}
```

#### 示例

```bash
curl -X POST "http://localhost:3000/api/exercises/import/precheck" \
  -H "X-User-Id: admin" \
  -F "file=@exercises.zip"
```

---

### POST /api/exercises/import

从 ZIP 文件导入动作库。

#### 查询参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `strategy` | `'overwrite' \| 'rename' \| 'skip'` | `'skip'` | 冲突处理策略 |
| `processVideos` | boolean | `true` | 是否创建视频处理任务 |

#### 请求

**Content-Type**: `multipart/form-data`

| 字段 | 类型 | 说明 |
|------|------|------|
| `file` | File | ZIP 文件 |

#### 响应

```typescript
{
  success: number;              // 成功导入数量
  skipped: number;              // 跳过数量
  failed: number;               // 失败数量
  errors: Array<{               // 错误详情
    exerciseName: string;
    error: string;
  }>;
  videoTasks: string[];         // 视频任务 ID 列表
  renamedExercises: Array<{     // 重命名的动作
    originalName: string;
    newName: string;
  }>;
  batchId: string;              // 批次 ID（用于进度查询）
}
```

#### 冲突处理策略

| 策略 | 说明 | 示例 |
|------|------|------|
| `overwrite` | 删除旧动作，创建新动作 | "杠铃卧推" → 删除旧 → 创建新 |
| `rename` | 保留旧动作，新动作重命名 | "杠铃卧推" → "杠铃卧推 (2)" |
| `skip` | 跳过冲突动作 | "杠铃卧推" → 跳过 |

#### 示例

```bash
# 预检导入
PRECHECK_RESULT=$(curl -X POST "http://localhost:3000/api/exercises/import/precheck" \
  -H "X-User-Id: admin" \
  -F "file=@exercises.zip")

# 导入（重命名策略），保存返回的 batchId
IMPORT_RESULT=$(curl -X POST "http://localhost:3000/api/exercises/import?strategy=rename" \
  -H "X-User-Id: admin" \
  -F "file=@exercises.zip")

BATCH_ID=$(echo $IMPORT_RESULT | jq -r '.batchId')
echo "Batch ID: $BATCH_ID"
```

---

## 进度查询

### GET /api/exercises/import/status/:batchId

查询导入批次的进度。

#### 路径参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `batchId` | string | 批次 ID |

#### 响应

```typescript
{
  batchId: string;
  status: 'processing' | 'completed' | 'failed' | 'cancelled';
  totalExercises: number;
  processedExercises: number;
  videoTasks: {
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  };
  startedAt: string;        // ISO 8601 UTC
  completedAt?: string;     // ISO 8601 UTC
  errors: Array<{
    exerciseName: string;
    error: string;
  }>;
}
```

#### 示例

```bash
curl "http://localhost:3000/api/exercises/import/status/$BATCH_ID" \
  -H "X-User-Id: admin"
```

---

### POST /api/exercises/import/cancel/:batchId

取消正在进行的导入。

#### 路径参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `batchId` | string | 批次 ID |

#### 响应

```typescript
{
  message: string;
  batchId: string;
}
```

#### 示例

```bash
curl -X POST "http://localhost:3000/api/exercises/import/cancel/$BATCH_ID" \
  -H "X-User-Id: admin"
```

---

### GET /api/exercises/import/list

获取用户的所有导入批次历史。

#### 响应

```typescript
Array<{
  batchId: string;
  status: string;
  totalExercises: number;
  processedExercises: number;
  startedAt: string;        // ISO 8601 UTC
  completedAt?: string;     // ISO 8601 UTC
}>
```

#### 示例

```bash
curl "http://localhost:3000/api/exercises/import/list" \
  -H "X-User-Id: admin"
```

---

## 错误处理

### HTTP 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 成功 |
| 400 | 请求错误（无效的 ZIP、数据验证失败） |
| 404 | 资源未找到（批次不存在） |
| 500 | 服务器错误 |

### 错误响应格式

```typescript
{
  error: string;      // 错误类型
  details?: string;   // 详细错误信息
}
```

### 常见错误

| 错误 | 说明 | 解决方案 |
|------|------|----------|
| `Invalid ZIP file format` | ZIP 文件格式错误 | 确保上传的是有效的 ZIP 文件 |
| `Import validation failed` | 数据验证失败 | 检查 ZIP 文件是否包含必需的 manifest.json 和 exercises.json |
| `Missing required file: manifest.json` | 缺少必需文件 | 确保 ZIP 包含 manifest.json |
| `Invalid manifest.json` | manifest.json 格式错误 | 检查 JSON 格式是否正确 |
| `Import batch not found` | 批次不存在 | 确认 batchId 正确 |
| `Cannot cancel import with status: completed` | 无法取消已完成的导入 | 只能取消状态为 `processing` 的导入 |

---

## ZIP 文件格式

### 结构

```
exercise-library-export.zip
├── manifest.json          # 元数据
├── exercises.json         # 动作数据数组
├── videos/               # 视频文件（可选）
│   └── {exercise_id}/
│       └── {video_id}/
│           ├── original.mp4
│           ├── 1080p.mp4
│           ├── 720p.mp4
│           ├── 360p.mp4
│           └── poster.jpg
└── covers/               # 封面图片（可选）
    └── {exercise_id}/
        └── cover.{jpg|png}
```

### manifest.json 示例

```json
{
  "version": "1.0.0",
  "exportedAt": "2026-01-29T10:00:00Z",
  "exportedBy": "admin_123",
  "totalExercises": 15,
  "totalVideos": 12,
  "totalCovers": 15,
  "options": {
    "includeVideos": true,
    "includeCovers": true,
    "videoQuality": "1080p"
  }
}
```

### exercises.json 示例

```json
[
  {
    "id": "ex_001",
    "name": "杠铃卧推",
    "exercise_type": "resistance",
    "targets": "{\"primary\": [\"上胸\", \"前束\"], \"secondary\": [\"中束\", \"三头\"]}",
    "equipment_required": "[\"barbell\", \"bench\"]",
    "difficulty": "intermediate",
    "content_html": "<p>动作说明...</p>",
    "assets_json": "{\"cover\": \"/uploads/covers/ex_001/cover.jpg\", \"video\": {...}}",
    "tags_json": "[\"复合动作\", \"推\"]",
    "modified_by": "admin",
    "modified_at": 1706524800000
  }
]
```

---

## 速率限制

| 端点 | 限制 |
|------|------|
| GET /api/exercises/export | 10 次/分钟 |
| POST /api/exercises/import | 5 次/分钟 |
| POST /api/exercises/import/precheck | 10 次/分钟 |
| GET /api/exercises/import/status/:batchId | 60 次/分钟 |

超过限制会返回 `429 Too Many Requests`。

---

## WebSocket 进度推送（可选）

### 连接端点

```
ws://localhost:3000/api/videos/progress?taskId={taskId}
```

### 事件格式

```typescript
{
  type: 'fit.video.progress';
  taskId: string;
  exerciseName: string;
  progress: number;        // 0-100
  stage: string;
  message: string;
}
```

### 示例

```javascript
const ws = new WebSocket('ws://localhost:3000/api/videos/progress?taskId=task_123');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'fit.video.progress') {
    console.log(`Video progress: ${data.progress}%`);
  }
};
```

---

## 完整工作流示例

```bash
# 1. 导出动作库
curl "http://localhost:3000/api/exercises/export" \
  -H "X-User-Id: admin" \
  --output my_exercises.zip

# 2. 预检导入
PRECHECK=$(curl -X POST "http://localhost:3000/api/exercises/import/precheck" \
  -H "X-User-Id: admin" \
  -F "file=@my_exercises.zip")

# 查看冲突
echo $PRECHECK | jq '.conflicts'

# 3. 导入（重命名策略）
IMPORT=$(curl -X POST "http://localhost:3000/api/exercises/import?strategy=rename" \
  -H "X-User-Id: admin" \
  -F "file=@my_exercises.zip")

# 4. 获取批次 ID
BATCH_ID=$(echo $IMPORT | jq -r '.batchId')

# 5. 轮询进度
while true; do
  STATUS=$(curl "http://localhost:3000/api/exercises/import/status/$BATCH_ID" \
    -H "X-User-Id: admin")

  STATE=$(echo $STATUS | jq -r '.status')
  PROCESSED=$(echo $STATUS | jq -r '.processedExercises')
  TOTAL=$(echo $STATUS | jq -r '.totalExercises')

  echo "进度: $PROCESSED / $TOTAL"

  if [ "$STATE" = "completed" ] || [ "$STATE" = "failed" ]; then
    break
  fi

  sleep 2
done

# 6. 获取导入历史
curl "http://localhost:3000/api/exercises/import/list" \
  -H "X-User-Id: admin"
```
