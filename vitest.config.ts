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
      'packages/**',     // 子包如有自己的 runner，防止 vitest 误捡
      'android/**',
      'dist/**',
    ],
    setupFiles: ['./src/__tests__/setup.ts'],
    css: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'src/__tests__/',
        '**/*.test.{ts,tsx}',
        '**/*.spec.{ts,tsx}',
        'src/admin/',
        'packages/',
        'e2e/',
      ],
    },
  },
  resolve: {
    alias: [
      { find: '@/services', replacement: path.resolve(__dirname, 'src/services') },
      { find: '@/storage', replacement: path.resolve(__dirname, 'src/storage') },
      { find: '@/utils', replacement: path.resolve(__dirname, 'src/utils') },
      { find: '@/constants', replacement: path.resolve(__dirname, 'src/constants.ts') },
      { find: '@', replacement: path.resolve(__dirname, '.') },
      { find: 'shared/contracts', replacement: path.resolve(__dirname, 'shared/contracts') },
    ],
  },
});
