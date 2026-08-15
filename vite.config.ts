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
      'import.meta.env.VITE_WS_URL': JSON.stringify(env.VITE_WS_URL || '')
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        'shared/contracts': path.resolve(__dirname, 'shared/contracts'),
      }
    },
  };
});
