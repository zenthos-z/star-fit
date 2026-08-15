import Fastify from 'fastify';
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import path from 'path';
import fs from 'fs';
import agentRoutes from './routes/agent.js';
import { getPostgresClient as getDb } from './db/index.js';
import { pushHistory, pullSync, getConfig } from './controllers/syncController.js';
import { wsService } from './services/wsService.js';
import {
  uploadMedia,
  listUserMedia,
  deleteMedia,
  getUsers,
  getUserStats,
  loginOrCreate,
  getProxyConfig,
  updateProxyConfig,
  testProxy,
  getIPInfo,
  updateConfig,
  updateExercise,
  deleteExercise,
  getGuidance,
  updateGuidance,
  updatePromptStyle,
  deleteUserSession,
  deleteUserAccount,
  getSystemHealth,
  getSystemLogs,
  restartService,
  backupDatabase,
  emergencyStop,
  getAIConfig,
  updateAIConfig,
  getAdminCapabilities,
  getModelConfig,
  updateModelConfig,
  testModelConnection,
  getAdminConfig,
  setAdminConfig,
  getAllAdminConfigs,
  getPinnedUsers,
  setPinnedUsers,
  togglePinnedUser,
  batchDeleteUsers,
  getUserSessions,
  exportUserTrainingMarkdown,
  updateUserDisplayName,
  updateUserProfileStatic,
  getImageGenConfig,
  updateImageGenConfig,
  testImageGenConnection
} from './controllers/adminController.js';
import {
  getLatestTraining,
  getServerInfo,
  getExerciseStats as getDashboardExerciseStats
} from './controllers/dashboardController.js';
import {
  getAllExercises,
  getExerciseById,
  getExerciseByName,
  getExercisesByTarget,
  getExercisesByDifficulty,
  getExercisesByEquipment,
  createExercise,
  updateExercise as updateExerciseById,
  deleteExercise as deleteExerciseById,
  getExerciseStats
} from './controllers/exerciseController.js';
import {
  getUserProfile,
  updateUserProfile,
  deleteLoadAnchor
} from './controllers/userProfileController.js';
import { generateTextUnified } from './services/llm.js';
import {
  uploadVideo,
  getVideoInfo,
  deleteVideo,
  checkFFmpegStatus,
  getAllVideoTasks,
  getVideoTask,
  retryVideoTask,
  deleteVideoTask,
  getVideoStats
} from './controllers/videoController.js';
import {
  exportExercises,
  importExercises,
  precheckImport,
  getImportStatus,
  cancelImport,
  getImportList
} from './controllers/exerciseLibraryIOController.js';
import { WebSocketProgressBroadcaster } from './services/websocketProgressService.js';

const ACCESS_LOG = path.join(process.cwd(), 'access.log');

const server = Fastify({
  logger: {
    transport: {
      target: 'pino-pretty',
      options: {
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    },
  },
  bodyLimit: 10 * 1024 * 1024 // 10MB global limit for JSON etc.
});

// Helper for access logging
server.addHook('onRequest', async (request) => {
  const logMsg = `[${new Date().toISOString()}] ${request.method} ${request.url} from ${request.ip}\n`;
  fs.appendFileSync(ACCESS_LOG, logMsg);
});

const start = async () => {
  try {
    // Init DB
    getDb();

    // Plugins
    await server.register(cors, { 
      origin: (origin, cb) => {
        // Allow all origins for now to avoid mobile issues
        cb(null, true);
      },
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'X-User-Id'],
      credentials: true,
      preflight: true,
      strictPreflight: false
    });
    await server.register(formbody, { bodyLimit: 10 * 1024 * 1024 }); // 10MB
    await server.register(multipart, {
      limits: {
        fileSize: Infinity, // 无限制
        fieldSize: 10 * 1024 * 1024, // 10MB
        fieldNameSize: 100, // 100 bytes
        fields: 10,
        files: 10
      }
    });
    await server.register(websocket);
    
    // Static Files (Uploads)
    await server.register(fastifyStatic, {
      root: path.join(process.cwd(), 'uploads'),
      prefix: '/uploads/',
    });

    // API Routes
    server.get('/', async (req, reply) => {
      return { 
        ok: true, 
        message: 'Starfit Agent Backend is running',
        version: '2.0.0',
        ws_endpoints: ['/api/ws/sync', '/api/videos/progress']
      };
    });

    server.register(async (api) => {
      // Add a request logger for sync push
      api.addHook('preHandler', async (req) => {
        if (req.url.includes('/sync/push')) {
          req.log.info({ 
            url: req.url,
            method: req.method,
            origin: req.headers.origin,
            deviceId: (req.body as any)?.deviceId,
            sessionCount: (req.body as any)?.sessions?.length
          }, 'Incoming Sync Push Request');
        }
      });

      // Diagnostic Ping
      api.get('/ping', async (req, reply) => {
        return { 
          pong: true, 
          ts: Date.now(),
          ip: req.ip,
          headers: req.headers
        };
      });

      api.get('/', async (_req, reply) => {
        reply.send({
          ok: true,
          routes: [
            'GET /api/admin/users',
            'GET /api/admin/stats/:userId',
            'POST /api/sync/push',
            'GET /api/sync/pull',
            'GET /api/config/sync',
            'POST /api/config/update',
            'POST /api/media/upload',
            'GET /api/media/:id',
            'GET /api/history/summary',
            'POST /api/agent/plan',
            'GET /api/tutorial'
          ]
        });
      });
      // Agent Routes (Legacy)
      api.register(agentRoutes);

      // Sync Routes
      api.post('/sync/push', pushHistory);
      api.get('/sync/pull', pullSync);
      api.get('/config/sync', getConfig); // Shortcut for just config

      // WebSocket Sync
      (api as any).get('/ws/sync', { websocket: true }, (connection: any, req: any) => {
        // In some versions of @fastify/websocket, connection is a SocketStream (with .socket).
        // In others, or depending on config, it might be the WebSocket itself.
        const socket = connection.socket || (connection.send ? connection : null);

        if (!socket) {
          req.log.error({ 
            hasConnection: !!connection,
            connectionKeys: Object.keys(connection)
          }, '[WS] Could not find WebSocket object in connection. Upgrade might have failed.');
          
          if (typeof connection.destroy === 'function') connection.destroy();
          else if (typeof connection.end === 'function') connection.end();
          return;
        }

        const userId = req.query?.userId || req.headers['x-user-id'] || 'anonymous';
        const deviceId = req.query?.deviceId || 'unknown';
        
        console.log(`[WS] Connection established for user: ${userId}, device: ${deviceId}. Using ${socket === connection ? 'direct connection' : 'connection.socket'}`);
        socket.deviceId = deviceId; 
        
        wsService.registerClient(userId, socket);
        
        socket.on('message', async (message: any) => {
          try {
            const envelope = JSON.parse(message.toString());
            
            const messageType = envelope.type || envelope.method;
            const payload = envelope.data ?? envelope.payload ?? envelope.params;

            if (messageType === 'ping') {
              socket.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
              return;
            }

            switch (messageType) {
              case 'deviation_event':
                // Deviation events are now batched and submitted with session metadata
                console.log(`[WS] Deviation event received (batched for session end)`);
                break;
              case 'tutor.generate_tutorial': {
                const exerciseId = String((payload as any)?.exerciseId || "");
                const exerciseName = String((payload as any)?.exerciseName || (payload as any)?.exerciseId || "");
                const lang = String((payload as any)?.lang || "zh");
                const name = exerciseName || exerciseId || "动作";
                const fallback =
                  lang === "zh"
                    ? `# ${name}\n\n> ⚠️ AI 生成失败\n\n抱歉，暂时无法生成该动作的详细教程。这可能是由于网络连接问题或服务繁忙。\n\n请检查网络连接，或稍后点击下方的 **重新生成教程** 按钮重试。`
                    : `# ${name}\n\n> ⚠️ Generation Failed\n\nSorry, we cannot generate the tutorial at the moment. This may be due to network issues.\n\nPlease check your connection or try clicking the **Regenerate** button below.`;

                const aiPromise = (async () => {
                  const systemPrompt =
                    "你是一个专业的健身百科全书与教练，擅长用清晰、详细的方式解释动作细节，能够深入浅出地讲解动作原理、发力技巧和注意事项。输出使用 Markdown 格式。";
                  const userPrompt = `请为动作 "${exerciseName || exerciseId}" 生成一份非常详细的健身教程。要求：

## 内容结构
必须包含以下四个部分，每个部分都要有详细说明：

### 🎯 动作作用
- 详细说明这个动作主要锻炼哪些肌肉群
- 说明动作对身体的益处（如增强力量、改善体态、提高运动表现等）
- 说明动作的适用人群和训练目标

### 💪 发力心法
- 详细讲解动作的发力顺序和发力技巧
- 描述正确的姿势细节（如身体角度、关节位置、肌肉发力感等）
- 说明如何找到正确的发力感觉
- 讲解呼吸配合（如发力时呼气、放松时吸气）

### ⚠️ 注意事项
- 列出训练前的准备工作（如热身、器械检查等）
- 说明动作过程中的关键要点
- 说明训练后的放松和恢复建议
- 说明训练频率、组数、次数的建议

### ❌ 容易做错的地方
- 列出常见的错误动作并说明错误原因
- 说明错误动作可能导致的问题或受伤风险
- 提供纠正方法

## 格式要求
- 使用清晰的 Markdown 结构，使用二级标题（##）区分四个主要部分
- 适当使用 emoji 表情增强可读性（参考上面的 emoji 使用）
- 使用适当的空行和间距，确保内容易读
- 使用项目符号（-）列出要点，每个要点要详细说明
- 每个部分的文字要充实，不要过于简略
- 保持信息密度的同时，也要保证阅读体验
- 语言：${lang === "zh" ? "中文" : "英文"}`;
                  return generateTextUnified(userPrompt, req.log, "tutorial", systemPrompt);
                })();

                let firstMarkdown: string | null = null;
                try {
                  firstMarkdown = await aiPromise;
                  req.log.info({ 
                    exercise: name, 
                    contentLength: firstMarkdown?.length, 
                    isSuccess: !!firstMarkdown,
                    preview: firstMarkdown?.substring(0, 100)
                  }, "ai_generation_result");
                } catch (err: any) {
                  req.log.warn({ err, exercise: name }, "tutor_ws_generation_failed_falling_back");
                }

                const tutorialPayload = {
                  exerciseId: exerciseId || exerciseName,
                  content_md: firstMarkdown || fallback,
                  source: firstMarkdown ? "ai" : "internal",
                  isFinal: true,
                };
                try {
                  socket.send(JSON.stringify({ type: "tutor.tutorial_result", data: tutorialPayload, payload: tutorialPayload, ts: Date.now() }));
                } catch {}
                wsService.broadcastToUser(userId, "tutor.tutorial_result", tutorialPayload, socket.deviceId);
                break;
              }
              default:
                console.log(`[WS] Unhandled message type: ${messageType}`);
            }
          } catch (e) {
            console.error('[WS] Message parse error:', e);
          }
        });

        socket.on('close', () => {
          console.log(`[WS] Connection closed for user: ${userId}`);
          wsService.unregisterClient(userId, socket);
        });

        socket.on('error', (err: any) => {
          console.error(`[WS] Socket error for user ${userId}:`, err);
        });
      });

      // Media Routes
      api.post('/media/upload', uploadMedia);
      api.get('/media/list', listUserMedia);
      api.delete('/media/:id', deleteMedia);

      // Dashboard Routes (New)
      api.get('/admin/dashboard/latest-training', getLatestTraining);
      api.get('/admin/server-info', getServerInfo);
      api.get('/admin/dashboard/exercises/stats', getDashboardExerciseStats);

      // Admin Routes
      // Public auth endpoint (must be before other admin routes)
      api.post('/admin/login-or-create', loginOrCreate);

      api.get('/admin/users', getUsers);
      api.get('/admin/stats/:userId', getUserStats);
      api.get('/admin/proxy', getProxyConfig);
  api.post('/admin/proxy', updateProxyConfig);
  api.get('/admin/proxy/test', testProxy);
  api.get('/admin/proxy/ip-info', getIPInfo);
  api.post('/config/update', updateConfig);
      api.post('/knowledge/exercise', updateExercise);
      api.delete('/knowledge/exercise/:id', deleteExercise);
      api.get('/knowledge/guidance', getGuidance);
      api.post('/knowledge/guidance', updateGuidance);
      api.post('/prompt/style', updatePromptStyle);

      api.delete('/admin/sessions/:id', deleteUserSession);
      api.delete('/admin/users/:userId', deleteUserAccount);

      // System Health & Logs Routes
      api.get('/admin/health', getSystemHealth);
      api.get('/admin/logs', getSystemLogs);
      api.get('/admin/capabilities', getAdminCapabilities);

      // Quick Actions Routes
      api.post('/admin/restart', restartService);
      api.post('/admin/backup', backupDatabase);
      api.post('/admin/emergency-stop', emergencyStop);

      // AI Configuration Routes
      api.get('/admin/ai-config', getAIConfig);
      api.post('/admin/ai-config', updateAIConfig);

      // Model Configuration Routes
      api.get('/admin/model-config', getModelConfig);
      api.post('/admin/model-config', updateModelConfig);
      api.get('/admin/model-config/test', testModelConnection);

      // Image Generation Configuration Routes
      api.get('/admin/image-gen-config', getImageGenConfig);
      api.post('/admin/image-gen-config', updateImageGenConfig);
      api.get('/admin/image-gen-config/test', testImageGenConnection);

      // Exercise Library IO Routes (Import/Export)
      // NOTE: More specific routes must come before parameterized routes
      api.get('/exercises/export', exportExercises);
      api.post('/exercises/import', importExercises);
      api.post('/exercises/import/precheck', precheckImport);
      api.get('/exercises/import/status/:batchId', getImportStatus);
      api.post('/exercises/import/cancel/:batchId', cancelImport);
      api.get('/exercises/import/list', getImportList);

      // Exercise Library Routes (New)
      api.get('/exercises', getAllExercises);
      api.get('/exercises/stats', getExerciseStats);
      api.get('/exercises/by-name/:name', getExerciseByName);
      api.get('/exercises/target/:target', getExercisesByTarget);
      api.get('/exercises/difficulty/:difficulty', getExercisesByDifficulty);
      api.get('/exercises/by-equipment', getExercisesByEquipment);
      api.get('/exercises/:id', getExerciseById);
      api.post('/exercises', createExercise);
      api.put('/exercises/:id', updateExerciseById);
      api.delete('/exercises/:id', deleteExerciseById);

      // User Profile Routes (New)
      api.get('/profiles/:userId', getUserProfile);
      api.put('/profiles/:userId', updateUserProfile);
      api.delete('/profiles/:userId/anchors/:exerciseId', deleteLoadAnchor);

      // Admin Config Routes (New for User Management Refactoring)
      api.get('/admin/configs', getAllAdminConfigs);
      api.get('/admin/configs/:key', getAdminConfig);
      api.post('/admin/configs', setAdminConfig);
      api.get('/admin/configs/pinned-users', getPinnedUsers);
      api.post('/admin/configs/pinned-users', setPinnedUsers);
      api.post('/admin/configs/pinned-users/toggle', togglePinnedUser);
      api.post('/admin/users/batch-delete', batchDeleteUsers);
      api.get('/admin/users/:userId/sessions', getUserSessions);
      api.get('/admin/users/:userId/export-markdown', exportUserTrainingMarkdown);
      api.put('/admin/users/:userId/display-name', updateUserDisplayName);
      api.put('/admin/users/:userId/profile/static', updateUserProfileStatic);

      // Video Routes (New)
      // NOTE: More specific routes must come before parameterized routes
      api.post('/videos/upload', uploadVideo);
      api.get('/videos/status/ffmpeg', checkFFmpegStatus);

      // Video Task Routes (must come before /:exerciseName)
      api.get('/videos/tasks', getAllVideoTasks);
      api.get('/videos/tasks/:id', getVideoTask);
      api.post('/videos/tasks/:id/retry', retryVideoTask);
      api.delete('/videos/tasks/:id', deleteVideoTask);
      api.get('/videos/stats', getVideoStats);

      // Video Progress WebSocket
      (api as any).get('/videos/progress', { websocket: true }, (connection: any, req: any) => {
        const socket = connection.socket || (connection.send ? connection : null);

        if (!socket) {
          console.error('[WebSocket] Could not find WebSocket object in connection');
          if (typeof connection.destroy === 'function') connection.destroy();
          else if (typeof connection.end === 'function') connection.end();
          return;
        }

        // 从 URL 提取 taskId
        const taskId = req.query?.taskId;
        if (!taskId) {
          console.error('[WebSocket] No taskId provided');
          socket.close();
          return;
        }

        console.log(`[WebSocket] Video progress client connected for task: ${taskId}`);
        WebSocketProgressBroadcaster.subscribe(taskId, socket);

        socket.on('close', () => {
          console.log(`[WebSocket] Video progress client disconnected for task: ${taskId}`);
        });

        socket.on('error', (err: any) => {
          console.error(`[WebSocket] Socket error for task ${taskId}:`, err);
        });
      });

      // Exercise-specific routes (must come last)
      api.get('/videos/:exerciseName', getVideoInfo);
      api.delete('/videos/:exerciseName', deleteVideo);
    }, { prefix: '/api' });

    const port = Number(process.env.PORT) || 43111;
    const host = process.env.HOST || '0.0.0.0';
    await server.listen({ port, host });
    console.log(`Server running at http://${host}:${port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
