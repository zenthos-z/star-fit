export interface CacheProvider {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryCacheProvider implements CacheProvider {
  private cache = new Map<string, { value: any; expiresAt: number | null }>();

  async get<T>(key: string): Promise<T | null> {
    const item = this.cache.get(key);
    if (!item) return null;
    if (item.expiresAt && item.expiresAt < Date.now()) {
      this.cache.delete(key);
      return null;
    }
    return item.value;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
    this.cache.set(key, { value, expiresAt });
  }

  async del(key: string): Promise<void> {
    this.cache.delete(key);
  }

  async clear(): Promise<void> {
    this.cache.clear();
  }
}

// Initialized with Memory Provider
const provider: CacheProvider = new MemoryCacheProvider();

export const CacheService = {
  get: <T>(key: string) => provider.get<T>(key),
  set: <T>(key: string, value: T, ttlSeconds?: number) => provider.set(key, value, ttlSeconds),
  del: (key: string) => provider.del(key),
  
  // Key generators
  keys: {
    historySummary: (userId: string, lastSessionId: string) => `history_summary:${userId}:${lastSessionId}`,
    rpeStats: (userId: string, exerciseName: string) => `rpe_stats:${userId}:${exerciseName}`,
    exerciseList: () => `exercise_list`,
    guidance: (userId: string) => `guidance:${userId}`,
    configs: (userId: string) => `configs:${userId}`,
    styleParams: (userId: string, styleKey: string) => `style_params:${userId}:${styleKey}`,
    userList: () => `user_list`,
  }
};
