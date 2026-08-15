
# Starfit 视频管理故障排除指南

## 常见问题

### 1. 视频上传失败

**症状**：点击上传后显示"上传失败"

**可能原因**：
- FFmpeg 未安装
- 文件格式不支持
- 文件超过 50MB
- 服务器磁盘空间不足

**解决方案**：
```bash
# 检查 FFmpeg 是否安装
ffmpeg -version

# 检查磁盘空间
df -h

# 检查服务器日志
tail -f backend/logs/error.log
```

---

### 2. 视频处理后无缩略图

**症状**：上传完成后，视频卡片显示黑色背景

**可能原因**：
- FFmpeg 缩略图提取失败
- poster.jpg 文件未生成

**解决方案**：
```bash
# 检查 poster.jpg 是否存在
ls -la backend/uploads/videos/{exercise}/

# 手动生成缩略图
ffmpeg -i backend/uploads/videos/{exercise}/original.mp4 -ss 00:00:01 -vframes 1 backend/uploads/videos/{exercise}/poster.jpg
```

---

### 3. WebSocket 进度不更新

**症状**：上传进度一直卡在某个百分比

**可能原因**：
- WebSocket 连接失败
- taskId 不匹配
- 服务器 WebSocket 服务未启动

**解决方案**：
- 打开浏览器控制台检查 WebSocket 连接状态
- 检查服务器日志确认 WebSocket 服务启动
- 验证 taskId 格式是否正确

---

### 4. 视频播放失败

**症状**：点击播放按钮后视频无法播放

**可能原因**：
- 视频路径错误
- 文件不存在
- CORS 配置问题

**解决方案**：
- 检查浏览器 Network 标签确认文件是否加载（404?）
- 检查文件是否存在：`ls -la backend/uploads/videos/`
- 检查后端 CORS 配置

---

### 5. 多清晰度视频无法切换

**症状**：清晰度按钮点击无效

**可能原因**：
- 视频压缩未完成
- sources 数据格式错误
- 前端类型不匹配

**解决方案**：
- 检查视频任务状态（是否 completed）
- 检查数据库中 assets_json 的 video.sources 字段
- 检查浏览器控制台类型错误

---

### 6. 视频路径 404 错误

**症状**：所有视频显示 404 Not Found

**可能原因**：
- 使用了旧的 uploads/original/ 路径
- 文件被移动或删除
- exerciseName 包含特殊字符

**解决方案**：
- 确认使用新路径：`/uploads/videos/{exercise}/`
- 检查 exerciseName 是否已 sanitized
- 检查文件实际位置

---

## 调试工具

### 1. 检查视频任务状态

```bash
# 查询所有视频任务
curl http://localhost:43111/api/videos/tasks

# 查询特定任务
curl http://localhost:43111/api/videos/tasks/{taskId}
```

---

### 2. 检查视频信息

```bash
# 查询动作视频信息
curl http://localhost:43111/api/videos/{exerciseName}
```

---

### 3. 检查存储统计

```bash
# 查看存储使用情况
curl http://localhost:43111/api/videos/stats
```

---

### 4. 测试 FFmpeg 功能

```bash
# 测试视频信息提取
ffmpeg -i test.mp4 2>&1 | grep Duration

# 测试缩略图生成
ffmpeg -i test.mp4 -ss 00:00:01 -vframes 1 output.jpg

# 测试压缩
ffmpeg -i test.mp4 -vf "scale=640:-1" -b:v 800k output_360p.mp4
```

---

## 日志位置

### 后端日志
- **位置**：`backend/logs/`
- **关键字**：`[VideoController]`, `[VideoQueueService]`, `[VideoProcessingService]`

### 前端日志
- **位置**：浏览器控制台
- **关键字**：`[VideoUploader]`, `[VideoPlayerModal]`, `[ExerciseTutorialModal]`

---

## WebSocket 调试

### 连接测试

打开浏览器控制台，执行：

```javascript
const ws = new WebSocket('ws://localhost:43111/api/videos/progress?taskId=test_task_123');

ws.onopen = () => console.log('WebSocket connected');
ws.onmessage = (e) => console.log('Received:', JSON.parse(e.data));
ws.onerror = (err) => console.error('WebSocket error:', err);
ws.onclose = () => console.log('WebSocket closed');
```

### 常见 WebSocket 错误

| 错误 | 原因 | 解决方案 |
|------|------|----------|
| Connection refused | 后端服务器未启动 | 启动后端：`cd backend && npm run dev` |
| 404 Not Found | WebSocket 路由未注册 | 检查 server.ts 中的路由配置 |
| taskId 参数缺失 | URL 查询参数错误 | 确保 URL 包含 `?taskId=xxx` |

---

## 数据库查询

### 查看所有视频任务

```sql
SELECT
  id,
  exercise_name,
  status,
  progress,
  created_at,
  completed_at,
  error_message
FROM video_tasks
ORDER BY created_at DESC;
```

### 查看待处理的任务

```sql
SELECT * FROM video_tasks WHERE status = 'pending';
```

### 查看失败的任务

```sql
SELECT
  id,
  exercise_name,
  error_message,
  retry_count,
  created_at
FROM video_tasks
WHERE status = 'failed';
```

### 查看动作视频资产

```sql
SELECT
  name,
  assets_json
FROM exercises
WHERE json_extract(assets_json, '$.video') IS NOT NULL;
```

---

## 性能监控

### 上传速度测试

```bash
# 使用 curl 测试上传速度
time dd if=/dev/zero bs=1M count=50 | curl -X POST -F "file=@-;filename=test.mp4" http://localhost:43111/api/videos/upload -F "exerciseName=test"
```

### 视频处理时间监控

```sql
-- 查看平均处理时间
SELECT
  AVG(completed_at - started_at) as avg_processing_time_ms
FROM video_tasks
WHERE status = 'completed';
```

---

## 联系支持

如果以上方法都无法解决问题，请提供以下信息：

1. **错误截图**
2. **浏览器控制台日志**
3. **后端服务器日志**
4. **视频文件信息**（大小、格式、时长）
5. **复现步骤**

---

## 快速诊断清单

在报告问题之前，请完成以下检查：

- [ ] 后端服务器运行在端口 43111
- [ ] 前端服务器运行在端口 43112
- [ ] FFmpeg 已安装并可用（运行 `ffmpeg -version`）
- [ ] 有足够的磁盘空间（至少 1GB）
- [ ] 浏览器控制台没有 CORS 错误
- [ ] 视频文件格式为 MP4/MOV/AVI
- [ ] 视频文件大小小于 50MB
- [ ] exerciseName 不包含特殊字符（只允许字母、数字、下划线、连字符）
- [ ] WebSocket 连接成功（检查浏览器网络标签）

---

**文档维护者**: Starfit 开发团队
**最后更新**: 2026-01-14
