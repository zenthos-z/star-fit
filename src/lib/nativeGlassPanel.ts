/**
 * nativeGlassPanel — 原生 Liquid Glass 附件面板桥。
 *
 * 原生侧：SwiftUI .glassEffect(.regular) 面板（系统 shader 渲染玻璃），
 * 底边锚在 JS 上报的「输入栏上沿」上方，不遮挡输入框。
 * 选中项经 evaluateJavaScript 直调 window.__glassPanelSelect 回传
 * （notifyListeners 事件通道在本工程不可靠）。
 *
 * Web/Android 或 iOS < 26：调用静默失败，调用方回落自绘 Web 面板。
 */
import { Capacitor } from '@capacitor/core';

export const supportsNativeGlassPanel =
  Capacitor.getPlatform() === 'ios' &&
  (() => {
    // iOS 26+ 才有 .glassEffect；UA 不可信（见技能），用 availability 探测不到，
    // 交给原生侧守卫：旧系统直接 reject，调用方走 catch 回落。
    return true;
  })();

async function callPlugin(method: string, args: Record<string, unknown>): Promise<boolean> {
  if (Capacitor.getPlatform() !== 'ios') return false;
  try {
    await (Capacitor as unknown as {
      nativePromise?: (plugin: string, method: string, args?: Record<string, unknown>) => Promise<unknown>;
    }).nativePromise?.('LiquidGlassPlugin', method, args);
    return true;
  } catch {
    return false; // 旧系统 / 无桥：回落
  }
}

let panelSelectHandler: ((index: number) => void) | null = null;
let panelDismissHandler: (() => void) | null = null;

/**
 * 显示原生玻璃面板。返回 true = 原生面板已呈现；false = 回落 Web 面板。
 * @param anchor { x, width, bottomY } 面板区域（视觉视口坐标，CSS px）：
 *   x/width 为面板左缘与宽度，bottomY 为面板底边目标位置（输入栏上沿）。
 * 点面板外部收起时经 onGlassPanelDismiss 通知（JS 复位「+」旋转态等）。
 */
export async function showGlassPanel(
  anchor: { x: number; width: number; bottomY: number },
): Promise<boolean> {
  if (Capacitor.getPlatform() !== 'ios') return false;
  (window as unknown as { __glassPanelSelect?: (index: number) => void }).__glassPanelSelect =
    (index: number) => {
      panelSelectHandler?.(index);
    };
  (window as unknown as { __glassPanelDismiss?: () => void }).__glassPanelDismiss = () => {
    panelDismissHandler?.();
  };
  return callPlugin('showGlassPanel', {
    x: anchor.x,
    width: anchor.width,
    bottomY: anchor.bottomY,
  });
}

export function hideGlassPanel(): void {
  if (Capacitor.getPlatform() !== 'ios') return;
  void callPlugin('hideGlassPanel', {});
}

export function onGlassPanelSelect(handler: (index: number) => void): void {
  panelSelectHandler = handler;
}

/** 原生面板被点外部收起时的通知（面板自己消失，JS 只需复位状态） */
export function onGlassPanelDismiss(handler: () => void): void {
  panelDismissHandler = handler;
}
