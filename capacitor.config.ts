import type { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize } from '@capacitor/keyboard';

const config: CapacitorConfig = {
  appId: 'io.starfit.app',
  appName: 'Starfit',
  webDir: 'dist',
  server: {
    androidScheme: 'http',
    cleartext: true,
    allowNavigation: ['*'],
    // [DEV-ONLY 热更新] 指向 Vite dev server：app 直接加载开发服务器，前端保存即 HMR。
    // 提交/出包前必须注释掉这一行（否则 app 离开本机开发环境就白屏），然后 npx cap sync。
    url: 'http://localhost:43112'
  },
  // 手写原生插件（iOS: LiquidGlassPlugin.swift）注册进桥
  includePlugins: ['AppPlugin', 'LiquidGlassPlugin', '@capacitor/keyboard', '@capacitor/camera'],
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
