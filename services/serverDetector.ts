/**
 * Server Detector - Smart LAN Server Scanner
 *
 * Detects Starfit backend servers by:
 * 1. Get client's local IP → determine subnet
 * 2. Scan only the SAME subnet (much faster!)
 * 3. Gateway addresses first (.1, .254)
 * 4. Common server IPs (.100, .200)
 * 5. Fallback to history if LAN scan fails
 */

import { loadServerHistory } from '../storage';

/**
 * Get client's local IP address using WebRTC
 * @returns Local IP address (e.g., "192.168.31.50") or null
 */
async function getLocalIpAddress(): Promise<string | null> {
  return new Promise((resolve) => {
    const rtc = new RTCPeerConnection({ iceServers: [] });
    rtc.createDataChannel('');
    rtc.createOffer()
      .then(offer => rtc.setLocalDescription(offer))
      .catch(() => resolve(null));

    rtc.onicecandidate = (evt) => {
      if (evt.candidate) {
        const match = evt.candidate.candidate.match(/(\d+\.\d+\.\d+\.\d+)/);
        if (match) {
          const ip = match[1];
          // Only return local/private IPs
          if (
            ip.startsWith('192.168.') ||
            ip.startsWith('10.') ||
            ip.startsWith('172.')
          ) {
            rtc.close();
            resolve(ip);
          }
        }
      }
    };

    // Timeout after 2 seconds
    setTimeout(() => {
      rtc.close();
      resolve(null);
    }, 2000);
  });
}

/**
 * Extract subnet from IP address
 * @param ip - IP address (e.g., "192.168.31.50")
 * @returns Subnet (e.g., "192.168.31")
 */
function extractSubnet(ip: string): string {
  const parts = ip.split('.');
  if (parts.length >= 3) {
    return `${parts[0]}.${parts[1]}.${parts[2]}`;
  }
  return '192.168.1'; // fallback
}

export interface ServerCandidate {
  url: string;
  source: 'login' | 'history' | 'env' | 'local' | 'mobile' | 'scan';
  priority: number;
}

export interface DetectionResult {
  url: string;
  source: string;
  latency?: number;
}

export interface HealthCheckResult {
  ok: boolean;
  message: string;
  latency?: number;
}

/**
 * Check if a server is healthy and responsive
 * @param baseUrl - Base URL to check (e.g., http://192.168.1.100:43111/api)
 * @param timeout - Request timeout in ms (default: 3000)
 * @returns Health check result with optional latency
 */
export async function checkServerHealth(
  baseUrl: string,
  timeout = 1500,
  exact = false
): Promise<HealthCheckResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const startTime = performance.now();
    // Try /health endpoint first
    const healthUrl = baseUrl.replace(/\/api$/, '') + '/health';

    console.log('[ServerDetector] Checking health:', healthUrl);

    const response = await fetch(healthUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'Accept': 'application/json'
      }
    });

    clearTimeout(timeoutId);
    const latency = Math.round(performance.now() - startTime);

    console.log('[ServerDetector] Health check response:', response.status, 'latency:', latency);

    // 扫描场景要求精确命中：只有返回 Starfit 标识的 /health 才算发现，
    // 避免把局域网里碰巧占用 43111 的其他服务当成本服务器。
    // （对已知历史 URL 的直查则放宽：任何 <600 的响应都算在线。）
    if (response.status >= 200 && response.status < 600) {
      if (exact) {
        try {
          const body = await response.json();
          if (body?.app !== 'starfit') {
            return { ok: false, message: 'not a starfit server' };
          }
        } catch {
          return { ok: false, message: 'unrecognized response' };
        }
      }
      return { ok: true, message: 'Server is online', latency };
    }
    return { ok: false, message: `HTTP ${response.status}` };
  } catch (e: any) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') {
      return { ok: false, message: 'Connection timeout' };
    }
    console.log('[ServerDetector] Health check error:', e.message);
    return { ok: false, message: e.message || 'Connection failed' };
  }
}

/**
 * Get server candidates in priority order
 */
async function getCandidates(): Promise<ServerCandidate[]> {
  const candidates: ServerCandidate[] = [];
  const isServer = typeof window === 'undefined';
  const isCapacitor = typeof window !== 'undefined' && window.location.protocol === 'capacitor:';
  const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  const isLocalAccess = hostname === 'localhost' || hostname === '127.0.0.1';

  // Priority 1: Login override (highest priority)
  if (typeof window !== 'undefined' && window.localStorage) {
    const loginUrl = window.localStorage.getItem('starfit_server_url');
    if (loginUrl && loginUrl.startsWith('http')) {
      candidates.push({ url: loginUrl, source: 'login', priority: 100 });
    }
  }

  // Priority 2: History from IDB
  try {
    const history = await loadServerHistory();
    for (const entry of history.slice(0, 3)) {
      if (!candidates.find(c => c.url === entry.url)) {
        candidates.push({ url: entry.url, source: 'history', priority: 90 });
      }
    }
  } catch (e) {
    console.warn('[ServerDetector] Failed to load server history:', e);
  }

  // Priority 3: Environment variable
  const envUrl = import.meta.env?.VITE_API_BASE_URL;
  if (envUrl && envUrl.startsWith('http') && !candidates.find(c => c.url === envUrl)) {
    candidates.push({ url: envUrl, source: 'env', priority: 80 });
  }

  // Priority 4: Local development
  const localCandidates = [
    'http://localhost:43111/api',
    'http://127.0.0.1:43111/api'
  ];
  for (const url of localCandidates) {
    if (!candidates.find(c => c.url === url)) {
      candidates.push({ url, source: 'local', priority: 70 });
    }
  }

  // Priority 5: Mobile fixed IP (for Capacitor)
  if (isCapacitor || !isLocalAccess) {
    const mobileUrl = 'http://192.168.31.100:43111/api';
    if (!candidates.find(c => c.url === mobileUrl)) {
      candidates.push({ url: mobileUrl, source: 'mobile', priority: 60 });
    }
  }

  return candidates.sort((a, b) => b.priority - a.priority);
}

/**
 * 竞速扫描：一轮并发探测全部候选（不限批次），任一命中立即 resolve。
 * 局域网 /24 = 256 个地址，90 并发 + 700ms 超时 → 最坏 ~2s 出结果；
 * 服务器在线时通常 <1s（第一个批次内的命中立刻返回，不等其余请求）。
 */
async function raceScanCandidates(
  candidates: ServerCandidate[],
  onProgress?: (current: ServerCandidate, total: number) => void,
  concurrency = 90,
  timeoutMs = 700,
): Promise<DetectionResult | null> {
  return new Promise((resolve) => {
    let settled = 0;
    let nextIndex = 0;
    let done = false;
    const total = candidates.length;

    const finish = (result: DetectionResult | null) => {
      if (!done) {
        done = true;
        resolve(result);
      }
    };

    const launchNext = (): void => {
      if (done) return;
      if (nextIndex >= total) {
        if (settled >= total) finish(null);
        return;
      }
      const candidate = candidates[nextIndex++];
      onProgress?.(candidate, total);
      checkServerHealth(candidate.url, timeoutMs, true)
        .then((result) => {
          if (result.ok) {
            finish({ url: candidate.url, source: candidate.source, latency: result.latency });
          }
        })
        .catch(() => {})
        .finally(() => {
          settled++;
          if (!done && settled >= total) finish(null);
          launchNext();
        });
    };

    for (let i = 0; i < Math.min(concurrency, total); i++) {
      launchNext();
    }
  });
}

/**
 * Process candidates in batches with concurrency limit
 * @param candidates - Server candidates to check
 * @param onProgress - Progress callback
 * @param batchSize - Concurrent requests (default: 20)
 * @param timeoutMs - Per-request timeout in ms (default: 800 for local scan)
 */
async function checkCandidatesInBatches(
  candidates: ServerCandidate[],
  onProgress?: (current: ServerCandidate, total: number) => void,
  batchSize = 20,
  timeoutMs = 800
): Promise<DetectionResult | null> {
  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);

    const results = await Promise.allSettled(
      batch.map(candidate =>
        checkServerHealth(candidate.url, timeoutMs).then(result => ({
          candidate,
          result
        }))
      )
    );

    for (const settled of results) {
      if (settled.status === 'fulfilled') {
        const { candidate, result } = settled.value;
        if (result.ok) {
          return {
            url: candidate.url,
            source: candidate.source,
            latency: result.latency
          };
        }
      }
    }

    // Report progress for last item in batch
    if (onProgress && batch.length > 0) {
      onProgress(batch[batch.length - 1], candidates.length);
    }
  }

  return null;
}

/**
 * 生成全网段候选：.1–.254 全覆盖（排除网段地址 .0 与广播 .255）。
 * 竞速模式下不需要按优先级分批——任一命中立即返回，排前面的只是先发请求。
 * 43111 是固定冷门端口（与后端约定），命中即 Starfit。
 */
function generateFullSubnetCandidates(subnet: string): ServerCandidate[] {
  const candidates: ServerCandidate[] = [];
  for (let i = 1; i <= 254; i++) {
    candidates.push({
      url: `http://${subnet}.${i}:43111/api`,
      source: 'scan',
      // 高频服务器位排前面：网关、DHCP 常用段（竞速模式下只是先发请求）
      priority: [1, 100, 254, 2, 200].includes(i) ? 100 - i : 50 - (i % 50),
    });
  }
  return candidates.sort((a, b) => b.priority - a.priority);
}

/**
 * Detect available Starfit server (optimized for first-time users)
 * @param onProgress - Callback for progress updates
 * @returns Detection result or null if no server found
 *
 * Strategy（2026-09 优化：一轮竞速扫描替代三阶段分批）：
 * 0. 已知地址直查（history / 本机 dev server）——最快路径，通常 <100ms
 * 1. WebRTC 拿本机 IP → 定位网段 → **全网段 .1-.254 一轮并发竞速扫描**
 *    （90 并发、700ms 超时、命中即返回；固定端口 43111 + /health starfit 标识精确识别）
 */
export async function detectServer(
  onProgress?: (current: ServerCandidate, total: number) => void
): Promise<DetectionResult | null> {
  console.log('[ServerDetector] Starting server detection...');

  // Phase 0: 已知地址直查（上次连过的服务器几乎总是本次的服务器）
  console.log('[ServerDetector] Phase 0: known addresses...');
  const knownCandidates = await getCandidates();
  for (const candidate of knownCandidates) {
    const result = await checkServerHealth(candidate.url, 800);
    if (result.ok) {
      console.log('[ServerDetector] Known address hit:', candidate.url);
      return { url: candidate.url, source: candidate.source, latency: result.latency };
    }
  }

  // Phase 1: 全网段竞速扫描
  console.log('[ServerDetector] Getting client IP address...');
  const localIp = await getLocalIpAddress();
  console.log('[ServerDetector] Client IP:', localIp);

  const subnet = localIp ? extractSubnet(localIp) : '192.168.1';
  console.log(`[ServerDetector] Race-scanning ${subnet}.1-.254 ...`);
  const lanCandidates = generateFullSubnetCandidates(subnet);

  const scanResult = await raceScanCandidates(lanCandidates, onProgress, 60, 800);
  if (scanResult) {
    console.log('[ServerDetector] Server found:', scanResult);
    return scanResult;
  }

  console.log('[ServerDetector] No server found');
  return null;
}

/**
 * Quick detection - only checks priority candidates (no LAN scan)
 */
export async function quickDetectServer(): Promise<DetectionResult | null> {
  const candidates = await getCandidates();

  for (const candidate of candidates) {
    const result = await checkServerHealth(candidate.url, 2000);
    if (result.ok) {
      return {
        url: candidate.url,
        source: candidate.source,
        latency: result.latency
      };
    }
  }

  return null;
}

/**
 * Format server URL for display
 */
export function formatServerUrl(url: string): string {
  // Remove http:// or https://
  let formatted = url.replace(/^https?:\/\//, '');
  // Remove trailing /api
  formatted = formatted.replace(/\/api$/, '');
  return formatted;
}

/**
 * Parse user input to full server URL
 */
export function parseServerInput(input: string): string {
  let formatted = input.trim();
  // Remove http:// or https:// if user entered it
  formatted = formatted.replace(/^https?:\/\//, '');
  // Remove trailing slashes
  formatted = formatted.replace(/\/+$/, '');

  // Check if it already has a port, if not add 43111
  if (!formatted.includes(':')) {
    formatted = `${formatted}:43111`;
  }

  // Add http:// prefix and /api suffix
  return `http://${formatted}/api`;
}
