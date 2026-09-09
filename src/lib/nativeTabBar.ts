/**
 * nativeTabBar — iOS 26 原生系统 Tab Bar 桥（常驻 3 页签）。
 *
 * 原生侧：SwiftUI TabView 的 tab bar 视觉由系统渲染（Liquid Glass 官方实现）。
 * 本插件把 WebView 底部让出一块区域，原生 Tab Bar 常驻显示，
 * 选择事件通过 'tabSelect' 通知 JS；JS 侧同步选中态（setCurrentTab）。
 *
 * 路由仍由 Web 层（React）拥有——原生只是导航控件，不承载页面。
 */
import { Capacitor } from '@capacitor/core';

export interface TabItem {
  title: string;
  /** SF Symbol 名（原生渲染）；Web 层另有 React 图标 */
  sfSymbol: string;
}

export const TABS: TabItem[] = [
  { title: '历史', sfSymbol: 'clock.arrow.circlepath' },
  { title: '开始运动', sfSymbol: 'figure.run' },
  { title: 'AI Agent', sfSymbol: 'sparkles' },
];

const platform = Capacitor.getPlatform();
export const isNativeTabBar = platform === 'ios';

interface NativeBridge {
  nativePromise?: (plugin: string, method: string, args?: Record<string, unknown>) => Promise<unknown>;
  registerPlugin?: (name: string) => {
    addListener?: (ev: string, cb: (d: { tab: number }) => void) => unknown;
    removeAllListeners?: () => void;
  };
}
const bridge = Capacitor as unknown as NativeBridge;

async function callPlugin(method: string, args: Record<string, unknown> = {}): Promise<void> {
  try {
    if (!bridge.nativePromise) throw new Error('no bridge');
    await bridge.nativePromise('LiquidGlassPlugin', method, args);
  } catch {
    /* 原生旧版本无此方法：静默，Web TabBar 兜底 */
  }
}

export function showTabBar(selected: number): void {
  if (!isNativeTabBar) return;
  void callPlugin('showTabBar', {
    tabs: TABS.map((t) => ({ title: t.title, icon: t.sfSymbol })),
    selection: selected,
  });
}

export function setCurrentTab(index: number): void {
  if (!isNativeTabBar) return;
  void callPlugin('setCurrentTab', { selection: index });
}

/**
 * 层叠安全的 tab bar 隐藏（引用计数）：
 * sheet 会叠开（战报页 → 海报 sheet → 结果 viewer），内层 sheet 卸载时
 * 不能无条件恢复显示，否则会把底下还开着的 sheet 的隐藏状态吹掉。
 * 只有「最后一个隐藏者卸载」才真正恢复。
 */
let hiddenCount = 0;
let lastSentHidden = false;
export function setTabBarHidden(hidden: boolean): void {
  if (!isNativeTabBar) return;
  hiddenCount = Math.max(0, hiddenCount + (hidden ? 1 : -1));
  const next = hiddenCount > 0;
  if (next !== lastSentHidden) {
    lastSentHidden = next;
    void callPlugin('setTabBarDimmed', { dimmed: next });
  }
}

export function hideTabBar(): void {
  if (!isNativeTabBar) return;
  void callPlugin('hideTabBar', {});
}

let listenerBound = false;
let tabSelectHandler: ((index: number) => void) | null = null;
export function onTabSelect(handler: (index: number) => void): void {
  if (!isNativeTabBar) return;
  tabSelectHandler = handler; // 始终指向最新组件实例的 handler
  if (listenerBound) return;
  listenerBound = true;
  try {
    const plugin = bridge.registerPlugin?.('LiquidGlassPlugin');
    plugin?.addListener?.('tabSelect', (d: { tab: number }) => {
      console.log('[nativeTabBar] tabSelect received:', d.tab);
      tabSelectHandler?.(d.tab);
    });
  } catch { /* ignore */ }
}

/** 轮询用：读取原生当前选中页签 */
export async function getSelectedTab(): Promise<number | null> {
  if (!isNativeTabBar) return null;
  try {
    if (!bridge.nativePromise) return null;
    const r: any = await bridge.nativePromise('LiquidGlassPlugin', 'getCurrentTab', {});
    return typeof r?.tab === 'number' ? r.tab : null;
  } catch { return null; }
}
