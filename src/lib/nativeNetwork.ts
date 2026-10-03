/**
 * nativeNetwork — iOS 原生本机 IP 桥（#84 返工定案）。
 *
 * 原生侧：NativeNetworkPlugin（Swift，getifaddrs 枚举接口，en0 优先，
 * 仅认 RFC1918 私网段与回环）。背景：iOS WKWebView 对 WebRTC host
 * candidate 做 mDNS 混淆（xxx.local），浏览器路径拿不到真实本机 IP →
 * 扫描网段错误、局域网服务器扫不出来。
 *
 * Web/Android 或桥未就绪：getNativeLanIpv4 返回 null，调用方
 * （serverDetector.getLocalIpAddress）回退 WebRTC 旧路径。
 */

import { Capacitor } from '@capacitor/core';

/** 探测原生桥可用性（非 iOS 直接 false，不触发插件调用） */
export function supportsNativeNetwork(): boolean {
  return Capacitor.getPlatform() === 'ios';
}

/**
 * 取本机局域网 IPv4（原生 getifaddrs，en0 优先，仅私网/回环地址）。
 * 非 iOS 平台、桥未注册（旧二进制）或无私网接口时返回 null——调用方自行回退。
 */
export async function getNativeLanIpv4(): Promise<string | null> {
  if (Capacitor.getPlatform() !== 'ios') return null;
  try {
    const result = await (Capacitor as unknown as {
      nativePromise?: (
        plugin: string,
        method: string,
        args?: Record<string, unknown>
      ) => Promise<unknown>;
    }).nativePromise?.('NativeNetworkPlugin', 'getLanIpv4');
    const ip = (result as { ip?: unknown } | undefined)?.ip;
    return typeof ip === 'string' && ip !== '' ? ip : null;
  } catch {
    return null; // 桥未注册 / 旧二进制：回退 WebRTC
  }
}
