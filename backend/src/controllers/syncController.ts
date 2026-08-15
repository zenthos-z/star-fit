import { FastifyRequest, FastifyReply } from 'fastify';
import { SessionRepo } from '../services/sessionRepo.js';
import { KnowledgeRepo, ConfigRepo } from '../services/knowledgeRepo.js';
import { getUserId } from '../utils/requestUtils.js';
import { wsService } from '../services/wsService.js';
import { getNowISO } from '../utils/timestamp.js';
import fs from 'fs';
import path from 'path';

const LOG_FILE = path.join(process.cwd(), 'sync_debug.log');

function logToFile(msg: string) {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(LOG_FILE, `[${timestamp}] ${msg}\n`);
}

// Sync Controller
export const pushHistory = async (req: FastifyRequest, reply: FastifyReply) => {
  const { deviceId, sessions, deletedSessionIds } = req.body as { 
    deviceId: string, 
    sessions: any[],
    deletedSessionIds?: string[] 
  };
  const userId = getUserId(req);
  
  logToFile(`PUSH REQUEST: deviceId=${deviceId}, userId=${userId}, sessions=${sessions?.length}, deleted=${deletedSessionIds?.length || 0}`);

  if (!deviceId || (!Array.isArray(sessions) && !Array.isArray(deletedSessionIds))) {
    logToFile(`PUSH ERROR: Invalid payload - deviceId=${deviceId}`);
    return reply.status(400).send({ error: 'Invalid payload' });
  }

  try {
    let upsertResult = { success: true, count: 0 };
    // 即使 sessions 为空，也调用 upsertSessions 确保用户被创建
    if (Array.isArray(sessions)) {
      upsertResult = await SessionRepo.upsertSessions(deviceId, sessions, userId);
    }

    let deleteCount = 0;
    if (Array.isArray(deletedSessionIds) && deletedSessionIds.length > 0) {
      for (const sessionId of deletedSessionIds) {
        const info = await SessionRepo.deleteSession(sessionId);
        deleteCount += info.changes;
      }
    }

    logToFile(`PUSH SUCCESS: upserted=${upsertResult.count}, deleted=${deleteCount}`);
    
    // Notify other devices of the same user that data has changed
    await wsService.broadcastToUser(userId, 'sync_needed', { 
      reason: 'push_completed',
      sourceDeviceId: deviceId 
    }, deviceId); // Pass deviceId to exclude source device

    return reply.send({ 
      ...upsertResult, 
      deletedCount: deleteCount 
    });
  } catch (e: any) {
    logToFile(`PUSH FATAL ERROR: ${e.message}`);
    req.log.error(e);
    return reply.status(500).send({ error: e.message });
  }
};

export const pullSync = async (req: FastifyRequest, reply: FastifyReply) => {
  const { deviceId, since = 0 } = req.query as { deviceId: string, since?: string };
  const sinceTs = parseInt(since as string) || 0;
  const headerUserId = getUserId(req);

  try {
    // 1. Sessions & User Lookup
    // In PULL mode, we don't auto-create users to prevent DB bloat from anonymous pings
    const user = await SessionRepo.ensureUser(deviceId, headerUserId, false);
    
    if (!user) {
        // For non-existent users, we still return global exercises but no user-specific data
        const exercises = await KnowledgeRepo.getExercisesAfter(sinceTs);
        return reply.send({
            timestamp: getNowISO(),
            updates: {
                sessions: [],
                exercises,
                guidance: [],
                appConfigs: null,
                promptStyles: null,
                activeSessionIds: []
            }
        });
    }

    const userId = user.id;
    
    const sessions = await SessionRepo.getSessionsAfter(sinceTs, deviceId, userId);

    // 2. Knowledge
    const exercises = await KnowledgeRepo.getExercisesAfter(sinceTs);
    const guidance = await KnowledgeRepo.getGuidanceAfter(userId, sinceTs);

    // 3. Configs
    const { app, styles } = await ConfigRepo.getConfigsAfter(userId, sinceTs);

    // 4. Active Session IDs (for reconciliation)
    const activeSessionIds = await SessionRepo.getActiveSessionIds(userId);

    return reply.send({
      timestamp: getNowISO(),
      updates: {
        sessions,
        exercises,
        guidance,
        appConfigs: app,
        promptStyles: styles,
        activeSessionIds // High priority server state
      }
    });
  } catch (e: any) {
    req.log.error(e);
    return reply.status(500).send({ error: e.message });
  }
};

export const getConfig = async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = getUserId(req);
    try {
        const configs = await ConfigRepo.getAllConfigs(userId);
        return reply.send(configs);
    } catch (e: any) {
        return reply.status(500).send({ error: e.message });
    }
}
