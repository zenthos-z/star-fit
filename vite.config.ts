import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      port: 43112,
      host: '127.0.0.1',
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          // User App Entry
          main: path.resolve(__dirname, 'index.html'),
          // Admin Console Entry
          admin: path.resolve(__dirname, 'admin.html'),
        },
      },
    },
    define: {
      'import.meta.env.VITE_API_BASE_URL': JSON.stringify(env.VITE_API_BASE_URL || 'http://localhost:43111/api'),
      'import.meta.env.VITE_WS_URL': JSON.stringify(env.VITE_WS_URL || ''),
      // 调试版本指纹：诊断页/手表对照用（构建时刻 + 包版本）
      'import.meta.env.VITE_BUILD_TS': JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')),
      'import.meta.env.VITE_PKG_VERSION': JSON.stringify(process.env.npm_package_version || '2.0.0'),
    },
    resolve: {
      alias: [
        { find: '@/services', replacement: path.resolve(__dirname, 'src/services') },
        { find: '@/storage', replacement: path.resolve(__dirname, 'src/storage') },
        { find: '@/hooks', replacement: path.resolve(__dirname, 'src/hooks') },
        { find: '@/utils', replacement: path.resolve(__dirname, 'src/utils') },
        { find: '@/constants', replacement: path.resolve(__dirname, 'src/constants.ts') },
        { find: '@', replacement: path.resolve(__dirname, '.') },
        { find: 'shared/contracts', replacement: path.resolve(__dirname, 'shared/contracts') },
      ]
    },
  };
});
