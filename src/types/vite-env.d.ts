/**
 * Vite 环境变量类型声明。
 *
 * 原声明位于根级 types/global.d.ts（A1 批次删除后迁入此处，字段与原文件一致）。
 * tsconfig 的 `types: ["node"]` 未挂 vite/client，故此处手工声明；
 * 后续批次（types.ts 融合）可改为 `/// <reference types="vite/client" />`。
 */
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_WS_URL?: string;
  readonly VITE_BUILD_TS?: string;
  readonly VITE_PKG_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
