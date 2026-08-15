/**
 * Admin Configuration Service
 *
 * Manages admin-specific configurations stored in app_configs table.
 * Used for features like pinned users, admin preferences, etc.
 *
 * @module AdminConfigService
 * @version 2.0.0 - PostgreSQL Migration
 */

import { getPostgresClient } from '../db/index.js';
import { CacheService } from './cacheService.js';
import { getNowISO } from '../utils/timestamp.js';

interface AdminConfig {
  user_id: string;
  key: string;
  value_json: string;
  updated_at: string; // ISO 8601 UTC timestamp
}

export const AdminConfigService = {
  /**
   * Get a specific admin config value
   */
  getConfig: async (key: string): Promise<AdminConfig | null> => {
    const client = await getPostgresClient();
    const result = await client.query(
      'SELECT * FROM app_configs WHERE user_id = $userId AND key = $key',
      { userId: 'admin', key }
    );
    return result.rows[0] || null;
  },

  /**
   * Get all admin configs
   */
  getAllConfigs: async (): Promise<Record<string, any>> => {
    const cacheKey = CacheService.keys.configs('admin');
    const cached = await CacheService.get(cacheKey);
    if (cached) return cached;

    const client = await getPostgresClient();
    const result = await client.query(
      'SELECT key, value_json FROM app_configs WHERE user_id = $userId',
      { userId: 'admin' }
    );

    const out: Record<string, any> = {};
    for (const r of result.rows) {
      // pg library automatically parses JSONB values
      out[r.key] = r.value_json;
    }

    await CacheService.set(cacheKey, out, 1800);
    return out;
  },

  /**
   * Set an admin config value
   */
  setConfig: async (key: string, value: any): Promise<void> => {
    const client = await getPostgresClient();
    await client.query(
      `INSERT INTO app_configs (user_id, key, value_json, updated_at)
       VALUES ($userId, $key, $valueJson, $updatedAt)
       ON CONFLICT (user_id, key) DO UPDATE SET value_json = $valueJson, updated_at = $updatedAt`,
      { userId: 'admin', key, valueJson: JSON.stringify(value), updatedAt: getNowISO() }
    );

    await CacheService.del(CacheService.keys.configs('admin'));
  },

  /**
   * Delete an admin config
   */
  deleteConfig: async (key: string): Promise<void> => {
    const client = await getPostgresClient();
    await client.query(
      'DELETE FROM app_configs WHERE user_id = $userId AND key = $key',
      { userId: 'admin', key }
    );

    await CacheService.del(CacheService.keys.configs('admin'));
  },

  /**
   * Get pinned users list
   */
  getPinnedUsers: async (): Promise<string[]> => {
    try {
      const config = await AdminConfigService.getConfig('pinned_users');
      if (!config) return [];

      // PostgreSQL JSONB is auto-converted to JS object by pg library
      let pinned: any = config.value_json;

      // Handle case where pg returned a string (shouldn't happen with JSONB, but be safe)
      if (typeof pinned === 'string') {
        try {
          pinned = JSON.parse(pinned);
        } catch {
          console.warn('[AdminConfigService] Failed to parse pinned_users as JSON');
          return [];
        }
      }

      if (Array.isArray(pinned)) {
        const validIds = pinned.filter(id => typeof id === 'string' && id.length > 0);
        if (validIds.length !== pinned.length) {
          console.warn('[AdminConfigService] Some invalid user IDs filtered from pinned_users config');
        }
        return validIds;
      } else {
        console.warn('[AdminConfigService] Pinned users config is not an array, got:', typeof pinned);
        return [];
      }
    } catch (e) {
      console.error('[AdminConfigService] Failed to parse pinned_users config:', e);
      return [];
    }
  },

  /**
   * Set pinned users list
   */
  setPinnedUsers: async (userIds: string[]): Promise<void> => {
    await AdminConfigService.setConfig('pinned_users', userIds);
  },

  /**
   * Add user to pinned list
   */
  addPinnedUser: async (userId: string): Promise<void> => {
    const pinned = await AdminConfigService.getPinnedUsers();
    if (!pinned.includes(userId)) {
      await AdminConfigService.setPinnedUsers([...pinned, userId]);
    }
  },

  /**
   * Remove user from pinned list
   */
  removePinnedUser: async (userId: string): Promise<void> => {
    const pinned = await AdminConfigService.getPinnedUsers();
    await AdminConfigService.setPinnedUsers(pinned.filter(id => id !== userId));
  },

  /**
   * Toggle user pinned status
   */
  togglePinnedUser: async (userId: string): Promise<boolean> => {
    const pinned = await AdminConfigService.getPinnedUsers();
    const isPinned = pinned.includes(userId);

    if (isPinned) {
      await AdminConfigService.setPinnedUsers(pinned.filter(id => id !== userId));
      return false;
    } else {
      await AdminConfigService.setPinnedUsers([...pinned, userId]);
      return true;
    }
  }
};
