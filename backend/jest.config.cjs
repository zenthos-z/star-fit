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
  setupFiles: ['<rootDir>/tests/setup-env.ts'],
  rootDir: '.',
  moduleNameMapper: {
    // 源码直接 import shared/dist/*（postgres-client.ts / user.repository.ts 等），
    // 把构建产物路径映射回 shared 源码，让 ts-jest 直接编译 TS 源，
    // 避免加载 shared/dist/*.js（package type=module → ESM SyntaxError）或
    // dist 不存在时 "Could not locate module"。
    '^(.*)shared/dist/(.*)\\.js$': '<rootDir>/../shared/$2',
    // Map .js imports to .ts for ESM compatibility
    '^(\\.{1,2}/.*)\\.js$': '$1',
    // Shared contracts import path
    '^shared/(.*)$': '<rootDir>/../shared/$1',
  },
  transform: {
    '^.+\\.[jt]sx?$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.test.json',
      },
    ],
  },
  // uuid v11+ 是 ESM-only（无 CJS 构建），被 videoProcessingService 链引入；
  // nanoid v5+ 同样 ESM-only，被 utils/nanoid.ts 引入。
  // 白名单放行让 ts-jest(allowJs) 把它编译成 CJS，jest 才能加载。
  transformIgnorePatterns: [
    'node_modules/(?!(uuid|nanoid)/)',
  ],
  testMatch: [
    '**/tests/unit/**/*.test.ts',
    '**/tests/integration/**/*.test.ts',
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
  // integration 测试直连 PG，PostgresClient 池（min:2）会在测试结束后保持句柄，
  // 不 forceExit jest 会永久挂起。测试完毕即强制退出（结果已产出）。
  forceExit: true,
};
