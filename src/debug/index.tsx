/**
 * src/debug 出口（issue #53 T1 测试基建）。
 *
 * 接线约定：src/index.tsx 里仅此一处条件动态 import——
 *   if (import.meta.env.DEV && URL 带 ?debug=1) → import('./debug') → mountDebugApp(root)
 * `import.meta.env.DEV` 在生产构建被静态替换为 false，整条分支（连同
 * src/debug 的全部代码）被 tree-shaking 剔除，发布产物零残留（构建门 grep 验证）。
 */
import React from 'react';
import { DebugApp } from './DebugApp';

/** 渲染根（index.tsx 已创建的 ReactDOM root；结构上只需一个 render 方法） */
export interface DebugRoot {
  render(node: React.ReactNode): void;
}

/** URL 是否带 ?debug=1（配合 import.meta.env.DEV 一起短路） */
export function isDebugEntryEnabled(search = window.location.search): boolean {
  return new URLSearchParams(search).has('debug');
}

/** 把调试台挂到既有 root（替换 App 渲染，登录/后端零依赖） */
export function mountDebugApp(root: DebugRoot): void {
  root.render(<DebugApp />);
}

export { DebugApp };
