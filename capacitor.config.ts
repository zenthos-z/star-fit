import type { CapacitorConfig } from '@capacitor/cli';

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
  includePlugins: ['AppPlugin', 'LiquidGlassPlugin']
};

export default config;
