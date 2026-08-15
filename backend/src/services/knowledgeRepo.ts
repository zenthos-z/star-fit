/**
 * KnowledgeRepo - PostgreSQL Migration
 *
 * Migrated from SQLite (getDb()) to PostgreSQL client
 *
 * Contains three repositories:
 * - KnowledgeRepo: Exercise library and guidance documents
 * - ConfigRepo: User configurations and style parameters
 * - CacheRepo: History summaries and RPE stats cache
 *
 * Changes:
 * - Replaced getDb() with getPostgresClient()
 * - Used named parameters ($paramName) for query parameters
 * - Changed INSERT OR REPLACE to INSERT ... ON CONFLICT DO UPDATE
 * - Used TIMESTAMPTZ for timestamps
 * - Used JSONB for JSON columns
 *
 * @version 3.0.0 - PostgreSQL Migration
 */

import { getPostgresClient, type PostgresClient } from '../db/postgresql/client/postgres-client.js';
import { CacheService } from './cacheService.js';
import { getNowISO } from '../utils/timestamp.js';

// ============================================
// Types
// ============================================

export interface ExerciseRow {
  id: string;
  name: string;
  exercise_type: string;
  targets: string;
  content_html: string | null;
  assets_json: any;
  tags_json: any;
  updated_at: string; // ISO 8601 UTC timestamp
}

export interface GuidanceRow {
  user_id: string;
  key: string;
  version: number;
  content_md: string | null;
  meta_json: any;
  updated_at: string; // ISO 8601 UTC timestamp
}

export interface AppConfigRow {
  user_id: string;
  key: string;
  value_json: any;
  updated_at: string; // ISO 8601 UTC timestamp
}

export interface PromptStyleConfigRow {
  user_id: string;
  style_key: string;
  parameters_json: any;
  is_active: boolean;
  updated_at: string; // ISO 8601 UTC timestamp
}

// ============================================
// KnowledgeRepo - PostgreSQL Implementation
// ============================================

export const KnowledgeRepo = {
  /**
   * Get PostgreSQL client instance
   */
  getClient(): PostgresClient {
    return getPostgresClient();
  },

  // Exercises
  upsertExercise: async (ex: {
    id: string;
    name: string;
    exercise_type: string;
    targets: string;
    content_html: string;
    assets_json: string;
    tags_json?: string;
  }): Promise<void> => {
    const client = KnowledgeRepo.getClient();
    await client.query(
      `INSERT INTO exercises (id, name, exercise_type, attributes, content_html, tutorials, tags_json, assets_json, updated_at)
       VALUES ($id, $name, $exerciseType, $attributes, $contentHtml, $tutorials, $tagsJson, $assetsJson, $updatedAt)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         exercise_type = EXCLUDED.exercise_type,
         attributes = EXCLUDED.attributes,
         content_html = EXCLUDED.content_html,
         tutorials = EXCLUDED.tutorials,
         tags_json = EXCLUDED.tags_json,
         assets_json = EXCLUDED.assets_json,
         updated_at = EXCLUDED.updated_at`,
      {
        id: ex.id,
        name: ex.name,
        exerciseType: ex.exercise_type,
        // Map targets string to attributes JSONB structure
        attributes: JSON.stringify({ targets: ex.targets ? JSON.parse(ex.targets) : {} }),
        contentHtml: ex.content_html || null,
        // Map assets_json string to tutorials JSONB structure
        tutorials: ex.assets_json || '{}',
        tagsJson: ex.tags_json || null,
        assetsJson: ex.assets_json || null,
        updatedAt: getNowISO()
      }
    );

    // Invalidate exercise list cache
    await CacheService.del(CacheService.keys.exerciseList());
  },

  deleteExercise: async (id: string): Promise<void> => {
    const client = KnowledgeRepo.getClient();
    await client.query('DELETE FROM exercises WHERE id = $id', { id });
    await CacheService.del(CacheService.keys.exerciseList());
  },

  getExercisesAfter: async (since: number): Promise<any[]> => {
    const client = KnowledgeRepo.getClient();
    const sinceDate = new Date(since);
    const rows = await client.queryMany(
      'SELECT * FROM exercises WHERE updated_at > $since ORDER BY updated_at DESC',
      { since: sinceDate }
    );
    return rows;
  },

  getAllExercises: async (): Promise<any[]> => {
    const cacheKey = CacheService.keys.exerciseList();
    const cached = await CacheService.get(cacheKey);
    if (cached) return cached as any[];

    const client = KnowledgeRepo.getClient();
    const rows = await client.queryMany('SELECT * FROM exercises ORDER BY name');
    await CacheService.set(cacheKey, rows, 3600); // Cache for 1 hour
    return rows;
  },

  // Guidance
  upsertGuidance: async (userId: string, doc: {
    key: string;
    version: number;
    content_md: string;
    meta_json: string;
  }): Promise<void> => {
    const client = KnowledgeRepo.getClient();
    await client.query(
      `INSERT INTO guidance (user_id, key, version, content_md, meta_json, updated_at)
       VALUES ($userId, $key, $version, $contentMd, $metaJson, $updatedAt)
       ON CONFLICT (user_id, key) DO UPDATE SET
         version = EXCLUDED.version,
         content_md = EXCLUDED.content_md,
         meta_json = EXCLUDED.meta_json,
         updated_at = EXCLUDED.updated_at`,
      {
        userId,
        key: doc.key,
        version: doc.version,
        contentMd: doc.content_md || null,
        metaJson: doc.meta_json || null,
        updatedAt: getNowISO()
      }
    );

    await CacheService.del(CacheService.keys.guidance(userId));
  },

  getGuidanceAfter: async (userId: string, since: number): Promise<any[]> => {
    const client = KnowledgeRepo.getClient();
    const sinceDate = new Date(since);
    const rows = await client.queryMany(
      'SELECT * FROM guidance WHERE user_id = $userId AND updated_at > $since ORDER BY updated_at DESC',
      { userId, since: sinceDate }
    );
    return rows;
  },

  getAllGuidance: async (userId: string): Promise<any[]> => {
    const cacheKey = CacheService.keys.guidance(userId);
    const cached = await CacheService.get(cacheKey);
    if (cached) return cached as any[];

    const client = KnowledgeRepo.getClient();
    const rows = await client.queryMany(
      'SELECT * FROM guidance WHERE user_id = $userId ORDER BY key',
      { userId }
    );
    await CacheService.set(cacheKey, rows, 1800); // 30 mins
    return rows;
  }
};

// ============================================
// ConfigRepo - PostgreSQL Implementation
// ============================================

export const ConfigRepo = {
  /**
   * Get PostgreSQL client instance
   */
  getClient(): PostgresClient {
    return getPostgresClient();
  },

  setConfig: async (userId: string, key: string, value: any): Promise<void> => {
    const client = ConfigRepo.getClient();
    await client.query(
      `INSERT INTO app_configs (user_id, key, value_json, updated_at)
       VALUES ($userId, $key, $valueJson, $updatedAt)
       ON CONFLICT (user_id, key) DO UPDATE SET
         value_json = EXCLUDED.value_json,
         updated_at = EXCLUDED.updated_at`,
      {
        userId,
        key,
        valueJson: JSON.stringify(value),
        updatedAt: getNowISO()
      }
    );

    await CacheService.del(CacheService.keys.configs(userId));
  },

  getConfig: async (userId: string, key: string): Promise<any> => {
    const configs = await ConfigRepo.getAllConfigs(userId) as Record<string, any>;
    return configs[key] || null;
  },

  getAllConfigs: async (userId: string): Promise<Record<string, any>> => {
    const cacheKey = CacheService.keys.configs(userId);
    const cached = await CacheService.get(cacheKey);
    if (cached) return cached as Record<string, any>;

    const client = ConfigRepo.getClient();
    const rows = await client.queryMany<{ key: string; value_json: any }>(
      'SELECT key, value_json FROM app_configs WHERE user_id = $userId',
      { userId }
    );

    const out: Record<string, any> = {};
    rows.forEach(r => {
      // pg library automatically parses JSONB values:
      // - JSON objects → JS objects
      // - JSON strings → JS strings (already unquoted)
      // - JSON arrays → JS arrays
      // So we should NOT call JSON.parse() again on strings
      out[r.key] = r.value_json;
    });

    await CacheService.set(cacheKey, out, 1800);
    return out;
  },

  setStyleParam: async (userId: string, styleKey: string, params: any): Promise<void> => {
    const client = ConfigRepo.getClient();
    await client.query(
      `INSERT INTO prompt_style_configs (user_id, style_key, parameters_json, updated_at)
       VALUES ($userId, $styleKey, $parametersJson, $updatedAt)
       ON CONFLICT (user_id, style_key) DO UPDATE SET
         parameters_json = EXCLUDED.parameters_json,
         updated_at = EXCLUDED.updated_at`,
      {
        userId,
        styleKey,
        parametersJson: JSON.stringify(params),
        updatedAt: getNowISO()
      }
    );

    await CacheService.del(CacheService.keys.styleParams(userId, styleKey));
  },

  getStyleParams: async (userId: string, styleKey: string): Promise<any> => {
    const cacheKey = CacheService.keys.styleParams(userId, styleKey);
    const cached = await CacheService.get(cacheKey);
    if (cached) return cached;

    const client = ConfigRepo.getClient();
    const row = await client.queryOne<{ parameters_json: any }>(
      'SELECT parameters_json FROM prompt_style_configs WHERE user_id = $userId AND style_key = $styleKey',
      { userId, styleKey }
    );

    const out = row ? row.parameters_json : {};

    await CacheService.set(cacheKey, out, 1800);
    return out;
  },

  getConfigsAfter: async (userId: string, since: number): Promise<{ app: any[]; styles: any[] }> => {
    const client = ConfigRepo.getClient();
    const sinceDate = new Date(since);

    const app = await client.queryMany<{ key: string; value_json: any }>(
      'SELECT key, value_json FROM app_configs WHERE user_id = $userId AND updated_at > $since',
      { userId, since: sinceDate }
    );

    const styles = await client.queryMany<{ style_key: string; parameters_json: any }>(
      'SELECT style_key, parameters_json FROM prompt_style_configs WHERE user_id = $userId AND updated_at > $since',
      { userId, since: sinceDate }
    );

    return { app, styles };
  }
};

// ============================================
// CacheRepo - PostgreSQL Implementation
// ============================================

export const CacheRepo = {
  /**
   * Get PostgreSQL client instance
   */
  getClient(): PostgresClient {
    return getPostgresClient();
  },

  getHistorySummary: async (deviceId: string, lastSessionId: string): Promise<string | null> => {
    const client = CacheRepo.getClient();

    const user = await client.queryOne<{ id: string }>(
      'SELECT id FROM users WHERE device_id = $deviceId',
      { deviceId }
    );

    if (!user) return null;

    const cacheKey = CacheService.keys.historySummary(user.id, lastSessionId);
    const cached = await CacheService.get(cacheKey);
    if (cached) return cached as string;

    const row = await client.queryOne<{ summary_text: string }>(
      'SELECT summary_text FROM cache_history_summaries WHERE user_id = $userId AND last_session_id = $lastSessionId',
      { userId: user.id, lastSessionId }
    );

    if (row) {
      await CacheService.set(cacheKey, row.summary_text, 86400); // 24h
      return row.summary_text;
    }
    return null;
  },

  setHistorySummary: async (deviceId: string, lastSessionId: string, summary: string): Promise<void> => {
    const client = CacheRepo.getClient();

    const user = await client.queryOne<{ id: string }>(
      'SELECT id FROM users WHERE device_id = $deviceId',
      { deviceId }
    );

    if (!user) return;

    await client.query(
      `INSERT INTO cache_history_summaries (user_id, last_session_id, summary_text, updated_at)
       VALUES ($userId, $lastSessionId, $summary, $updatedAt)
       ON CONFLICT (user_id) DO UPDATE SET
         last_session_id = EXCLUDED.last_session_id,
         summary_text = EXCLUDED.summary_text,
         updated_at = EXCLUDED.updated_at`,
      {
        userId: user.id,
        lastSessionId,
        summary,
        updatedAt: getNowISO()
      }
    );

    await CacheService.set(CacheService.keys.historySummary(user.id, lastSessionId), summary, 86400);
  },

  getRpeStats: async (deviceId: string, exerciseName: string): Promise<any> => {
    const client = CacheRepo.getClient();

    const user = await client.queryOne<{ id: string }>(
      'SELECT id FROM users WHERE device_id = $deviceId',
      { deviceId }
    );

    if (!user) return null;

    const cacheKey = CacheService.keys.rpeStats(user.id, exerciseName);
    const cached = await CacheService.get(cacheKey);
    if (cached) return cached;

    const row = await client.queryOne<{ stats_json: any }>(
      'SELECT stats_json FROM cache_rpe_stats WHERE user_id = $userId AND exercise_name = $exerciseName',
      { userId: user.id, exerciseName }
    );

    if (row) {
      // pg library already parses JSONB values
      await CacheService.set(cacheKey, row.stats_json, 3600);
      return row.stats_json;
    }
    return null;
  },

  setRpeStats: async (deviceId: string, exerciseName: string, stats: any): Promise<void> => {
    const client = CacheRepo.getClient();

    const user = await client.queryOne<{ id: string }>(
      'SELECT id FROM users WHERE device_id = $deviceId',
      { deviceId }
    );

    if (!user) return;

    await client.query(
      `INSERT INTO cache_rpe_stats (user_id, exercise_name, stats_json, updated_at)
       VALUES ($userId, $exerciseName, $statsJson, $updatedAt)
       ON CONFLICT (user_id, exercise_name) DO UPDATE SET
         stats_json = EXCLUDED.stats_json,
         updated_at = EXCLUDED.updated_at`,
      {
        userId: user.id,
        exerciseName,
        statsJson: JSON.stringify(stats),
        updatedAt: getNowISO()
      }
    );

    await CacheService.set(CacheService.keys.rpeStats(user.id, exerciseName), stats, 3600);
  }
};
