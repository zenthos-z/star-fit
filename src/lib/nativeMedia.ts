/**
 * nativeMedia — iOS 原生媒体桥。
 *
 * saveImage：PNG data URL → 系统相册（走 LiquidGlassPlugin.saveImage）。
 * 训练战报「保存海报」用：html-to-image 导出的圆角镂空图带透明通道，
 * PNG 保存到相册可完整保留透明四角，与界面所见一致。
 * Web/Android 无原生桥：调用方自行降级（浏览器下载）。
 */
import { Capacitor } from '@capacitor/core';

const isIOS = Capacitor.getPlatform() === 'ios';

const bridge = Capacitor as unknown as {
  nativePromise?: (plugin: string, method: string, args?: Record<string, unknown>) => Promise<unknown>;
};

/**
 * 保存 PNG data URL 到 iOS 系统相册。
 * @returns true = 已保存；false = 无原生桥（Web/Android，调用方走浏览器下载兜底）；reject 抛错 = 失败
 */
export async function saveImageToPhotos(dataUrl: string): Promise<boolean> {
  if (!isIOS || !bridge.nativePromise) return false;
  await bridge.nativePromise('LiquidGlassPlugin', 'saveImage', { dataUrl });
  return true;
}

