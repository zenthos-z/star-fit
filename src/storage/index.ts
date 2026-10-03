import { idbGet, idbSet, idbRemove, idbKeys, idbClear } from "./adapters/indexeddb";
import { lsGet, lsSet, lsRemove, lsKeys, lsClear } from "./adapters/localstorage";
import { Keys, TutorialCache, UserPrefs, WorkoutDraft, SessionLite, ServerHistoryEntry, LoginCredentials } from "./schemas";
import type { ChatMessage } from "../hooks/useAICoach";
import { v4 as uuidv4 } from "uuid";
import type { Session } from "@/src/types/legacy";

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
  Keys.nextPlan,
  'starfit_day_plan:',
  'starfit_poster:'
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

/** nextPlan 保存元信息（含 savedAt），供到期清理判断 */
export async function loadNextPlanMeta(): Promise<{ savedAt?: number } | null> {
  const payload = await storageGet<{ plan?: any[]; savedAt?: number }>(Keys.nextPlan);
  if (payload) return { savedAt: payload.savedAt };
  return null;
}

export async function clearNextPlan(): Promise<void> {
  await storageRemove(Keys.nextPlan);
}

// ========== 按天训练计划（AI Agent hub 7 天计划墙） ==========

export interface DayPlan {
  date: string; // yyyy-mm-dd
  plan: any[];
  savedAt: number;
}

export async function saveDayPlan(date: string, plan: any[]): Promise<void> {
  await storageSet(Keys.dayPlan + date, { date, plan, savedAt: Date.now() });
}

export async function loadDayPlan(date: string): Promise<any[] | null> {
  const payload = await storageGet<{ date: string; plan?: any[] }>(Keys.dayPlan + date);
  if (payload && Array.isArray(payload.plan)) return payload.plan;
  return null;
}

export async function loadDayPlans(dates: string[]): Promise<Record<string, any[] | null>> {
  const out: Record<string, any[] | null> = {};
  for (const d of dates) {
    out[d] = await loadDayPlan(d);
  }
  return out;
}

export async function clearDayPlan(date: string): Promise<void> {
  await storageRemove(Keys.dayPlan + date);
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
 * 会话清理共用路径（useLoginStatus.logout 与 #108 401 强制登出共用）：
 * 同步 localStorage 部分先行（写墓碑 + 清凭据镜像，同步必然成功，reload 后
 * 必落登录页）；IDB 凭据清除 best-effort（WKWebView 的 IDB 可能挂起，登出
 * 墓碑保证下次启动懒清除陈旧凭据）。双墓碑 lastUserId / lastServerUrl 供
 * 下次登录检测切号（#82）与切服务器（#108 机制二）。
 */
export async function clearLoginSession(): Promise<void> {
  const uid = localStorage.getItem('starfit_user_id');
  if (uid) {
    localStorage.setItem(Keys.lastUserId, uid);
  }
  const curServer = localStorage.getItem('starfit_server_url');
  if (curServer) {
    localStorage.setItem(Keys.lastServerUrl, curServer);
  }
  localStorage.setItem('starfit_logged_out', '1');
  localStorage.removeItem('starfit_user_id');
  localStorage.removeItem('starfit_server_url');
  localStorage.removeItem('starfit_server_ip');
  try {
    await Promise.race([
      clearLoginCredentials(),
      new Promise<void>((r) => setTimeout(r, 2000)),
    ]);
  } catch (e) {
    console.warn('[Storage] clearLoginSession: IDB credential clear failed (non-fatal):', e);
  }
}

/**
 * Load server history from IDB
 */
export async function loadServerHistory(): Promise<ServerHistoryEntry[]> {
  const history = await storageGet<ServerHistoryEntry[]>(Keys.serverHistory);
  return history || [];
}

// ========== [#82 方案A] 切号清残留（账号切换即清空用户态数据） ==========

/**
 * 切号时保留的键：设备级标识 / 登录凭据 / 共享内容缓存。
 * 未列出的键一律视为用户态数据（default-clear）——新增用户态键无需登记；
 * 误保留的代价（跨账号数据泄漏）远大于误清除（重新拉取内容缓存）。
 */
const USER_STATE_KEEP_EXACT = [
  Keys.deviceId,            // 设备标识（方案A 明确保留）
  Keys.userId,              // 登录凭据
  Keys.serverUrl,           // 登录凭据
  Keys.serverHistory,       // 服务器连接记录（设备级便利项，见 clearLoginCredentials 注释）
  Keys.lastUserId,          // 切号检测墓碑（useLoginStatus 读写）
  'starfit_server_ip',      // 凭据 legacy localStorage 镜像（useLoginStatus）
  'starfit_login_creds',    // 凭据聚合（saveLoginCredentials）
  'starfit_logged_out',     // 登出墓碑（useLoginStatus.logout）
  'starfit_login_username', // 登录名展示留存（LoginV2，每次登录覆写）
  'starfit_access_token',   // 访问令牌（geminiService，每次登录覆写）
  Keys.exerciseLibrary,     // 动作公共库缓存（服务端内容缓存，非用户态）
  Keys.exerciseLibraryMeta,
];
const USER_STATE_KEEP_PREFIXES = [
  'tutorial:', // 教程正文缓存（服务端内容缓存）
];

/** 判定一个键是否属于用户态数据（切号时需清除） */
export function isUserStateKey(key: string): boolean {
  if (USER_STATE_KEEP_EXACT.includes(key)) return false;
  return !USER_STATE_KEEP_PREFIXES.some((p) => key.startsWith(p));
}

/**
 * 清除所有用户态存储，保留设备级标识、登录凭据与共享内容缓存（#82 方案A）。
 * 双后端清扫：IDB kv 库 + localStorage（海报等直写 localStorage 的键不在 IDB）。
 * @returns 清除的键数量（双后端合计）
 */
export async function clearUserStateStorage(): Promise<number> {
  let removed = 0;
  if (useIDB) {
    try {
      for (const k of await idbKeys()) {
        if (isUserStateKey(k)) {
          await idbRemove(k);
          removed++;
        }
      }
    } catch (e) {
      console.warn('[Storage] clearUserStateStorage: IDB pass failed:', e);
    }
  }
  try {
    for (const k of lsKeys()) {
      if (isUserStateKey(k)) {
        lsRemove(k);
        removed++;
      }
    }
  } catch (e) {
    console.warn('[Storage] clearUserStateStorage: localStorage pass failed:', e);
  }
  console.log(`[Storage] clearUserStateStorage: removed ${removed} user-state key(s)`);
  return removed;
}

// ========== [#108 机制二] 服务器切换 → 用户数据缓存整体作废 ==========

/**
 * 作废的精确键：用户数据（按 Keys 全集逐键判定）+ 指向旧数据宇宙的同步队列。
 * 未列入者要么是设备级/凭据键（见下方豁免注释），要么由 sync/pull 随新服务器覆写。
 */
const SERVER_SWITCH_INVALIDATE_EXACT = [
  Keys.history,              // legacy 全局历史（迁移前）
  Keys.sessionActive,        // 进行中会话
  Keys.pendingSummary,       // 待总结标记
  Keys.nextPlan,             // 下次计划
  Keys.exerciseLibrary,      // 动作库缓存（新服务器拉取重建）
  Keys.exerciseLibraryMeta,
  Keys.suggestionCache,      // 动作建议缓存（用户数据衍生）
  'STARFIT_SYNC_QUEUE',      // 同步队列：指向旧服务器宇宙的会话引用
  'STARFIT_DELETE_QUEUE',
  'STARFIT_SYNC_STATE',
];
/** 作废的键前缀：按 deviceId / 日期 / 会话 ID 展开的用户数据 */
const SERVER_SWITCH_INVALIDATE_PREFIXES = [
  'starfit_history:',        // historyForDevice（当前历史）
  'starfit_day_plan:',       // 按天训练计划
  'workout_draft:',          // 训练草稿（Keys.draft）
  'chat_draft:',             // legacy 会话草稿（迁移前）
  'chat_thread_list:',       // 会话线程列表
  'chat_messages:',          // 会话消息
  'starfit_poster:',         // 海报缓存（训练衍生用户数据）
];

function isServerSwitchInvalidateKey(key: string): boolean {
  if (SERVER_SWITCH_INVALIDATE_EXACT.includes(key)) return true;
  return SERVER_SWITCH_INVALIDATE_PREFIXES.some((p) => key.startsWith(p));
}

/**
 * 扫除所有用户数据缓存键（双后端：IDB kv 库 + localStorage）。
 * 豁免（设备级 / 凭据 / 跨服务器内容缓存，不作废）：deviceId、userId/serverUrl/
 * serverHistory/lastUserId/lastServerUrl（凭据与记录）、aiConfig、prefs:*、
 * tutorial:*（服务端内容缓存）、firstUseCoachTriage:*（userId 维度）、
 * serverHistory、starfit_logged_out / starfit_login_username。
 * @returns 清除的键数量（双后端合计）
 */
export async function invalidateUserDataStorage(): Promise<number> {
  let removed = 0;
  if (useIDB) {
    try {
      for (const k of await idbKeys()) {
        if (isServerSwitchInvalidateKey(k)) {
          await idbRemove(k);
          removed++;
        }
      }
    } catch (e) {
      console.warn('[Storage] invalidateUserDataStorage: IDB pass failed:', e);
    }
  }
  try {
    for (const k of lsKeys()) {
      if (isServerSwitchInvalidateKey(k)) {
        lsRemove(k);
        removed++;
      }
    }
  } catch (e) {
    console.warn('[Storage] invalidateUserDataStorage: localStorage pass failed:', e);
  }
  console.log(`[Storage] invalidateUserDataStorage: removed ${removed} key(s)`);
  return removed;
}

/**
 * 登录成功时检测服务器变更 → 用户数据缓存整体作废（#108 机制二）。
 * 一把梭语义：换了服务器 = 换了数据宇宙，不做键级指纹（YAGNI）。
 * 比对基准 = 跨登出存活的 Keys.lastServerUrl（凭据在 logout 时会被清，
 * 首次登录无记录 = 无从谈「变化」，不触发作废）。无论是否变更都记录本次 URL。
 * 必须在覆写凭据 / onLogin（App 随即 reload，异步作废会与 reload 竞态）之前 await。
 * @returns 作废的键数量（未变更时为 0）
 */
export async function invalidateUserDataOnServerChange(newServerUrl: string): Promise<number> {
  const last = localStorage.getItem(Keys.lastServerUrl);
  if (last && last !== newServerUrl) {
    console.log(`[Storage] Server changed (${last} → ${newServerUrl}), invalidating user data cache`);
    const removed = await invalidateUserDataStorage();
    localStorage.setItem(Keys.lastServerUrl, newServerUrl);
    return removed;
  }
  localStorage.setItem(Keys.lastServerUrl, newServerUrl);
  return 0;
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
