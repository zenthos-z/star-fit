/**
 * AdminConfigService — App 端读取 Agent 系统配置（只读 + 测试连接）。
 *
 * 后端配置链路：app_configs 表（user_id='system'）→ ConfigRepo，DB > env > default，
 * 解析唯一真源在 backend/src/services/modelConfigService.ts。
 * App 端只读展示 /admin/model-config（provider/model/baseURL），不暴露 key 明文
 * （后端只回传 *_SET 布尔）。测试连接走 /admin/model-config/test。
 *
 * 注意：这些是 admin 命名空间接口，后端鉴权仅 X-Access-Token 无角色区分；
 * 展示时只读、不回写（写权限留在 admin 后台）。
 */

import { API_BASE, getHeaders } from '../services/geminiService';

export interface ModelTaskConfig {
  provider: string;
  model: string;
  baseURL?: string;
}

export interface ModelConfigResponse {
  tasks: Record<string, ModelTaskConfig>;
  availableModels?: Record<string, string[]>;
}

export interface TestConnectionResult {
  success: boolean;
  latency?: number;
  error?: string;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...getHeaders({}, false), ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${path} 失败: ${res.status} ${text.slice(0, 120)}`);
  }
  return res.json() as Promise<T>;
}

export const AdminConfigService = {
  /** 读取当前 Agent 模型配置（各任务 provider/model/baseURL） */
  getModelConfig(): Promise<ModelConfigResponse> {
    return requestJson<ModelConfigResponse>('/admin/model-config');
  },

  /** 测试指定 provider+model 的连接（返回成功/延迟/错误信息） */
  testModelConnection(
    provider: string,
    model: string,
    baseURL?: string
  ): Promise<TestConnectionResult> {
    const params = new URLSearchParams({ provider, model });
    if (baseURL) params.append('baseURL', baseURL);
    return requestJson<TestConnectionResult>(`/admin/model-config/test?${params.toString()}`);
  },
};

export default AdminConfigService;
