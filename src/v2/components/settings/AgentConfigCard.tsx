/**
 * AgentConfigCard — Agent 配置只读展示（设置页「Agent 与运行环境」区）。
 *
 * 从后端 /admin/model-config 读取当前各任务 provider/model/baseURL，
 * 提供「测试连接」按钮（/admin/model-config/test）。
 * 只读不回写——模型/密钥配置的修改入口在管理后台（admin）。
 *
 * @version 2.0.0
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  AdminConfigService,
  type ModelConfigResponse,
  type TestConnectionResult,
} from '../../../services/adminConfigService';

// ============================================================================
// Constants
// ============================================================================

const PROVIDER_LABELS: Record<string, string> = {
  gemini: 'Gemini',
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  glm: 'GLM',
};

function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] || provider;
}

// ============================================================================
// Main Component
// ============================================================================

export function AgentConfigCard(): JSX.Element {
  const [config, setConfig] = useState<ModelConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await AdminConfigService.getModelConfig();
      setConfig(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取配置失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onTest = useCallback(async () => {
    const def = config?.tasks?.default;
    if (!def || !def.provider || !def.model || testing) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await AdminConfigService.testModelConnection(def.provider, def.model, def.baseURL);
      setTestResult(result);
    } catch (e) {
      setTestResult({ success: false, error: e instanceof Error ? e.message : '测试失败' });
    } finally {
      setTesting(false);
    }
  }, [config, testing]);

  const def = config?.tasks?.default;

  return (
    <div className="bg-white rounded-[24px] shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-gray-900 tracking-tight">Agent 配置</h2>
        <span className="text-[10px] text-gray-400 font-medium">修改请前往管理后台</span>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-8">
          <div className="inline-block h-6 w-6 animate-spin rounded-full border-4 border-solid border-current border-r-transparent text-star-accent" />
        </div>
      )}

      {error && !loading && (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 break-words [overflow-wrap:anywhere]">
          {error}
        </div>
      )}

      {!loading && !error && def && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">模型服务</span>
            <span className="text-sm font-semibold text-gray-900">{providerLabel(def.provider)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">模型</span>
            <span className="text-sm font-semibold text-gray-900 font-mono text-right break-all">{def.model}</span>
          </div>
          {def.baseURL && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">接入地址</span>
              <span className="text-xs text-gray-600 font-mono text-right break-all max-w-[220px]">{def.baseURL}</span>
            </div>
          )}

          <div className="flex items-center gap-3 pt-3 border-t border-gray-100">
            <button
              onClick={onTest}
              disabled={testing}
              className="rounded-full bg-star-accent px-5 py-2 text-sm font-semibold text-white
                         hover:bg-star-accent/90 disabled:opacity-50 transition-colors"
            >
              {testing ? '测试中…' : '测试连接'}
            </button>
            {testResult && (
              <span className={`text-xs font-medium ${testResult.success ? 'text-green-600' : 'text-red-600'}`}>
                {testResult.success
                  ? `连接正常${testResult.latency ? `（${testResult.latency}ms）` : ''}`
                  : `失败：${testResult.error || '未知错误'}`}
              </span>
            )}
          </div>
        </div>
      )}

      {!loading && !error && !def && (
        <p className="text-sm text-gray-500">暂无模型配置</p>
      )}
    </div>
  );
}

export default AgentConfigCard;
