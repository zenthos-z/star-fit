/**
 * SessionRepo - PostgreSQL Migration
 *
 * Migrated from SQLite (getDb()) to PostgreSQL client
 *
 * Changes:
 * - Replaced getDb() with getPostgresClient()
 * - Converted all SQL queries from SQLite to PostgreSQL syntax
 * - Used named parameters ($paramName) for query parameters
 * - Changed INSERT OR REPLACE to INSERT ... ON CONFLICT DO UPDATE
 * - Used TIMESTAMPTZ for timestamps
 * - Used UUID type for IDs
 * - Maintained transaction support with postgresClient.transaction()
 *
 * @version 3.0.0 - PostgreSQL Migration
 */

import { getPostgresClient, type PostgresClient, type TransactionClient } from '../db/postgresql/client/postgres-client.js';
import { randomUUID } from 'crypto';
import { CacheService } from './cacheService.js';
import { getNowISO } from '../utils/timestamp.js';

// UUID validation regex - PostgreSQL accepts UUID format only
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Check if a string is a valid UUID format
 * Used to filter out SQLite legacy values like 'global', 'system', 'admin'
 */
const isValidUUID = (value: string | undefined): boolean => {
  if (!value) return false;
  return UUID_REGEX.test(value);
};

export interface Session {
  id: string;
  startTime: number;
  endTime?: number;
  exercises: any[]; // Complex JSON
  [key: string]: any;
}

export interface UserRow {
  id: string;
  device_id: string | null;
  created_at: string; // ISO 8601 UTC timestamp
}

export interface SessionRow {
  id: string;
  user_id: string;
  start_time: string; // ISO 8601 UTC timestamp
  end_time: string | null; // ISO 8601 UTC timestamp
  duration: number | null;
  title: string | null;
  raw_json: any;
  ai_audit_text: string | null;
  updated_at: string; // ISO 8601 UTC timestamp
}

// ============================================
// SessionRepo - PostgreSQL Implementation
// ============================================

export const SessionRepo = {
  /**
   * Get PostgreSQL client instance
   */
  getClient(): PostgresClient {
    return getPostgresClient();
  },

  // Get or create user by device ID or manual User ID
  ensureUser: async (deviceId: string, manualUserId?: string, autoCreate = true): Promise<UserRow | null> => {
    const client = SessionRepo.getClient();

    // PostgreSQL: Filter out non-UUID values (SQLite legacy like 'global', 'system', 'admin')
    // These are not valid UUIDs and will cause PostgreSQL errors
    if (manualUserId && !isValidUUID(manualUserId)) {
      console.log(`[SessionRepo] ensureUser: manualUserId="${manualUserId}" is not a valid UUID, treating as undefined`);
      // Clear the invalid manualUserId so we fall back to device-based lookup
      manualUserId = undefined;
    }

    console.log(`[SessionRepo] ensureUser: deviceId=${deviceId}, manualUserId=${manualUserId ?? 'undefined'}, autoCreate=${autoCreate}`);

    // Early return if both deviceId and manualUserId are empty
    if (!deviceId && !manualUserId) {
      console.log(`[SessionRepo] ensureUser: No deviceId or manualUserId provided, returning null`);
      return null;
    }

    // Helper to unbind device from any other user
    const unbindDevice = async (id: string) => {
      if (!id) return;
      await client.query(
        'UPDATE users SET device_id = NULL WHERE device_id = $deviceId',
        { deviceId: id }
      );
    };

    // 1. If manual ID provided, use it as primary
    if (manualUserId) {
      const user = await client.queryOne<UserRow>(
        'SELECT id, device_id, created_at FROM users WHERE id = $manualUserId',
        { manualUserId }
      );

      if (user) {
        // Update device_id if it's different (mapping device to last used user ID)
        if (deviceId && user.device_id !== deviceId) {
          await unbindDevice(deviceId); // Ensure device is not taken
          await client.query(
            'UPDATE users SET device_id = $deviceId WHERE id = $manualUserId',
            { deviceId, manualUserId }
          );
        }
        return user;
      }

      if (!autoCreate) return null;

      // New user with manual ID
      await unbindDevice(deviceId); // Ensure device is not taken
      console.log(`[SessionRepo] Creating NEW MANUAL user: id=${manualUserId}, device_id=${deviceId}`);
      await client.query(
        'INSERT INTO users (id, device_id, created_at) VALUES ($id, $deviceId, $createdAt)',
        { id: manualUserId, deviceId: deviceId || null, createdAt: getNowISO() }
      );
      await CacheService.del(CacheService.keys.userList());

      return {
        id: manualUserId,
        device_id: deviceId || null,
        created_at: getNowISO()
      };
    }

    // 2. Fallback to device-based lookup
    const user = await client.queryOne<UserRow>(
      'SELECT id, device_id, created_at FROM users WHERE device_id = $deviceId',
      { deviceId }
    );

    if (user) return user;

    if (!autoCreate) return null;

    // Create new anonymous user
    const newId = randomUUID();
    console.log(`[SessionRepo] Creating NEW ANONYMOUS user: id=${newId}, device_id=${deviceId}`);
    await client.query(
      'INSERT INTO users (id, device_id, created_at) VALUES ($id, $deviceId, $createdAt)',
      { id: newId, deviceId, createdAt: getNowISO() }
    );
    await CacheService.del(CacheService.keys.userList());

    return {
      id: newId,
      device_id: deviceId,
      created_at: getNowISO()
    };
  },

  getUserId: async (deviceId: string, manualUserId?: string): Promise<string | undefined> => {
    // Validate manualUserId is a proper UUID
    if (manualUserId && isValidUUID(manualUserId)) {
      return manualUserId;
    }

    const cacheKey = `user_id:device:${deviceId}`;
    const cached = await CacheService.get<string>(cacheKey);
    if (cached && isValidUUID(cached)) {
      return cached;
    }

    const client = SessionRepo.getClient();
    const user = await client.queryOne<{ id: string }>(
      'SELECT id FROM users WHERE device_id = $deviceId',
      { deviceId }
    );

    // Return undefined if no user found (instead of 'global' which is not a valid UUID)
    const userId = user ? user.id : undefined;

    if (userId) {
      await CacheService.set(cacheKey, userId, 3600); // Cache for 1 hour
    }
    return userId;
  },

  // Batch upsert sessions (Push)
  upsertSessions: async (deviceId: string, sessions: Session[], manualUserId?: string): Promise<{ success: boolean; count: number }> => {
    const client = SessionRepo.getClient();
    const user = await SessionRepo.ensureUser(deviceId, manualUserId);

    if (!user) {
      throw new Error('Failed to ensure user for session upsert');
    }

    // Use transaction for atomic operations
    await client.transaction(async (tx) => {
      for (const s of sessions) {
        // 1. Insert or Update Session
        const duration = s.endTime ? Math.floor((s.endTime - s.startTime) / 1000) : 0;
        const title = s.exercises?.map((e: any) => e.name).slice(0, 2).join('/') || 'Workout';
        const startTime = new Date(s.startTime);
        const endTime = s.endTime ? new Date(s.endTime) : null;

        await tx.query(
          `INSERT INTO sessions (id, user_id, start_time, end_time, duration, title, raw_json, updated_at)
           VALUES ($id, $userId, $startTime, $endTime, $duration, $title, $rawJson, $updatedAt)
           ON CONFLICT (id) DO UPDATE SET
             user_id = EXCLUDED.user_id,
             start_time = EXCLUDED.start_time,
             end_time = EXCLUDED.end_time,
             duration = EXCLUDED.duration,
             title = EXCLUDED.title,
             raw_json = EXCLUDED.raw_json,
             updated_at = EXCLUDED.updated_at`,
          {
            id: s.id,
            userId: user.id,
            startTime,
            endTime,
            duration,
            title,
            rawJson: JSON.stringify(s),
            updatedAt: getNowISO()
          }
        );

        // 2. Delete old RPE logs for this session
        await tx.query(
          'DELETE FROM rpe_logs WHERE session_id = $sessionId',
          { sessionId: s.id }
        );

        // 3. Extract & Insert RPE Logs (Re-build analytics data)
        if (Array.isArray(s.exercises)) {
          for (const ex of s.exercises) {
            if (Array.isArray(ex.sets)) {
              for (const set of ex.sets) {
                if (set.completed && typeof set.rpe === 'number') {
                  await tx.query(
                    `INSERT INTO rpe_logs (user_id, session_id, exercise_name, rpe, weight, reps, timestamp)
                     VALUES ($userId, $sessionId, $exerciseName, $rpe, $weight, $reps, $timestamp)`,
                    {
                      userId: user.id,
                      sessionId: s.id,
                      exerciseName: ex.name,
                      rpe: set.rpe,
                      weight: set.weight || null,
                      reps: set.reps || null,
                      timestamp: startTime
                    }
                  );
                }
              }
            }
          }
        }
      }

      // Note: InsightAnalyzer.analyzeRecentSessionsSync is synchronous and designed for SQLite
      // In PostgreSQL version, this should be handled asynchronously or via a separate job
      // For now, we skip this step in the PostgreSQL version
      // InsightAnalyzer.analyzeRecentSessionsSync(user.id, sessions);
    }, {
      operation: 'upsertSessions',
      userId: user.id
    });

    // Invalidate caches
    await CacheService.del(`sessions:user:${user.id}`);
    await CacheService.del(`active_ids:user:${user.id}`);

    return { success: true, count: sessions.length };
  },

  // Get new sessions since timestamp (Pull)
  getSessionsAfter: async (since: number, deviceId?: string, userId?: string): Promise<any[]> => {
    const client = SessionRepo.getClient();
    let targetUserId = userId;

    if (!targetUserId && deviceId) {
      targetUserId = await SessionRepo.getUserId(deviceId);
    }

    // Return empty if no valid user found (getUserId now returns undefined instead of 'global')
    if (!targetUserId) return [];

    const sinceDate = new Date(since);
    const rows = await client.queryMany<{ raw_json: any }>(
      'SELECT raw_json FROM sessions WHERE user_id = $userId AND updated_at > $since',
      { userId: targetUserId, since: sinceDate }
    );

    return rows.map(r => {
      // Handle JSONB - PostgreSQL may return it as object or string
      if (typeof r.raw_json === 'string') {
        return JSON.parse(r.raw_json);
      }
      return r.raw_json;
    });
  },

  // Get RPE Stats (Analytics)
  getRpeStats: async (deviceId: string, exerciseName: string): Promise<{ median: number; count: number; last: number } | null> => {
    const userId = await SessionRepo.getUserId(deviceId);
    // getUserId now returns undefined instead of 'global' for unknown users
    if (!userId) return null;

    const cacheKey = `rpe_stats:${userId}:${exerciseName}`;
    const cached = await CacheService.get(cacheKey);
    if (cached) return cached as { median: number; count: number; last: number };

    const client = SessionRepo.getClient();
    const logs = await client.queryMany<{ rpe: number; timestamp: Date }>(
      `SELECT rpe, timestamp
       FROM rpe_logs
       WHERE user_id = $userId AND exercise_name = $exerciseName
       ORDER BY timestamp DESC LIMIT 20`,
      { userId, exerciseName }
    );

    if (logs.length === 0) return null;

    const rpes = logs.map(l => Number(l.rpe));
    rpes.sort((a, b) => a - b);
    const median = rpes[Math.floor(rpes.length / 2)];

    const result = { median, count: logs.length, last: Number(logs[0].rpe) };
    await CacheService.set(cacheKey, result, 600); // Cache for 10 mins
    return result;
  },

  // Get all user sessions for Admin (with pagination support)
  getAllUserSessions: async (userId: string, limit?: number, offset?: number): Promise<any[]> => {
    const client = SessionRepo.getClient();
    let query = 'SELECT id, start_time, duration, title, raw_json, ai_audit_text FROM sessions WHERE user_id = $userId ORDER BY start_time DESC';
    const params: Record<string, any> = { userId };

    if (limit !== undefined) {
      query += ' LIMIT $limit';
      params.limit = limit;
    }
    if (offset !== undefined) {
      query += ' OFFSET $offset';
      params.offset = offset;
    }

    const rows = await client.queryMany(query, params);
    return rows;
  },

  // Update AI audit text for a session
  updateSessionAudit: async (sessionId: string, auditText: string): Promise<void> => {
    const client = SessionRepo.getClient();

    // Find user_id first to invalidate cache
    const session = await client.queryOne<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE id = $sessionId',
      { sessionId }
    );

    if (session) {
      await client.query(
        'UPDATE sessions SET ai_audit_text = $auditText, updated_at = $updatedAt WHERE id = $sessionId',
        { auditText, updatedAt: getNowISO(), sessionId }
      );
      await CacheService.del(`sessions:user:${session.user_id}`);
    }
  },

  // Get only IDs of all sessions for a user (for sync reconciliation)
  getActiveSessionIds: async (userId: string): Promise<string[]> => {
    const cacheKey = `active_ids:user:${userId}`;
    const cached = await CacheService.get<string[]>(cacheKey);
    if (cached) return cached;

    const client = SessionRepo.getClient();
    const rows = await client.queryMany<{ id: string }>(
      'SELECT id FROM sessions WHERE user_id = $userId',
      { userId }
    );
    const ids = rows.map(r => r.id);

    await CacheService.set(cacheKey, ids, 600);
    return ids;
  },

  // Get all users for Admin
  getAllUsers: async (): Promise<any[]> => {
    const cacheKey = CacheService.keys.userList();
    const cached = await CacheService.get(cacheKey);
    if (cached) return cached as any[];

    const client = SessionRepo.getClient();
    const rows = await client.queryMany(
      `SELECT u.*, COUNT(s.id) as session_count
       FROM users u
       LEFT JOIN sessions s ON u.id = s.user_id
       GROUP BY u.id
       ORDER BY u.created_at DESC`
    );

    await CacheService.set(cacheKey, rows, 600);
    return rows;
  },

  // Delete a single session
  deleteSession: async (sessionId: string): Promise<{ changes: number }> => {
    const client = SessionRepo.getClient();

    // Find user_id first to invalidate cache
    const session = await client.queryOne<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE id = $sessionId',
      { sessionId }
    );

    const result = await client.query(
      'DELETE FROM sessions WHERE id = $sessionId',
      { sessionId }
    );

    if (session) {
      await CacheService.del(`sessions:user:${session.user_id}`);
      await CacheService.del(`active_ids:user:${session.user_id}`);
    }

    const changes = result.rowCount || 0;
    console.log(`[SessionRepo] Deleted session ${sessionId}, affected rows: ${changes}`);
    return { changes };
  },

  // Delete an entire user and all associated data
  deleteUser: async (userId: string): Promise<{ success: boolean }> => {
    const client = SessionRepo.getClient();

    const SYSTEM_USER_IDS = ['system', 'global', 'admin'];

    if (SYSTEM_USER_IDS.includes(userId)) {
      throw new Error(`Cannot delete system user: ${userId}`);
    }

    let changes = 0;

    // Use transaction for atomic deletion
    await client.transaction(async (tx) => {
      // 1. Delete deviation_logs (has FK to users)
      await tx.query('DELETE FROM deviation_logs WHERE user_id = $userId', { userId });

      // 2. Delete sessions (cascades to rpe_logs)
      const s = await tx.query('DELETE FROM sessions WHERE user_id = $userId', { userId });
      changes += s.rowCount || 0;

      // 3. Delete media records
      const m = await tx.query('DELETE FROM user_media WHERE user_id = $userId', { userId });
      changes += m.rowCount || 0;

      // 4. Delete configs
      await tx.query('DELETE FROM app_configs WHERE user_id = $userId', { userId });
      await tx.query('DELETE FROM prompt_style_configs WHERE user_id = $userId', { userId });

      // 5. Delete guidance
      await tx.query('DELETE FROM guidance WHERE user_id = $userId', { userId });

      // 6. Delete cache
      await tx.query('DELETE FROM cache_history_summaries WHERE user_id = $userId', { userId });
      await tx.query('DELETE FROM cache_rpe_stats WHERE user_id = $userId', { userId });

      // 7. Delete user_insights (if exists as separate table)
      // Note: In PostgreSQL schema, user_insights might be a view, skip if not a table

      // 8. Delete audit_logs
      await tx.query('DELETE FROM audit_logs WHERE user_id = $userId', { userId });

      // 9. Delete the user itself
      const u = await tx.query('DELETE FROM users WHERE id = $userId', { userId });
      changes += u.rowCount || 0;
    }, {
      operation: 'deleteUser',
      userId
    });

    console.log(`[SessionRepo] Deleted user ${userId} and all related data. Total major rows affected: ${changes}`);

    await CacheService.del(CacheService.keys.userList());
    await CacheService.del(`sessions:user:${userId}`);
    await CacheService.del(`active_ids:user:${userId}`);

    return { success: true };
  }
};
