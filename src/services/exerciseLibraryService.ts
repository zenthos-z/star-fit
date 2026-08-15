import { API_BASE, getHeaders } from './geminiService';
import { storageGet, storageSet } from '@/storage';
import { Keys, ExerciseLibraryCache, Exercise } from '@/storage/schemas';

const EXERCISE_LIBRARY_KEY = Keys.exerciseLibrary;
const EXERCISE_LIBRARY_META_KEY = Keys.exerciseLibraryMeta;
const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CACHE_VERSION = 3; // Incremented to invalidate old cache (NanoID migration)

let isSyncing = false;
let listeners: Set<() => void> = new Set();

function computeHash(exercises: Exercise[]): string {
  const sorted = exercises
    .map(e => `${e.id}:${e.name}:${e.modified_at}`)
    .sort()
    .join('|');
  let hash = 0;
  for (let i = 0; i < sorted.length; i++) {
    const char = sorted.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

export const ExerciseLibraryService = {
  async getCache(): Promise<ExerciseLibraryCache | null> {
    try {
      const cached = await storageGet<ExerciseLibraryCache>(EXERCISE_LIBRARY_KEY);
      const meta = await storageGet(EXERCISE_LIBRARY_META_KEY);
      
      if (!cached || !meta) return null;
      
      if (meta.version !== CACHE_VERSION) {
        console.log('[ExerciseLibraryService] Cache version mismatch, ignoring');
        return null;
      }
      
      const now = Date.now();
      if (now - meta.lastSyncTime > SYNC_INTERVAL_MS) {
        console.log('[ExerciseLibraryService] Cache expired');
        return null;
      }
      
      return cached;
    } catch (e) {
      console.error('[ExerciseLibraryService] Failed to get cache:', e);
      return null;
    }
  },

  async setCache(exercises: Exercise[]): Promise<void> {
    try {
      const meta = {
        version: CACHE_VERSION,
        lastSyncTime: Date.now(),
        hash: computeHash(exercises),
        count: exercises.length
      };
      
      await storageSet(EXERCISE_LIBRARY_KEY, { exercises, meta });
      await storageSet(EXERCISE_LIBRARY_META_KEY, meta);
      
      console.log('[ExerciseLibraryService] Cache updated', { count: exercises.length, hash: meta.hash });
    } catch (e) {
      console.error('[ExerciseLibraryService] Failed to set cache:', e);
    }
  },

  async fetchFromServer(): Promise<Exercise[]> {
    try {
      const res = await fetch(`${API_BASE}/exercises`, {
        headers: getHeaders()
      });

      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }

      const data = await res.json();
      const exercises = Array.isArray(data) ? data : [];

      const parsed = exercises.map((ex: any) => {
        let targets = ex.targets;
        let equipmentRequired = ex.equipment_required;

        // Parse targets
        if (typeof targets === 'string') {
          try {
            targets = JSON.parse(targets);
          } catch {
            targets = { primary: [], secondary: [] };
          }
        }

        // Parse equipment_required
        if (typeof equipmentRequired === 'string') {
          try {
            equipmentRequired = JSON.parse(equipmentRequired);
          } catch {
            equipmentRequired = [];
          }
        }

        return {
          id: ex.id,
          name: ex.name,
          exercise_type: ex.exercise_type || 'resistance',
          targets: targets,
          equipment_required: equipmentRequired,
          difficulty: ex.difficulty || 'beginner',
          content_html: ex.content_html || '',
          assets_json: ex.assets_json || '{}',
          tags_json: ex.tags_json || undefined,
          modified_at: ex.modified_at || Date.now(),
          updated_at: ex.updated_at,
        };
      });

      return parsed;
    } catch (e) {
      console.error('[ExerciseLibraryService] Failed to fetch from server:', e);
      return [];
    }
  },

  async getExercises(): Promise<Exercise[]> {
    const cached = await this.getCache();
    
    if (cached) {
      console.log('[ExerciseLibraryService] Using cached exercises');
      return cached.exercises;
    }
    
    console.log('[ExerciseLibraryService] Cache miss, fetching from server');
    return await this.syncExercises();
  },

  async syncExercises(): Promise<Exercise[]> {
    if (isSyncing) {
      console.log('[ExerciseLibraryService] Already syncing, skipping');
      const cached = await this.getCache();
      return cached?.exercises || [];
    }
    
    isSyncing = true;
    
    try {
      const exercises = await this.fetchFromServer();
      await this.setCache(exercises);
      this.notifyListeners();
      return exercises;
    } catch (e) {
      console.error('[ExerciseLibraryService] Sync failed:', e);
      
      const cached = await this.getCache();
      if (cached) {
        console.log('[ExerciseLibraryService] Falling back to cache');
        return cached.exercises;
      }
      
      return [];
    } finally {
      isSyncing = false;
    }
  },

  async forceRefresh(): Promise<Exercise[]> {
    console.log('[ExerciseLibraryService] Force refresh requested');
    isSyncing = false;
    return await this.syncExercises();
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  notifyListeners(): void {
    listeners.forEach(listener => listener());
  },

  async clearCache(): Promise<void> {
    try {
      await storageSet(EXERCISE_LIBRARY_KEY, null);
      await storageSet(EXERCISE_LIBRARY_META_KEY, null);
      console.log('[ExerciseLibraryService] Cache cleared');
    } catch (e) {
      console.error('[ExerciseLibraryService] Failed to clear cache:', e);
    }
  },

  async getCacheStatus(): Promise<{
    hasCache: boolean;
    isExpired: boolean;
    lastSyncTime: number | null;
  }> {
    const meta = await storageGet(EXERCISE_LIBRARY_META_KEY);
    const now = Date.now();
    
    return {
      hasCache: !!meta,
      isExpired: !meta || (now - meta.lastSyncTime > SYNC_INTERVAL_MS),
      lastSyncTime: meta?.lastSyncTime || null
    };
  },

  init(): void {
    if (typeof window === 'undefined') return;
    
    const checkAndSync = async () => {
      if (navigator.onLine) {
        const status = await this.getCacheStatus();
        if (status.isExpired || !status.hasCache) {
          console.log('[ExerciseLibraryService] Auto-syncing exercises');
          await this.syncExercises();
        }
      }
    };
    
    checkAndSync();
    
    const intervalId = setInterval(checkAndSync, SYNC_INTERVAL_MS);
    
    window.addEventListener('online', () => {
      console.log('[ExerciseLibraryService] Network online, syncing...');
      this.syncExercises().catch(e => {
        console.error('[ExerciseLibraryService] Online sync failed:', e);
      });
    });
    
    window.addEventListener('offline', () => {
      console.log('[ExerciseLibraryService] Network offline');
    });
    
    return (() => {
      clearInterval(intervalId);
    }) as unknown as void;
  }
};
