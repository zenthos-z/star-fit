/**
 * nativeHaptics — iOS 原生触感反馈桥（HIG 全量映射）。
 *
 * Apple HIG 参考：交互事件→对应强度
 * - light  : 次级按钮、菜单项、卡片点按
 * - medium : 主操作按钮（开始训练、发送消息）
 * - heavy  : 拖拽落位等重操作
 * - success/warning/error : 任务结果通知（导入完成、校验失败等）
 *
 * 底层用 Capacitor 官方 @capacitor/haptics 插件（标准链路，勿再走自研
 * LiquidGlassPlugin.haptic——该路径在真机上未生效，且错误被静默吞掉）。
 * Web/Android 端静默降级（Android Vibration API 观感差，禁用避免廉价感）。
 */
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

export type HapticStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'success' | 'warning' | 'error';

const isIOS = Capacitor.getPlatform() === 'ios';

export function haptic(style: HapticStyle = 'light'): void {
  if (!isIOS) return;
  // 官方插件返回 Promise，但触感不 await——fire-and-forget，失败静默
  switch (style) {
    case 'success':
      Haptics.notification({ type: NotificationType.Success }).catch(() => {});
      break;
    case 'warning':
      Haptics.notification({ type: NotificationType.Warning }).catch(() => {});
      break;
    case 'error':
      Haptics.notification({ type: NotificationType.Error }).catch(() => {});
      break;
    case 'medium':
      Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
      break;
    case 'heavy':
    case 'rigid':
      Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {});
      break;
    default:
      Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
  }
}
