import { API_BASE, getHeaders } from './geminiService';
import { Keys } from '@/storage/schemas';
import { storageGet, storageSet, getDeviceId as getStorageDeviceId } from '@/storage';
import { ExerciseLibraryService } from './exerciseLibraryService';
import { deviationBuffer } from '../v2/services/DeviationBuffer';

const QUEUE_KEY = 'STARFIT_SYNC_QUEUE';
const DELETE_QUEUE_KEY = 'STARFIT_DELETE_QUEUE';
const SYNC_STATE_KEY = 'STARFIT_SYNC_STATE';

interface SyncState {
  lastHistoryPull: number;
  lastConfigPull: number;
}

export const SyncService = {
  queue: [] as string[],
  deleteQueue: [] as string[],
  isSyncing: false,
  pulledSessionIds: new Set<string>(),

  init: async () => {
    SyncService.queue = await storageGet<string[]>(QUEUE_KEY) || [];
    SyncService.deleteQueue = await storageGet<string[]>(DELETE_QUEUE_KEY) || [];
    console.log(`[SyncService] Initialized with ${SyncService.queue.length} items in queue and ${SyncService.deleteQueue.length} items in delete queue`);
    
    // Initial Sync: Push anything in queue, then Pull
    if (SyncService.queue.length > 0 || SyncService.deleteQueue.length > 0) {
        SyncService.push();
    }
    SyncService.pull();
    
    // Periodically try to push/pull every 5 minutes if online
    setInterval(() => {
        if (navigator.onLine) {
            SyncService.push();
            SyncService.pull();
        }
    }, 5 * 60 * 1000);
    
    // Initialize Exercise Library Service for offline caching
    ExerciseLibraryService.init();
  },

  getDeviceId: async () => {
    return getStorageDeviceId();
  },

  // Push History
  push: async () => {
    if (SyncService.isSyncing) {
        console.log('[SyncService] Already syncing, skipping push');
        return;
    }
    SyncService.isSyncing = true;

    try {
      const deviceId = await SyncService.getDeviceId();
      if (!deviceId) {
        console.error('[SyncService] No deviceId available, skipping push');
        return;
      }
      
      const { loadHistory } = await import('@/storage');
      const allHistory = await loadHistory() || [];
      
      console.log(`[SyncService] Push check. DeviceId: ${deviceId}, Total history items: ${allHistory.length}, Queue: ${SyncService.queue.length}, DeleteQueue: ${SyncService.deleteQueue.length}`);
      
      if (SyncService.queue.length === 0 && SyncService.deleteQueue.length === 0) {
          // Even if queue is empty, we should ensure the user exists on the server
          // This helps with registration and pulling
          console.log('[SyncService] Queues empty, sending heartbeat push to register device');
          await fetch(`${API_BASE}/sync/push`, {
            method: 'POST',
            mode: 'cors',
            headers: getHeaders({ 
                'X-Requested-With': 'XMLHttpRequest'
            }),
            body: JSON.stringify({ deviceId, sessions: [] })
          }).catch(e => console.warn('[SyncService] Heartbeat failed:', e));
          return;
      }
      
      // Filter sessions in queue
      const batchIds = SyncService.queue.slice(0, 10);
      let batch = allHistory.filter(s => batchIds.includes(s.id));
      
      // Add deviations to session metadata
      const deviations = deviationBuffer.getRecords();
      if (deviations.length > 0) {
        batch = batch.map(session => ({
          ...session,
          meta: {
            ...(session.meta || {}),
            deviations
          }
        }));
        console.log(`[SyncService] Added ${deviations.length} deviation records to sessions`);
      }
      
      const deletedIds = [...SyncService.deleteQueue]; // Take all deletions at once as they are small
      
      console.log(`[SyncService] Batch size: ${batch.length} from queue size: ${batchIds.length}, Deleting: ${deletedIds.length}`);

      if (batch.length === 0 && SyncService.queue.length > 0 && deletedIds.length === 0) {
        console.warn(`[SyncService] Queue has items but they were not found in current history. Total history items: ${allHistory.length}`);
        // Remove missing items from queue to avoid infinite loop
        SyncService.queue = SyncService.queue.filter(id => !batchIds.includes(id));
        await storageSet(QUEUE_KEY, SyncService.queue);
        
        // If there's more in queue, try next batch after a short delay
        if (SyncService.queue.length > 0) {
            SyncService.isSyncing = false;
            setTimeout(() => SyncService.push(), 100);
            return;
        }
        return; 
      }
      
      if (batch.length > 0 || deletedIds.length > 0) {
          console.log(`[SyncService] Pushing batch of ${batch.length} sessions and ${deletedIds.length} deletions to ${API_BASE}`);
          const payload = { deviceId, sessions: batch, deletedSessionIds: deletedIds };
          console.log('[SyncService] Payload summary:', { 
              deviceId, 
              sessionsCount: batch.length, 
              deletedCount: deletedIds.length 
          });
          
          const res = await fetch(`${API_BASE}/sync/push`, {
            method: 'POST',
            mode: 'cors',
            headers: getHeaders({ 
                'Accept': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            }),
            body: JSON.stringify(payload)
          }).catch(err => {
            console.error('[SyncService] Fetch failed:', err);
            throw new Error(`网络连接失败: ${err.message || '无法连接到服务器'}`);
          });

          if (res.ok) {
            const result = await res.json();
            console.log('[SyncService] Push Success:', result);
            
            // Success! Remove from queues
            SyncService.queue = SyncService.queue.filter(id => !batchIds.includes(id));
            await storageSet(QUEUE_KEY, SyncService.queue);

            // Clear successfully synced deletions
            SyncService.deleteQueue = SyncService.deleteQueue.filter(id => !deletedIds.includes(id));
            await storageSet(DELETE_QUEUE_KEY, SyncService.deleteQueue);
            
            // Clear deviation buffer after successful sync
            if (deviations.length > 0) {
              deviationBuffer.clear();
              console.log('[SyncService] Cleared deviation buffer after successful sync');
            }
            
            // If there's more in queue, continue after a short delay
            if (SyncService.queue.length > 0 || SyncService.deleteQueue.length > 0) {
                console.log(`[SyncService] More items in queues (U:${SyncService.queue.length}, D:${SyncService.deleteQueue.length}), scheduling next batch...`);
                SyncService.isSyncing = false;
                setTimeout(() => SyncService.push(), 300);
                return;
            }
          } else {
             const errText = await res.text();
             console.error(`[SyncService] Server error ${res.status}:`, errText);
             throw new Error(`服务器错误 (${res.status}): ${errText || '未知错误'}`);
          }
      }
    } catch (e: any) {
      console.error('[SyncService] Push Error:', e);
      throw e;
    } finally {
      SyncService.isSyncing = false;
    }
  },

  enqueue: async (sessionId: string) => {
    // Skip if session was recently pulled from server (prevents echo loop)
    if (SyncService.pulledSessionIds.has(sessionId)) {
      console.log(`[SyncService] Enqueue: Skipping session ${sessionId} because it was just pulled from remote`);
      return;
    }

    if (!SyncService.queue.includes(sessionId)) {
      SyncService.queue.push(sessionId);
      await storageSet(QUEUE_KEY, SyncService.queue);
      console.log(`[SyncService] Enqueued session: ${sessionId}. Queue size: ${SyncService.queue.length}`);
      // Trigger push (don't await to avoid blocking UI)
      SyncService.push().catch(e => console.error('[SyncService] Background push failed:', e));
    }
  },

  enqueueDeletion: async (sessionId: string) => {
    // If it's in the upload queue, remove it (no need to upload if deleted)
    if (SyncService.queue.includes(sessionId)) {
      SyncService.queue = SyncService.queue.filter(id => id !== sessionId);
      await storageSet(QUEUE_KEY, SyncService.queue);
    }
    
    // Add to delete queue if not already there
    if (!SyncService.deleteQueue.includes(sessionId)) {
      SyncService.deleteQueue.push(sessionId);
      await storageSet(DELETE_QUEUE_KEY, SyncService.deleteQueue);
      console.log(`[SyncService] Enqueued deletion: ${sessionId}. Delete queue size: ${SyncService.deleteQueue.length}`);
      // Trigger push
      SyncService.push().catch(e => console.error('[SyncService] Background delete push failed:', e));
    }
  },

  // Enqueue all local history that isn't in the queue
  syncAll: async () => {
    try {
        const deviceId = await SyncService.getDeviceId();
        // Check both new and old keys
        const historyKey = Keys.historyForDevice(deviceId);
        let allHistory = await storageGet<any[]>(historyKey) || [];
        
        if (allHistory.length === 0) {
            console.log('[SyncService] New history key empty, checking legacy key...');
            const legacy = await storageGet<any[]>(Keys.history) || [];
            if (legacy.length > 0) {
                console.log(`[SyncService] Found ${legacy.length} items in legacy key. Migrating...`);
                await storageSet(historyKey, legacy);
                allHistory = legacy;
            }
        }

        if (allHistory.length === 0) {
            console.log('[SyncService] No history found to sync.');
            // Still run push once to ensure registration
            await SyncService.push();
            return;
        }

        let added = 0;
        for (const s of allHistory) {
            if (!SyncService.queue.includes(s.id)) {
                SyncService.queue.push(s.id);
                added++;
            }
        }
        
        if (added > 0 || SyncService.queue.length > 0) {
            await storageSet(QUEUE_KEY, SyncService.queue);
            console.log(`[SyncService] syncAll added ${added} sessions to queue. Total queue: ${SyncService.queue.length}`);
            await SyncService.push();
        } else {
            // Even if nothing added, maybe register
            await SyncService.push();
        }
    } catch (e) {
        console.error('[SyncService] syncAll Error:', e);
        throw e;
    }
  },

  // Pull History & Config (Full Sync - Simple & Reliable)
  // 始终拉取全部历史记录，不再使用增量同步
  // 数据量小（通常<100条），全量同步更可靠
  pull: async () => {
    try {
      const deviceId = await SyncService.getDeviceId();

      const res = await fetch(`${API_BASE}/sync/pull?deviceId=${deviceId}&since=0`, {
        headers: getHeaders()
      });
      if (!res.ok) return;

      const data = await res.json();
      
      // 1. Merge History & Reconciliation (Server Priority)
      const localHistory = await storageGet<any[]>(Keys.historyForDevice(deviceId)) || [];
      const remoteSessions = data.updates?.sessions || [];
      const activeSessionIds = data.updates?.activeSessionIds as string[] | undefined;
      
      let merged = [...localHistory];
      let changed = false;

      // Apply remote updates
      if (remoteSessions.length > 0) {
        remoteSessions.forEach((remote: any) => {
          // Track pulled IDs to prevent echo loop in enqueue
          SyncService.pulledSessionIds.add(remote.id);
          
          // Don't merge if it's pending deletion
          if (SyncService.deleteQueue.includes(remote.id)) {
            console.log(`[SyncService] Pull: Skipping session ${remote.id} because it's pending deletion`);
            return;
          }

          const idx = merged.findIndex(l => l.id === remote.id);
          if (idx >= 0) {
             // Overwrite if remote is newer
             merged[idx] = remote;
          } else {
             merged.push(remote);
          }
        });
        changed = true;
      }

      // Reconciliation: Remove local items that are missing from server (Server Priority)
      // Only if activeSessionIds is provided (to avoid accidental wipes on old server versions)
      if (activeSessionIds && Array.isArray(activeSessionIds)) {
        const countBefore = merged.length;
        // Keep if:
        // 1. It's in the server's active list
        // 2. OR it's in the local sync queue (not yet pushed to server)
        merged = merged.filter(local => 
          activeSessionIds.includes(local.id) || 
          SyncService.queue.includes(local.id)
        );
        
        if (merged.length !== countBefore) {
          console.log(`[SyncService] Reconciliation: Removed ${countBefore - merged.length} sessions missing from server`);
          changed = true;
        }
      }

      if (changed) {
        // Sort
        merged.sort((a, b) => b.startTime - a.startTime);
        await storageSet(Keys.historyForDevice(deviceId), merged);
        window.dispatchEvent(new Event('history-updated'));
      }

      // 2. Merge Knowledge (Exercises)
      if (data.updates?.exercises?.length > 0) {
         const exercises = data.updates.exercises;
         console.log(`[SyncService] Merging ${exercises.length} exercises from server`);
         
         const cached = await ExerciseLibraryService.getCache();
         let merged = cached?.exercises || [];
         
         const idSet = new Set(merged.map(e => e.id));
         let addedCount = 0;
         let updatedCount = 0;
         
         exercises.forEach((ex: any) => {
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

            if (typeof equipmentRequired === 'string') {
              try {
                equipmentRequired = JSON.parse(equipmentRequired);
              } catch {
                equipmentRequired = [];
              }
            }

            const normalized = {
              ...ex,
              targets: targets,
              equipment_required: equipmentRequired
            };
            
            const idx = merged.findIndex((e: any) => e.id === ex.id);
            if (idx >= 0) {
               merged[idx] = normalized;
               updatedCount++;
            } else {
               merged.push(normalized);
               addedCount++;
            }
         });
         
         console.log(`[SyncService] Exercise merge: ${addedCount} added, ${updatedCount} updated`);
         await ExerciseLibraryService.setCache(merged);
         ExerciseLibraryService.notifyListeners();
      }

      // 3. Merge Configs
      if (data.updates?.appConfigs?.length > 0) {
         data.updates.appConfigs.forEach((cfg: any) => {
             if (cfg.key === 'source_config') storageSet('STARFIT_SOURCE_CONFIG', JSON.parse(cfg.value_json));
             if (cfg.key === 'scene_config') storageSet('STARFIT_SCENE_CONFIG', JSON.parse(cfg.value_json));
         });
      }

      // Note: 使用全量同步，不再更新时间戳
      // SYNC_STATE_KEY 保留用于未来可能的配置增量同步优化
    } catch (e) {
      console.error('Sync Pull Error', e);
    }
  }
};
