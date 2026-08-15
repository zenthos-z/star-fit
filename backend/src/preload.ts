/**
 * 代理预加载文件
 * 必须在任何其他模块导入之前执行，确保所有 HTTP 请求都使用代理
 */

import { ProxyAgent, setGlobalDispatcher } from "undici";
import dotenv from "dotenv";

// 加载环境变量
dotenv.config();
// 本地覆盖（不进 git，见 .gitignore）：放本地 secret 如 DEEPSEEK_API_KEY
dotenv.config({ path: ".env.local", override: true });

// 配置代理
const proxyUrl = process.env.GEMINI_PROXY || process.env.GLOBAL_PROXY || "";
if (proxyUrl) {
  // 1. 设置 undici 全局 dispatcher
  const dispatcher = new ProxyAgent(proxyUrl);
  setGlobalDispatcher(dispatcher);
  console.log('[ProxyPreload] Global ProxyAgent configured:', proxyUrl);

  // 2. 设置全局 fetch 环境变量（Node.js 18+ 原生 fetch 会使用这些）
  process.env.HTTP_PROXY = proxyUrl;
  process.env.HTTPS_PROXY = proxyUrl;
  process.env.http_proxy = proxyUrl;
  process.env.https_proxy = proxyUrl;
  console.log('[ProxyPreload] Fetch proxy environment variables set');
} else {
  console.log('[ProxyPreload] No proxy URL configured, using direct connection');
}

// 导入应用
await import("./server.js");
