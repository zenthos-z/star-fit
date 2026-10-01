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

import { loadServerHistory } from '@/storage';

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
  /** /health 响应的 version 字段（多后端共存时供用户比对） */
  version?: string;
}

export interface HealthCheckResult {
  ok: boolean;
  message: string;
  latency?: number;
  /** /health 响应的 version 字段（非 starfit 或解析失败时缺省） */
  version?: string;
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
    // 响应体尽力解析：exact 借此校验 starfit 标识，两种模式都顺带带出
    // version（多后端共存时列出供用户比对）；解析失败不拦截非 exact 命中。
    if (response.status >= 200 && response.status < 600) {
      let version: string | undefined;
      try {
        const body = await response.json();
        if (exact && body?.app !== 'starfit') {
          return { ok: false, message: 'not a starfit server' };
        }
        if (typeof body?.version === 'string' && body.version) {
          version = body.version;
        }
      } catch {
        if (exact) {
          return { ok: false, message: 'unrecognized response' };
        }
      }
      return { ok: true, message: 'Server is online', latency, version };
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

  // Priority 5: Mobile fixed fallback (for Capacitor)
  // 2026-09-18：公网穿透优先（稳定不随局域网漂移），旧局域网 IP 降为兜底候选
  if (isCapacitor || !isLocalAccess) {
    const mobileUrl = 'http://8.138.169.218:19902/api';
    if (!candidates.find(c => c.url === mobileUrl)) {
      candidates.push({ url: mobileUrl, source: 'mobile', priority: 65 });
    }
    const lanUrl = 'http://192.168.31.100:43111/api';
    if (!candidates.find(c => c.url === lanUrl)) {
      candidates.push({ url: lanUrl, source: 'mobile', priority: 60 });
    }
  }

  return candidates.sort((a, b) => b.priority - a.priority);
}

/**
 * 全量扫描：一轮并发探测全部候选（不限批次），收集窗口内所有响应者。
 * 局域网 /24 = 254 个地址，60 并发 + 800ms 超时 → 最坏 ~2s 出结果；
 * 多后端共存（BYO-server 真实场景）时全部列出，不再命中即返回赌第一台。
 */
async function collectScanHits(
  candidates: ServerCandidate[],
  onProgress?: (current: ServerCandidate, total: number) => void,
  concurrency = 90,
  timeoutMs = 700,
): Promise<DetectionResult[]> {
  return new Promise((resolve) => {
    const hits: DetectionResult[] = [];
    let settled = 0;
    let nextIndex = 0;
    let done = false;
    const total = candidates.length;

    const finish = () => {
      if (!done) {
        done = true;
        resolve(hits);
      }
    };

    const launchNext = (): void => {
      if (done) return;
      if (nextIndex >= total) {
        if (settled >= total) finish();
        return;
      }
      const candidate = candidates[nextIndex++];
      onProgress?.(candidate, total);
      checkServerHealth(candidate.url, timeoutMs, true)
        .then((result) => {
          if (result.ok) {
            hits.push({
              url: candidate.url,
              source: candidate.source,
              latency: result.latency,
              version: result.version,
            });
          }
        })
        .catch(() => {})
        .finally(() => {
          settled++;
          if (!done && settled >= total) finish();
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
 * Detect all available Starfit servers on the LAN (issue #84 多后端命中列出全部)
 * @param onProgress - Callback for progress updates
 * @returns All detected servers, LAN addresses first then public/tunnel,
 *          latency ascending within each group; empty array if none
 *
 * Strategy（2026-10 调整：局域网优先 + 永不短路）：
 * 0. 已知地址直查（history / env / 本机 dev server / mobile fallback）并发探测，
 *    全部命中保留——不再命中即 return（隧道地址可能只是同一后端的公网入口，
 *    短路会让用户错过局域网直连）
 * 1. **无论 Phase 0 是否命中都执行**：WebRTC 拿本机 IP → 定位网段 →
 *    **全网段 .1-.254 一轮并发扫描收集全部响应者**
 *    （60 并发、800ms 超时、窗口内命中全收；固定端口 43111 + /health starfit 标识精确识别）
 * 2. 合并去重（同 url 一条，Phase 0 来源更具体故优先保留），局域网地址排前、
 *    其后公网/隧道地址，同组内按延迟升序
 */
export async function detectServers(
  onProgress?: (current: ServerCandidate, total: number) => void
): Promise<DetectionResult[]> {
  console.log('[ServerDetector] Starting server detection...');

  // Phase 0: 已知地址直查（并发一轮，全部命中保留，不短路）
  console.log('[ServerDetector] Phase 0: known addresses...');
  const knownCandidates = await getCandidates();
  const knownSettled = await Promise.allSettled(
    knownCandidates.map(candidate =>
      checkServerHealth(candidate.url, 800).then(result => ({ candidate, result }))
    )
  );
  const knownHits: DetectionResult[] = [];
  for (const settled of knownSettled) {
    if (settled.status === 'fulfilled' && settled.value.result.ok) {
      const { candidate, result } = settled.value;
      console.log('[ServerDetector] Known address hit:', candidate.url);
      knownHits.push({
        url: candidate.url,
        source: candidate.source,
        latency: result.latency,
        version: result.version,
      });
    }
  }

  // Phase 1: 全网段扫描——Phase 0 命中也继续（收集窗口内全部响应者）
  console.log('[ServerDetector] Getting client IP address...');
  const localIp = await getLocalIpAddress().catch(() => null);
  console.log('[ServerDetector] Client IP:', localIp);

  const subnet = localIp ? extractSubnet(localIp) : '192.168.1';
  console.log(`[ServerDetector] Scanning ${subnet}.1-.254 for all responders ...`);
  const lanCandidates = generateFullSubnetCandidates(subnet);

  const scanHits = await collectScanHits(lanCandidates, onProgress, 60, 800);

  // 合并去重：同 url 只留一条；Phase 0 来源（history/login/local…）比 scan 更具体，优先保留
  const merged = new Map<string, DetectionResult>();
  for (const hit of [...knownHits, ...scanHits]) {
    if (!merged.has(hit.url)) merged.set(hit.url, hit);
  }

  // 排序：局域网地址在前，其后公网/隧道地址；同组内延迟最优在前
  // （并列时保持合并序，Array.prototype.sort 稳定）
  const results = [...merged.values()].sort((a, b) => {
    const lanDiff = (isLanUrl(a.url) ? 0 : 1) - (isLanUrl(b.url) ? 0 : 1);
    if (lanDiff !== 0) return lanDiff;
    return (a.latency ?? Infinity) - (b.latency ?? Infinity);
  });

  if (results.length > 0) {
    console.log(`[ServerDetector] Found ${results.length} server(s):`, results.map(h => h.url));
  } else {
    console.log('[ServerDetector] No server found');
  }
  return results;
}

/**
 * Detect available Starfit server（兼容封装：返回首个/最优命中）
 * @param onProgress - Callback for progress updates
 * @returns Detection result or null if no server found
 */
export async function detectServer(
  onProgress?: (current: ServerCandidate, total: number) => void
): Promise<DetectionResult | null> {
  const hits = await detectServers(onProgress);
  return hits[0] ?? null;
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

/**
 * 判断服务器 URL 是否指向私网/回环地址（局域网入口）。
 *
 * RFC1918 私网段（10/8、172.16/12、192.168/16）与 localhost/127.0.0.1
 * 视为局域网；公网 IP、域名、无法解析的串视为公网。
 * 供登录页服务器列表标注来源（「局域网」/「公网」）与 detectServers 排序共用。
 */
export function isLanUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  const octets = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!octets) return false;
  const first = Number(octets[1]);
  const second = Number(octets[2]);
  if (first === 127 || first === 10) return true;
  if (first === 192 && second === 168) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  return false;
}
