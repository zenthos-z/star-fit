/**
 * MediaRepo - PostgreSQL Migration
 *
 * Migrated from SQLite (getDb()) to PostgreSQL client
 *
 * Changes:
 * - Replaced getDb() with getPostgresClient()
 * - Converted all SQL queries from SQLite to PostgreSQL syntax
 * - Used named parameters ($paramName) for query parameters
 * - Changed INSERT OR REPLACE to INSERT ... ON CONFLICT DO UPDATE
 * - Used TIMESTAMPTZ for timestamps
 *
 * @version 3.0.0 - PostgreSQL Migration
 */

import { getPostgresClient, type PostgresClient } from '../db/postgresql/client/postgres-client.js';
import { getNowISO } from '../utils/timestamp.js';

export interface MediaRow {
  id: string;
  user_id: string;
  hash: string;
  mime: string;
  size: number;
  created_at: string; // ISO 8601 UTC timestamp
}

export const MediaRepo = {
  /**
   * Get PostgreSQL client instance
   */
  getClient(): PostgresClient {
    return getPostgresClient();
  },

  recordOwnership: async (userId: string, mediaId: string, hash: string, mime: string, size: number): Promise<void> => {
    const client = MediaRepo.getClient();
    await client.query(
      `INSERT INTO user_media (id, user_id, hash, mime, size, created_at)
       VALUES ($id, $userId, $hash, $mime, $size, $createdAt)
       ON CONFLICT (id) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         hash = EXCLUDED.hash,
         mime = EXCLUDED.mime,
         size = EXCLUDED.size`,
      {
        id: mediaId,
        userId,
        hash,
        mime,
        size,
        createdAt: getNowISO()
      }
    );
  },

  getUserMedia: async (userId: string): Promise<MediaRow[]> => {
    const client = MediaRepo.getClient();
    return client.queryMany<MediaRow>(
      'SELECT id, user_id, hash, mime, size, created_at FROM user_media WHERE user_id = $userId ORDER BY created_at DESC',
      { userId }
    );
  },

  deleteMedia: async (id: string): Promise<void> => {
    const client = MediaRepo.getClient();
    await client.query('DELETE FROM user_media WHERE id = $id', { id });
  }
};
