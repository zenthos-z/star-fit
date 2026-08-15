import { Exercise, Session, AiConfig, AiScenario } from '../types';
import { MOCK_PLAN, DEFAULT_AI_CONFIG } from '../constants';
import { loadTutorialCache, saveTutorialCache, loadLoginCredentials } from '../storage';

export const API_BASE = (() => {
  const log = (msg: string, val: any) => console.log(`[API_BASE_DEBUG] ${msg}:`, val);
  
  // 0. Login-based Override (Highest Priority)
  if (typeof window !== 'undefined' && window.localStorage) {
    const loginUrl = window.localStorage.getItem('starfit_server_url');
    if (loginUrl && loginUrl.startsWith('http')) {
      log('Using Login Override', loginUrl);
      return loginUrl;
    }
  }

  // 1. Manual Override via LocalStorage (Legacy)
  if (typeof window !== 'undefined' && window.localStorage) {
    const stored = window.localStorage.getItem('STARFIT_API_BASE');
    if (stored && stored.startsWith('http')) {
      log('Using Manual Override', stored);
      return stored;
    }
  }

  const envUrl = import.meta.env?.VITE_API_BASE_URL;
  const hostname = window.location.hostname;
  const protocol = window.location.protocol;
  const isCapacitor = protocol === 'capacitor:';
  const isLocalAccess = (hostname === 'localhost' || hostname === '127.0.0.1') && !isCapacitor;

  log('Env Info', { protocol, hostname, isCapacitor, isLocalAccess, envUrl });

  // 2. Fixed Fallback for Mobile (Should match backend port 43111)
  const MOBILE_DEFAULT = 'http://192.168.31.100:43111/api';

  // If we are on a mobile device or Capacitor (which serves from localhost), 
  // and we don't have a valid remote URL, use the fixed IP fallback.
  if ((isCapacitor || !isLocalAccess) && (!envUrl || envUrl.includes('localhost'))) {
    log('Detection', 'Mobile/Capacitor detected, using fixed fallback');
    return MOBILE_DEFAULT;
  }

  let result = '';
  if (envUrl && envUrl.startsWith('http')) {
      result = envUrl;
  } else {
      result = `${protocol}//${hostname}:43111/api`;
  }

  // 强制使用 43111 端口（覆盖任何其他配置）
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
      result = `${protocol}//${hostname}:43111/api`;
  }
  
  log('Final Result', result);
  return result;
})();

export const getUserId = () => {
  if (typeof window === 'undefined') return 'global';
  // Try localStorage first for synchronous access (fallback)
  // migrated data should be synced to localStorage during migrateLegacyLoginData
  return localStorage.getItem('starfit_user_id') || 'global';
};

/**
 * Async version of getUserId that reads from IDB
 * Use this for initial load where async is acceptable
 */
export async function getUserIdAsync(): Promise<string> {
  try {
    const creds = await loadLoginCredentials();
    return creds.userId || 'global';
  } catch (e) {
    console.warn('[GeminiService] Failed to load userId from IDB, using fallback:', e);
    return getUserId(); // Fallback to sync version
  }
}

/**
 * Get API base URL from IDB with fallback to current detection logic
 * Returns the current API_BASE for backward compatibility
 */
export async function getApiBase(): Promise<string> {
  try {
    const creds = await loadLoginCredentials();
    if (creds.serverUrl) {
      return creds.serverUrl;
    }
  } catch (e) {
    console.warn('[GeminiService] Failed to load serverUrl from IDB, using fallback:', e);
  }
  return API_BASE; // Fallback to current sync API_BASE
}

export const getHeaders = (extra: Record<string, string> = {}, includeContentType = true) => {
  const userId = getUserId();
  const headers: Record<string, string> = {
    // Encode userId to handle non-ASCII characters (e.g., Chinese) in headers
    // Browsers throw if headers contain non ISO-8859-1 characters
    'X-User-Id': encodeURIComponent(userId),
    ...extra
  };
  if (includeContentType) {
    headers['Content-Type'] = 'application/json';
  }
  return headers;
};

export const setApiBase = (url: string) => {
    if (!url) return;
    url = url.trim();
    if (!url.startsWith('http')) {
        alert('Invalid URL. Must start with http:// or https://');
        return;
    }
    
    // Ensure it ends with /api
    if(!url.endsWith('/api')) {
        url = url.replace(/\/$/, '') + '/api';
    }
    
    localStorage.setItem('STARFIT_API_BASE', url);
    console.log('[API_BASE] Saved to localStorage:', url);
    
    // Use a small delay before reload to ensure storage is flushed
    alert('API 地址已更新为: ' + url + '\n应用即将重启。');
    setTimeout(() => {
        window.location.href = window.location.origin + window.location.pathname + '?t=' + Date.now();
    }, 100);
};

export const checkServiceHealth = async (): Promise<{ ok: boolean; message: string }> => {
  try {
    // According to docs/TESTING_GUIDE.md and backend/infra/nginx.conf, health endpoint is /healthz
    // We try /healthz first, then fallback to /health if needed
    const healthUrl = API_BASE.replace(/\/api$/, '') + '/healthz';
    const res = await fetch(healthUrl, {
      method: 'GET',
      headers: getHeaders({}, false)
    });
    if (res.ok) return { ok: true, message: 'Service is online' };
    return { ok: false, message: `HTTP Error ${res.status}` };
  } catch (e: any) {
    return { ok: false, message: e.message || 'Connection failed' };
  }
};

// [NEW] Resolve Context from Backend (Admin/Debug)
export const resolveRemoteContext = async (userId: string, scenario: string, userInput?: string): Promise<any> => {
  const res = await fetch(`${API_BASE}/admin/resolve-context`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ userId, scenario, userInput })
  });
  if (!res.ok) throw new Error(`ResolveContext Failed: ${res.status}`);
  return res.json();
};

// --- Helper Functions ---
function getClient(): any {
  return null as any;
}
// --- Robust Retry Utility ---
async function withRetry<T>(
    operation: (signal?: AbortSignal) => Promise<T>, 
    maxRetries: number = 4, 
    baseDelay: number = 3000,
    operationName: string = "Operation",
    timeoutMs: number = 30000 // 30s default timeout
): Promise<T> {
    let lastError: any;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const result = await operation(controller.signal);
            clearTimeout(timeoutId);
            return result;
        } catch (error: any) {
            clearTimeout(timeoutId);
            lastError = error;
            
            if (error.name === 'AbortError') {
              console.error(`[${operationName}] Request timed out after ${timeoutMs}ms`);
            }

            const status = error.status || error.code;
            const msg = error.message || "";
            
            // Retry on 503 (Service Unavailable), 500 (Internal Error), 429 (Too Many Requests), or "overloaded" message
            const isRetryable = status === 503 || status === 500 || status === 429 || msg.includes('overloaded') || msg.includes('Internal Server Error');
            
            if (isRetryable && attempt < maxRetries) {
                // Exponential Backoff with Jitter: base * 2^attempt + random jitter
                const delay = baseDelay * Math.pow(2, attempt) + (Math.random() * 1000);
                console.warn(`[${operationName}] Failed with ${status}. Retrying in ${Math.floor(delay)}ms (Attempt ${attempt + 1}/${maxRetries})...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }
            // If not retryable or max retries reached, throw
            throw error;
        }
    }
    throw lastError;
}

/**
 * [NEW] MAS Chat with Multi-Agent Support, HITL, and UI Hints
 */
export const masChat = async (params: {
  message?: string;
  sessionId?: string;
  scenario?: string;
  interrupt_id?: string;
  payload?: any;
  metadata?: any;
  thread_id?: string;  // [FIX] 新增 thread_id 参数，支持多对话隔离
}): Promise<any> => {
  try {
    const data = await withRetry(async (signal) => {
      const res = await fetch(`${API_BASE}/mas/chat`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          ...params,
          userId: getUserId()
        }),
        signal
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    }, 2, 1000, "MasChatAPI", 300000);  // 300s timeout (5分钟) for complex MAS plan generation with multiple LLM calls
    return data;
  } catch (error) {
    console.error("MAS Chat Error:", error);
    throw error;
  }
};

// [NEW] Generate Tutorial Card Content
export const getExerciseTutorial = async (exerciseName: string, config: AiConfig = DEFAULT_AI_CONFIG, context?: any): Promise<string> => {
  try {
    const lang = "zh";
    const hit = await loadTutorialCache(exerciseName, lang);
    const now = Date.now();
    if (hit && hit.expiresAt > now) {
      return hit.markdown;
    }
    const url = `${API_BASE}/tutorial?name=${encodeURIComponent(exerciseName)}&lang=${lang}`;
    const data = await withRetry(async (signal) => {
      const res = await fetch(url, { 
        method: 'POST', // Changed to POST to support sending context
        headers: getHeaders(),
        body: JSON.stringify({ context }),
        signal
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    }, 2, 1000, "TutorialAPI");
    const markdown = data.markdown || "No content generated.";
    const cache = {
      key: `${exerciseName}:${lang}`,
      markdown,
      source: data.source || "internal",
      cachedAt: now,
      expiresAt: now + 7 * 24 * 60 * 60 * 1000
    };
    await saveTutorialCache(exerciseName, lang, cache);
    return markdown;
  } catch (error) {
    console.error("Tutorial Gen Error:", error);
    return "Failed to load tutorial. Please check your network.";
  }
};

interface AiMetrics {
    weight?: number;
    duration?: number;
    distance?: number;
    reps?: number;
}

// Background Calculation (Agent Mode - CALC scenario)
export const predictMetrics = async (exerciseName: string, type: string, targetRpe: number, config: AiConfig = DEFAULT_AI_CONFIG): Promise<AiMetrics> => {
    // Note: For extreme speed, we might still use heuristics, but here is the logic if we wanted to use the CALC model.
    // However, to keep the UI snappy (debounce is 500ms), we might stick to local heuristics OR use the fastest possible flash model.
    
    // For this implementation, I will keep the heuristic logic as a fallback, 
    // but conceptually this would use config.models[AiScenario.CALC].
    
    // ... Existing heuristic logic ...
    const lowerName = exerciseName.toLowerCase();
    const result: AiMetrics = {};

    if (type === 'cardio') {
        if (targetRpe <= 6) { result.duration = 20; result.distance = 3; }
        else if (targetRpe <= 8) { result.duration = 30; result.distance = 5; }
        else { result.duration = 45; result.distance = 8; }
        return result;
    }

    if (type === 'isometric') {
        let duration = 30;
        if (targetRpe >= 8) duration = 45;
        if (targetRpe >= 9) duration = 60;
        result.weight = 0;
        result.duration = duration;
        return result;
    }

    if (type === 'bodyweight') {
        result.weight = 0;
        result.reps = Math.floor(targetRpe * 1.5) + 5; 
        return result;
    }

    if (type === 'reps_only') {
        result.reps = Math.floor(targetRpe * 2) + 8;
        return result;
    }

    if (type === 'weight_only') {
        let base = 20;
        if (lowerName.includes('deadlift') || lowerName.includes('硬拉')) base = 120;
        else if (lowerName.includes('squat') || lowerName.includes('深蹲')) base = 100;
        else if (lowerName.includes('bench') || lowerName.includes('卧推')) base = 80;
        else base = 40;

        const rpeModifier = 1 + ((targetRpe - 5) * 0.05);
        result.weight = Math.round(base * rpeModifier / 2.5) * 2.5;
        return result;
    }

    let base = 20; 
    if (lowerName.includes('bench') || lowerName.includes('卧推')) base = 60;
    if (lowerName.includes('squat') || lowerName.includes('深蹲')) base = 80;
    if (lowerName.includes('deadlift') || lowerName.includes('硬拉')) base = 100;
    if (lowerName.includes('dumb') || lowerName.includes('哑铃')) base = 15;
    if (lowerName.includes('curl') || lowerName.includes('弯举')) base = 10;
    if (lowerName.includes('raise') || lowerName.includes('平举')) base = 5;

    const rpeModifier = 1 + ((targetRpe - 5) * 0.05);
    result.weight = Math.round(base * rpeModifier / 2.5) * 2.5; 
    
    // Add Reps suggestion for standard resistance exercises
    if (targetRpe >= 9) result.reps = 3;
    else if (targetRpe >= 8) result.reps = 5;
    else if (targetRpe >= 7) result.reps = 8;
    else result.reps = 12;

    return result;
};

// [UPDATED] Generate Workout Image with Config Routing + Robust Retry
export const generateWorkoutImage = async (
  sessionData: string, 
  dateStr: string,
  config: AiConfig = DEFAULT_AI_CONFIG
): Promise<string | null> => {
  try {
    const payload = {
      session: {
        Nickname: "ANONYMOUS",
        Date: dateStr,
        Duration: "—",
        Workout_List: sessionData
      },
      templateKey: "Industrial_Dark"
    };
    const data = await withRetry(async (signal) => {
      const res = await fetch(`${API_BASE}/agent/image`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(payload),
        signal
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    }, 3, 2000, "ImageAPI", 60000);
    return data.dataUrl || null;
  } catch (error: any) {
    console.error("Image Gen Error:", error);
    throw error; // Propagate for UI handling
  }
};

// 新增：将 dataUrl 上传到后端媒体服务，返回可持久化访问的 URL
export const uploadMediaFromDataUrl = async (dataUrl: string): Promise<{ id: string; url: string } | null> => {
  try {
    const payload = { dataUrl };
    const data = await withRetry(async (signal) => {
      const res = await fetch(`${API_BASE}/media/uploadData`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify(payload),
        signal
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    }, 2, 800, "MediaUpload");
    return { id: data.id, url: data.url };
  } catch (err) {
    console.error("Media Upload Error:", err);
    return null;
  }
};

// [NEW] Summarize History using AI (Layer 3)
export const summarizeHistory = async (history: Session[], config: AiConfig): Promise<string> => {
  // Use backend API instead of deprecated client
  try {
    const data = await withRetry(async (signal) => {
      const res = await fetch(`${API_BASE}/history/summary`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ history }), // Simplified payload, backend handles processing usually
        signal
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    }, 2, 1000, "HistorySum");
    return data.text || "Failed to generate summary.";
  } catch (error) {
    console.error("History Summary Error:", error);
    return "Error generating summary.";
  }
};

// [NEW] Generate Workout Strategy (Layer 2 - Mid/Long term memory)
export const generateStrategy = async (history: Session[], config: AiConfig): Promise<string> => {
    // Use backend API
    try {
      const data = await withRetry(async (signal) => {
        const res = await fetch(`${API_BASE}/strategy`, {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify({ history }),
          signal
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      }, 2, 1000, "StrategyGen");
      return data.text || "Failed to generate strategy.";
    } catch (error) {
      console.error("Strategy Gen Error:", error);
      return "Error generating strategy.";
    }
}
