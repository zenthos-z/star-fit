import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    exclude: [
      '**/node_modules/**',
      'backend/**',      // 后端测试归 backend 自己的 runner（tsx --test / jest）
      'android/**',
      'dist/**',
    ],
    setupFiles: ['./src/v2/__tests__/setup.ts'],
    css: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'src/v2/__tests__/',
        '**/*.test.{ts,tsx}',
        '**/*.spec.{ts,tsx}',
        'src/admin/',
        'packages/',
        'e2e/',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      'shared/contracts': path.resolve(__dirname, 'shared/contracts'),
      '@/v2': path.resolve(__dirname, 'src/v2'),
    },
  },
});
