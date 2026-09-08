/**
 * nativeGlass — iOS 26 原生系统组件菜单桥。
 *
 * 载体 = SwiftUI Picker(.segmented)（iOS 26 系统选中胶囊指示器 + Liquid Glass，
 * 视觉/交互/动画全部系统渲染，与官方 App 一致）。
 *  - showMenu(items, frame, selection)  展示系统菜单
 *  - hideMenu                          收起
 *  - menuSelect 事件                    用户选择 → JS 回调
 */
import { Capacitor } from '@capacitor/core';

export interface MenuItemData {
  title: string;
  icon: string;
}

export interface MenuRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const platform = Capacitor.getPlatform();
// iOS 26 的 WKWebView UA 仍报 "OS 18_"，不能用 UA 判断版本；
// iOS 平台一律尝试调用，旧系统由原生层 unavailable 回落。
export const isNativeGlass = platform === 'ios';

if (isNativeGlass && typeof document !== 'undefined') {
  document.body.classList.add('native-glass');
}

async function callPlugin(method: string, args: Record<string, unknown>): Promise<void> {
  try {
    const plugin = (Capacitor as unknown as {
      nativePromise?: (name: string, method: string, args?: Record<string, unknown>) => Promise<unknown>;
    }).nativePromise;
    if (!plugin) throw new Error('nativePromise unavailable');
    await plugin.call(Capacitor, 'LiquidGlassPlugin', method, args);
  } catch {
    // 静默：调用方以 isNativeGlass 预判，这里只兜底
  }
}

export function showMenu(rect: MenuRect, items: MenuItemData[], selection: number): void {
  if (!isNativeGlass) return;
  void callPlugin('showMenu', {
    x: rect.x, y: rect.y, width: rect.width, height: rect.height,
    items: items.map((it) => ({ title: it.title, icon: it.icon })),
    selection,
  });
}

export function hideMenu(): void {
  if (!isNativeGlass) return;
  void callPlugin('hideMenu', {});
}

/** 监听系统菜单选择事件（原生 → JS） */
export function onMenuSelect(handler: (index: number) => void): () => void {
  if (!isNativeGlass) return () => {};
  const listener = (ev: { index: number }) => handler(ev.index);
  try {
    const bridge = (Capacitor as unknown as {
      registerPlugin?: (name: string) => { addListener?: (ev: string, cb: (d: { index: number }) => void) => void };
    }).registerPlugin;
    if (bridge) {
      const plugin = bridge('LiquidGlassPlugin');
      plugin?.addListener?.('menuSelect', listener);
      return () => { /* removeListener 简化：组件卸载时 hideMenu 清理 */ };
    }
  } catch { /* ignore */ }
  return () => {};
}

// ===== 旧 API 兼容（迁移期）=====
export interface LensRect { x: number; y: number; width: number; height: number; }
export function setLens(_rect: LensRect, _direct = false): void { /* no-op：系统组件版 */ }
export function setLabel(
  _id: string, _rect: LensRect, _label: string,
  _active?: boolean, _activeColor = '#2563EB', _inactiveColor = '#111111',
  _icon = '',
): void { /* no-op */ }
export function hideLens(): void { hideMenu(); }
