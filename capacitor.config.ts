import type { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize } from '@capacitor/keyboard';

const config: CapacitorConfig = {
  appId: 'io.starfit.app',
  appName: 'Starfit',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    // allowNavigation 收敛：HTTPS 不限（自部署服务器证书形态多样）；
    // 明文 HTTP 仅放行私网段（localhost / 127.0.0.0-8 / 10 / 172.16-31 / 192.168），
    // 互联网明文地址不再被 App 内嵌导航。
    allowNavigation: [
      'https://*',
      'localhost',
      '127.0.0.1',
      '10.0.0.0/8',
      '172.16.0.0/12',
      '192.168.0.0/16',
    ],
    // [DEV-ONLY 热更新] 设置 CAP_DEV_URL 环境变量时 app 直连该 dev server 获得 HMR；
    // 不设置则默认加载打包内 web 资源，出包/分发无需手工注释。改动后执行 npx cap sync。
    ...(process.env.CAP_DEV_URL ? { url: process.env.CAP_DEV_URL } : {})
  },
  // 手写原生插件（iOS: LiquidGlassPlugin.swift）注册进桥
  includePlugins: ['AppPlugin', 'LiquidGlassPlugin', '@capacitor/keyboard', '@capacitor/camera', '@capawesome/capacitor-file-picker'],
  plugins: {
    // 键盘不推挤/不缩放 webview 视口：聚焦输入框时整个页面被顶上灵动岛的根因修复。
    // webview 尺寸保持不变，输入框可见性由页面自身布局（底部输入栏 + safe-bottom 冻结）负责。
    Keyboard: {
      resize: KeyboardResize.None,
      resizeOnFullScreen: true
    }
  }
};

export default config;
