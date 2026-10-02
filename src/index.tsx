import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { installUnauthorizedInterceptor } from './services/authInterceptor';
import './index.css';

// #108 机制一：401 全局拦截（包装 window.fetch，登录态 401 → 清凭据 + 踢回登录页）
installUnauthorizedInterceptor();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);

// T1 调试入口（issue #53）：?debug=1 + DEV 构建 → 数据直灌调试台替换 App 渲染。
// 动态 import 使生产构建（DEV=false）整条分支成死代码，src/debug 不进产物。
if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('debug')) {
  void import('./debug').then(m => m.mountDebugApp(root));
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
import('@/storage').then(m => m.requestPersist().catch(() => {}));
