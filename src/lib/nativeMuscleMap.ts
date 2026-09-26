/**
 * nativeMuscleMap — iOS 原生 MuscleMap 人体肌群图桥（A4，issue #12 定案）。
 *
 * 原生侧：MuscleMapPlugin（Swift）+ MuscleMap Swift Package（MIT）——
 * SwiftUI BodyView front/back 双视图叠在 WebView 上方，主发力高饱和橙红、
 * 次发力同色系低饱和纯色填充（配色常量见 src/lib/muscleMap.ts）。
 *
 * 布局约定：JS 上报容器 rect（视觉视口坐标，CSS px ≈ pt），原生 convert 后
 * 原位覆盖；容器滚动时 JS 重报 rect，sheet 拖拽/关闭时 hide。
 *
 * Web/Android 或桥未就绪：showNativeMuscleMap 返回 false，调用方回落肌群胶囊。
 */

import { Capacitor } from '@capacitor/core';

export interface NativeMuscleMapAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NativeMuscleMapPayload {
  primary: string[];
  secondary: string[];
  primaryColor: string;
  secondaryColor: string;
  secondaryOpacity: number;
}

async function callPlugin(
  method: string,
  args: Record<string, unknown>,
): Promise<boolean> {
  if (Capacitor.getPlatform() !== 'ios') return false;
  try {
    await (Capacitor as unknown as {
      nativePromise?: (plugin: string, method: string, args?: Record<string, unknown>) => Promise<unknown>;
    }).nativePromise?.('MuscleMapPlugin', method, args);
    return true;
  } catch {
    return false; // 桥未注册 / 旧二进制：回落胶囊
  }
}

/** 探测原生桥可用性（非 iOS 直接 false，不触发插件调用） */
export function supportsNativeMuscleMap(): boolean {
  return Capacitor.getPlatform() === 'ios';
}

/**
 * 在锚点区域显示原生肌群图。返回 true = 原生图已呈现；false = 回落胶囊。
 * 滚动重定位复用同签名（原生侧更新既有视图 frame）。
 */
export async function showNativeMuscleMap(
  anchor: NativeMuscleMapAnchor,
  payload: NativeMuscleMapPayload,
): Promise<boolean> {
  return callPlugin('showMuscleMap', {
    x: anchor.x,
    y: anchor.y,
    width: anchor.width,
    height: anchor.height,
    primary: payload.primary,
    secondary: payload.secondary,
    primaryColor: payload.primaryColor,
    secondaryColor: payload.secondaryColor,
    secondaryOpacity: payload.secondaryOpacity,
  });
}

/** 隐藏原生肌群图（sheet 关闭/拖拽/离开可视区） */
export function hideNativeMuscleMap(): void {
  if (Capacitor.getPlatform() !== 'ios') return;
  void callPlugin('hideMuscleMap', {});
}
