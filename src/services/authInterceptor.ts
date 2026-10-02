/**
 * #108 机制一：401 全局拦截 → 半自动登出
 *
 * 出口调查结论（2026-10-02）：项目无统一 apiClient，后端请求经 window.fetch
 * 分散在 30+ 调用点——geminiService（mas/chat、tutorial、image、media、
 * history/summary、strategy、resolve-context）、syncService（sync/push、
 * sync/pull）、exerciseLibraryService、suggestionService、ProfileServiceV2、
 * useAICoach、userProfileService、adminConfigService、watchConnectivity、
 * App.tsx 及组件层（admin v2 页面也复用同一用户凭据，无独立 admin token）。
 * 唯一共同路径是 window.fetch → 最小侵入拦截点 = 入口处一次包装 window.fetch，
 * 不逐处替换调用点。
 *
 * 行为：登录态下收到目标服务器的 401（后端全局 STARFIT_ACCESS_TOKEN 网关
 * 判令牌失效）→ 复用 logout 清理路径清凭据 + reload 踢回登录页。
 * 用户数据（history/计划/会话草稿）保留不洗——防偶发 401 误伤（后端重启窗口），
 * 重新登录后由既有 Server Priority 对账（syncService pull）自然清理孤儿会话。
 * 401 风暴（多请求同时失败）由模块级 flag 保证只登出一次。
 */

import { Keys } from '@/storage/schemas';
import { clearLoginSession } from '@/storage';
import { setAccessToken } from './geminiService';

/** 模块级去重：401 风暴只触发一次登出（同步置位，先于任何 await，天然免竞态） */
let handled401 = false;

/**
 * 测试注入口：jsdom 的 window.location.reload 不可伪造（unforgeable），
 * 经此间接调用供测试断言「登出即回登录页」。
 */
export const __reloadHook = { fn: () => window.location.reload() };

/**
 * 判定请求 URL 是否属于当前登录服务器（origin 相同且 path 在服务器 URL
 * 的 path 之下，如 http://ip:port/api）。局域网扫描等探测其它主机的请求
 * 天然不命中（origin 不同）；登录页自身的 login-or-create 401 由调用方的
 * 登录态守卫兜住（见 handleUnauthorized）。
 */
export function isServerRequest(url: string): boolean {
  try {
    const serverUrl = localStorage.getItem('starfit_server_url');
    if (!serverUrl) return false;
    const target = new URL(url, window.location.origin);
    const server = new URL(serverUrl);
    if (target.origin !== server.origin) return false;
    const basePath = server.pathname.replace(/\/$/, '');
    return target.pathname.startsWith(basePath);
  } catch {
    return false;
  }
}

/**
 * 401 处理核心（幂等）：清凭据（复用 logout 清理路径 clearLoginSession）+
 * 清访问令牌 + reload 踢回登录页。用户数据不动。
 * 未登录态（登录页自身请求 401，如 login-or-create 令牌错误）不触发——
 * 否则登录失败红字提示会被 reload 吞掉。
 */
export async function handleUnauthorized(): Promise<void> {
  if (handled401) return;
  if (!localStorage.getItem(Keys.userId)) return;
  handled401 = true;
  console.warn('[AuthInterceptor] 401 from server — forcing logout (user data preserved)');
  // 令牌与凭据一并失效（与 logout 语义一致；用户数据保留）
  setAccessToken(null);
  await clearLoginSession();
  __reloadHook.fn();
}

/**
 * 入口安装（src/index.tsx 调用一次）：包装 window.fetch，对命中服务器的
 * 401 响应做 fire-and-forget 处理后原样放行——调用方照常拿到 401 走各自的
 * 错误分支，登出与跳转由本模块收口。
 */
export function installUnauthorizedInterceptor(): void {
  if (typeof window === 'undefined') return;
  const w = window as any;
  if (w.__starfit401Installed) return;
  // 保存底层引用：测试重置（__resetForTest）时还原，防止重装层层套娃
  const originalFetch = w.__starfit401OriginalFetch ?? window.fetch.bind(window);
  w.__starfit401OriginalFetch = originalFetch;
  w.__starfit401Installed = true;

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const res = await originalFetch(input, init);
    try {
      if (res.status === 401) {
        const url = typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
        if (isServerRequest(url)) {
          void handleUnauthorized();
        }
      }
    } catch (e) {
      // 拦截层异常绝不影响请求方
      console.warn('[AuthInterceptor] intercept error (ignored):', e);
    }
    return res;
  };
}

/**
 * 测试专用：重置模块级去重 flag 与 window 安装标记，并还原底层 fetch——
 * 模块状态跨用例存活（vitest 每文件一个 jsdom），用例间以此隔离。
 */
export function __resetForTest(): void {
  handled401 = false;
  if (typeof window !== 'undefined') {
    const w = window as any;
    if (w.__starfit401OriginalFetch) {
      window.fetch = w.__starfit401OriginalFetch;
      delete w.__starfit401OriginalFetch;
    }
    delete w.__starfit401Installed;
  }
}
