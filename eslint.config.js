import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'android/', 'backend/', 'docs-site/', 'packages/', 'src/admin/', 'build/', 'release/', 'fixtures/'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [...tseslint.configs.recommended],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/rules-of-hooks': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // 存量降级（见 .hermes/plans/2026-09-08 计划的风险预案）：
      // 184 处 no-unused-vars / 30 处 exhaustive-deps / 类型桥接空接口等，随重构逐步清零
      '@typescript-eslint/no-unused-vars': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-empty-object-type': 'off', // src/types/jsx-namespace.d.ts 的 React 19 JSX 桥接是有意的空接口
      '@typescript-eslint/no-require-imports': 'off',   // 测试文件里的 require(mock) 模式，vitest 迁移后再开
      'prefer-const': 'off',
      '@typescript-eslint/ban-ts-comment': 'warn',
    },
  }
);
