/**
 * Vitest setup file
 *
 * Configures the testing environment for component tests
 *
 * @version 2.0.0
 */

import { vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';

// --- Jest 兼容层 -----------------------------------------------------------
// 项目 runner 已是 Vitest，但历史测试用 Jest 语法编写（jest.mock/fn/spyOn 等）。
// 此桥把全局 jest 指向 vi，让旧测试无需逐行改写即可运行；新测试请直接用 vi。
(globalThis as any).jest = vi;

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock IntersectionObserver
global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  takeRecords() {
    return [];
  }
  unobserve() {}
} as any;

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  unobserve() {}
} as any;

// Mock requestAnimationFrame
global.requestAnimationFrame = (callback: FrameRequestCallback) => {
  return setTimeout(callback, 0) as unknown as number;
};

global.cancelAnimationFrame = (id: number) => {
  clearTimeout(id);
};

(globalThis as any).jest = vi;

// jsdom 27 × Node undici 版本错位（v3 测试环境修正）：
// jsdom 的 window.fetch 在 POST+自定义头组合下，dispatcher 内部浮动 promise 必然抛
// 'invalid onError method'（Agent.dispatch 校验失败，jsdom 侧传入的 onError 形状不被
// 当前 undici 接受）——该 promise 不经过调用方 await 链，无法在业务代码捕获。
// 测试环境处理：①全局以快速失败桩替换 realm fetch（组件链路离线降级分支本就依赖失败）；
// ②对仍从 jsdom 内部逃逸的这一特定 rejection 静默（其余 unhandled 照常打印）。
vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline (test env)')));
const JSDOM_UNDICI_REJ = 'invalid onError method';
const vitestRejectionListeners = process.listeners('unhandledRejection');
process.removeAllListeners('unhandledRejection');
process.on('unhandledRejection', (reason) => {
  if (String((reason as Error)?.message ?? reason).includes(JSDOM_UNDICI_REJ)) return;
  for (const l of vitestRejectionListeners) (l as (r: unknown) => void)(reason);
});
