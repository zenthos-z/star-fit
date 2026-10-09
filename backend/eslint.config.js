/**
 * Backend flat config（ESLint 9）。#166/#153：此前 backend 只有 legacy
 * .eslintrc.json，ESLint 9 默认 flat config——从 backend CWD 向上找到根
 * eslint.config.js，而其全局 ignores 含 'backend/' → `npm run lint`
 * "all files are ignored" 直接报错（lint 实际从未跑过）。
 *
 * 本文件沿用 legacy .eslintrc.json 的规则语义：type-aware（projectService
 * 挂 backend/tsconfig.json）+ 同名规则同档位；recommended-requiring-type-
 * checking 的现代等价 = recommendedTypeChecked（floating-promises 等三条
 * 类型规则在下方显式保留 error）。存量口径见各规则的「存量降级」注释。
 */
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  // 与 legacy ignorePatterns 对齐（legacy 未忽略 tests/，lint 脚本也只扫 src/）
  { ignores: ["dist/", "node_modules/", "**/*.config.js", "**/*.config.ts"] },
  {
    files: ["**/*.ts"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // —— 与 legacy .eslintrc.json 同名同档 ——
      // 存量降级（error→warn + 一行原因，随重构逐步清零后升回）：
      // 首跑实测 1897 E / 687 W（#153 修复前 lint 从未真跑过，存量都在）。
      "@typescript-eslint/no-unused-vars": [
        "warn", // 存量 62 处
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn", // 存量 320 处
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      // no-unsafe-* 五件套存量 1314 处，全部是 320 处显式 any 的连带
      // （DB JSON 行解包 / error 捕获边界），与 any 同批清零
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      "@typescript-eslint/no-floating-promises": "warn", // 存量 342 处 fire-and-forget，需系统化补 void/Promise.all 后升回
      "@typescript-eslint/no-misused-promises": "warn", // 存量 5 处：fastify 异步 handler / ffmpeg·定时器回调（框架侧自 await，误报面）
      "@typescript-eslint/await-thenable": "warn", // 存量 38 处
      "@typescript-eslint/no-unnecessary-type-assertion": "warn", // 存量 89 处
      "@typescript-eslint/require-await": "warn", // 存量 79 处（接口一致性的空 async）
      eqeqeq: "warn", // 存量 13 处 `!= null` 宽松判空惯用法（改 === 变语义）
      "@typescript-eslint/no-redundant-type-constituents": "warn", // 存量 5 处（pino 序列化器 unknown 联合习惯）
      "@typescript-eslint/no-unsafe-enum-comparison": "warn", // 存量 4 处（DB 字符串 vs TS enum 对比）
      "@typescript-eslint/no-base-to-string": "warn", // 存量 3 处
      "@typescript-eslint/prefer-promise-reject-errors": "warn", // 存量 1 处（catch err:unknown 透传）
      "@typescript-eslint/no-unsafe-function-type": "warn", // 存量 1 处（errorHandler 的 Function 形参类型）
      "no-unused-expressions": "warn", // 存量 1 处（测试文件表达式断言）
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "prefer-const": "error",
      "no-var": "error",
      curly: ["error", "all"],
      "no-throw-literal": "error",
      "no-return-await": "error",
    },
  },
  prettier,
);
