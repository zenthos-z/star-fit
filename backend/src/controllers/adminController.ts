import { FastifyRequest, FastifyReply } from 'fastify';
import path from 'path';
import fs from 'fs-extra';
import { pipeline } from 'stream';
import util from 'util';
import { ProxyAgent, request } from 'undici';
import { randomUUID } from 'crypto';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format Date/Timestamp to ISO string for UserProfileV2
 */
function formatDateTime(date: Date | string | number | undefined | null): string {
  if (!date) return new Date().toISOString();
  if (typeof date === 'string') return date;
  if (typeof date === 'number') return new Date(date).toISOString();
  return new Date(date).toISOString();
}
// PostgreSQL services (migration from SQLite)
import { KnowledgeRepo, ConfigRepo } from '../services/knowledgeRepo.js';
import { SessionRepo } from '../services/sessionRepo.js';
import { MediaRepo } from '../services/mediaRepo.js';
import { getUserId } from '../utils/requestUtils.js';
import { getNowISO } from '../utils/timestamp.js';
import { wsService } from '../services/wsService.js';
import { PromptEngineCore } from '../services/promptEngineCore.js';
import { parseJSONSafe } from '../types/validation.js';
import {
  getAllConfigs,
  resolveTaskConfig,
  resolveDefaultedProvider,
  updateTaskConfig,
  testConnection,
  getAvailableModels,
  resolveImageModelConfig,
  updateImageGenConfig as updateImageGenConfigService,
  getAvailableImageModels,
  testImageGenConnection as testImageGenConnectionService
} from '../services/modelConfigService.js';
import { AdminConfigService } from '../services/AdminConfigService.js';
import { ExportMarkdownQuerySchema, ExportMarkdownResponseSchema } from '../schemas/exportSchema.js';
import { markdownExportService } from '../services/markdownExportService.js';

const pump = util.promisify(pipeline);

// Admin / Debug Controller
export const getUsers = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    // Use PostgreSQL for consistency with getUserProfile API
    const { getPostgresClient } = await import('../db/postgresql/client/postgres-client.js');
    const client = getPostgresClient();

    // Query user_insights VIEW with session_count from sessions table
    const rows = await client.query(`
      SELECT
        ui.user_id::text as id,
        ui.device_id,
        -- Only use display_name if set, otherwise return null (frontend will show "未设置名称")
        NULLIF(ui.display_name, '') as display_name,
        ui.created_at,
        COALESCE(s.session_count, 0) as session_count
      FROM user_insights ui
      LEFT JOIN (
        SELECT user_id, COUNT(*) as session_count
        FROM sessions
        GROUP BY user_id
      ) s ON ui.user_id = s.user_id
      ORDER BY ui.created_at DESC
    `, {});

    return reply.send(rows.rows || rows);
  } catch (e: any) {
    req.log.error(e, 'get_users_failed');
    return reply.status(500). send({ error: e.message });
  }
};

/**
 * Login or create user endpoint
 * Used by the frontend login system to auto-create users on first login
 */
export const loginOrCreate = async (req: FastifyRequest, reply: FastifyReply) => {
  const { userId } = req.body as { userId: string };

  if (!userId || userId.trim().length === 0) {
    return reply.status(400).send({ error: 'userId is required' });
  }

  const trimmedUserId = userId.trim();

  try {
    const { getPostgresClient } = await import('../db/postgresql/client/postgres-client.js');
    const client = getPostgresClient();

    // Check if user exists by device_id (which stores the login userId)
    const existingUser = await client.query(`
      SELECT id, device_id, display_name
      FROM users
      WHERE device_id = $userId
      LIMIT 1
    `, { userId });

    if (existingUser.rows.length > 0) {
      // User exists, return their ID
      const user = existingUser.rows[0];
      // Use device_id as display_name fallback if display_name is null
      const displayName = user.display_name || user.device_id;
      return reply.send({
        userId: user.id,
        isNew: false,
        displayName: displayName
      });
    }

    // Create new user
    const newUserId = randomUUID();
    const now = new Date().toISOString();

    await client.query(`
      INSERT INTO users (id, device_id, display_name, created_at, updated_at, protocol_version, version)
      VALUES ($id, $deviceId, $displayName, $createdAt, $updatedAt, $protocolVersion, $version)
    `, {
      id: newUserId,
      deviceId: trimmedUserId, // Use user input as device_id (for backward compatibility)
      displayName: trimmedUserId, // Also save as display_name
      createdAt: now,
      updatedAt: now,
      protocolVersion: '2.0',
      version: 1
    });

    req.log.info({ userId: newUserId, deviceId: trimmedUserId, displayName: trimmedUserId }, 'New user created');

    return reply.send({
      userId: newUserId,
      isNew: true,
      displayName: trimmedUserId
    });
  } catch (e: any) {
    req.log.error(e, 'login_or_create_failed');
    return reply.status(500).send({ error: e.message });
  }
};

export const resolveContext = async (req: FastifyRequest, reply: FastifyReply) => {
  const { userId, scenario, userInput } = req.body as { 
    userId: string; 
    scenario: string; 
    userInput?: string 
  };

  if (!userId || !scenario) {
    return reply.status(400).send({ error: 'Missing userId or scenario' });
  }

  try {
    const contextPack = await PromptEngineCore.buildContextPack(userId, scenario, { userInput });
    return reply.send(contextPack);
  } catch (e: any) {
    req.log.error(e, 'resolve_context_failed');
    return reply.status(500).send({ error: e.message });
  }
};

// Media Controller
export const uploadMedia = async (req: FastifyRequest, reply: FastifyReply) => {
  const data = await req.file();
  if (!data) {
    return reply.status(400).send({ error: 'No file' });
  }

  const userId = getUserId(req);
  const ext = path.extname(data.filename) || '.bin';
  const mediaId = randomUUID();
  const filename = `${mediaId}${ext}`;
  const uploadDir = path.join(process.cwd(), 'uploads');
  await fs.ensureDir(uploadDir);
  
  const filepath = path.join(uploadDir, filename);
  await pump(data.file, fs.createWriteStream(filepath));

  // Record ownership
  const stats = await fs.stat(filepath);
  await MediaRepo.recordOwnership(userId, mediaId, mediaId, data.mimetype, stats.size);

  return reply.send({
    id: mediaId,
    url: `/uploads/${filename}`,
    mimeType: data.mimetype
  });
};

export const listUserMedia = async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = getUserId(req);
    try {
        const media = await MediaRepo.getUserMedia(userId);
        return reply.send(media);
    } catch (e: any) {
        return reply.status(500).send({ error: e.message });
    }
}

interface UserMedia {
  id: string;
  user_id: string;
  hash: string;
  mime: string;
  size: number;
  created_at: number;
}

export const deleteMedia = async (req: FastifyRequest, reply: FastifyReply) => {
  const userId = getUserId(req);
  const { id } = req.params as { id: string };

  try {
    // 1. Verify ownership
    const allMedia = await MediaRepo.getUserMedia(userId);
    const media = allMedia.find(m => m.id === id);
    if (!media) {
      return reply.status(403).send({ error: 'Unauthorized or not found' });
    }

    // 2. Delete from DB
    await MediaRepo.deleteMedia(id);

    return reply.send({ success: true });
  } catch (e: any) {
    return reply.status(500).send({ error: e.message });
  }
};

// Admin Controller
export const getUserStats = async (req: FastifyRequest, reply: FastifyReply) => {
    const { userId } = req.params as { userId: string };
    try {
        const allSessions = await SessionRepo.getAllUserSessions(userId);
        const recentSessions = allSessions.slice(0, 10);

        // Calculate summary stats
        let totalVolume = 0;
        for (const session of allSessions) {
            try {
                const rawData = typeof session.raw_json === 'string'
                    ? JSON.parse(session.raw_json)
                    : session.raw_json;

                if (rawData?.exercises && Array.isArray(rawData.exercises)) {
                    for (const exercise of rawData.exercises) {
                        if (exercise.sets && Array.isArray(exercise.sets)) {
                            for (const set of exercise.sets) {
                                if (set.completed && set.weight && set.reps) {
                                    totalVolume += set.weight * set.reps;
                                }
                            }
                        }
                    }
                }
            } catch (e) {
                // Skip invalid sessions
                continue;
            }
        }

        return reply.send({
            session_count: allSessions.length,
            total_volume: totalVolume,
            recent_sessions: recentSessions
        });
    } catch (e: any) {
        return reply.status(500).send({error: e.message});
    }
}

export const updateConfig = async (req: FastifyRequest, reply: FastifyReply) => {
    const { key, value } = req.body as { key: string, value: any };
    const userId = getUserId(req);
    try {
        await ConfigRepo.setConfig(userId, key, value);
        await wsService.broadcastToUser(userId, 'config_updated', { key });
        return reply.send({ success: true });
    } catch (e: any) {
        return reply.status(500).send({error: e.message});
    }
}

export const getProxyConfig = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const globalProxy = await ConfigRepo.getConfig('system', 'GLOBAL_PROXY');
    const geminiProxy = await ConfigRepo.getConfig('system', 'GEMINI_PROXY');
    const openaiProxy = await ConfigRepo.getConfig('system', 'OPENAI_PROXY');
    
    // AI API Settings
    const aiProvider = await ConfigRepo.getConfig('system', 'AI_PROVIDER');
    const googleApiKey = await ConfigRepo.getConfig('system', 'GOOGLE_API_KEY');
    const openaiApiKey = await ConfigRepo.getConfig('system', 'OPENAI_API_KEY');
    const deepseekApiKey = await ConfigRepo.getConfig('system', 'DEEPSEEK_API_KEY');

    return reply.send({
      GLOBAL_PROXY: globalProxy !== null ? globalProxy : (process.env.GLOBAL_PROXY || ''),
      GEMINI_PROXY: geminiProxy !== null ? geminiProxy : (process.env.GEMINI_PROXY || ''),
      OPENAI_PROXY: openaiProxy !== null ? openaiProxy : (process.env.OPENAI_PROXY || ''),
      AI_PROVIDER: aiProvider !== null ? aiProvider : (process.env.AI_PROVIDER || 'gemini'),
      GOOGLE_API_KEY_SET: Boolean((googleApiKey !== null ? googleApiKey : (process.env.GOOGLE_API_KEY || '')).trim()),
      OPENAI_API_KEY_SET: Boolean((openaiApiKey !== null ? openaiApiKey : (process.env.OPENAI_API_KEY || '')).trim()),
      DEEPSEEK_API_KEY_SET: Boolean((deepseekApiKey !== null ? deepseekApiKey : (process.env.DEEPSEEK_API_KEY || '')).trim())
    });
  } catch (e: any) {
    return reply.status(500).send({ error: e.message });
  }
};

export const updateProxyConfig = async (req: FastifyRequest, reply: FastifyReply) => {
  const {
    GLOBAL_PROXY, GEMINI_PROXY, OPENAI_PROXY,
    AI_PROVIDER, GOOGLE_API_KEY, OPENAI_API_KEY, DEEPSEEK_API_KEY
  } = req.body as any;
  try {
    if (GLOBAL_PROXY !== undefined) await ConfigRepo.setConfig('system', 'GLOBAL_PROXY', GLOBAL_PROXY);
    if (GEMINI_PROXY !== undefined) await ConfigRepo.setConfig('system', 'GEMINI_PROXY', GEMINI_PROXY);
    if (OPENAI_PROXY !== undefined) await ConfigRepo.setConfig('system', 'OPENAI_PROXY', OPENAI_PROXY);

    if (AI_PROVIDER !== undefined) await ConfigRepo.setConfig('system', 'AI_PROVIDER', AI_PROVIDER);
    if (GOOGLE_API_KEY !== undefined) await ConfigRepo.setConfig('system', 'GOOGLE_API_KEY', GOOGLE_API_KEY);
    if (OPENAI_API_KEY !== undefined) await ConfigRepo.setConfig('system', 'OPENAI_API_KEY', OPENAI_API_KEY);
    if (DEEPSEEK_API_KEY !== undefined) await ConfigRepo.setConfig('system', 'DEEPSEEK_API_KEY', DEEPSEEK_API_KEY);
    
    return reply.send({ success: true });
  } catch (e: any) {
    return reply.status(500).send({ error: e.message });
  }
};

export const testProxy = async (req: FastifyRequest, reply: FastifyReply) => {
  const query = req.query as any;
  const { url, provider, test_ai, apiKey: queryApiKey, proxyUrl: queryProxyUrl, model: queryModel } = query;
  
  console.log('[ProxyTest] Received query:', { ...query, apiKey: (query as any)?.apiKey ? '***' : undefined });
  
  try {
    let proxyUrl = queryProxyUrl || "";
    let source = queryProxyUrl ? "query" : "none";
    let targetUrl = url || "";
    let finalModel = queryModel || "";

    // AI Connectivity Test logic
    if (test_ai) {
      const aiType = test_ai.toLowerCase();
      if (aiType === 'gemini') {
        const apiKey = queryApiKey || await getApiKey('gemini');
        if (!apiKey) return reply.status(400).send({ success: false, error: 'Google API Key is not configured' });
        finalModel = queryModel || 'gemini-3-flash-preview';
        // Use v1beta as it supports more preview/experimental models
        targetUrl = `https://generativelanguage.googleapis.com/v1beta/models/${finalModel}:generateContent?key=${encodeURIComponent(apiKey)}`;
      } else if (aiType === 'openai') {
        const apiKey = queryApiKey || await getApiKey('openai');
        if (!apiKey) return reply.status(400).send({ success: false, error: 'OpenAI API Key is not configured' });
        finalModel = queryModel || 'gpt-4o-mini';
        targetUrl = "https://api.openai.com/v1/chat/completions";
      }
    }

    if (!targetUrl) {
      const safeQuery = { ...query, apiKey: (query as any)?.apiKey ? '***' : undefined };
      return reply.status(400).send({ 
        success: false, 
        error: `Missing url or test_ai parameter. Received test_ai=${test_ai}, url=${url}`,
        receivedQuery: safeQuery
      });
    }

    if (!proxyUrl && provider) {
      const specificKey = provider.toUpperCase() === 'OPENAI' ? 'OPENAI_PROXY' : 'GEMINI_PROXY';
      const dbVal = await ConfigRepo.getConfig('system', specificKey);
      if (dbVal !== null) {
        proxyUrl = dbVal;
        source = `db:${specificKey}`;
      } else {
        proxyUrl = (provider.toUpperCase() === 'OPENAI' ? process.env.OPENAI_PROXY : process.env.GEMINI_PROXY) || "";
        source = `env:${specificKey}`;
      }
    }
    
    if (!proxyUrl) {
      const dbGlobal = await ConfigRepo.getConfig('system', 'GLOBAL_PROXY');
      if (dbGlobal !== null) {
        proxyUrl = dbGlobal;
        source = "db:GLOBAL_PROXY";
      } else {
        proxyUrl = process.env.GLOBAL_PROXY || "";
        source = "env:GLOBAL_PROXY";
      }
    }

    // Normalize proxy URL
    let finalProxyUrl = proxyUrl.trim();
    if (finalProxyUrl && !finalProxyUrl.includes('://')) {
      finalProxyUrl = `http://${finalProxyUrl}`;
    }

    const dispatcher = finalProxyUrl ? new ProxyAgent(finalProxyUrl) : undefined;
    
    console.log(`[ProxyTest] Testing URL: ${targetUrl.split('?')[0]}, Proxy: ${finalProxyUrl || 'None'} (Source: ${source})`);
    
    const start = Date.now();
    try {
      const options: any = {
        method: test_ai ? 'POST' : 'GET',
        dispatcher,
        headersTimeout: 20000, // Increase timeout
        bodyTimeout: 20000,
        headers: {
          'user-agent': 'Starfit-Admin-Tester/1.0',
          'content-type': 'application/json'
        }
      };

      if (test_ai) {
        if (test_ai.toLowerCase() === 'gemini') {
          // Add role: user for strict API versions
          options.body = JSON.stringify({ 
            contents: [{ 
              role: "user",
              parts: [{ text: "ping" }] 
            }] 
          });
        } else if (test_ai.toLowerCase() === 'openai') {
          const key = queryApiKey || await getApiKey('openai');
          options.headers['Authorization'] = `Bearer ${key}`;
          options.body = JSON.stringify({ 
            model: finalModel, 
            messages: [{ role: "user", content: "ping" }], 
            max_tokens: 5 
          });
        }
      }

      const response = await request(targetUrl, options);
      const latency = Date.now() - start;

      let resBody: any = {};
      const rawBody = await response.body.text();
      resBody = parseJSONSafe(rawBody, 'adminControllerProxy') || { raw: rawBody.slice(0, 1000) };
      
      if (response.statusCode >= 400) {
        console.error(`[ProxyTest] Failed: ${response.statusCode}`, JSON.stringify(resBody, null, 2));
        let errorMsg = resBody.error?.message || resBody.error || `HTTP ${response.statusCode}`;
        if (typeof resBody === 'object' && resBody.error?.details) {
          errorMsg += ` (${JSON.stringify(resBody.error.details)})`;
        }
        
        // Also check for model not found specifically
        if (response.statusCode === 404 || (typeof errorMsg === 'string' && errorMsg.includes('not found'))) {
          errorMsg = `模型 "${finalModel}" 未找到或暂不支持。请检查模型名称是否正确。`;
        }
        // Add helpful hint for common proxy issues
        if (response.statusCode === 401 || response.statusCode === 403) {
          errorMsg += " - 请检查 API Key 是否正确";
        } else if (response.statusCode === 404) {
          errorMsg += " - 请检查模型名称是否正确";
        }

        return reply.send({ 
          success: false, 
          error: errorMsg,
          statusCode: response.statusCode,
          details: resBody,
          proxyUsed: finalProxyUrl,
          source 
        });
      }

      return reply.send({ 
        success: true, 
        latency, 
        proxyUsed: finalProxyUrl, 
        source,
        info: test_ai ? 'AI Service Connected' : 'Website Accessible',
        response: resBody
      });
    } catch (fetchError: any) {
      const latency = Date.now() - start;
      console.error(`[ProxyTest] Fetch Error: ${fetchError.message}`, fetchError);
      
      let errorHint = "";
      if (fetchError.message.includes('undici') || fetchError.message.includes('socket hang up')) {
        errorHint = " - 可能是代理协议不支持（例如使用了 SOCKS5 但此处仅支持 HTTP/HTTPS）或代理服务器未启动";
      } else if (fetchError.message.includes('ECONNREFUSED')) {
        errorHint = " - 无法连接到代理服务器，请确认端口是否正确";
      } else if (fetchError.message.includes('ETIMEDOUT')) {
        errorHint = " - 连接超时，请检查网络质量或代理是否可用";
      }

      return reply.send({
        success: false,
        error: fetchError.message + errorHint,
        latency,
        proxyUsed: finalProxyUrl || null,
        source
      });
    }
  } catch (e: any) {
    console.error('[ProxyTest] Setup Error:', e);
    return reply.status(500).send({ error: e.message });
  }
};

async function getApiKey(provider: string): Promise<string> {
  const upper = provider.toUpperCase();
  const keyName = upper === 'OPENAI' ? 'OPENAI_API_KEY' : upper === 'DEEPSEEK' ? 'DEEPSEEK_API_KEY' : 'GOOGLE_API_KEY';
  const dbKey = await ConfigRepo.getConfig('system', keyName);
  if (dbKey) return dbKey;
  return process.env[keyName] || "";
}

export const getIPInfo = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const { provider } = req.query as { provider?: string };
    let proxyUrl = "";
    let source = "none";

    if (provider) {
      const specificKey = provider.toUpperCase() === 'OPENAI' ? 'OPENAI_PROXY' : 'GEMINI_PROXY';
      const dbVal = await ConfigRepo.getConfig('system', specificKey);
      if (dbVal !== null) {
        proxyUrl = dbVal;
        source = `db:${specificKey}`;
      } else {
        proxyUrl = (provider.toUpperCase() === 'OPENAI' ? process.env.OPENAI_PROXY : process.env.GEMINI_PROXY) || "";
        source = `env:${specificKey}`;
      }
    }
    
    if (!proxyUrl) {
      const dbGlobal = await ConfigRepo.getConfig('system', 'GLOBAL_PROXY');
      if (dbGlobal !== null) {
        proxyUrl = dbGlobal;
        source = "db:GLOBAL_PROXY";
      } else {
        proxyUrl = process.env.GLOBAL_PROXY || "";
        source = "env:GLOBAL_PROXY";
      }
    }
    
    console.log(`[IPInfo] Provider: ${provider || 'Global'}, Proxy: "${proxyUrl}", Source: ${source}`);

    // Normalize proxy URL
    let finalProxyUrl = proxyUrl.trim();
    if (finalProxyUrl && !finalProxyUrl.includes('://')) {
      finalProxyUrl = `http://${finalProxyUrl}`;
    }

    const dispatcher = finalProxyUrl ? new ProxyAgent(finalProxyUrl) : undefined;

    // Try multiple IP services for better reliability
    const services = [
      {
        url: 'http://ip-api.com/json/?fields=status,message,country,countryCode,regionName,city,zip,timezone,isp,org,as,query',
        parser: (data: any) => ({
          query: data.query,
          country: data.country,
          city: data.regionName + ' ' + data.city,
          isp: data.isp,
          region: data.regionName
        })
      },
      {
        url: 'https://api.ip.sb/geoip',
        parser: (data: any) => ({
          query: data.ip,
          country: data.country,
          city: data.region + ' ' + data.city,
          isp: data.isp || data.organization,
          region: data.region
        })
      },
      {
        url: 'https://ipapi.co/json/',
        parser: (data: any) => ({
          query: data.ip,
          country: data.country_name,
          city: data.region + ' ' + data.city,
          isp: data.org,
          region: data.region
        })
      },
      {
        url: 'https://ifconfig.me/all.json',
        parser: (data: any) => ({
          query: data.ip_addr,
          country: data.country_code,
          city: data.city || 'Unknown',
          isp: data.remote_host || 'Unknown',
          region: ''
        })
      }
    ];

    let lastError = null;
    for (const service of services) {
      try {
        console.log(`[IPInfo] Trying service: ${service.url} with proxy: ${proxyUrl || 'None'}`);
        
        const response = await request(service.url, {
          dispatcher,
          method: 'GET',
          headers: {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          },
          headersTimeout: 5000,
          bodyTimeout: 5000
        });
        
        if (response.statusCode === 200) {
          const data = await response.body.json() as any;
          const normalized = service.parser(data);
          console.log(`[IPInfo] Success with ${service.url}:`, normalized.query, `(${normalized.country})`);
          return reply.send({
            ...normalized,
            proxyUsed: proxyUrl || null,
            source
          });
        } else {
          console.warn(`[IPInfo] Service ${service.url} returned status ${response.statusCode}`);
          await response.body.dump(); // Consume the body
        }
      } catch (e: any) {
        console.warn(`[IPInfo] Service ${service.url} failed:`, e.message);
        lastError = e;
        continue;
      }
    }
    
    throw lastError || new Error('All IP services failed');
  } catch (e: any) {
    console.error('[IPInfo] Error:', e);
    return reply.status(500).send({ error: e.message });
  }
};

export const updateExercise = async (req: FastifyRequest, reply: FastifyReply) => {
    const ex = req.body as any;
    try {
        await KnowledgeRepo.upsertExercise(ex);
        // Exercises are global, but we can notify the user who updated it or all users
        // For now, broadcast to 'global' or similar if needed, or just specific user
        const userId = getUserId(req);
        await wsService.broadcastToUser(userId, 'knowledge_updated', { type: 'exercise', id: ex.id });
        return reply.send({ success: true });
    } catch (e: any) {
        return reply.status(500).send({error: e.message});
    }
}

export const deleteExercise = async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    try {
        await KnowledgeRepo.deleteExercise(id);
        const userId = getUserId(req);
        await wsService.broadcastToUser(userId, 'knowledge_updated', { type: 'exercise_deleted', id });
        return reply.send({ success: true });
    } catch (e: any) {
        return reply.status(500).send({error: e.message});
    }
}

export const getGuidance = async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = getUserId(req);
    try {
        const guidance = await KnowledgeRepo.getAllGuidance(userId);
        return reply.send(guidance);
    } catch (e: any) {
        return reply.status(500).send({error: e.message});
    }
}

export const updateGuidance = async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = getUserId(req);
    const doc = req.body as any;
    try {
        await KnowledgeRepo.upsertGuidance(userId, doc);
        await wsService.broadcastToUser(userId, 'knowledge_updated', { type: 'guidance', key: doc.key });
        return reply.send({ success: true });
    } catch (e: any) {
        return reply.status(500).send({error: e.message});
    }
}

export const updatePromptStyle = async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req.headers['x-user-id'] as string) || 'global';
    const { styleKey, parameters } = req.body as { styleKey: string, parameters: any };
    try {
        await ConfigRepo.setStyleParam(userId, styleKey, parameters);
        await wsService.broadcastToUser(userId, 'config_updated', { type: 'prompt_style', styleKey });
        return reply.send({ success: true });
    } catch (e: any) {
        return reply.status(500).send({error: e.message});
    }
}

export const deleteUserSession = async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    console.log(`[AdminAPI] Attempting to delete session: ${id}`);
    try {
        await SessionRepo.deleteSession(id);
        console.log(`[AdminAPI] Successfully deleted session: ${id}`);
        return reply.send({ success: true });
    } catch (e: any) {
        console.error(`[AdminAPI] Error deleting session: ${id}`, e);
        return reply.status(500).send({ error: e.message });
    }
}

export const deleteUserAccount = async (req: FastifyRequest, reply: FastifyReply) => {
    const { userId } = req.params as { userId: string };
    console.log(`[AdminAPI] Attempting to delete user account: ${userId}`);
    try {
        await SessionRepo.deleteUser(userId);
        console.log(`[AdminAPI] Successfully deleted user account: ${userId}`);
        return reply.send({ success: true });
    } catch (e: any) {
        console.error(`[AdminAPI] Error deleting user account: ${userId}`, e);
        return reply.status(500).send({ error: e.message });
    }
}

// System Health API
export const getSystemHealth = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const start = Date.now();
    
    // Check API latency
    const apiLatency = Date.now() - start;
    
    // Check AI connection status. resolveDefaultedProvider() reads DB > env and
    // defaults to the actual runtime provider (deepseek under the new kernel),
    // so the admin header reflects what /api/chat really uses — not a stale
    // process.env default.
    const aiProvider = await resolveDefaultedProvider('default');
    const aiStatus = await checkAIConnection(aiProvider);
    
    // Check storage usage
    const storageInfo = await getStorageInfo();
    
    return reply.send({
      api: {
        status: 'ok',
        latency: apiLatency
      },
      ai: {
        status: aiStatus.connected ? 'connected' : 'disconnected',
        provider: aiProvider,
        model: aiStatus.model
      },
      storage: {
        used: storageInfo.used,
        total: storageInfo.total,
        percent: storageInfo.percent,
        available: storageInfo.available
      },
      uptime: process.uptime()
    });
  } catch (e: any) {
    console.error('[SystemHealth] Error:', e);
    return reply.status(500).send({ error: e.message });
  }
};

export const getAdminCapabilities = async (_req: FastifyRequest, reply: FastifyReply) => {
  return reply.send({
    protocol_version: '2.0.0',
    features: {
      dashboard: {
        health: true,
        logs: true,
        quick_actions: true
      },
      settings: {
        proxy: true,
        ai_config: true
      },
      users: {
        list: true,
        profile: true,
        stats: true,
        delete_user: true,
        delete_session: true,
        health_integrations: false
      },
      content: {
        exercises: true,
        videos_upload: true,
        media_upload: true
      }
    }
  });
};

async function checkAIConnection(provider: string): Promise<{ connected: boolean; model: string }> {
  const timeout = new Promise<{ connected: boolean; model: string; timeout?: boolean }>((resolve) => {
    setTimeout(() => resolve({ connected: false, model: '', timeout: true }), 15000);
  });

  try {
    const result = await Promise.race([checkAIConnectionInternal(provider), timeout]) as { connected: boolean; model: string; timeout?: boolean };
    
    if ('timeout' in result && result.timeout) {
      console.warn('[AIConnection] Check timed out after 15s');
      return { connected: false, model: '' };
    }
    
    return { connected: result.connected, model: result.model };
  } catch (e) {
    console.error('[AIConnection] Error:', e);
    return { connected: false, model: '' };
  }
}

async function checkAIConnectionInternal(provider: string): Promise<{ connected: boolean; model: string }> {
  try {
    if (provider === 'gemini') {
      const apiKey = await getApiKey('gemini');
      if (!apiKey) return { connected: false, model: '' };
      
      const model = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      
      const response = await request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        headersTimeout: 15000,
        bodyTimeout: 15000,
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "ping" }] }] })
      });
      
      return { connected: response.statusCode === 200, model };
    } else if (provider === 'openai') {
      const apiKey = await getApiKey('openai');
      if (!apiKey) return { connected: false, model: '' };

      const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
      // 使用 OPENAI_BASE_URL 环境变量以支持 OpenAI 兼容 API（如 DMXAPI）
      const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
      const url = `${baseUrl}/chat/completions`.replace(/\/+/g, '/'); // 规范化路径

      const response = await request(url, {
        method: 'POST',
        headers: { 
          'content-type': 'application/json',
          'authorization': `Bearer ${apiKey}`
        },
        headersTimeout: 15000,
        bodyTimeout: 15000,
        body: JSON.stringify({ 
          model, 
          messages: [{ role: "user", content: "ping" }], 
          max_tokens: 5 
        })
      });
      
      return { connected: response.statusCode === 200, model };
    } else if (provider === 'deepseek') {
      const apiKey = await getApiKey('deepseek');
      if (!apiKey) return { connected: false, model: '' };

      const model = process.env.DEEPSEEK_MODEL_FLASH || 'deepseek-v4-flash';
      const baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
      const url = `${baseUrl}/chat/completions`;

      const response = await request(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${apiKey}`
        },
        headersTimeout: 15000,
        bodyTimeout: 15000,
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 5
        })
      });

      return { connected: response.statusCode === 200, model };
    }
  } catch (e) {
    const err = e as any;
    // 统一使用 warn 级别，因为健康检查失败不是严重错误
    if (err.code === 'UND_ERR_HEADERS_TIMEOUT' || err.code === 'UND_ERR_BODY_TIMEOUT' || err.code === 'UND_ERR_CONNECT_TIMEOUT') {
      console.warn('[AIConnection] Connection check timed out:', err.code);
    } else {
      console.warn('[AIConnection] Connection check failed:', e);
    }
  }
  return { connected: false, model: '' };
}

async function getStorageInfo(): Promise<{ used: number; total: number; percent: number; available: number }> {
  try {
    const uploadDir = path.join(process.cwd(), 'uploads');
    await fs.ensureDir(uploadDir);
    
    const totalSize = await getDirectorySize(uploadDir);
    const totalCapacity = 10 * 1024 * 1024 * 1024; // 10 GB default
    const available = totalCapacity - totalSize;
    const percent = Math.round((totalSize / totalCapacity) * 100);
    
    return {
      used: totalSize,
      total: totalCapacity,
      percent,
      available
    };
  } catch (e) {
    console.error('[StorageInfo] Error:', e);
    return { used: 0, total: 10 * 1024 * 1024 * 1024, percent: 0, available: 10 * 1024 * 1024 * 1024 };
  }
}

async function getDirectorySize(dirPath: string): Promise<number> {
  let totalSize = 0;
  const files = await fs.readdir(dirPath, { withFileTypes: true });
  
  for (const file of files) {
    const filePath = path.join(dirPath, file.name);
    if (file.isDirectory()) {
      totalSize += await getDirectorySize(filePath);
    } else {
      const stats = await fs.stat(filePath);
      totalSize += stats.size;
    }
  }
  
  return totalSize;
}

// System Logs API
export const getSystemLogs = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const { limit = 50, level = 'info' } = req.query as { limit?: number; level?: string };
    
    const logs = await readSystemLogs(Number(limit), level);
    
    return reply.send(logs);
  } catch (e: any) {
    console.error('[SystemLogs] Error:', e);
    return reply.status(500).send({ error: e.message });
  }
};

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  meta?: any;
}

interface ParsedLogEntry {
  time?: string;
  level?: string;
  msg?: string;
  [key: string]: any;
}

async function readSystemLogs(limit: number, level: string): Promise<LogEntry[]> {
  const logs: LogEntry[] = [];

  try {
    const logFile = path.join(process.cwd(), 'logs', 'app.log');
    if (await fs.pathExists(logFile)) {
      const content = await fs.readFile(logFile, 'utf-8');
      const lines = content.split('\n').reverse().slice(0, limit);

      for (const line of lines) {
        const parsed = parseJSONSafe<ParsedLogEntry>(line, 'adminControllerStream');
        if (!parsed) {
          if (line.trim()) {
            logs.push({
              timestamp: new Date().toISOString(),
              level: 'info',
              message: line
            });
          }
          continue;
        }

        if (level === 'all' || parsed.level === level) {
          logs.push({
            timestamp: parsed.time || new Date().toISOString(),
            level: parsed.level || 'info',
            message: parsed.msg || line,
            meta: parsed
          });
        }
      }
    }
  } catch (e) {
    console.error('[ReadSystemLogs] Error:', e);
  }

  if (logs.length === 0) {
    logs.push({
      timestamp: new Date().toISOString(),
      level: 'info',
      message: 'No logs available'
    });
  }

  return logs;
}

// Quick Actions API
export const restartService = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    console.log('[QuickAction] Restart service requested');
    
    return reply.send({ success: true, message: 'Service restart initiated' });
  } catch (e: any) {
    console.error('[QuickAction] Restart error:', e);
    return reply.status(500).send({ error: e.message });
  }
};

export const backupDatabase = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    console.log('[QuickAction] Database backup requested');

    // PostgreSQL backup requires pg_dump, which should be done at infrastructure level
    // For now, we'll create a SQL export using the client
    const { getPostgresClient } = await import('../db/postgresql/client/postgres-client.js');
    const client = getPostgresClient();

    const backupDir = path.join(process.cwd(), 'backups');
    await fs.ensureDir(backupDir);

    const backupFile = path.join(backupDir, `backup_${Date.now()}.sql`);

    // Get table list
    const tables = await client.queryMany<{ tablename: string }>(`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `);

    let sqlContent = `-- Starfit PostgreSQL Backup\n-- Generated: ${new Date().toISOString()}\n\n`;

    for (const table of tables) {
      const rows = await client.queryMany(`SELECT * FROM "${table.tablename}" LIMIT 1000`);
      if (rows.length > 0) {
        sqlContent += `-- Table: ${table.tablename}\n`;
        sqlContent += `-- Rows: ${rows.length}\n\n`;
      }
    }

    await fs.writeFile(backupFile, sqlContent);

    return reply.send({
      success: true,
      message: 'Database backup completed (metadata export)',
      file: backupFile,
      tables: tables.length
    });
  } catch (e: any) {
    console.error('[QuickAction] Backup error:', e);
    return reply.status(500).send({ error: e.message });
  }
};

export const emergencyStop = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    console.log('[QuickAction] Emergency stop requested');
    
    return reply.send({ success: true, message: 'Emergency stop executed' });
  } catch (e: any) {
    console.error('[QuickAction] Emergency stop error:', e);
    return reply.status(500).send({ error: e.message });
  }
};

// AI Configuration API
export const getAIConfig = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const aiProvider = await ConfigRepo.getConfig('system', 'AI_PROVIDER') || process.env.AI_PROVIDER || 'gemini';
    const promptStyle = await ConfigRepo.getConfig('system', 'PROMPT_STYLE') || process.env.PROMPT_STYLE || 'default';
    
    const coachPersona = await ConfigRepo.getConfig('system', 'COACH_PERSONA') || process.env.COACH_PERSONA || 'professional';
    
    const styleParams = await ConfigRepo.getStyleParams('system', 'default');
    
    return reply.send({
      aiProvider,
      coachPersona,
      promptStyle,
      styleParams
    });
  } catch (e: any) {
    console.error('[AIConfig] Error:', e);
    return reply.status(500).send({ error: e.message });
  }
};

export const updateAIConfig = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const { aiProvider, coachPersona, promptStyle, styleParams } = req.body as {
      aiProvider?: string;
      coachPersona?: string;
      promptStyle?: string;
      styleParams?: any;
    };

    if (aiProvider !== undefined) {
      await ConfigRepo.setConfig('system', 'AI_PROVIDER', aiProvider);
    }

    if (coachPersona !== undefined) {
      await ConfigRepo.setConfig('system', 'COACH_PERSONA', coachPersona);
    }

    if (promptStyle !== undefined) {
      await ConfigRepo.setConfig('system', 'PROMPT_STYLE', promptStyle);
    }

    if (styleParams !== undefined) {
      await ConfigRepo.setStyleParam('system', 'default', styleParams);
    }

    return reply.send({ success: true, message: 'AI configuration updated' });
  } catch (e: any) {
    console.error('[AIConfig] Update error:', e);
    return reply.status(500).send({ error: e.message });
  }
};

// Model Configuration API
export const getModelConfig = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    console.log('[ModelConfig] Getting all model configurations...');
    const configs = await getAllConfigs();
    console.log('[ModelConfig] Configs retrieved:', JSON.stringify(configs, null, 2));

    // Also include available models lists for UI
    const response = {
      tasks: configs,
      availableModels: {
        gemini: getAvailableModels('gemini'),
        openai: getAvailableModels('openai'),
        deepseek: getAvailableModels('deepseek')
      }
    };
    console.log('[ModelConfig] Sending response:', JSON.stringify(response, null, 2));
    return reply.send(response);
  } catch (e: any) {
    console.error('[ModelConfig] Error:', e);
    return reply.status(500).send({ error: e.message });
  }
};

export const updateModelConfig = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const { task, provider, model, baseURL } = req.body as {
      task: string;
      provider: 'gemini' | 'openai' | 'deepseek';
      model: string;
      baseURL?: string;
    };

    if (!task || !provider || !model) {
      return reply.status(400).send({ error: 'Missing required fields: task, provider, model' });
    }

    await updateTaskConfig(task, { provider, model, baseURL });

    // Invalidate the cached single Deep Agent so the next /api/chat rebuilds
    // with the new model/provider.
    try {
      const { deepAgentService } = await import('../services/agent/DeepAgentService.js');
      (deepAgentService as unknown as { resetAgentCache: () => void }).resetAgentCache();
    } catch (e) {
      console.warn('[ModelConfig] Failed to invalidate agent cache:', e);
    }

    return reply.send({ success: true, message: 'Model configuration updated' });
  } catch (e: any) {
    console.error('[ModelConfig] Update error:', e);
    return reply.status(500).send({ error: e.message });
  }
};

export const testModelConnection = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const query = req.query as any;
    const { provider, model, baseURL } = query as {
      provider?: 'gemini' | 'openai' | 'deepseek';
      model?: string;
      baseURL?: string;
    };

    if (!provider || !model) {
      return reply.status(400).send({ error: 'Missing required parameters: provider, model' });
    }

    const result = await testConnection({ provider, model, baseURL });

    return reply.send(result);
  } catch (e: any) {
    console.error('[ModelConfig] Test connection error:', e);
    return reply.status(500).send({ error: e.message });
  }
};

// ============================================================================
// Image Generation Model Config API
// ============================================================================

export const getImageGenConfig = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const config = await resolveImageModelConfig();
    return reply.send({
      config,
      availableProviders: ['dmx', 'openai'],
      availableModels: {
        dmx: getAvailableImageModels('dmx'),
        openai: getAvailableImageModels('openai')
      }
    });
  } catch (e: any) {
    console.error('[ImageGen] Error:', e);
    return reply.status(500).send({ error: e.message });
  }
};

export const updateImageGenConfig = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const { provider, model, baseURL } = req.body as {
      provider: 'dmx' | 'openai';
      model: string;
      baseURL?: string;
    };

    if (!provider || !model) {
      return reply.status(400).send({ error: 'Missing required fields: provider, model' });
    }

    await updateImageGenConfigService({ provider, model, baseURL });
    return reply.send({ success: true, message: 'Image generation model configuration updated' });
  } catch (e: any) {
    console.error('[ImageGen] Update error:', e);
    return reply.status(500).send({ error: e.message });
  }
};

export const testImageGenConnection = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const query = req.query as any;
    const { provider, model, baseURL } = query as {
      provider?: 'dmx' | 'openai';
      model?: string;
      baseURL?: string;
    };

    if (!provider) {
      return reply.status(400).send({ error: 'Missing required parameter: provider' });
    }

    const result = await testImageGenConnectionService({ provider, model: model || '', baseURL });
    return reply.send(result);
  } catch (e: any) {
    console.error('[ImageGen] Test connection error:', e);
    return reply.status(500).send({ error: e.message });
  }
};

// ============================================================================
// Admin Configuration APIs (New for User Management Refactoring)
// ============================================================================

/**
 * GET /api/admin/configs/:key
 * Get a specific admin configuration value
 */
export const getAdminConfig = async (req: FastifyRequest, reply: FastifyReply) => {
  const { key } = req.params as { key: string };

  if (!key) {
    return reply.status(400).send({ error: 'Missing key parameter' });
  }

  try {
    const config = await AdminConfigService.getConfig(key);

    if (!config) {
      return reply.status(404).send({ error: 'Config not found' });
    }

    // pg library already parses JSONB values, so use directly
    const value = config.value_json;

    return reply.send({
      user_id: config.user_id,
      key: config.key,
      value,
      updated_at: config.updated_at
    });
  } catch (e: any) {
    console.error('[AdminConfig] Get config error:', e);
    return reply.status(500).send({ error: e.message });
  }
};

/**
 * POST /api/admin/configs
 * Set an admin configuration value
 */
export const setAdminConfig = async (req: FastifyRequest, reply: FastifyReply) => {
  const { key, value } = req.body as { key: string; value: any };

  if (!key || value === undefined) {
    return reply.status(400).send({ error: 'Missing key or value' });
  }

  try {
    await AdminConfigService.setConfig(key, value);

    // Broadcast config update to admin clients
    await wsService.broadcastToUser('admin', 'config_updated', { key });

    return reply.send({ success: true, key, value });
  } catch (e: any) {
    console.error('[AdminConfig] Set config error:', e);
    return reply.status(500).send({ error: e.message });
  }
};

/**
 * GET /api/admin/configs
 * Get all admin configurations
 */
export const getAllAdminConfigs = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const configs = await AdminConfigService.getAllConfigs();
    return reply.send(configs);
  } catch (e: any) {
    console.error('[AdminConfig] Get all configs error:', e);
    return reply.status(500).send({ error: e.message });
  }
};

/**
 * GET /api/admin/configs/pinned-users
 * Get pinned users list
 */
export const getPinnedUsers = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const pinned = await AdminConfigService.getPinnedUsers();
    return reply.send({ pinned_users: pinned });
  } catch (e: any) {
    console.error('[AdminConfig] Get pinned users error:', e);
    return reply.status(500).send({ error: e.message });
  }
};

/**
 * POST /api/admin/configs/pinned-users
 * Set pinned users list
 */
export const setPinnedUsers = async (req: FastifyRequest, reply: FastifyReply) => {
  const { userIds } = req.body as { userIds: string[] };

  if (!Array.isArray(userIds)) {
    return reply.status(400).send({ error: 'userIds must be an array' });
  }

  try {
    await AdminConfigService.setPinnedUsers(userIds);

    // Broadcast update to admin clients (use pinned_users for consistency)
    await wsService.broadcastToUser('admin', 'pinned_users_updated', { pinned_users: userIds });

    return reply.send({ success: true, pinned_users: userIds });
  } catch (e: any) {
    console.error('[AdminConfig] Set pinned users error:', e);
    return reply.status(500).send({ error: e.message });
  }
};

/**
 * POST /api/admin/configs/pinned-users/toggle
 * Toggle user pinned status
 */
export const togglePinnedUser = async (req: FastifyRequest, reply: FastifyReply) => {
  const { userId } = req.body as { userId: string };

  if (!userId) {
    return reply.status(400).send({ error: 'Missing userId' });
  }

  try {
    const isPinned = await AdminConfigService.togglePinnedUser(userId);
    const pinned = await AdminConfigService.getPinnedUsers();

    // Broadcast update to admin clients (use pinned_users for consistency)
    await wsService.broadcastToUser('admin', 'pinned_users_updated', { pinned_users: pinned });

    return reply.send({ success: true, is_pinned: isPinned, pinned_users: pinned });
  } catch (e: any) {
    console.error('[AdminConfig] Toggle pinned user error:', e);
    return reply.status(500).send({ error: e.message });
  }
};

/**
 * POST /api/admin/users/batch-delete
 * Batch delete multiple users
 */
export const batchDeleteUsers = async (req: FastifyRequest, reply: FastifyReply) => {
  const { userIds } = req.body as { userIds: string[] };

  if (!Array.isArray(userIds) || userIds.length === 0) {
    return reply.status(400).send({ error: 'userIds must be a non-empty array' });
  }

  console.log(`[AdminAPI] Batch deleting ${userIds.length} users:`, userIds);

  try {
    let deletedCount = 0;
    const errors: Array<{ userId: string; error: string }> = [];

    for (const userId of userIds) {
      try {
        await SessionRepo.deleteUser(userId);
        deletedCount++;

        // Remove from pinned users if present
        await AdminConfigService.removePinnedUser(userId);

        console.log(`[AdminAPI] Successfully deleted user: ${userId}`);
      } catch (e: any) {
        console.error(`[AdminAPI] Error deleting user ${userId}:`, e);
        errors.push({ userId, error: e.message });
      }
    }

    // Broadcast update to admin clients
    await wsService.broadcastToUser('admin', 'users_deleted', { userIds, deletedCount });

    return reply.send({
      success: true,
      deleted: deletedCount,
      failed: errors.length,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (e: any) {
    console.error('[AdminAPI] Batch delete error:', e);
    return reply.status(500).send({ error: e.message });
  }
};

/**
 * GET /api/admin/users/:userId/sessions
 * Get detailed session history for a user
 */
export const getUserSessions = async (req: FastifyRequest, reply: FastifyReply) => {
  const { userId } = req.params as { userId: string };
  const query = req.query as { limit?: string; offset?: string };

  if (!userId) {
    return reply.status(400).send({ error: 'Missing userId' });
  }

  try {
    const limit = query.limit ? parseInt(query.limit, 10) : undefined;
    const offset = query.offset ? parseInt(query.offset, 10) : undefined;
    const sessions = await SessionRepo.getAllUserSessions(userId, limit, offset);
    return reply.send(sessions);
  } catch (e: any) {
    console.error('[AdminAPI] Get user sessions error:', e);
    return reply.status(500).send({ error: e.message });
  }
};

/**
 * GET /api/admin/users/:userId/export-markdown
 * Export user training records as Markdown
 */
export const exportUserTrainingMarkdown = async (req: FastifyRequest, reply: FastifyReply) => {
  const { userId } = req.params as { userId: string };

  if (!userId) {
    return reply.status(400).send({ error: 'Missing userId' });
  }

  // Parse and validate query parameters using Zod
  const queryResult = ExportMarkdownQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    return reply.status(400).send({ error: 'Invalid query parameters', details: queryResult.error.issues });
  }

  const { startDate, endDate } = queryResult.data;

  try {
    console.log(`[AdminAPI] Export markdown request for user: ${userId}, range: ${startDate} - ${endDate}`);

    // Call service to generate Markdown
    const result = await markdownExportService.generateMarkdownExport({
      userId,
      startDate,
      endDate,
    });

    // Validate response using Zod
    const validated = ExportMarkdownResponseSchema.parse(result);

    console.log(`[AdminAPI] Export markdown generated for user: ${userId}, sessions: ${validated.metadata.sessionCount}`);

    return reply.send(validated);
  } catch (e: any) {
    console.error('[AdminAPI] Export markdown error:', e);
    return reply.status(500).send({ error: e.message });
  }
};

// ============================================================================
// User Profile Management APIs (New for Admin Console)
// ============================================================================

/**
 * GET /api/admin/users/:userId/profile
 * Get complete user profile including static and dynamic states
 */
export const getUserProfile = async (req: FastifyRequest, reply: FastifyReply) => {
  const { userId } = req.params as { userId: string };

  if (!userId) {
    return reply.status(400).send({ success: false, error: 'Missing userId' });
  }

  // Validate UUID format (PostgreSQL requires valid UUID)
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!UUID_REGEX.test(userId)) {
    console.log(`[AdminAPI] Invalid UUID format: ${userId}`);
    // Return empty profile structure for non-UUID user IDs (legacy compatibility)
    return reply.send({
      success: true,
      data: {
        protocol_version: '2.0.0',
        user_id: userId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        profile_static: {},
        profile_dynamic: {
          load_anchors: {},
          active_limitations: [],
          recovery_state: null
        },
        history_summary: {},
        tags: [],
        fitness_level: 'beginner',
        red_flags: [],
        training_strategy: null
      }
    });
  }

  try {
    console.log(`[AdminAPI] Getting profile for user: ${userId}`);

    // Import the PostgreSQL user profile service
    const { UserProfileService } = await import('../services/userProfileService.js');

    const profile = await UserProfileService.getProfile(userId);

    if (!profile) {
      return reply.status(404).send({ success: false, error: 'User not found' });
    }

    // Transform to UserProfileV2 format
    // Use profile.id (UUID) instead of profile.user_id (device_id)
    // Note: Return empty objects {} instead of undefined for optional fields
    // so they are included in JSON response (undefined values are omitted)
    // Helper to safely parse JSON (handles both string and already-parsed objects)
    const safeParseJSON = (value: any): any[] => {
      if (!value) return [];
      if (typeof value === 'string') {
        try { return JSON.parse(value); } catch { return []; }
      }
      return Array.isArray(value) ? value : [];
    };

    // Helper to safely parse JSON object
    const safeParseObject = (value: any): any => {
      if (!value) return {};
      if (typeof value === 'string') {
        try { return JSON.parse(value); } catch { return {}; }
      }
      return typeof value === 'object' ? value : {};
    };

    // Parse JSON fields that might be strings from Postgres
    const basicInfo = safeParseObject(profile.basic_info);
    const psychological = safeParseObject(profile.psychological);
    const loadAnchors = safeParseObject(profile.load_anchors);

    const userProfileV2 = {
      protocol_version: '2.0.0',
      user_id: profile.id || profile.user_id, // profile.id is the UUID from users table
      created_at: formatDateTime(profile.created_at),
      updated_at: formatDateTime(profile.updated_at),
      profile_static: basicInfo && Object.keys(basicInfo).length > 0 ? {
        age: basicInfo.age,
        weight: basicInfo.weight,
        height: basicInfo.height,
        body_fat_percentage: basicInfo.body_fat,
        neuro_type: psychological.neurotype,
        risk_preference: psychological.risk_preference,
        accountability: psychological.accountability,
        permanent_injuries: [],
      } : {}, // Return empty object instead of undefined
      profile_dynamic: loadAnchors && Object.keys(loadAnchors).length > 0 ? {
        load_anchors: loadAnchors,
        active_limitations: [],
        recovery_state: null,
      } : { // Return empty object with default structure
        load_anchors: {},
        active_limitations: [],
        recovery_state: null,
      },
      history_summary: {}, // Return empty object instead of undefined
      tags: safeParseJSON(profile.red_flags),
      fitness_level: profile.fitness_level || 'beginner',
      red_flags: safeParseJSON(profile.red_flags),
      training_strategy: profile.training_strategy,
    };

    // Ensure dates are strings (override Fastify serialization)
    if (userProfileV2.created_at && typeof userProfileV2.created_at !== 'string') {
      userProfileV2.created_at = new Date(userProfileV2.created_at).toISOString();
    }
    if (userProfileV2.updated_at && typeof userProfileV2.updated_at !== 'string') {
      userProfileV2.updated_at = new Date(userProfileV2.updated_at).toISOString();
    }

    return reply.send({ success: true, data: userProfileV2 });
  } catch (e: any) {
    console.error('[AdminAPI] Get user profile error:', e);
    return reply.status(500).send({ success: false, error: e.message });
  }
};

/**
 * PUT /api/admin/users/:userId/profile/static
 * Update user's static profile (basic info, psychological traits)
 */
export const updateUserProfileStatic = async (req: FastifyRequest, reply: FastifyReply) => {
  const { userId } = req.params as { userId: string };
  const updates = req.body as any;

  if (!userId) {
    return reply.status(400).send({ success: false, error: 'Missing userId' });
  }

  try {
    console.log('[AdminAPI] Updating profile static for user:', userId, updates);

    const { UserProfileService } = await import('../services/userProfileService.js');

    // Support both nested format (from V2 frontend) and flat format (legacy/admin)
    // V2 format: { basic_info: { age: 30, weight: 75 }, preferences: {...} }
    // Legacy format: { age: 30, weight: 75, neuro_type: '...' }

    // If nested format is used, pass through directly
    if (updates.basic_info || updates.preferences || updates.physiological || updates.psychological || updates.training_strategy || updates.fitness_level || updates.red_flags) {
      console.log('[AdminAPI] Using nested format for profile update');
      console.log('[AdminAPI] updates.basic_info:', JSON.stringify(updates.basic_info));
      console.log('[AdminAPI] About to call UserProfileService.updateProfile...');
      await UserProfileService.updateProfile({
        userId: userId,
        basic_info: updates.basic_info,
        preferences: updates.preferences,
        physiological: updates.physiological,
        psychological: updates.psychological,
        training_strategy: updates.training_strategy,
        fitness_level: updates.fitness_level,
        red_flags: updates.red_flags,
        modifiedBy: 'admin',
        changeReason: 'Admin console update',
      });
      console.log('[AdminAPI] UserProfileService.updateProfile completed!');

      // Broadcast update to user if online
      await wsService.broadcastToUser(userId, 'profile_updated', {
        type: 'static',
        updates: updates,
      });

      return reply.send({ success: true, message: 'Profile static updated' });
    }

    // Legacy: Build the update object from flat fields
    console.log('[AdminAPI] Using flat format for profile update');
    const basicInfoUpdates: any = {};
    const psychologicalUpdates: any = {};

    if (updates.age !== undefined) basicInfoUpdates.age = updates.age;
    if (updates.weight !== undefined) basicInfoUpdates.weight = updates.weight;
    if (updates.height !== undefined) basicInfoUpdates.height = updates.height;
    if (updates.body_fat_percentage !== undefined) basicInfoUpdates.body_fat = updates.body_fat_percentage;
    if (updates.neuro_type !== undefined) psychologicalUpdates.neurotype = updates.neuro_type;
    if (updates.risk_preference !== undefined) psychologicalUpdates.risk_preference = updates.risk_preference;
    if (updates.accountability !== undefined) psychologicalUpdates.accountability = updates.accountability;

    await UserProfileService.updateProfile({
      userId: userId,
      basic_info: Object.keys(basicInfoUpdates).length > 0 ? basicInfoUpdates : undefined,
      psychological: Object.keys(psychologicalUpdates).length > 0 ? psychologicalUpdates : undefined,
      modifiedBy: 'admin',
      changeReason: 'Admin console update',
    });

    // Broadcast update to user if online
    await wsService.broadcastToUser(userId, 'profile_updated', {
      type: 'static',
      updates: { ...basicInfoUpdates, ...psychologicalUpdates },
    });

    return reply.send({ success: true, message: 'Profile static updated' });
  } catch (e: any) {
    console.error('[AdminAPI] Update profile static error:', e);
    return reply.status(500).send({ success: false, error: e.message });
  }
};

/**
 * POST /api/admin/users/:userId/profile/dynamic
 * Update user's dynamic profile (load anchors, active limitations)
 */
export const updateUserProfileDynamic = async (req: FastifyRequest, reply: FastifyReply) => {
  const { userId } = req.params as { userId: string };
  const { load_anchors, active_limitations, recovery_state } = req.body as any;

  if (!userId) {
    return reply.status(400).send({ success: false, error: 'Missing userId' });
  }

  try {
    console.log('[AdminAPI] Updating profile dynamic for user:', userId);

    const { UserProfileService } = await import('../services/userProfileService.js');

    // Update load anchors if provided
    if (load_anchors) {
      await UserProfileService.updateProfile({
        userId,
        load_anchors,
        modifiedBy: 'admin',
        changeReason: 'Admin console update',
      });

      // Broadcast to user
      await wsService.broadcastToUser(userId, 'load_anchors_updated', { load_anchors });
    }

    // Note: active_limitations and recovery_state are stored separately in v2 architecture
    // They would need separate storage mechanism - for now we store in a special field
    if (active_limitations || recovery_state) {
      // Store dynamic state in a metadata field or separate table
      // This is a placeholder for the actual implementation
      console.log('[AdminAPI] Dynamic limitations/recovery not fully implemented in v1 schema');
    }

    return reply.send({ success: true, message: 'Profile dynamic updated' });
  } catch (e: any) {
    console.error('[AdminAPI] Update profile dynamic error:', e);
    return reply.status(500).send({ success: false, error: e.message });
  }
};

/**
 * POST /api/admin/users/:userId/anchors/:exerciseId
 * Update a single load anchor for a specific exercise
 */
export const updateUserLoadAnchor = async (req: FastifyRequest, reply: FastifyReply) => {
  const { userId, exerciseId } = req.params as { userId: string; exerciseId: string };
  const anchorData = req.body as any;

  if (!userId || !exerciseId) {
    return reply.status(400).send({ success: false, error: 'Missing userId or exerciseId' });
  }

  try {
    console.log('[AdminAPI] Updating load anchor for user:', userId, 'exercise:', exerciseId);

    const { UserProfileService } = await import('../services/userProfileService.js');

    // Get current profile to merge anchors
    const currentProfile = await UserProfileService.getProfile(userId);
    const currentAnchors = (currentProfile?.load_anchors || {}) as Record<string, any>;

    // Update the specific anchor
    const updatedAnchors: Record<string, any> = {
      ...currentAnchors,
      [exerciseId]: {
        ...anchorData,
        last_updated: anchorData.last_updated || getNowISO(),
      },
    };

    await UserProfileService.updateProfile({
      userId,
      load_anchors: updatedAnchors,
      modifiedBy: 'admin',
      changeReason: `Admin update anchor for ${exerciseId}`,
    });

    // Broadcast to user
    await wsService.broadcastToUser(userId, 'load_anchor_updated', {
      exerciseId,
      anchor: updatedAnchors[exerciseId],
    });

    return reply.send({
      success: true,
      message: `Load anchor updated for ${exerciseId}`,
      data: { exerciseId, anchor: updatedAnchors[exerciseId] },
    });
  } catch (e: any) {
    console.error('[AdminAPI] Update load anchor error:', e);
    return reply.status(500).send({ success: false, error: e.message });
  }
};

/**
 * POST /api/admin/users/:userId/limitations
 * Add a new active limitation for a user
 */
export const addUserLimitation = async (req: FastifyRequest, reply: FastifyReply) => {
  const { userId } = req.params as { userId: string };
  const { part, severity, note, auto_heal } = req.body as any;

  if (!userId || !part || severity === undefined) {
    return reply.status(400).send({ success: false, error: 'Missing userId, part, or severity' });
  }

  if (severity < 1 || severity > 10) {
    return reply.status(400).send({ success: false, error: 'Severity must be between 1 and 10' });
  }

  try {
    console.log('[AdminAPI] Adding limitation for user:', userId, 'part:', part);

    // Import utility functions from shared/contracts
    const { createActiveLimitation } = await import('../../../shared/contracts/index.js');

    const newLimitation = createActiveLimitation(part, severity, note);
    if (auto_heal !== undefined) {
      newLimitation.auto_heal = auto_heal;
    }

    // For v1 schema, we store limitations in a special field
    // This would be better implemented in the v2 schema with proper active_limitations storage
    const { ConfigRepo } = await import('../services/knowledgeRepo.js');
    await ConfigRepo.setConfig(userId, `limitation_${part}_${Date.now()}`, JSON.stringify(newLimitation));

    // Broadcast to user
    await wsService.broadcastToUser(userId, 'limitation_added', { limitation: newLimitation });

    return reply.send({
      success: true,
      message: 'Limitation added',
      data: { limitation: newLimitation },
    });
  } catch (e: any) {
    console.error('[AdminAPI] Add limitation error:', e);
    return reply.status(500).send({ success: false, error: e.message });
  }
};

/**
 * DELETE /api/admin/users/:userId/limitations/:part
 * Remove an active limitation for a user
 */
export const removeUserLimitation = async (req: FastifyRequest, reply: FastifyReply) => {
  const { userId, part } = req.params as { userId: string; part: string };

  if (!userId || !part) {
    return reply.status(400).send({ success: false, error: 'Missing userId or part' });
  }

  try {
    console.log('[AdminAPI] Removing limitation for user:', userId, 'part:', part);

    // In v1 schema, limitations are stored as individual config entries
    // We need to find and delete the matching entry
    const { ConfigRepo } = await import('../services/knowledgeRepo.js');
    const allConfigs = await ConfigRepo.getAllConfigs(userId);

    for (const key of Object.keys(allConfigs)) {
      if (key.startsWith('limitation_')) {
        try {
          const config = allConfigs[key];
          const limitation = typeof config === 'string' ? JSON.parse(config) : config;
          if (limitation.part === part) {
            await ConfigRepo.setConfig(userId, key, null); // Delete by setting to null
          }
        } catch (e) {
          // Skip invalid entries
        }
      }
    }

    // Broadcast to user
    await wsService.broadcastToUser(userId, 'limitation_removed', { part });

    return reply.send({
      success: true,
      message: 'Limitation removed',
    });
  } catch (e: any) {
    console.error('[AdminAPI] Remove limitation error:', e);
    return reply.status(500).send({ success: false, error: e.message });
  }
};

/**
 * PUT /api/admin/users/:userId/display-name
 * Update user display name
 */
export const updateUserDisplayName = async (req: FastifyRequest, reply: FastifyReply) => {
  const { userId } = req.params as { userId: string };
  const { displayName } = req.body as { displayName: string };

  if (!displayName || displayName.trim().length === 0) {
    return reply.status(400).send({ success: false, error: 'Display name is required' });
  }

  if (displayName.length > 50) {
    return reply.status(400).send({ success: false, error: 'Display name must be 50 characters or less' });
  }

  try {
    console.log('[AdminAPI] Updating display name for user:', userId, 'to:', displayName);

    const { getPostgresClient } = await import('../db/postgresql/client/postgres-client.js');
    const client = getPostgresClient();

    await client.query(`
      UPDATE users
      SET display_name = $displayName, updated_at = $updatedAt
      WHERE id = $userId
      RETURNING id, display_name
    `, {
      userId,
      displayName: displayName.trim(),
      updatedAt: new Date().toISOString()
    });

    // Broadcast to user
    await wsService.broadcastToUser(userId, 'display_name_updated', { displayName });

    return reply.send({
      success: true,
      message: 'Display name updated',
      data: { displayName: displayName.trim() }
    });
  } catch (e: any) {
    console.error('[AdminAPI] Update display name error:', e);
    return reply.status(500).send({ success: false, error: e.message });
  }
};

// ============================================================================
// Embedding Configuration API — REMOVED (vector search for exercises dropped;
// the agent now loads the whole library via the list_exercises MCP tool).
// ============================================================================

