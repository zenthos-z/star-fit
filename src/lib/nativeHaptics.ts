/**
 * nativeHaptics — iOS 原生触感反馈桥（HIG 全量映射）。
 *
 * Apple HIG 参考：交互事件→对应强度
 * - light  : 次级按钮、菜单项、卡片点按
 * - medium : 主操作按钮（开始训练、发送消息）
 * - heavy  : 拖拽落位等重操作
 * - success/warning/error : 任务结果通知（导入完成、校验失败等）
 *
 * Web/Android 端静默降级（Android Vibration API 观感差，禁用避免廉价感）。
 */
import { Capacitor } from '@capacitor/core';

export type HapticStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'success' | 'warning' | 'error';

const isIOS = Capacitor.getPlatform() === 'ios';

export function haptic(style: HapticStyle = 'light'): void {
  if (!isIOS) return;
  try {
    (Capacitor as any).nativePromise('LiquidGlassPlugin', 'haptic', { style }).catch(() => {});
  } catch {
    /* 旧版本原生侧无此方法：静默 */
  }
}
