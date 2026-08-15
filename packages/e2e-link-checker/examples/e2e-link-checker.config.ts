import { Config } from '@mas/e2e-link-checker';

const config: Config = {
  rules: {
    relativeUrl: {
      enabled: true,
      severity: 'error'
    },
    webSocket: {
      enabled: true,
      severity: 'warning'
    },
    dataQuery: {
      enabled: true,
      severity: 'warning'
    },
    dependency: {
      enabled: true,
      severity: 'error'
    },
    aspectRatio: {
      enabled: true,
      severity: 'warning'
    }
  },
  include: ['src/**/*.tsx', 'src/**/*.ts'],
  exclude: [
    '**/node_modules/**',
    '**/dist/**',
    '**/*.test.ts',
    '**/*.test.tsx',
    '**/coverage/**',
    '**/build/**',
    '**/out/**'
  ],
  dependencies: {
    system: ['ffmpeg', 'node'],
    node: ['langchain', '@langchain/core', '@playwright/test']
  },
  output: {
    format: 'console'
  }
};

export default config;
