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
    // Handle better-sqlite3 ESM import
    '^better-sqlite3$': 'better-sqlite3',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.test.json',
      },
    ],
  },
  transformIgnorePatterns: [
    'node_modules/(?!(better-sqlite3)/)',
    '/node_modules/(?!(better-sqlite3)/)',  // Exclude better-sqlite3 from node_modules
  ],
  testMatch: [
    '**/tests/unit/**/*.test.ts',
    '**/tests/integration/**/*.test.ts',
    '**/__tests__/**/*.test.ts',
  ],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
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
