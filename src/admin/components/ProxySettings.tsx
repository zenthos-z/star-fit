import React, { useState, useEffect } from 'react';
import { Globe, Save, Loader, AlertCircle, CheckCircle2, Wifi, MapPin, RefreshCw, Eye, EyeOff } from 'lucide-react';
import { API_BASE, getHeaders } from '@/services/geminiService';

const WEBSITES = [
  { name: 'Apple', url: 'https://www.apple.com/library/test/success.html', icon: '🍎' },
  { name: 'GitHub', url: 'https://github.com', icon: '🐙' },
  { name: 'Google', url: 'https://www.google.com/generate_204', icon: '🔍' },
  { name: 'YouTube', url: 'https://www.youtube.com', icon: '📺' },
];

const ProxySettings = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [config, setConfig] = useState({
    GLOBAL_PROXY: '',
    GEMINI_PROXY: '',
    OPENAI_PROXY: '',
    AI_PROVIDER: 'gemini',
    GOOGLE_API_KEY: '',
    OPENAI_API_KEY: ''
  });

  const [testResults, setTestResults] = useState<Record<string, { latency?: number, loading?: boolean, error?: string, proxyUsed?: string, source?: string }>>({});
  const [ipInfo, setIpInfo] = useState<any>(null);
  const [loadingIp, setLoadingIp] = useState(false);
  const [showIp, setShowIp] = useState(false);
  const [testProvider, setTestProvider] = useState<'GLOBAL' | 'GEMINI' | 'OPENAI'>('GLOBAL');
  const [lastTestedKeys, setLastTestedKeys] = useState({ google: '', openai: '' });

  useEffect(() => {
    fetchProxyConfig();
  }, []);

  // Auto-test and save logic for API Keys
  useEffect(() => {
    const timer = setTimeout(() => {
      if (config.GOOGLE_API_KEY && config.GOOGLE_API_KEY !== lastTestedKeys.google) {
        autoTestAndSave('gemini', config.GOOGLE_API_KEY);
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, [config.GOOGLE_API_KEY]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (config.OPENAI_API_KEY && config.OPENAI_API_KEY !== lastTestedKeys.openai) {
        autoTestAndSave('openai', config.OPENAI_API_KEY);
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, [config.OPENAI_API_KEY]);

  const autoTestAndSave = async (provider: 'gemini' | 'openai', key: string) => {
    setTestResults(prev => ({ ...prev, [provider]: { loading: true } }));
    try {
      let testUrl = `${API_BASE}/admin/proxy/test?test_ai=${provider}&provider=${provider.toUpperCase()}&apiKey=${encodeURIComponent(key)}&model=gemini-3-flash-preview`;
      const res = await fetch(testUrl, { headers: getHeaders() });
      const data = await res.json();
      
      if (data.success) {
        setTestResults(prev => ({ 
          ...prev, 
          [provider]: { latency: data.latency, loading: false } 
        }));
        setLastTestedKeys(prev => ({ ...prev, [provider === 'gemini' ? 'google' : 'openai']: key }));
        // Auto save on success
        await handleSave();
      } else {
        setTestResults(prev => ({ 
          ...prev, 
          [provider]: { error: data.error || '验证失败', loading: false } 
        }));
      }
    } catch (e: any) {
      setTestResults(prev => ({ 
        ...prev, 
        [provider]: { error: e.message, loading: false } 
      }));
    }
  };

  useEffect(() => {
    fetchIpInfo();
  }, [testProvider]);

  const fetchProxyConfig = async () => {
    try {
      const res = await fetch(`${API_BASE}/admin/proxy`, {
        headers: getHeaders()
      });
      if (!res.ok) throw new Error('Failed to fetch proxy config');
      const data = await res.json();
      // Ensure all fields have at least an empty string to avoid uncontrolled component warnings
      setConfig({
        GLOBAL_PROXY: data.GLOBAL_PROXY || '',
        GEMINI_PROXY: data.GEMINI_PROXY || '',
        OPENAI_PROXY: data.OPENAI_PROXY || '',
        AI_PROVIDER: data.AI_PROVIDER || 'gemini',
        GOOGLE_API_KEY: data.GOOGLE_API_KEY || '',
        OPENAI_API_KEY: data.OPENAI_API_KEY || ''
      });
    } catch (e: any) {
      setStatus({ type: 'error', message: e.message });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch(`${API_BASE}/admin/proxy`, {
        method: 'POST',
        headers: {
          ...getHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(config)
      });
      if (!res.ok) throw new Error('Failed to save proxy config');
      setStatus({ type: 'success', message: '代理设置已保存' });
      // Refresh IP info after saving
      fetchIpInfo();
    } catch (e: any) {
      setStatus({ type: 'error', message: e.message });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (siteName: string, url: string) => {
    setTestResults(prev => ({ ...prev, [siteName]: { loading: true } }));
    try {
      const providerParam = testProvider !== 'GLOBAL' ? `&provider=${testProvider}` : '';
      const currentProxy = testProvider === 'GEMINI' ? config.GEMINI_PROXY : (testProvider === 'OPENAI' ? config.OPENAI_PROXY : config.GLOBAL_PROXY);
      const testUrl = `${API_BASE}/admin/proxy/test?url=${encodeURIComponent(url)}${providerParam}&proxyUrl=${encodeURIComponent(currentProxy || '')}`;

      const res = await fetch(testUrl, {
        headers: getHeaders()
      });
      const data = await res.json();
      
      if (data.success) {
        setTestResults(prev => ({ 
          ...prev, 
          [siteName]: { 
            latency: data.latency, 
            loading: false, 
            proxyUsed: data.proxyUsed,
            source: data.source
          } 
        }));
      } else {
        setTestResults(prev => ({ 
          ...prev, 
          [siteName]: { 
            error: data.error || '测试失败', 
            loading: false,
            proxyUsed: data.proxyUsed,
            source: data.source
          } 
        }));
      }
    } catch (e: any) {
      setTestResults(prev => ({ 
        ...prev, 
        [siteName]: { error: e.message, loading: false } 
      }));
    }
  };

  const fetchIpInfo = async () => {
    setLoadingIp(true);
    try {
      const providerParam = testProvider !== 'GLOBAL' ? `?provider=${testProvider}` : '';
      const res = await fetch(`${API_BASE}/admin/proxy/ip-info${providerParam}`, {
        headers: getHeaders()
      });
      if (!res.ok) throw new Error('Failed to fetch IP info');
      const data = await res.json();
      setIpInfo(data);
    } catch (e: any) {
      console.error('IP Info error:', e);
      setIpInfo(null);
    } finally {
      setLoadingIp(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader className="animate-spin text-star-accent" size={32} />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-admin-bg">
      {/* Header - Fixed */}
      <div className="p-8 pb-4 border-b border-admin-border bg-admin-bg/50 backdrop-blur-md z-10">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-star-accent/20 text-star-accent rounded-xl">
              <Globe size={28} />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white tracking-tight">AI 与网络配置</h2>
              <p className="text-admin-muted text-sm mt-0.5">管理模型提供商密钥、网络代理及连通性诊断</p>
            </div>
          </div>
          
          <button
            onClick={handleSave}
            disabled={saving}
            className="hidden md:flex items-center space-x-2 bg-star-accent hover:bg-star-accent/90 disabled:opacity-50 text-black font-bold px-6 py-2.5 rounded-xl transition-all transform active:scale-[0.98] shadow-lg shadow-star-accent/10"
          >
            {saving ? <Loader className="animate-spin" size={18} /> : <Save size={18} />}
            <span>保存更改</span>
          </button>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-8">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Left Column - Main Settings */}
            <div className="lg:col-span-8 space-y-8">
              {/* AI Provider Section */}
              <section className="bg-admin-card border border-admin-border rounded-2xl overflow-hidden shadow-sm">
                <div className="px-6 py-4 bg-admin-border/10 border-b border-admin-border flex items-center justify-between">
                  <h3 className="font-bold text-white flex items-center space-x-2">
                    <span className="w-1.5 h-6 bg-star-accent rounded-full" />
                    <span>AI 模型提供商</span>
                  </h3>
                  <div className="flex items-center space-x-2">
                    {['gemini', 'openai'].map(p => (
                      <button
                        key={p}
                        onClick={() => setConfig({ ...config, AI_PROVIDER: p })}
                        className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all uppercase tracking-wider ${
                          config.AI_PROVIDER === p 
                            ? 'bg-star-accent text-black shadow-lg shadow-star-accent/20' 
                            : 'bg-admin-bg/50 text-admin-muted border border-admin-border hover:border-admin-muted/30'
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
                
                <div className="p-6 space-y-8">
                  {/* Gemini Key */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <label className="text-sm font-bold text-white">Google API Key</label>
                        <span className="text-[10px] text-admin-muted bg-admin-border/30 px-2 py-0.5 rounded">Gemini 3 系列</span>
                      </div>
                      {testResults['gemini']?.loading ? (
                        <div className="flex items-center space-x-1.5 text-star-accent">
                          <Loader className="animate-spin" size={12} />
                          <span className="text-[10px] font-medium">正在验证...</span>
                        </div>
                      ) : testResults['gemini']?.latency ? (
                        <div className="flex items-center space-x-1.5 text-green-500">
                          <CheckCircle2 size={12} />
                          <span className="text-[10px] font-mono">验证成功 ({testResults['gemini'].latency}ms)</span>
                        </div>
                      ) : testResults['gemini']?.error ? (
                        <div className="flex items-center space-x-1.5 text-red-500">
                          <AlertCircle size={12} />
                          <span className="text-[10px] font-medium">验证失败: {testResults['gemini'].error}</span>
                        </div>
                      ) : null}
                    </div>
                    <div className="relative group">
                      <input
                        type={showIp ? "text" : "password"}
                        value={config.GOOGLE_API_KEY}
                        onChange={e => setConfig({ ...config, GOOGLE_API_KEY: e.target.value })}
                        placeholder="输入 Google AI Studio 获取的 API Key"
                        className="w-full bg-admin-bg/50 border border-admin-border rounded-xl px-4 py-3.5 text-white focus:border-star-accent outline-none transition-all pr-12 text-sm font-mono group-hover:bg-admin-bg"
                      />
                      <button 
                        onClick={() => setShowIp(!showIp)}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-admin-muted hover:text-white transition-colors"
                      >
                        {showIp ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>

                  {/* OpenAI Key */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <label className="text-sm font-bold text-white">OpenAI API Key</label>
                        <span className="text-[10px] text-admin-muted bg-admin-border/30 px-2 py-0.5 rounded">GPT-4o / 3.5</span>
                      </div>
                      {testResults['openai']?.loading ? (
                        <div className="flex items-center space-x-1.5 text-star-accent">
                          <Loader className="animate-spin" size={12} />
                          <span className="text-[10px] font-medium">正在验证...</span>
                        </div>
                      ) : testResults['openai']?.latency ? (
                        <div className="flex items-center space-x-1.5 text-green-500">
                          <CheckCircle2 size={12} />
                          <span className="text-[10px] font-mono">验证成功 ({testResults['openai'].latency}ms)</span>
                        </div>
                      ) : testResults['openai']?.error ? (
                        <div className="flex items-center space-x-1.5 text-red-500">
                          <AlertCircle size={12} />
                          <span className="text-[10px] font-medium">验证失败: {testResults['openai'].error}</span>
                        </div>
                      ) : null}
                    </div>
                    <div className="relative group">
                      <input
                        type={showIp ? "text" : "password"}
                        value={config.OPENAI_API_KEY}
                        onChange={e => setConfig({ ...config, OPENAI_API_KEY: e.target.value })}
                        placeholder="输入 OpenAI 平台获取的 API Key (sk-...)"
                        className="w-full bg-admin-bg/50 border border-admin-border rounded-xl px-4 py-3.5 text-white focus:border-star-accent outline-none transition-all pr-12 text-sm font-mono group-hover:bg-admin-bg"
                      />
                      <button 
                        onClick={() => setShowIp(!showIp)}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-admin-muted hover:text-white transition-colors"
                      >
                        {showIp ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>
                </div>
              </section>

              {/* Proxy Section */}
              <section className="bg-admin-card border border-admin-border rounded-2xl overflow-hidden shadow-sm">
                <div className="px-6 py-4 bg-admin-border/10 border-b border-admin-border">
                  <h3 className="font-bold text-white flex items-center space-x-2">
                    <span className="w-1.5 h-6 bg-blue-500 rounded-full" />
                    <span>网络代理配置</span>
                  </h3>
                </div>
                <div className="p-6 space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="md:col-span-2 space-y-2">
                      <label className="text-sm font-medium text-admin-text flex items-center space-x-2">
                        <span>全局代理</span>
                        <span className="text-[10px] text-admin-muted font-normal">(GLOBAL_PROXY)</span>
                      </label>
                      <input
                        type="text"
                        value={config.GLOBAL_PROXY}
                        onChange={e => setConfig({ ...config, GLOBAL_PROXY: e.target.value })}
                        placeholder="例如: http://127.0.0.1:7890"
                        className="w-full bg-admin-bg border border-admin-border rounded-xl px-4 py-3 text-white focus:border-blue-500 outline-none transition-all text-sm font-mono"
                      />
                      <p className="text-[11px] text-admin-muted mt-1">所有 API 调用的默认代理，若未设置专用代理则回退至此。</p>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium text-admin-text flex items-center space-x-2">
                        <span>Gemini 专用代理</span>
                        <span className="text-[10px] text-admin-muted font-normal">(GEMINI_PROXY)</span>
                      </label>
                      <input
                        type="text"
                        value={config.GEMINI_PROXY}
                        onChange={e => setConfig({ ...config, GEMINI_PROXY: e.target.value })}
                        placeholder="留空则使用全局代理"
                        className="w-full bg-admin-bg border border-admin-border rounded-xl px-4 py-3 text-white focus:border-blue-500 outline-none transition-all text-sm font-mono"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium text-admin-text flex items-center space-x-2">
                        <span>OpenAI 专用代理</span>
                        <span className="text-[10px] text-admin-muted font-normal">(OPENAI_PROXY)</span>
                      </label>
                      <input
                        type="text"
                        value={config.OPENAI_PROXY}
                        onChange={e => setConfig({ ...config, OPENAI_PROXY: e.target.value })}
                        placeholder="留空则使用全局代理"
                        className="w-full bg-admin-bg border border-admin-border rounded-xl px-4 py-3 text-white focus:border-blue-500 outline-none transition-all text-sm font-mono"
                      />
                    </div>
                  </div>

                  <div className="p-4 bg-blue-500/5 border border-blue-500/10 rounded-xl">
                    <div className="flex items-start space-x-3">
                      <AlertCircle size={16} className="text-blue-400 mt-0.5" />
                      <div className="space-y-1">
                        <h4 className="text-xs font-bold text-blue-400">优先级与规则</h4>
                        <ul className="text-[11px] text-admin-muted space-y-1 list-disc pl-3">
                          <li>专用代理 &gt; 全局代理 &gt; 环境变量 (.env)</li>
                          <li>支持 HTTP/HTTPS 协议，修改后实时生效</li>
                          <li>建议在中国大陆环境配置代理以确保 API 稳定性</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              {/* Mobile Save Button */}
              <div className="md:hidden pt-4">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="w-full flex items-center justify-center space-x-2 bg-star-accent hover:bg-star-accent/90 disabled:opacity-50 text-black font-bold py-4 rounded-xl transition-all shadow-lg"
                >
                  {saving ? <Loader className="animate-spin" size={20} /> : <Save size={20} />}
                  <span>保存所有配置</span>
                </button>
              </div>

              {status && (
                <div className={`flex items-center space-x-3 p-4 rounded-xl text-sm animate-in fade-in slide-in-from-top-2 duration-300 ${
                  status.type === 'success' ? 'bg-green-500/10 text-green-500 border border-green-500/20' : 'bg-red-500/10 text-red-500 border border-red-500/20'
                }`}>
                  {status.type === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
                  <span className="font-medium">{status.message}</span>
                </div>
              )}
            </div>

            {/* Right Column - Status & Tests */}
            <div className="lg:col-span-4 space-y-6">
              {/* IP Status Card */}
              <div className="bg-admin-card border border-admin-border rounded-2xl overflow-hidden shadow-sm">
                <div className="p-4 bg-admin-border/20 flex items-center justify-between border-b border-admin-border">
                  <div className="flex items-center space-x-2">
                    <MapPin size={18} className="text-star-accent" />
                    <span className="font-bold text-white text-sm">出口 IP 诊断</span>
                  </div>
                  <button 
                    onClick={fetchIpInfo} 
                    disabled={loadingIp}
                    className="p-1.5 hover:bg-admin-border rounded-lg transition-colors disabled:opacity-50"
                  >
                    <RefreshCw size={14} className={`text-admin-muted ${loadingIp ? 'animate-spin' : ''}`} />
                  </button>
                </div>
                <div className="p-5">
                  {loadingIp && !ipInfo ? (
                    <div className="flex flex-col items-center justify-center py-8 space-y-3">
                      <Loader className="animate-spin text-star-accent/50" size={24} />
                      <span className="text-xs text-admin-muted">正在获取 IP 信息...</span>
                    </div>
                  ) : ipInfo ? (
                    <div className="space-y-5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <div className="w-10 h-10 rounded-full bg-admin-bg border border-admin-border flex items-center justify-center text-xl shadow-inner">
                            {ipInfo.countryCode === 'CN' ? '🇨🇳' : (ipInfo.countryCode === 'JP' ? '🇯🇵' : (ipInfo.countryCode === 'US' ? '🇺🇸' : '🌐'))}
                          </div>
                          <div>
                            <div className="text-sm font-bold text-white">{ipInfo.country || '未知国家'}</div>
                            <div className="text-[11px] text-admin-muted">{ipInfo.city || ipInfo.region || '未知城市'}</div>
                          </div>
                        </div>
                        <div className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/10 text-green-500 border border-green-500/20">
                          在线
                        </div>
                      </div>

                      <div className="space-y-3 bg-admin-bg/40 p-3 rounded-xl border border-admin-border/50">
                        <div className="flex items-center justify-between group">
                          <span className="text-[11px] text-admin-muted">当前 IP</span>
                          <div className="flex items-center space-x-2">
                            <span className="text-xs text-white font-mono tracking-tighter">
                              {showIp ? ipInfo.query : '••••••••••••'}
                            </span>
                            <button onClick={() => setShowIp(!showIp)} className="text-admin-muted hover:text-white transition-colors">
                              {showIp ? <EyeOff size={12} /> : <Eye size={12} />}
                            </button>
                          </div>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-admin-muted">运营商</span>
                          <span className="text-[11px] text-white truncate max-w-[140px] text-right font-medium" title={ipInfo.isp}>
                            {ipInfo.isp || '未知'}
                          </span>
                        </div>
                        {ipInfo.proxyUsed && (
                          <div className="pt-2 border-t border-admin-border/30 mt-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] text-admin-muted">代理出口</span>
                              <span className="text-[10px] text-star-accent font-mono truncate max-w-[140px]" title={ipInfo.proxyUsed}>
                                {ipInfo.proxyUsed.replace(/^https?:\/\//, '')}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <AlertCircle className="mx-auto text-admin-muted mb-2" size={20} />
                      <div className="text-xs text-admin-muted">IP 信息获取失败</div>
                      <button onClick={fetchIpInfo} className="text-[10px] text-star-accent mt-2 hover:underline">点击重试</button>
                    </div>
                  )}
                </div>
              </div>

              {/* Connectivity Test Card */}
              <div className="bg-admin-card border border-admin-border rounded-2xl overflow-hidden shadow-sm">
                <div className="p-4 bg-admin-border/20 border-b border-admin-border flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Wifi size={18} className="text-star-accent" />
                    <span className="font-bold text-white text-sm">连通性测试</span>
                  </div>
                  <select 
                    value={testProvider}
                    onChange={(e) => setTestProvider(e.target.value as any)}
                    className="bg-admin-bg border border-admin-border rounded-lg px-2 py-1 text-[10px] text-white outline-none focus:border-star-accent transition-all cursor-pointer"
                  >
                    <option value="GLOBAL">全局环境</option>
                    <option value="GEMINI">Gemini 环境</option>
                    <option value="OPENAI">OpenAI 环境</option>
                  </select>
                </div>
                <div className="p-4 grid grid-cols-1 gap-3">
                  {WEBSITES.map(site => (
                    <div key={site.name} className="bg-admin-bg/30 border border-admin-border/50 p-3 rounded-xl flex items-center justify-between group hover:border-admin-muted/30 transition-all">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 rounded-lg bg-admin-bg border border-admin-border flex items-center justify-center text-base shadow-sm group-hover:scale-110 transition-transform">
                          {site.icon}
                        </div>
                        <div>
                          <div className="text-xs font-bold text-white">{site.name}</div>
                          <div className="text-[9px] text-admin-muted uppercase tracking-widest">Latency Test</div>
                        </div>
                      </div>
                      
                      <div className="flex flex-col items-end">
                        {testResults[site.name]?.loading ? (
                          <Loader className="animate-spin text-star-accent/50" size={14} />
                        ) : testResults[site.name]?.latency ? (
                          <div className="flex flex-col items-end">
                            <span className={`text-xs font-mono font-bold ${
                              testResults[site.name].latency! < 300 ? 'text-green-500' : 
                              (testResults[site.name].latency! < 800 ? 'text-yellow-500' : 'text-orange-500')
                            }`}>
                              {testResults[site.name].latency}ms
                            </span>
                            <div className="flex items-center space-x-1">
                              <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                              <span className="text-[8px] text-admin-muted font-medium">响应正常</span>
                            </div>
                          </div>
                        ) : testResults[site.name]?.error ? (
                          <div className="flex flex-col items-end">
                            <span className="text-xs text-red-500 font-bold">超时</span>
                            <span className="text-[8px] text-red-500/50 truncate max-w-[80px]" title={testResults[site.name].error}>
                              测试失败
                            </span>
                          </div>
                        ) : (
                          <button 
                            onClick={() => handleTest(site.name, site.url)}
                            className="text-[10px] text-admin-muted group-hover:text-star-accent transition-colors border border-admin-border px-2 py-1 rounded-md hover:border-star-accent/30"
                          >
                            开始测试
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="px-4 py-3 bg-admin-border/10 border-t border-admin-border">
                  <p className="text-[9px] text-admin-muted text-center italic">
                    * 测试结果受网络波动影响，仅供参考
                  </p>
                </div>
              </div>
            </div>
          </div>
          
          {/* Bottom Spacer for Mobile */}
          <div className="h-20 md:hidden" />
        </div>
      </div>
    </div>
  );
};

export default ProxySettings;
