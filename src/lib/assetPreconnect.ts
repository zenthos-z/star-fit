/**
 * assetPreconnect — 资产源预热（T6 视频加载优化）
 *
 * 背景（docs/video-loading-diagnosis.md）：教程视频/海报托管在远端资产源
 * （R2 公开桶），实测冷连接 TLS 握手 0.6–2.7s、TTFB 1.0–3.2s，且与用户
 * 网络间吞吐仅 ~125KB/s。教程 Sheet 打开到用户点「观看演示」之间有天然
 * 阅读间隔——提前对资产源完成 DNS+TCP+TLS 建连，视频首字节等待即可
 * 少掉一整个握手往返。
 *
 * 形态：按 origin 幂等注入标准资源提示（<link rel="preconnect"> +
 * dns-prefetch 兜底），同一 origin 只注入一次；相对/非法 URL 静默忽略
 * （交给页面自身加载路径）。video/img 均为 no-cors 请求，故不加
 * crossorigin（加了会预热出一条用不上的 CORS 连接）。
 */

const warmed = new Set<string>();

/** 对资产 URL 所在源做幂等预热；返回已预热的 origin（未处理返回 null） */
export function preconnectAssetOrigin(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  let origin: string;
  try {
    const u = new URL(rawUrl); // 只处理绝对 URL：相对路径的源即当前页，无需预热
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    origin = u.origin;
  } catch {
    return null;
  }
  if (warmed.has(origin)) return origin;
  warmed.add(origin);

  const mk = (rel: 'preconnect' | 'dns-prefetch') => {
    const link = document.createElement('link');
    link.rel = rel;
    link.href = origin;
    document.head.appendChild(link);
  };
  mk('dns-prefetch'); // 旧 WebView 兜底（不支持 preconnect 时至少省 DNS）
  mk('preconnect');
  return origin;
}
