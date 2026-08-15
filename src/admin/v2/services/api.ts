import { API_BASE, getHeaders } from './geminiService';
import { Exercise, User, VideoTask } from './types';
import { z } from 'zod';
import {
  zAdminAIConfig,
  zAdminHealth,
  zAdminLogs,
  zAdminProxyConfig,
  zAdminUsers,
  zAdminCapabilities,
  zExercise,
  zExercises,
  zModelConfigResponse,
  zImageGenConfigResponse,
  zDashboardLatestTraining,
  zDashboardServerInfo,
  zDashboardExerciseStats,
} from './contracts';

// Import profile types from shared contracts (data contract compliance)
import type {
  BasicInfo,
  Preferences,
  Physiological,
  Psychological,
  LoadAnchors,
  ActiveLimitation,
  RecoveryState,
  Trends,
  KeyMetrics,
  PermanentInjury,
} from 'shared/contracts';

type ApiErrorDetails = {
  status: number;
  endpoint: string;
  message: string;
};

class ApiError extends Error {
  details: ApiErrorDetails;
  constructor(details: ApiErrorDetails) {
    super(details.message);
    this.details = details;
  }
}

// API Response wrapper (for admin endpoints)
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// Profile response type (from /profiles/:userId endpoint - returns flat profile directly)
// Extended with proper types from shared/contracts for type safety
export interface FlattenedProfile {
  // Core fields
  user_id: string;
  fitness_level: 'beginner' | 'intermediate' | 'advanced';

  // Static data (profile_static)
  basic_info?: BasicInfo;
  preferences?: Preferences;
  physiological?: Physiological;
  psychological?: Psychological;
  permanent_injuries?: PermanentInjury[];

  // Dynamic data (profile_dynamic)
  load_anchors?: LoadAnchors;
  active_limitations?: ActiveLimitation[];
  recovery_state?: RecoveryState | null;

  // History summary (history_summary)
  trends?: Trends;
  key_metrics?: KeyMetrics;

  // Other fields
  training_strategy?: string | null;
  red_flags?: string[];
  tags?: string[];

  // Metadata
  created_at?: string;
  updated_at?: string;
}

// Stats response type
interface UserStats {
  session_count?: number;
  total_volume?: number;
  [key: string]: unknown;
}

// Session data type
interface UserSession {
  id: string;
  user_id: string;
  status: string;
  start_time: string;
  end_time?: string;
  [key: string]: unknown;
}

function toAbsoluteUrl(endpoint: string) {
  return endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;
}

async function readErrorMessage(res: Response) {
  try {
    const data = await res.json();
    const msg = data?.error || data?.message || res.statusText;
    return typeof msg === 'string' ? msg : res.statusText;
  } catch {
    return res.statusText;
  }
}

async function requestJson<T>(endpoint: string, options: RequestInit = {}, timeoutMs = 20_000): Promise<T> {
  const url = toAbsoluteUrl(endpoint);
  const hasBody = options.body !== undefined && options.body !== null && String(options.body).length > 0;
  const defaultHeaders = getHeaders({}, hasBody);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        ...defaultHeaders,
        ...options.headers,
      },
    });
    if (!res.ok) {
      const msg = await readErrorMessage(res);
      throw new ApiError({ status: res.status, endpoint, message: msg });
    }
    if (res.status === 204) return {} as T;
    return (await res.json()) as T;
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      throw new ApiError({ status: 0, endpoint, message: '请求超时' });
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function requestForm<T>(endpoint: string, formData: FormData, timeoutMs = 60_000): Promise<T> {
  const url = toAbsoluteUrl(endpoint);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: getHeaders({}, false),
      body: formData,
    });
    if (!res.ok) {
      const msg = await readErrorMessage(res);
      throw new ApiError({ status: res.status, endpoint, message: msg });
    }
    return (await res.json()) as T;
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      throw new ApiError({ status: 0, endpoint, message: '请求超时' });
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export const AdminService = {
  exercises: {
    list: async () => zExercises.parse(await requestJson<unknown>('/exercises')) as unknown as Exercise[],
    get: async (id: string) => zExercise.parse(await requestJson<unknown>(`/exercises/${id}`)) as unknown as Exercise,
    create: async (data: Record<string, unknown>) =>
      zExercise.parse(await requestJson<unknown>('/exercises', { method: 'POST', body: JSON.stringify(data) })) as unknown as Exercise,
    update: async (id: string, data: Record<string, unknown>) =>
      zExercise.parse(await requestJson<unknown>(`/exercises/${id}`, { method: 'PUT', body: JSON.stringify(data) })) as unknown as Exercise,
    delete: (id: string) => requestJson<{ success: boolean }>(`/exercises/${id}`, { method: 'DELETE' }),
  },
  
  users: {
    list: async () => zAdminUsers.parse(await requestJson<unknown>('/admin/users')) as unknown as User[],
    getStats: (userId: string) => requestJson<UserStats>(`/admin/stats/${userId}`),
    getProfile: (userId: string) => requestJson<FlattenedProfile>(`/profiles/${userId}`),
    getSessions: (userId: string, limit?: number, offset?: number) => {
      const queryParams = new URLSearchParams();
      if (limit !== undefined) queryParams.append('limit', String(limit));
      if (offset !== undefined) queryParams.append('offset', String(offset));
      const params = queryParams.toString();
      return requestJson<UserSession[]>(`/admin/users/${userId}/sessions${params ? '?' + params : ''}`);
    },
    updateProfile: (userId: string, data: Partial<FlattenedProfile>) =>
      requestJson<{ profile: FlattenedProfile }>(`/profiles/${userId}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (userId: string) => requestJson<{ success: boolean }>(`/admin/users/${userId}`, { method: 'DELETE' }),
    deleteSession: (sessionId: string) => requestJson<{ success: boolean }>(`/admin/sessions/${sessionId}`, { method: 'DELETE' }),
    batchDelete: (userIds: string[]) => requestJson<{ success: boolean; deleted: number; failed?: number; errors?: Array<{ userId: string; error: string }> }>('/admin/users/batch-delete', { method: 'POST', body: JSON.stringify({ userIds }) }),
    exportMarkdown: (userId: string, startDate?: string, endDate?: string) => {
      const params = new URLSearchParams();
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      return requestJson<{ markdown: string; metadata: Record<string, unknown> }>(`/admin/users/${userId}/export-markdown?${params.toString()}`);
    },
    // Update user display name (set by admin)
    updateDisplayName: (userId: string, displayName: string) =>
      requestJson<{ success: boolean; message?: string; data?: { displayName: string }; error?: string }>(`/admin/users/${userId}/display-name`, { method: 'PUT', body: JSON.stringify({ displayName }) }),
  },

  configs: {
    getAll: async () => requestJson<Record<string, unknown>>('/admin/configs'),
    get: async (key: string) => requestJson<{ user_id: string; key: string; value: unknown; updated_at: number }>(`/admin/configs/${key}`),
    set: async (key: string, value: unknown) => requestJson<{ success: boolean; key: string; value: unknown }>('/admin/configs', { method: 'POST', body: JSON.stringify({ key, value }) }),
    getPinnedUsers: async () => requestJson<{ pinned_users: string[] }>('/admin/configs/pinned-users'),
    setPinnedUsers: async (userIds: string[]) => requestJson<{ success: boolean; pinned_users: string[] }>('/admin/configs/pinned-users', { method: 'POST', body: JSON.stringify({ userIds }) }),
    togglePinnedUser: async (userId: string) => requestJson<{ success: boolean; is_pinned: boolean; pinned_users: string[] }>('/admin/configs/pinned-users/toggle', { method: 'POST', body: JSON.stringify({ userId }) }),
  },

  videos: {
    upload: (file: File, exerciseId: string) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('exerciseId', exerciseId);
      return requestForm<ApiResponse<{ task_id: string; status: string; taskId: string; exerciseId: string; originalVideoUrl: string }>>('/videos/upload', formData);
    },
    listTasks: () => requestJson<VideoTask[]>('/videos/tasks'),
  },

  media: {
    upload: (file: File): Promise<{ id: string; url: string; mimeType: string }> => {
      const formData = new FormData();
      formData.append('file', file);
      return requestForm<{ id: string; url: string; mimeType: string }>('/media/upload', formData);
    },
  },

  system: {
    getProxy: async () => zAdminProxyConfig.parse(await requestJson<unknown>('/admin/proxy')),
    updateProxy: (config: Record<string, unknown>) =>
      requestJson<{ success: boolean }>('/admin/proxy', { method: 'POST', body: JSON.stringify(config) }),
    testProxy: (url: string, provider?: string, proxyUrl?: string) => {
        const params = new URLSearchParams({ url, provider: provider || '', proxyUrl: proxyUrl || '' });
        return requestJson<ApiResponse<{ latency?: number; error?: string }>>(`/admin/proxy/test?${params.toString()}`);
    },
    getIpInfo: (provider?: string) => {
        const params = new URLSearchParams({ provider: provider || '' });
        return requestJson<ApiResponse<{ ip: string; country?: string }>>(`/admin/proxy/ip-info?${params.toString()}`);
    },
    getHealth: async () => zAdminHealth.parse(await requestJson<unknown>('/admin/health')),
    getCapabilities: async () => zAdminCapabilities.parse(await requestJson<unknown>('/admin/capabilities')),
    getLogs: (limit?: number, level?: string) => {
        const params = new URLSearchParams();
        if (limit) params.append('limit', String(limit));
        if (level) params.append('level', level);
        return requestJson<unknown>(`/admin/logs?${params.toString()}`).then((data) => zAdminLogs.parse(data));
    },
    restart: () => requestJson<{ success: boolean; message: string }>('/admin/restart', { method: 'POST' }),
    backup: () => requestJson<{ success: boolean; message: string; file: string }>('/admin/backup', { method: 'POST' }),
    emergencyStop: () => requestJson<{ success: boolean; message: string }>('/admin/emergency-stop', { method: 'POST' }),
    getAIConfig: async () => zAdminAIConfig.parse(await requestJson<unknown>('/admin/ai-config')),
    updateAIConfig: (config: Record<string, unknown>) =>
      requestJson<{ success: boolean; message: string }>('/admin/ai-config', { method: 'POST', body: JSON.stringify(config) }),
    getModelConfig: async () => zModelConfigResponse.parse(await requestJson<unknown>('/admin/model-config')),
    updateModelConfig: (task: string, provider: string, model: string, baseURL?: string) =>
      requestJson<{ success: boolean; message: string }>('/admin/model-config', {
        method: 'POST',
        body: JSON.stringify({ task, provider, model, baseURL })
      }),
    testModelConnection: (provider: string, model: string, baseURL?: string) => {
      const params = new URLSearchParams({ provider, model });
      if (baseURL) params.append('baseURL', baseURL);
      return requestJson<{ success: boolean; latency?: number; error?: string }>(`/admin/model-config/test?${params.toString()}`);
    }
  },

  dashboard: {
    getLatestTraining: async () => zDashboardLatestTraining.parse(await requestJson<unknown>('/admin/dashboard/latest-training')),
    getServerInfo: async () => zDashboardServerInfo.parse(await requestJson<unknown>('/admin/server-info')),
    getExerciseStats: async () => zDashboardExerciseStats.parse(await requestJson<unknown>('/admin/dashboard/exercises/stats')),
  },

  imageGen: {
    getConfig: async () => zImageGenConfigResponse.parse(await requestJson<unknown>('/admin/image-gen-config')),
    updateConfig: (provider: string, model: string, baseURL?: string) =>
      requestJson<{ success: boolean }>('/admin/image-gen-config', {
        method: 'POST',
        body: JSON.stringify({ provider, model, baseURL }),
      }),
    testConnection: (provider: string, model: string, baseURL?: string) => {
      const params = new URLSearchParams({ provider, model });
      if (baseURL) params.append('baseURL', baseURL);
      return requestJson<{ success: boolean; latency?: number; error?: string }>(`/admin/image-gen-config/test?${params.toString()}`);
    },
  },
};
