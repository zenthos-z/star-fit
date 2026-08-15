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
  timeout = 1500
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

    // Any HTTP response means the server exists!
    // Even 404 means the server is running, just the path is wrong
    if (response.status >= 200 && response.status < 600) {
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
 * Generate LAN subnet scan candidates (optimized for speed)
 * Strategy:
 * 1. Priority scan: Gateway addresses (.1, .254) + common server IPs (.100, .200)
 * 2. Range scan: .2-.99 (skipping .100-.254 where user devices usually are)
 * 3. Only scan the SAME subnet as client (e.g., 192.168.31.x)
 *
 * @param subnet - Subnet to scan (e.g., "192.168.31")
 * @param scanAllRanges - If true, scan full range; if false, only scan priority addresses
 */
function generateLanCandidates(subnet: string, scanAllRanges = false): ServerCandidate[] {
  const candidates: ServerCandidate[] = [];

  // Priority 1: Gateway addresses (most servers run on gateway IPs)
  candidates.push({
    url: `http://${subnet}.1:43111/api`,
    source: 'scan',
    priority: 100
  });
  candidates.push({
    url: `http://${subnet}.254:43111/api`,
    source: 'scan',
    priority: 95
  });

  // Priority 2: Common static IPs for servers (.100, .200)
  for (const ip of [100, 200]) {
    candidates.push({
      url: `http://${subnet}.${ip}:43111/api`,
      source: 'scan',
      priority: 90
    });
  }

  // Priority 3: Range scan .2-.99 (only if scanAllRanges is true)
  // This is for exhaustive scan when priority scan fails
  if (scanAllRanges) {
    for (let i = 2; i <= 99; i++) {
      // Skip already scanned addresses
      if ([1, 100, 200, 254].includes(i)) continue;

      candidates.push({
        url: `http://${subnet}.${i}:43111/api`,
        source: 'scan',
        priority: 50
      });
    }
  }

  return candidates;
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
 * Detect available Starfit server (optimized for first-time users)
 * @param onProgress - Callback for progress updates
 * @returns Detection result or null if no server found
 *
 * Strategy:
 * 1. Get client's local IP → determine subnet (e.g., 192.168.31)
 * 2. Priority scan: Gateway (.1, .254) + common IPs (.100, .200) in SAME subnet only
 * 3. If priority fails, scan remaining range (.2-.99) in SAME subnet
 * 4. Fallback to history if all scans fail
 */
export async function detectServer(
  onProgress?: (current: ServerCandidate, total: number) => void
): Promise<DetectionResult | null> {
  console.log('[ServerDetector] Starting server detection...');

  // Phase 0: Get client's local IP to determine subnet
  console.log('[ServerDetector] Getting client IP address...');
  const localIp = await getLocalIpAddress();
  console.log('[ServerDetector] Client IP:', localIp);

  let subnet = '192.168.1'; // fallback
  if (localIp) {
    subnet = extractSubnet(localIp);
    console.log('[ServerDetector] Detected subnet:', subnet);
  }

  // Phase 1: Priority scan (gateway + common IPs) in SAME subnet only
  console.log(`[ServerDetector] Phase 1: Priority scan on ${subnet}.x`);
  const priorityCandidates = generateLanCandidates(subnet, false);
  priorityCandidates.sort((a, b) => b.priority - a.priority);

  const priorityResult = await checkCandidatesInBatches(
    priorityCandidates,
    onProgress,
    20,    // 20 concurrent requests
    800    // 800ms timeout for local network scan
  );

  if (priorityResult) {
    console.log('[ServerDetector] Server found in priority scan:', priorityResult);
    return priorityResult;
  }

  // Phase 2: Exhaustive scan (.2-.99) in SAME subnet only (if priority failed)
  console.log(`[ServerDetector] Phase 2: Exhaustive scan on ${subnet}.x`);
  const exhaustiveCandidates = generateLanCandidates(subnet, true);
  exhaustiveCandidates.sort((a, b) => b.priority - a.priority);

  const exhaustiveResult = await checkCandidatesInBatches(
    exhaustiveCandidates,
    onProgress,
    20,    // 20 concurrent requests
    800    // 800ms timeout for local network scan
  );

  if (exhaustiveResult) {
    console.log('[ServerDetector] Server found in exhaustive scan:', exhaustiveResult);
    return exhaustiveResult;
  }

  // Phase 3: Fallback to history candidates (if LAN scan failed)
  console.log('[ServerDetector] Phase 3: Checking history...');
  const historyCandidates = await getCandidates();
  console.log('[ServerDetector] History candidates:', historyCandidates);

  if (historyCandidates.length > 0) {
    const historyResult = await checkCandidatesInBatches(historyCandidates, onProgress, 20);
    if (historyResult) {
      console.log('[ServerDetector] History found server:', historyResult);
      return historyResult;
    }
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
