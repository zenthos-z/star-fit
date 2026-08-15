import React, { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { AdminService } from '../../services/api';
import { ImageGenConfigResponse, ModelConfigResponse } from '../../services/contracts';
import { Globe, Cpu, Save, CheckCircle, XCircle, Loader, Image, Eye } from 'lucide-react';

interface ProxyConfig {
  GLOBAL_PROXY: string;
  GEMINI_PROXY: string;
  OPENAI_PROXY: string;
  AI_PROVIDER: string;
  GOOGLE_API_KEY_SET: boolean;
  OPENAI_API_KEY_SET: boolean;
  DEEPSEEK_API_KEY_SET: boolean;
}

type SaveStatus = 'idle' | 'saving' | 'success' | 'error';

// Map a provider to its API key field on the proxy config (read *_SET status /
// write the raw key). Lets the model-config UI treat deepseek the same as
// gemini/openai without per-call ternaries.
const apiKeySetField = (provider: string): string =>
  provider === 'openai' ? 'OPENAI_API_KEY_SET' : provider === 'deepseek' ? 'DEEPSEEK_API_KEY_SET' : 'GOOGLE_API_KEY_SET';
const apiKeyField = (provider: string): string =>
  provider === 'openai' ? 'OPENAI_API_KEY' : provider === 'deepseek' ? 'DEEPSEEK_API_KEY' : 'GOOGLE_API_KEY';

export const SettingsPage: React.FC = () => {
  // Proxy Config State
  const [proxyConfig, setProxyConfig] = useState<ProxyConfig>({
    GLOBAL_PROXY: '',
    GEMINI_PROXY: '',
    OPENAI_PROXY: '',
    AI_PROVIDER: 'gemini',
    GOOGLE_API_KEY_SET: false,
    OPENAI_API_KEY_SET: false,
    DEEPSEEK_API_KEY_SET: false
  });
  const [googleApiKeyInput, setGoogleApiKeyInput] = useState('');
  const [openaiApiKeyInput, setOpenaiApiKeyInput] = useState('');

  // ==========================================
  // Language Model Config (Agent)
  // ==========================================
  const [modelConfig, setModelConfig] = useState<ModelConfigResponse | null>(null);
  const [defaultProvider, setDefaultProvider] = useState<'gemini' | 'openai' | 'deepseek'>('deepseek');
  const [defaultModel, setDefaultModel] = useState('');
  const [defaultCustomModel, setDefaultCustomModel] = useState('');
  const [defaultBaseURL, setDefaultBaseURL] = useState('');
  const [defaultIsCustomModel, setDefaultIsCustomModel] = useState(false);
  const [defaultApiKeyInput, setDefaultApiKeyInput] = useState('');
  const [defaultApiKeySet, setDefaultApiKeySet] = useState(false);

  // ==========================================
  // Image Generation Model Config
  // ==========================================
  const [imageGenConfig, setImageGenConfig] = useState<ImageGenConfigResponse | null>(null);
  const [imageGenProvider, setImageGenProvider] = useState<'dmx' | 'openai'>('dmx');
  const [imageGenModel, setImageGenModel] = useState('');
  const [imageGenCustomModel, setImageGenCustomModel] = useState('');
  const [imageGenIsCustomModel, setImageGenIsCustomModel] = useState(false);
  const [imageGenBaseURL, setImageGenBaseURL] = useState('');
  const [imageGenApiKeyInput, setImageGenApiKeyInput] = useState('');
  const [imageGenApiKeySet, setImageGenApiKeySet] = useState(false);

  // ==========================================
  // UI State
  // ==========================================
  const [testResult, setTestResult] = useState<{ status: 'idle' | 'testing' | 'success' | 'error', latency?: number, error?: string }>({ status: 'idle' });
  const [imageTestResult, setImageTestResult] = useState<{ status: 'idle' | 'testing' | 'success' | 'error', latency?: number, error?: string }>({ status: 'idle' });
  const [savingProxy, setSavingProxy] = useState(false);
  const [savingDefault, setSavingDefault] = useState(false);
  const [savingImageGen, setSavingImageGen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [imageSaveStatus, setImageSaveStatus] = useState<SaveStatus>('idle');
  const [loadingModel, setLoadingModel] = useState(true);
  const [loadingImageGen, setLoadingImageGen] = useState(true);
  const [testingConnection, setTestingConnection] = useState(false);
  const [testingImageGen, setTestingImageGen] = useState(false);
  const [modelConfigError, setModelConfigError] = useState<string | null>(null);
  const [imageGenError, setImageGenError] = useState<string | null>(null);

  // ==========================================
  // API Key state for image gen (read via proxy config proxy)
  // ==========================================
  const [imageGenApiKeySetState, setImageGenApiKeySetState] = useState(false);

  useEffect(() => {
    loadProxyConfig();
    loadModelConfig();
    loadImageGenConfig();
  }, []);

  // ==========================================
  // Proxy Config
  // ==========================================
  const loadProxyConfig = async () => {
    try {
      const config = await AdminService.system.getProxy();
      setProxyConfig(config as ProxyConfig);
    } catch (e) {
      console.error(e);
    }
  };

  const handleSaveProxy = async () => {
    setSavingProxy(true);
    try {
      const payload: any = {
        GLOBAL_PROXY: proxyConfig.GLOBAL_PROXY,
        GEMINI_PROXY: proxyConfig.GEMINI_PROXY,
        OPENAI_PROXY: proxyConfig.OPENAI_PROXY
      };

      if (googleApiKeyInput.trim()) payload.GOOGLE_API_KEY = googleApiKeyInput.trim();
      if (openaiApiKeyInput.trim()) payload.OPENAI_API_KEY = openaiApiKeyInput.trim();

      await AdminService.system.updateProxy(payload);
      setGoogleApiKeyInput('');
      setOpenaiApiKeyInput('');
      await loadProxyConfig();
    } catch (e) {
      alert('保存失败');
    } finally {
      setSavingProxy(false);
    }
  };

  const handleTestProxy = async () => {
    setTestResult({ status: 'testing' });
    try {
      const start = Date.now();
      await AdminService.system.testProxy('https://www.google.com', defaultProvider, proxyConfig.GLOBAL_PROXY);
      setTestResult({ status: 'success', latency: Date.now() - start });
    } catch (e) {
      setTestResult({ status: 'error' });
    }
  };

  // ==========================================
  // Language Model Config (Agent)
  // ==========================================
  const loadModelConfig = async () => {
    setLoadingModel(true);
    setModelConfigError(null);
    try {
      const config = await AdminService.system.getModelConfig();
      if (!config || !config.tasks || !config.tasks.default) {
        throw new Error('Invalid model config response');
      }
      setModelConfig(config);

      const defaultConfig = config.tasks.default;
      setDefaultProvider(defaultConfig.provider);
      setDefaultModel(defaultConfig.model);
      setDefaultBaseURL(defaultConfig.baseURL || '');
      const defaultProviderModels = config.availableModels[defaultConfig.provider] || [];
      setDefaultIsCustomModel(!defaultProviderModels.includes(defaultConfig.model));

      // Load API Key status
      const proxyConfig = await AdminService.system.getProxy();
      const keySet = apiKeySetField(defaultConfig.provider);
      setDefaultApiKeySet((proxyConfig as Record<string, unknown>)[keySet] as boolean || false);
    } catch (e: any) {
      console.error('[SettingsPage] Failed to load model config:', e);
      setModelConfigError(e?.message || 'Failed to load model configuration');
    } finally {
      setLoadingModel(false);
    }
  };

  const handleDefaultProviderChange = async (newProvider: 'gemini' | 'openai' | 'deepseek') => {
    setDefaultProvider(newProvider);
    setDefaultIsCustomModel(false);
    setDefaultApiKeyInput('');
    setDefaultBaseURL(newProvider === 'deepseek' ? 'https://api.deepseek.com' : '');

    const fallbackModel = newProvider === 'gemini' ? 'gemini-3-flash-preview' : newProvider === 'deepseek' ? 'deepseek-v4-flash' : 'gpt-4o-mini';
    if (modelConfig) {
      setDefaultModel(modelConfig.availableModels[newProvider]?.[0] || fallbackModel);
    }

    try {
      const proxyConfig = await AdminService.system.getProxy();
      const keySet = apiKeySetField(newProvider);
      setDefaultApiKeySet((proxyConfig as Record<string, unknown>)[keySet] as boolean || false);
    } catch (e) {
      console.error('Failed to load API key status:', e);
    }
  };

  const handleDefaultModelChange = (newModel: string) => {
    if (newModel === 'custom') {
      setDefaultIsCustomModel(true);
      setDefaultModel(defaultCustomModel || '');
    } else {
      setDefaultIsCustomModel(false);
      setDefaultModel(newModel);
    }
  };

  const handleSaveDefault = async () => {
    const finalModel = defaultIsCustomModel ? defaultCustomModel.trim() : defaultModel.trim();
    if (!finalModel) {
      alert('请输入模型名称');
      return;
    }

    setSavingDefault(true);
    setSaveStatus('saving');

    try {
      const needsBaseUrl = defaultProvider === 'openai' || defaultProvider === 'deepseek';
      await AdminService.system.updateModelConfig(
        'default',
        defaultProvider,
        finalModel,
        needsBaseUrl ? defaultBaseURL.trim() || undefined : undefined
      );

      if (defaultApiKeyInput.trim()) {
        const keyName = apiKeyField(defaultProvider);
        await AdminService.system.updateProxy({
          [keyName]: defaultApiKeyInput.trim()
        });
      }

      setSaveStatus('success');
      setDefaultApiKeyInput('');
      setTimeout(() => setSaveStatus('idle'), 2000);
      await loadModelConfig();
    } catch (e: any) {
      setSaveStatus('error');
      alert(`保存失败: ${e.message}`);
      setTimeout(() => setSaveStatus('idle'), 2000);
    } finally {
      setSavingDefault(false);
    }
  };

  const handleTestConnection = async () => {
    const provider = defaultProvider;
    const finalModel = defaultIsCustomModel ? defaultCustomModel.trim() : defaultModel.trim();
    if (!finalModel) {
      alert('请输入模型名称');
      return;
    }

    setTestingConnection(true);
    try {
      const result = await AdminService.system.testModelConnection(
        provider,
        finalModel,
        provider === 'openai' ? defaultBaseURL.trim() || undefined : undefined
      );

      if (result.success) {
        setTestResult({ status: 'success', latency: result.latency });
      } else {
        setTestResult({ status: 'error', error: result.error });
      }
    } catch (e: any) {
      setTestResult({ status: 'error', error: e.message });
    } finally {
      setTestingConnection(false);
    }
  };

  // ==========================================
  // Image Generation Model Config
  // ==========================================
  const loadImageGenConfig = async () => {
    setLoadingImageGen(true);
    setImageGenError(null);
    try {
      const config = await AdminService.imageGen.getConfig();
      setImageGenConfig(config);

      // Set current values from API response
      const currentConfig = config.config;
      setImageGenProvider(currentConfig.provider);
      setImageGenModel(currentConfig.model);
      setImageGenBaseURL(currentConfig.baseURL || '');

      const providerModels = config.availableModels[currentConfig.provider] || [];
      setImageGenIsCustomModel(!providerModels.includes(currentConfig.model));
    } catch (e: any) {
      console.error('[SettingsPage] Failed to load image gen config:', e);
      setImageGenError(e?.message || 'Failed to load image generation config');
    } finally {
      setLoadingImageGen(false);
    }
  };

  const handleImageGenProviderChange = (newProvider: 'dmx' | 'openai') => {
    setImageGenProvider(newProvider);
    setImageGenIsCustomModel(false);
    setImageGenModel('');

    if (imageGenConfig) {
      const models = imageGenConfig.availableModels[newProvider] || [];
      setImageGenModel(models[0] || '');
    }
  };

  const handleImageGenModelChange = (newModel: string) => {
    if (newModel === 'custom') {
      setImageGenIsCustomModel(true);
      setImageGenModel(imageGenCustomModel || '');
    } else {
      setImageGenIsCustomModel(false);
      setImageGenModel(newModel);
    }
  };

  const handleSaveImageGen = async () => {
    const finalModel = imageGenIsCustomModel ? imageGenCustomModel.trim() : imageGenModel.trim();

    setSavingImageGen(true);
    setImageSaveStatus('saving');

    try {
      await AdminService.imageGen.updateConfig(
        imageGenProvider,
        finalModel,
        imageGenBaseURL.trim() || undefined
      );

      setImageSaveStatus('success');
      setTimeout(() => setImageSaveStatus('idle'), 2000);
      await loadImageGenConfig();
    } catch (e: any) {
      setImageSaveStatus('error');
      alert(`保存失败: ${e.message}`);
      setTimeout(() => setImageSaveStatus('idle'), 2000);
    } finally {
      setSavingImageGen(false);
    }
  };

  const handleTestImageGenConnection = async () => {
    const finalModel = imageGenIsCustomModel ? imageGenCustomModel.trim() : imageGenModel.trim();

    setTestingImageGen(true);
    try {
      const result = await AdminService.imageGen.testConnection(
        imageGenProvider,
        finalModel,
        imageGenBaseURL.trim() || undefined
      );

      if (result.success) {
        setImageTestResult({ status: 'success', latency: result.latency });
      } else {
        setImageTestResult({ status: 'error', error: result.error });
      }
    } catch (e: any) {
      setImageTestResult({ status: 'error', error: e.message });
    } finally {
      setTestingImageGen(false);
    }
  };

  const renderSourceBadge = (source: 'db' | 'env' | 'default') => {
    const colors = {
      db: 'bg-purple-100 text-purple-700 border-purple-200',
      env: 'bg-blue-100 text-blue-700 border-blue-200',
      default: 'bg-gray-100 text-gray-700 border-gray-200'
    };
    const labels = {
      db: '数据库',
      env: '环境变量',
      default: '默认值'
    };
    return (
      <span className={`px-2 py-0.5 text-xs rounded border ${colors[source]}`}>
        {labels[source]}
      </span>
    );
  };

  // ==========================================
  // Render
  // ==========================================
  return (
    <div className="max-w-4xl mx-auto space-y-6" data-testid="admin-settings">
      {/* ========== Language Model Configuration (Agent) ========== */}
      <Card className="p-6">
        <div className="flex items-start gap-4 mb-6">
          <div className="p-3 bg-purple-50 text-purple-600 rounded-xl">
            <Cpu size={24} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-900">语言模型配置</h3>
            <p className="text-sm text-gray-500">配置 Agent 系统使用的语言模型，默认 DeepSeek</p>
          </div>
        </div>

        {loadingModel ? (
          <div className="flex items-center justify-center py-8">
            <Loader size={24} className="animate-spin text-purple-500" />
          </div>
        ) : modelConfigError ? (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-600">加载失败: {modelConfigError}</p>
            <button
              onClick={loadModelConfig}
              className="mt-2 text-sm text-red-600 underline hover:no-underline"
            >
              重试
            </button>
          </div>
        ) : modelConfig ? (
          <div className="space-y-4">
            {/* Provider */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  提供商
                  {modelConfig.tasks.default && renderSourceBadge(modelConfig.tasks.default.source)}
                </label>
                <select
                  value={defaultProvider}
                  onChange={e => handleDefaultProviderChange(e.target.value as 'gemini' | 'openai' | 'deepseek')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none bg-white"
                  data-testid="default-provider-select"
                >
                  <option value="deepseek">DeepSeek（官方）</option>
                  <option value="gemini">Google Gemini</option>
                  <option value="openai">OpenAI / 兼容模式</option>
                </select>
              </div>
            </div>

            {/* Model Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">模型</label>
              <select
                value={defaultIsCustomModel ? 'custom' : defaultModel}
                onChange={e => handleDefaultModelChange(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none bg-white"
                data-testid="default-model-select"
              >
                <>
                  {(modelConfig.availableModels[defaultProvider] || []).map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                  <option value="custom">自定义模型...</option>
                </>
              </select>

              {defaultIsCustomModel && (
                <input
                  type="text"
                  value={defaultCustomModel}
                  onChange={e => setDefaultCustomModel(e.target.value)}
                  placeholder="例如: glm-4-plus, qwen-turbo, deepseek-chat"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-star-accent/20 outline-none mt-2"
                  data-testid="default-custom-model"
                />
              )}
            </div>

            {/* API Key */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {defaultProvider === 'gemini' ? 'Google API Key' : defaultProvider === 'deepseek' ? 'DeepSeek API Key' : 'OpenAI API Key'}
              </label>
              <div className="text-xs text-gray-500 mb-1">
                {defaultApiKeySet ? '已配置' : '未配置'}
              </div>
              <input
                type="password"
                value={defaultApiKeyInput}
                onChange={e => setDefaultApiKeyInput(e.target.value)}
                placeholder={defaultApiKeySet ? '输入新Key以更新' : '输入API Key'}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-star-accent/20 outline-none"
                data-testid="default-api-key"
              />
            </div>

            {/* Base URL for OpenAI-compatible providers (OpenAI / DeepSeek) */}
            {(defaultProvider === 'openai' || defaultProvider === 'deepseek') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Base URL</label>
                <input
                  type="text"
                  value={defaultBaseURL}
                  onChange={e => setDefaultBaseURL(e.target.value)}
                  placeholder={defaultProvider === 'deepseek' ? 'https://api.deepseek.com' : 'https://api.openai.com/v1'}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-star-accent/20 outline-none"
                  data-testid="default-base-url"
                />
                <p className="text-xs text-gray-500 mt-1">
                  {defaultProvider === 'deepseek'
                    ? 'DeepSeek 官方端点（默认 https://api.deepseek.com，OpenAI 兼容）'
                    : '用于国产模型（智谱GLM、通义千问等）的兼容端点'}
                </p>
              </div>
            )}

            {/* Action Buttons */}
            <div className="pt-2 flex items-center gap-4">
              <Button
                onClick={handleSaveDefault}
                loading={savingDefault}
                icon={<Save size={16} />}
                data-testid="save-default-config"
              >
                保存配置
              </Button>

              <Button
                variant="secondary"
                onClick={handleTestConnection}
                disabled={testingConnection}
                data-testid="test-default-connection"
              >
                测试连接
              </Button>

              {/* Save Status */}
              {saveStatus !== 'idle' && (
                <div className="flex items-center gap-2">
                  {saveStatus === 'saving' && (
                    <>
                      <div className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
                      <span className="text-xs text-yellow-600">保存中...</span>
                    </>
                  )}
                  {saveStatus === 'success' && (
                    <>
                      <div className="w-2 h-2 rounded-full bg-green-500" />
                      <span className="text-xs text-green-600">已保存</span>
                    </>
                  )}
                  {saveStatus === 'error' && (
                    <>
                      <div className="w-2 h-2 rounded-full bg-red-500" />
                      <span className="text-xs text-red-600">保存失败</span>
                    </>
                  )}
                </div>
              )}

              {/* Test Result */}
              {testResult.status !== 'idle' && testResult.status !== 'testing' && (
                <div className="flex items-center gap-2">
                  {testResult.status === 'success' ? (
                    <>
                      <CheckCircle size={16} className="text-green-500" />
                      <span className="text-sm text-green-600">连接成功 ({testResult.latency}ms)</span>
                    </>
                  ) : (
                    <>
                      <XCircle size={16} className="text-red-500" />
                      <span className="text-sm text-red-600">{testResult.error || '连接失败'}</span>
                    </>
                  )}
                </div>
              )}

              {testingConnection && (
                <div className="flex items-center gap-2">
                  <Loader size={16} className="animate-spin text-purple-500" />
                  <span className="text-sm text-gray-500">测试中...</span>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </Card>

      {/* ========== Image Generation Model Configuration ========== */}
      <Card className="p-6">
        <div className="flex items-start gap-4 mb-6">
          <div className="p-3 bg-pink-50 text-pink-600 rounded-xl">
            <Image size={24} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-900">图片生成模型配置</h3>
            <p className="text-sm text-gray-500">配置训练海报中的 AI 图片生成，支持 DMX API / OpenAI 格式兼容</p>
          </div>
        </div>

        {loadingImageGen ? (
          <div className="flex items-center justify-center py-8">
            <Loader size={24} className="animate-spin text-pink-500" />
          </div>
        ) : imageGenError ? (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-600">加载失败: {imageGenError}</p>
            <button
              onClick={loadImageGenConfig}
              className="mt-2 text-sm text-red-600 underline hover:no-underline"
            >
              重试
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Provider */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  供应商
                  {imageGenConfig?.config && renderSourceBadge(imageGenConfig.config.source)}
                </label>
                <select
                  value={imageGenProvider}
                  onChange={e => handleImageGenProviderChange(e.target.value as 'dmx' | 'openai')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none bg-white"
                >
                  <option value="dmx">DMX API（兼容 OpenAI 格式）</option>
                  <option value="openai">OpenAI（DALL-E）</option>
                </select>
                <p className="text-xs text-gray-400 mt-1">
                  DMX API 为推荐的默认供应商，支持 OpenAI 兼容格式
                </p>
              </div>
            </div>

            {/* Model Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">模型</label>
              <select
                value={imageGenIsCustomModel ? 'custom' : imageGenModel}
                onChange={e => handleImageGenModelChange(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none bg-white"
              >
                <>
                  {(imageGenConfig?.availableModels[imageGenProvider] || []).map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                  <option value="">默认（留空）</option>
                  <option value="custom">自定义模型...</option>
                </>
              </select>

              {imageGenIsCustomModel && (
                <input
                  type="text"
                  value={imageGenCustomModel}
                  onChange={e => setImageGenCustomModel(e.target.value)}
                  placeholder="例如: stable-diffusion-xl, dall-e-3"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-star-accent/20 outline-none mt-2"
                />
              )}
            </div>

            {/* API Key */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                图片生成 API Key
              </label>
              <div className="text-xs text-gray-500 mb-1">
                {imageGenApiKeySetState ? '已配置' : '未配置'}
              </div>
              <input
                type="password"
                value={imageGenApiKeyInput}
                onChange={e => setImageGenApiKeyInput(e.target.value)}
                placeholder={imageGenApiKeySetState ? '输入新Key以更新' : '输入API Key'}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-star-accent/20 outline-none"
              />
            </div>

            {/* Base URL */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Base URL（可选）</label>
              <input
                type="text"
                value={imageGenBaseURL}
                onChange={e => setImageGenBaseURL(e.target.value)}
                placeholder="https://api.dmx.com/v1"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-star-accent/20 outline-none"
              />
              <p className="text-xs text-gray-500 mt-1">
                用于兼容 OpenAI 格式的图片生成端点。DMX API 默认内置，可留空。
              </p>
            </div>

            {/* Action Buttons */}
            <div className="pt-2 flex items-center gap-4">
              <Button
                onClick={handleSaveImageGen}
                loading={savingImageGen}
                icon={<Save size={16} />}
              >
                保存配置
              </Button>

              <Button
                variant="secondary"
                onClick={handleTestImageGenConnection}
                disabled={testingImageGen}
              >
                测试连接
              </Button>

              {/* Save Status */}
              {imageSaveStatus !== 'idle' && (
                <div className="flex items-center gap-2">
                  {imageSaveStatus === 'saving' && (
                    <>
                      <div className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
                      <span className="text-xs text-yellow-600">保存中...</span>
                    </>
                  )}
                  {imageSaveStatus === 'success' && (
                    <>
                      <div className="w-2 h-2 rounded-full bg-green-500" />
                      <span className="text-xs text-green-600">已保存</span>
                    </>
                  )}
                  {imageSaveStatus === 'error' && (
                    <>
                      <div className="w-2 h-2 rounded-full bg-red-500" />
                      <span className="text-xs text-red-600">保存失败</span>
                    </>
                  )}
                </div>
              )}

              {/* Test Result */}
              {imageTestResult.status !== 'idle' && imageTestResult.status !== 'testing' && (
                <div className="flex items-center gap-2">
                  {imageTestResult.status === 'success' ? (
                    <>
                      <CheckCircle size={16} className="text-green-500" />
                      <span className="text-sm text-green-600">连接成功 ({imageTestResult.latency}ms)</span>
                    </>
                  ) : (
                    <>
                      <XCircle size={16} className="text-red-500" />
                      <span className="text-sm text-red-600">{imageTestResult.error || '连接失败'}</span>
                    </>
                  )}
                </div>
              )}

              {testingImageGen && (
                <div className="flex items-center gap-2">
                  <Loader size={16} className="animate-spin text-pink-500" />
                  <span className="text-sm text-gray-500">测试中...</span>
                </div>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* ========== 多模态识别（预留扩展） ========== */}
      <Card className="p-6">
        <div className="flex items-start gap-4 mb-4">
          <div className="p-3 bg-amber-50 text-amber-600 rounded-xl">
            <Eye size={24} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-900">多模态识别</h3>
            <p className="text-sm text-gray-500">Agent 将支持图片、语音、视频等多媒体文件识别</p>
          </div>
        </div>

        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="flex items-center gap-2 mb-3">
            <span className="px-2 py-0.5 text-xs font-bold bg-amber-200 text-amber-800 rounded">🚧 开发中</span>
            <span className="text-sm text-amber-700 font-medium">即将推出，敬请期待</span>
          </div>
          <ul className="space-y-2 text-sm text-amber-700">
            <li className="flex items-start gap-2">
              <span className="text-amber-500 mt-0.5">•</span>
              <span>Agent 可发送图片进行分析，识别动作姿势、器械类型等</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-500 mt-0.5">•</span>
              <span>支持语音指令输入，训练过程中无需手动操作</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-500 mt-0.5">•</span>
              <span>训练视频上传后自动分析动作规范性</span>
            </li>
          </ul>
          <p className="mt-3 text-xs text-amber-500 italic">
            以上功能计划在后续版本中实现，届时可在本页面进行详细配置。
          </p>
        </div>
      </Card>

      {/* ========== 代理网络配置（底部） ========== */}
      <Card className="p-6">
        <div className="flex items-start gap-4 mb-6">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
            <Globe size={24} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-900">代理网络配置</h3>
            <p className="text-sm text-gray-500">配置 NAS 环境的出站连接</p>
          </div>
        </div>

        <div className="space-y-4 max-w-lg">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">全局代理 URL</label>
            <input
              type="text"
              value={proxyConfig.GLOBAL_PROXY}
              onChange={e => setProxyConfig({ ...proxyConfig, GLOBAL_PROXY: e.target.value })}
              placeholder="http://127.0.0.1:7890"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-star-accent/20 outline-none"
              data-testid="admin-proxy-url"
            />
            <p className="text-xs text-gray-400 mt-1">支持 HTTP/SOCKS5</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Gemini 代理 URL</label>
            <input
              type="text"
              value={proxyConfig.GEMINI_PROXY}
              onChange={e => setProxyConfig({ ...proxyConfig, GEMINI_PROXY: e.target.value })}
              placeholder="(optional) http://127.0.0.1:7890"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-star-accent/20 outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">OpenAI 代理 URL</label>
            <input
              type="text"
              value={proxyConfig.OPENAI_PROXY}
              onChange={e => setProxyConfig({ ...proxyConfig, OPENAI_PROXY: e.target.value })}
              placeholder="(optional) http://127.0.0.1:7890"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-star-accent/20 outline-none"
            />
          </div>

          <div className="pt-4 flex items-center gap-4">
            <Button onClick={handleSaveProxy} loading={savingProxy} icon={<Save size={16} />} data-testid="admin-proxy-save">
              Save Configuration
            </Button>

            <Button
              variant="secondary"
              onClick={handleTestProxy}
              disabled={testResult.status === 'testing'}
              data-testid="admin-proxy-test"
            >
              Test Connection
            </Button>

            {testResult.status !== 'idle' && (
              <div
                className={`flex items-center gap-2 text-sm font-medium ${
                testResult.status === 'success' ? 'text-green-600' :
                testResult.status === 'error' ? 'text-red-600' : 'text-gray-500'
              }`}
                data-testid="admin-proxy-test-result"
              >
                {testResult.status === 'testing' ? <Loader size={16} className="animate-spin" /> :
                 testResult.status === 'success' ? <CheckCircle size={16} /> :
                 <XCircle size={16} />}

                {testResult.status === 'testing' ? 'Testing...' :
                 testResult.status === 'success' ? `Connected (${testResult.latency}ms)` :
                 'Connection Failed'}
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
};
