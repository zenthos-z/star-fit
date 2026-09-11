/**
 * nativeGlassMenu — 原生系统按钮菜单桥（点按触发）。
 *
 * 原生侧：透明 UIButton（showsMenuAsPrimaryAction = true）叠在 Web「···」按钮
 * 正上方，挂在 Capacitor 桥 VC 的 view 层级里；点按弹系统 UIMenu
 * （Liquid Glass 材质、动画、触感全由系统负责）。
 * 坐标换算由原生 convert(_:from:) 完成，JS 只上报视觉视口坐标。
 * 选项点击经 evaluateJavaScript 直调 window.__glassMenuSelect 回传
 * （notifyListeners 事件通道在本工程不可靠）。
 *
 * Web/Android 无此桥，自动静默跳过，回落 Web 自绘菜单。
 */
import { Capacitor } from '@capacitor/core';

export interface GlassMenuItem {
  title?: string;
  /** SF Symbol 名（原生渲染图标） */
  sfSymbol?: string;
  danger?: boolean;
  separator?: boolean;
}

export const isNativeGlassMenu = Capacitor.getPlatform() === 'ios';

async function callPlugin(method: string, args: Record<string, unknown> = {}): Promise<void> {
  try {
    await (Capacitor as unknown as {
      nativePromise?: (plugin: string, method: string, args?: Record<string, unknown>) => Promise<unknown>;
    }).nativePromise?.('LiquidGlassPlugin', method, args);
  } catch {
    /* 原生旧版本无此方法：静默，Web 菜单兜底 */
  }
}

/**
 * 显示原生按钮菜单：原生在 anchor（视觉视口坐标，CSS px）处叠透明按钮，
 * 点按即弹系统菜单。菜单项注册一次，选中经 onGlassMenuSelect 分发。
 */
export async function showGlassMenu(
  items: GlassMenuItem[],
  anchor: { x: number; y: number; size: number },
  opts?: { debug?: boolean },
): Promise<void> {
  if (!isNativeGlassMenu) return;
  await callPlugin('showMenu', {
    items: items.map((it) => ({
      title: it.title ?? '',
      icon: it.sfSymbol ?? '',
      danger: it.danger ?? false,
      separator: it.separator ?? false,
    })),
    x: anchor.x,
    y: anchor.y,
    size: anchor.size,
    debug: opts?.debug ?? false,
  });
}

export function hideGlassMenu(): void {
  if (!isNativeGlassMenu) return;
  void callPlugin('hideMenu', {});
}

let menuSelectHandler: ((index: number) => void) | null = null;
export function onGlassMenuSelect(handler: (index: number) => void): void {
  if (!isNativeGlassMenu) return;
  menuSelectHandler = handler; // 始终指向最新实例的 handler
  // 原生经 evaluateJavaScript 直调 window.__glassMenuSelect（事件通道不可靠，见原生侧注释）
  (window as unknown as { __glassMenuSelect?: (index: number) => void }).__glassMenuSelect = (index: number) => {
    menuSelectHandler?.(index);
  };
}
