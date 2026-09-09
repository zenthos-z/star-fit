/**
 * Jest Configuration for ESM + TypeScript
 *
 * Key configurations:
 * - Uses ts-jest with default preset (not ESM)
 * - Handles module imports through moduleNameMapper
 * - Tests run in CommonJS mode for stability
 * - Includes setup file for test environment initialization
 */

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  moduleNameMapper: {
    // Map .js imports to .ts for ESM compatibility
    '^(\\.{1,2}/.*)\\.js$': '$1',
    // Shared contracts import path
    '^shared/(.*)$': '<rootDir>/../shared/$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.test.json',
      },
    ],
  },
  testMatch: [
    '**/tests/unit/**/*.test.ts',
  ],
  // node:test 语法套件 jest 无法承载，排除（由 tsx --test 单独运行）：
  // - tests/unit/services/sessionSchema.test.ts（契约镜像，8 例）
  // - src/services/agent/__tests__/*（118 例，跑 `npx tsx --test src/services/agent/__tests__/*.test.ts`）
  testPathIgnorePatterns: [
    'tests/unit/services/sessionSchema.test.ts',
  ],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
    '!src/**/*.test.ts',
    '!src/db/postgresql', // Exclude PostgreSQL files from Jest tests
  ],
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 50,
      lines: 50,
      statements: 50,
    },
  },
  verbose: true,
  testTimeout: 10000,
};
