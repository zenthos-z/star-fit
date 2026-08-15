import { Config } from './packages/e2e-link-checker/src/types';

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
  include: [
    'src/admin/**/*.tsx',
    'src/admin/**/*.ts',
    'src/app/**/*.tsx',
    'src/app/**/*.ts',
    'src/v2/**/*.tsx',
    'src/v2/**/*.ts',
    'backend/src/**/*.ts'
  ],
  exclude: [
    '**/node_modules/**',
    '**/dist/**',
    '**/coverage/**',
    '**/*.test.ts',
    '**/*.test.tsx',
    '**/e2e/**'
  ],
  dependencies: {
    system: ['ffmpeg'],
    node: ['langchain', '@langchain/core', '@playwright/test', 'typescript']
  },
  output: {
    format: 'console'
  }
};

export default config;
