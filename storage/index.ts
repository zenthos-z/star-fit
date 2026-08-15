import { idbGet, idbSet, idbRemove, idbKeys, idbClear } from "./adapters/indexeddb";
import { lsGet, lsSet, lsRemove, lsKeys, lsClear } from "./adapters/localstorage";
import { Keys, TutorialCache, UserPrefs, WorkoutDraft, SessionLite, ServerHistoryEntry, LoginCredentials } from "./schemas";
import type { ChatMessage } from "../src/v2/hooks/useAICoach";
import { v4 as uuidv4 } from "uuid";
import type { Session } from "../types";

// Chat Thread Types
export interface ChatThread {
  id: string;
  sessionId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  preview?: string;
}

const useIDB = typeof indexedDB !== "undefined";

const STORAGE_WHITELIST = [
  Keys.deviceId,
  'prefs:',
  Keys.sessionActive,
  'STARFIT_SYNC_QUEUE',
  'STARFIT_DELETE_QUEUE',
  'STARFIT_SYNC_STATE',
  'starfit_history:',
  Keys.aiConfig,
  'chat_thread_list:',
  'chat_messages:',
  Keys.pendingSummary,
  Keys.nextPlan
];

export async function storageGet<T = any>(key: string): Promise<T | null> {
  if (useIDB) {
    try {
      return await idbGet<T>(key);
    } catch (e) {
      console.warn('[Storage] IDB get failed, falling back to localStorage:', e);
      return lsGet<T>(key);
    }
  }
  return Promise.resolve(lsGet<T>(key));
}

export async function storageSet(key: string, value: any): Promise<void> {
  if (useIDB) return idbSet(key, value, STORAGE_WHITELIST);
  lsSet(key, value);
}

export async function storageRemove(key: string): Promise<void> {
  if (useIDB) return idbRemove(key);
  lsRemove(key);
}

export async function storageKeys(): Promise<string[]> {
  if (useIDB) return idbKeys();
  return Promise.resolve(lsKeys());
}

/**
 * PURGE_V1_DATA: Clears all local storage (IDB and LocalStorage) to establish a clean V2 baseline.
 */
export async function storageClear(): Promise<void> {
  if (useIDB) await idbClear();
  lsClear();
  console.log("[Storage] PURGE_V1_DATA completed. Environment reset to baseline.");
}

export async function getDeviceId(): Promise<string> {
  let id = await storageGet<string>(Keys.deviceId);
  if (!id) {
    // Fallback for older WebViews that don't support crypto.randomUUID
    if (typeof crypto !== 'undefined' && (crypto as any).randomUUID) {
      id = (crypto as any).randomUUID();
    } else {
      id = 'dev-' + Date.now() + '-' + Math.random().toString(36).substring(2, 11);
      console.log('[Storage] Generated fallback deviceId:', id);
    }
    await storageSet(Keys.deviceId, id);
  }
  return id;
}

export async function requestPersist(): Promise<boolean> {
  try {
    // @ts-ignore
    if (navigator.storage && navigator.storage.persist) {
      // @ts-ignore
      return await navigator.storage.persist();
    }
  } catch {}
  return false;
}

export async function saveWorkoutDraft(date: string, draft: WorkoutDraft): Promise<void> {
  await storageSet(Keys.draft(date), draft);
}

export async function loadWorkoutDraft(date: string): Promise<WorkoutDraft | null> {
  return storageGet(Keys.draft(date));
}

export async function savePrefs(profileId: string, prefs: UserPrefs): Promise<void> {
  await storageSet(Keys.prefs(profileId), prefs);
}

export async function loadPrefs(profileId: string): Promise<UserPrefs | null> {
  return storageGet(Keys.prefs(profileId));
}

export async function saveTutorialCache(name: string, lang: string, data: TutorialCache): Promise<void> {
  await storageSet(Keys.tutorial(name, lang), data);
}

export async function loadTutorialCache(name: string, lang: string): Promise<TutorialCache | null> {
  return storageGet(Keys.tutorial(name, lang));
}

export async function setPendingSummary(pending: boolean): Promise<void> {
  if (pending) {
    await storageSet(Keys.pendingSummary, true);
  } else {
    await storageRemove(Keys.pendingSummary);
  }
}

export async function hasPendingSummary(): Promise<boolean> {
  const val = await storageGet<boolean>(Keys.pendingSummary);
  return !!val;
}

export async function saveHistory(list: SessionLite[]): Promise<void> {
  const deviceId = await getDeviceId();
  await storageSet(Keys.historyForDevice(deviceId), list);
}

export async function loadHistory(): Promise<SessionLite[] | null> {
  const deviceId = await getDeviceId();
  const byDevice = await storageGet<SessionLite[]>(Keys.historyForDevice(deviceId));
  if (byDevice && Array.isArray(byDevice)) return byDevice;
  const legacy = await storageGet<SessionLite[]>(Keys.history);
  if (legacy && Array.isArray(legacy)) {
    await storageSet(Keys.historyForDevice(deviceId), legacy);
    await storageRemove(Keys.history);
    return legacy;
  }
  return null;
}

export async function saveActiveSession(s: Session): Promise<void> {
  await storageSet(Keys.sessionActive, s);
}

export async function loadActiveSession(): Promise<Session | null> {
  return storageGet<Session>(Keys.sessionActive);
}

export async function saveAiConfig(cfg: any): Promise<void> {
  await storageSet(Keys.aiConfig, cfg);
}

export async function loadAiConfig(): Promise<any | null> {
  return storageGet(Keys.aiConfig);
}

export async function saveNextPlan(plan: any[]): Promise<void> {
  const payload = {
    plan,
    savedAt: Date.now()
  };
  await storageSet(Keys.nextPlan, payload);
}

export async function loadNextPlan(): Promise<any[] | null> {
  const payload = await storageGet<{ plan?: any[] }>(Keys.nextPlan);
  if (payload && Array.isArray(payload.plan)) {
    return payload.plan;
  }
  return null;
}

export async function clearNextPlan(): Promise<void> {
  await storageRemove(Keys.nextPlan);
}

// ========== Login and Authentication ==========

/**
 * Save login credentials to IDB
 */
export async function saveLoginCredentials(userId: string, serverUrl: string): Promise<void> {
  await storageSet(Keys.userId, userId);
  await storageSet(Keys.serverUrl, serverUrl);
  const creds: LoginCredentials = {
    userId,
    serverUrl,
    lastLogin: Date.now()
  };
  await storageSet("starfit_login_creds", creds);
}

/**
 * Load login credentials from IDB
 */
export async function loadLoginCredentials(): Promise<{ userId: string | null; serverUrl: string | null }> {
  const userId = await storageGet<string>(Keys.userId);
  const serverUrl = await storageGet<string>(Keys.serverUrl);
  return { userId, serverUrl };
}

/**
 * Clear login credentials from IDB
 */
export async function clearLoginCredentials(): Promise<void> {
  await storageRemove(Keys.userId);
  await storageRemove(Keys.serverUrl);
  await storageRemove("starfit_login_creds");
  // Note: serverHistory is NOT cleared here as it's a user preference
  // that should persist across logins for convenience
}

/**
 * Load server history from IDB
 */
export async function loadServerHistory(): Promise<ServerHistoryEntry[]> {
  const history = await storageGet<ServerHistoryEntry[]>(Keys.serverHistory);
  return history || [];
}

/**
 * Add server to history or update existing entry
 */
export async function addServerToHistory(url: string, latency?: number): Promise<void> {
  const history = await loadServerHistory();
  const existingIndex = history.findIndex(h => h.url === url);
  const now = Date.now();

  if (existingIndex >= 0) {
    // Update existing entry
    history[existingIndex].lastConnected = now;
    history[existingIndex].successCount += 1;
    if (latency !== undefined) {
      history[existingIndex].latency = latency;
    }
  } else {
    // Add new entry
    history.unshift({
      url,
      lastConnected: now,
      successCount: 1,
      latency
    });
  }

  // Keep only last 10 entries
  const trimmed = history.slice(0, 10);
  await storageSet(Keys.serverHistory, trimmed);
}

/**
 * Migrate legacy login data from localStorage to IDB
 */
export async function migrateLegacyLoginData(): Promise<boolean> {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return false;
    }

    const legacyUserId = localStorage.getItem('starfit_user_id');
    const legacyServerUrl = localStorage.getItem('starfit_server_url');
    const legacyServerIp = localStorage.getItem('starfit_server_ip');

    let migrated = false;

    // Migrate user ID
    if (legacyUserId && !(await storageGet<string>(Keys.userId))) {
      await storageSet(Keys.userId, legacyUserId);
      migrated = true;
    }

    // Migrate server URL
    if (legacyServerUrl && !(await storageGet<string>(Keys.serverUrl))) {
      await storageSet(Keys.serverUrl, legacyServerUrl);
      migrated = true;
    }

    // Create initial server history entry from legacy URL
    if (legacyServerUrl && migrated) {
      await addServerToHistory(legacyServerUrl);
    }

    // Optionally clear legacy data after successful migration
    if (migrated) {
      console.log('[Storage] Legacy login data migrated to IDB');
      // Uncomment to clear legacy data after migration:
      // localStorage.removeItem('starfit_user_id');
      // localStorage.removeItem('starfit_server_url');
      // localStorage.removeItem('starfit_server_ip');
    }

    return migrated;
  } catch (e) {
    console.error('[Storage] Failed to migrate legacy login data:', e);
    return false;
  }
}

// ========== Chat Thread Management ==========
// Note: Using deviceId instead of sessionId for persistent storage across app restarts

/**
 * Save chat thread list for current device
 */
export async function saveChatThreadList(threads: ChatThread[]): Promise<void> {
  const deviceId = await getDeviceId();
  await storageSet(Keys.chatThreadList(deviceId), threads);
}

/**
 * Load chat thread list for current device
 */
export async function loadChatThreadList(): Promise<ChatThread[] | null> {
  const deviceId = await getDeviceId();
  return storageGet<ChatThread[]>(Keys.chatThreadList(deviceId));
}

/**
 * Save chat messages for a thread
 */
export async function saveChatMessages(threadId: string, messages: ChatMessage[]): Promise<void> {
  await storageSet(Keys.chatMessages(threadId), messages);
}

/**
 * Load chat messages for a thread
 */
export async function loadChatMessages(threadId: string): Promise<ChatMessage[] | null> {
  return storageGet<ChatMessage[]>(Keys.chatMessages(threadId));
}

/**
 * Delete a chat thread and its messages
 */
export async function deleteChatThread(threadId: string): Promise<void> {
  // Remove messages
  await storageRemove(Keys.chatMessages(threadId));
  // Update thread list
  const threads = await loadChatThreadList();
  if (threads) {
    const updated = threads.filter(t => t.id !== threadId);
    await saveChatThreadList(updated);
  }
}

/**
 * Migrate legacy chat draft data to new thread format
 * One-time migration from old chat_draft to new thread-based system
 */
export async function migrateLegacyChatData(): Promise<boolean> {
  try {
    const deviceId = await getDeviceId();

    // Check if already migrated (has thread list)
    const existingThreads = await loadChatThreadList();
    if (existingThreads && existingThreads.length > 0) {
      // Already migrated, clean up old draft if exists
      const legacyDraft = await storageGet<any[]>(`chat_draft:${deviceId}`);
      if (legacyDraft) {
        await storageRemove(`chat_draft:${deviceId}`);
      }
      return false;
    }

    // Load legacy draft - try with deviceId
    let legacyDraft = await storageGet<any[]>(`chat_draft:${deviceId}`);

    // If not found, try to find any old chat_draft key
    if (!legacyDraft) {
      const allKeys = await storageKeys();
      const oldDraftKey = allKeys.find(k => k.startsWith('chat_draft:'));
      if (oldDraftKey) {
        legacyDraft = await storageGet<any[]>(oldDraftKey);
      }
    }

    if (!legacyDraft || legacyDraft.length === 0) {
      return false;
    }

    console.log('[Storage] Migrating legacy chat data for device:', deviceId);

    // Create a migrated thread
    const threadId = `thread_${Date.now()}_migrated`;
    const now = Date.now();

    // Generate title from first user message
    const firstUserMsg = legacyDraft.find((m: any) => m.role === 'user');
    const title = firstUserMsg
      ? `${firstUserMsg.text.slice(0, 10)}${firstUserMsg.text.length > 10 ? '...' : ''}`
      : '历史对话';

    // Get preview from last message
    const lastMsg = legacyDraft[legacyDraft.length - 1];
    const preview = lastMsg?.text?.slice(0, 30) || '';

    const migratedThread: ChatThread = {
      id: threadId,
      sessionId: deviceId,
      title,
      createdAt: now,
      updatedAt: now,
      messageCount: legacyDraft.length,
      preview
    };

    // Save migrated data
    await saveChatThreadList([migratedThread]);
    await saveChatMessages(threadId, legacyDraft as ChatMessage[]);

    // Delete old draft
    await storageRemove(`chat_draft:${deviceId}`);

    console.log('[Storage] Legacy chat data migrated successfully');
    return true;
  } catch (e) {
    console.error('[Storage] Failed to migrate legacy chat data:', e);
    return false;
  }
}

// ========== Legacy Chat Functions (Deprecated) ==========
// Note: saveChatDraft and loadChatDraft have been removed.
// Use saveChatMessages(threadId, messages) and loadChatMessages(threadId) instead.
