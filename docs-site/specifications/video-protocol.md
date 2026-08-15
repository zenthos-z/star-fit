
# Starfit 视频管理协议标准 (VIDEO_PROTOCOL_STANDARD)

## 1. 概述

本文档定义了 Starfit 系统中视频资源的完整管理协议，包括上传、存储、处理、播放等全流程规范。

- **版本**: 1.0.0
- **协议类型**: REST API + WebSocket
- **数据格式**: JSON
- **最后更新**: 2026-01-14

---

## 2. 资源寻址体系

### 2.1 URI Scheme

所有视频资源使用统一的 URI 格式进行寻址：

```
fit://video/{exerciseName}/manifest.json                 # 动作级清单（可选）
fit://video/{exerciseName}/{videoId}/original.mp4        # 原始视频（编辑器预览）
fit://video/{exerciseName}/{videoId}/poster.jpg          # 缩略图
fit://video/{exerciseName}/{videoId}/{quality}.mp4       # 压缩版本（360p/720p/1080p）
```

### 2.2 HTTP 路径

实际的 HTTP 访问路径：

```
/uploads/videos/{sanitizedName}/temp.mp4                         # 上传临时文件（处理前）
/uploads/videos/{sanitizedName}/{videoId}/original.mp4           # 原始视频（处理完成后）
/uploads/videos/{sanitizedName}/{videoId}/poster.jpg             # 缩略图
/uploads/videos/{sanitizedName}/{videoId}/360p.mp4               # 压缩版本
/uploads/videos/{sanitizedName}/{videoId}/720p.mp4
/uploads/videos/{sanitizedName}/{videoId}/1080p.mp4
```

**说明**：
- `{sanitizedName}`: 经过清理的动作名称，只包含 `a-zA-Z0-9_-` 字符
- 所有路径相对于后端服务器根目录

---

## 3. 数据模型

### 3.1 VideoAsset Schema

```typescript
interface VideoAsset {
  id: string;                    // 唯一标识（UUID）
  exerciseName: string;          // 动作名称（sanitized）
  type: 'local' | 'cdn';         // 存储类型
  baseUrl: string;               // 基础路径
  sources: VideoSource[];        // 多清晰度源
  posterUrl: string;             // 缩略图 URL
  metadata: VideoMetadata;       // 视频元数据
  createdAt: number;             // 创建时间戳（Unix timestamp）
}

interface VideoSource {
  quality: '360p' | '720p' | '1080p';
  url: string;
  size: number;                  // 字节
  bandwidth: number;             // bps
}

interface VideoMetadata {
  originalFilename: string;
  duration: number;              // 秒
  width: number;
  height: number;
  codec: string;
  bitrate: number;
  size: number;                  // 原始文件大小（字节）
}
```

### 3.2 Exercise Asset 格式

```typescript
interface ExerciseAssets {
  video?: VideoAsset | VideoAsset[];  // 支持单个或多个视频
  // ... 其他资产
}
```

**说明**：
- 单个视频：直接使用 `VideoAsset` 对象
- 多个视频：使用 `VideoAsset[]` 数组
- 前端需要兼容两种格式

---

## 4. 上传处理流程

### 4.1 流程图

```
┌─────────────────────────────────────────────────────────────────┐
│                        前端上传流程                              │
└─────────────────────────────────────────────────────────────────┘
1. 用户选择视频文件（拖拽或点击上传）
2. 前端创建 WebSocket 连接：ws://host/api/videos/progress?taskId=xxx
3. 前端发送 POST 请求：POST /api/videos/upload
   - Body: FormData { file, exerciseName }
4. 后端立即返回：{ taskId, originalVideoUrl }
5. 前端显示视频卡片（使用 originalVideoUrl）

┌─────────────────────────────────────────────────────────────────┐
│                      后台处理流程                                │
└─────────────────────────────────────────────────────────────────┘
6. VideoQueueService 接收任务
7. VideoProcessingService 开始处理：
   a. 生成缩略图（中间帧提取）
   b. 压缩生成 360p/720p/1080p 版本
   c. 提取视频元数据
   d. 将 `temp.mp4` 迁移至 `{videoId}/original.mp4`
8. WebSocket 推送进度事件（实时更新前端）
9. 处理完成后更新数据库（exercises.assets_json）
10. WebSocket 推送完成事件
11. 前端更新视频卡片信息（缩略图、多清晰度源）
```

### 4.2 存储结构规范

```
uploads/
└── videos/
    └── {sanitized-exercise-name}/
        ├── temp.mp4                    # 上传临时文件（处理前）
        └── {videoId}/
            ├── original.mp4           # 原始视频（编辑器预览）
            ├── poster.jpg             # 缩略图
            ├── 360p.mp4               # 压缩版本
            ├── 720p.mp4
            └── 1080p.mp4
```

**存储规则**：
- 每个动作对应一个目录
- 目录名称为 sanitized 的动作名称
- 上传同名视频会覆盖旧文件
- 临时文件命名为 `temp.mp4`，处理完成后重命名为 `original.mp4`

---

## 5. API 规范

### 5.1 上传视频

**请求**

```
POST /api/videos/upload
Content-Type: multipart/form-data

Body:
  - file: File (视频文件)
  - exerciseName: string (动作名称)
```

---

### 5.1.1 检查 FFmpeg 状态

**请求**

```
GET /api/videos/status/ffmpeg
```

**响应**

```json
{
  "status": "available" | "unavailable",
  "version": "string | null"
}
```

**说明**：
- 检查 FFmpeg 是否可用
- 如果 FFmpeg 不可用，视频上传功能将无法使用
- 用于前端功能降级提示

---

### 5.1.2 上传响应

**响应**

```json
{
  "success": true,
  "taskId": "task_xxx",
  "exerciseName": "squat",
  "originalVideoUrl": "/uploads/videos/squat/temp.mp4",
  "message": "视频已上传，正在后台处理中"
}
```

**说明**：
- 后端立即返回 taskId 和临时 URL
- 前端可以立即显示视频（使用临时 URL）
- 后台异步处理视频（不阻塞返回）

---

### 5.2 WebSocket 进度流

**连接**

```
ws://localhost:43111/api/videos/progress?taskId={taskId}
```

**事件格式（CloudEvents 兼容）**

**进度事件**：
```json
{
  "type": "fit.video.progress",
  "data": {
    "stage": "uploading" | "extracting_metadata" | "generating_poster" | "compressing" | "finalizing",
    "progress": 45,
    "message": "正在生成缩略图..."
  },
  "time": "2026-01-14T10:00:00Z"
}
```

**完成事件**：
```json
{
  "type": "fit.video.completed",
  "data": {
    "taskId": "task_xxx",
    "exerciseName": "squat",
    "videoAsset": {
      "id": "uuid",
      "exerciseName": "squat",
      "type": "local",
        "baseUrl": "/uploads/videos/squat/uuid",
      "sources": [
        {
          "quality": "360p",
            "url": "/uploads/videos/squat/uuid/360p.mp4",
          "size": 1234567,
          "bandwidth": 800000
        }
      ],
        "posterUrl": "/uploads/videos/squat/uuid/poster.jpg",
      "metadata": {
        "originalFilename": "squat_demo.mp4",
        "duration": 120,
        "width": 1920,
        "height": 1080,
        "codec": "h264",
        "bitrate": 6000000,
        "size": 8765432
      },
      "createdAt": 1642156800000
    }
  },
  "time": "2026-01-14T10:05:00Z"
}
```

**错误事件**：
```json
{
  "type": "fit.video.error",
  "data": {
    "taskId": "task_xxx",
    "error": "FFmpeg not installed",
    "stage": "compressing",
    "errorMessage": "Failed to execute ffmpeg command"
  },
  "time": "2026-01-14T10:03:00Z"
}
```

---

### 5.3 获取动作视频信息

**请求**

```
GET /api/videos/{exerciseName}
```

**响应**

```json
{
  "id": "uuid",
  "exerciseName": "squat",
  "type": "local",
  "baseUrl": "/uploads/videos/squat",
  "sources": [...],
  "posterUrl": "/uploads/videos/squat/poster.jpg",
  "metadata": {...},
  "createdAt": 1642156800000
}
```

**说明**：
- 如果动作有多个视频，返回数组
- 如果没有视频，返回 404

---

### 5.4 删除动作视频

**请求**

```
DELETE /api/videos/{exerciseName}
```

**响应**

```json
{
  "success": true
}
```

**说明**：
- 删除视频文件（包括所有清晰度版本）
- 更新数据库（移除视频资产）

---

### 5.5 获取所有视频任务

**请求**

```
GET /api/videos/tasks
```

**响应**

```json
[
  {
    "id": "task_xxx",
    "exerciseName": "squat",
    "status": "completed",
    "progress": 100,
    "createdAt": 1642156800000,
    "completedAt": 1642157400000
  }
]
```

---

### 5.6 获取存储统计

**请求**

```
GET /api/videos/stats
```

**响应**

```json
{
  "totalVideos": 15,
  "totalSize": 1234567890,
  "totalDuration": 3600,
  "byQuality": {
    "360p": 123456789,
    "720p": 456789012,
    "1080p": 654321987
  }
}
```

---

## 6. 前端集成规范

### 6.1 显示规范

**禁止**：
- ❌ 在 HTML 内容中嵌入 `<video>` 标签
- ❌ 在 HTML 内容中嵌入 `<source>` 标签
- ❌ 在 HTML 内容中嵌入 `<track>` 标签

**DOMPurify 配置**：
```javascript
const purifyConfig = {
  FORBID_TAGS: ['video', 'source', 'track'],
  // ... 其他配置
};
```

**推荐**：
- ✅ 视频通过独立模态框（VideoPlayerModal）播放
- ✅ 管理端使用 VideoUploader 组件上传和管理视频

---

### 6.2 组件职责

#### VideoUploader（管理端）
- **功能**：视频上传、管理、重排序、删除
- **位置**：`src/admin/components/VideoUploader.tsx`
- **特性**：
  - 拖拽上传
  - 实时进度显示（WebSocket）
  - 多视频支持
  - 重排序（拖拽）
  - 删除视频
  - 预览播放（调用 VideoPlayerModal）

#### VideoPlayerModal（共享）
- **功能**：视频播放、多视频切换、滑动手势
- **位置**：`src/v2/components/execution/VideoPlayerModal.tsx`
- **特性**：
  - 全屏模态框
  - 多清晰度切换
  - 滑动手势切换视频
  - 视频计数器
  - 键盘控制（ESC 关闭）

#### VideoManager（管理端）
- **功能**：任务管理、进度监控
- **位置**：`src/admin/components/VideoManager.tsx`
- **特性**：
  - 显示所有视频任务
  - 重试失败任务
  - 删除任务

---

### 6.3 数据流

#### 上传流程（管理端）

```
ActionEditor
  ↓
VideoUploader (管理多个视频)
  ↓
POST /api/videos/upload
  ↓
WebSocket 进度流
  ↓
VideoUploader (实时进度显示)
  ↓
VideoUploader (完成，更新视频卡片信息)
  ↓
ActionEditor (保存时包含 video 数据)
  ↓
数据库 (exercises.assets_json)
```

#### 播放流程（前端）

```
ExerciseTutorialModal
  ↓
检测 assets.video 存在
  ↓
显示"查看视频"按钮
  ↓
VideoPlayerModal (播放)
  ↓
加载多清晰度源
  ↓
用户切换视频（滑动/点击）
```

---

## 7. 错误处理

### 7.1 错误码

| 错误码 | 说明 | HTTP 状态码 |
|--------|------|------------|
| VIDEO_INVALID_TYPE | 文件类型错误 | 400 |
| VIDEO_TOO_LARGE | 文件过大（>50MB） | 400 |
| VIDEO_UPLOAD_FAILED | 上传失败 | 500 |
| VIDEO_PROCESSING_FAILED | 处理失败 | 500 |
| VIDEO_NOT_FOUND | 视频不存在 | 404 |
| VIDEO_FFMPEG_NOT_INSTALLED | FFmpeg 未安装 | 500 |
| VIDEO_TASK_NOT_FOUND | 任务不存在 | 404 |

### 7.2 错误响应格式

```json
{
  "error": "VIDEO_INVALID_TYPE",
  "message": "请上传有效的视频文件",
  "details": "文件类型：application/pdf",
  "suggestion": "支持的格式：MP4, MOV, AVI"
}
```

---

## 8. 安全性

### 8.1 文件类型验证

**允许的类型**：
- video/mp4
- video/quicktime (MOV)
- video/x-msvideo (AVI)

**前端验证**：
```javascript
if (!file.type.startsWith('video/')) {
  throw new Error('请上传视频文件');
}
```

**后端验证**：
```javascript
if (!file.mimetype?.startsWith('video/')) {
  return reply.status(400).send({ error: 'Invalid file type' });
}
```

---

### 8.2 文件大小限制

- **最大文件大小**: 50MB
- **后端限制**: Fastify bodyLimit 配置

```javascript
// backend/src/server.ts
fastify.addContentTypeParser('multipart/form-data', { bodyLimit: 52428800 }, ...);
```

---

### 8.3 文件名安全

**前端清理**：
```javascript
const sanitizedExerciseName = exerciseName.replace(/[^a-zA-Z0-9_-]/g, '_');
```

**后端清理**：
```javascript
import path from 'path';
const filename = path.basename(filePart.filename); // 防止路径遍历
```

---

### 8.4 CORS 配置

**后端配置**：
```javascript
fastify.register(cors, {
  origin: ['http://localhost:43112', 'https://yourdomain.com'],
  credentials: true
});
```

---

## 9. 性能优化

### 9.1 视频压缩参数

| 参数 | 值 |
|------|-----|
| 编码器 | H.264 (libx264) |
| CRF 值 | 23 |
| 音频编码 | AAC |
| 音频比特率 | 128kbps |
| 预设 | medium |

---

### 9.2 清晰度配置

| 清晰度 | 分辨率 | 比特率 |
|--------|--------|--------|
| 360p | 640x360 | 800 kbps |
| 720p | 1280x720 | 3000 kbps |
| 1080p | 1920x1080 | 6000 kbps |

---

### 9.3 并发控制

- **最大并发处理**: 2 个任务
- **队列实现**: VideoQueueService
- **任务调度**: 先进先出（FIFO）

---

### 9.4 WebSocket 优化

- **连接池**: 使用 Map 管理客户端连接
- **自动清理**: 客户端断开时自动清理连接
- **消息压缩**: 使用 JSON 序列化

---

## 10. 前端类型定义

### 10.1 核心 Video 类型

```typescript
// src/types/video.ts

export interface VideoSource {
  quality: '360p' | '720p' | '1080p';
  url: string;
  size: number;
  bandwidth: number;
}

export interface VideoMetadata {
  originalFilename: string;
  duration: number;
  width: number;
  height: number;
  codec: string;
  bitrate: number;
  size: number;
}

export interface VideoAsset {
  id: string;
  exerciseName: string;
  type: 'local' | 'cdn';
  baseUrl: string;
  sources: VideoSource[];
  posterUrl: string;
  metadata: VideoMetadata;
  createdAt: number;
}

export interface VideoCard {
  id: string;
  url: string;
  poster?: string;
  qualities?: VideoSource[];
  fileName?: string;
  createdAt?: number;
}

// 前端显示用的简化类型
export interface DisplayVideo {
  url: string;
  poster?: string;
  qualities?: VideoSource[];
}
```

---

## 11. 后端 Schema 定义

### 11.1 Zod Schema

```typescript
// backend/src/schemas/videoSchema.ts

import { z } from 'zod';

export const VideoSourceSchema = z.object({
  quality: z.enum(['360p', '720p', '1080p']),
  url: z.string().url(),
  size: z.number().positive(),
  bandwidth: z.number().positive(),
});

export const VideoMetadataSchema = z.object({
  originalFilename: z.string(),
  duration: z.number().positive(),
  width: z.number().positive(),
  height: z.number().positive(),
  codec: z.string(),
  bitrate: z.number().positive(),
  size: z.number().positive(),
});

export const VideoAssetSchema = z.object({
  id: z.string().uuid(),
  exerciseName: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  type: z.enum(['local', 'cdn']).default('local'),
  baseUrl: z.string(),
  sources: z.array(VideoSourceSchema).default([]),
  posterUrl: z.string(),
  metadata: VideoMetadataSchema,
  createdAt: z.number(),
});

export type VideoAsset = z.infer<typeof VideoAssetSchema>;
export type VideoSource = z.infer<typeof VideoSourceSchema>;
export type VideoMetadata = z.infer<typeof VideoMetadataSchema>;
```

---

## 12. 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.0 | 2026-01-14 | 初始版本 |

---

## 13. 参考文档

- [数据协议](../concepts/data-protocol.md)
- [Starfit 技术标准规范](./technical-standards.md)
- [视频故障排除指南](./video-troubleshooting.md)

---

**文档维护者**: Starfit 开发团队
**最后审核**: 2026-01-14
