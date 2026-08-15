# 视频管理

Starfit 将视频视为一等公民，允许用户上传动作检查视频，并允许教练提供视觉演示。

## 视频生命周期

1.  **上传**: 用户选择视频文件。
2.  **处理**: 后端对视频进行转码和优化。
3.  **存储**: 文件存储在 `uploads/` 目录（或生产环境中的 S3）。
4.  **分发**: 通过 HLS 或渐进式下载进行流式传输。

## 协议与 Schema

视频在 `Exercise` 对象中通过 `assets` 字段引用。

```typescript
interface VideoAsset {
  id: string;
  baseUrl: string;        // 例如 "/uploads/videos/v123"
  originalVideoUrl: string; // 原始上传文件
  posterUrl: string;      // 生成的缩略图
  sources: VideoSource[]; // 不同画质
  metadata: {
    duration: number;
    width: number;
    height: number;
    codec: string;
  }
}

interface VideoSource {
  quality: '360p' | '720p' | '1080p';
  url: string;
  bandwidth: number;
}
```

## 处理管道

`VideoProcessingService` 处理：
- **缩略图生成**: 提取第 1 秒的帧。
- **转码**: 将上传转换为 H.264/MP4 以获得最大兼容性。
- **验证**: 检查文件大小限制（最大 50MB）和格式。

## 故障排除

### 上传失败
- 检查网络连接。
- 确认文件大小在 50MB 以内。
- 确保后端磁盘空间充足。

### 播放错误
- 检查 `baseUrl` 是否可访问。
- 验证 Nginx/Apache 配置中的 MIME 类型。
- 确保浏览器支持该视频编解码器。
