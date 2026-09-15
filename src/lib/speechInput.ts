/**
 * speechInput — iOS 原生语音输入桥（SpeechRecognitionPlugin → SFSpeechRecognizer）。
 *
 * 用途：AI 教练输入栏「按住说话」——流式中文识别，中间结果实时回填输入框，
 * 最终文本交用户确认后走现有聊天链路（与打字输入完全等价，后端零改动）。
 *
 * 工程约束：
 * - 事件通道（notifyListeners）在本工程不可靠（nativeGlassPanel 同源教训），
 *   中间结果一律轮询 getPartialResult 获取。
 * - Web / Android / 无桥环境静默降级：isSpeechInputSupported() 返回 false，UI 隐藏入口。
 */
import { Capacitor } from '@capacitor/core';

const platform = Capacitor.getPlatform();
export const isSpeechInputSupported = platform === 'ios';

interface SpeechBridge {
  nativePromise?: (plugin: string, method: string, args?: Record<string, unknown>) => Promise<unknown>;
}
const bridge = Capacitor as unknown as SpeechBridge;

async function call(method: string, args: Record<string, unknown> = {}): Promise<unknown> {
  if (!isSpeechInputSupported) return null;
  try {
    if (!bridge.nativePromise) return null;
    return await bridge.nativePromise('SpeechRecognitionPlugin', method, args);
  } catch (err: any) {
    console.warn('[speechInput] plugin call failed:', method, err?.message || err);
    return null;
  }
}

export interface SpeechPermissionState {
  /** speech: granted / denied / restricted / notDetermined */
  speech: string;
  /** mic: granted / denied / notDetermined */
  mic: string;
}

export async function requestSpeechPermissions(): Promise<SpeechPermissionState | null> {
  return (await call('requestSpeechPermissions')) as SpeechPermissionState | null;
}

export async function isSpeechRecognizerAvailable(): Promise<boolean> {
  const r = (await call('checkSupported')) as { supported?: boolean } | null;
  return r?.supported === true;
}

/** 开始流式识别（iOS 原生），仅 iOS 有效；返回 true=已启动 */
export async function startSpeechInput(locale = 'zh-CN'): Promise<boolean> {
  const r = (await call('start', { locale, partialResults: true })) as { started?: boolean } | null;
  return r !== null; // resolve() 即启动成功；reject 已被 catch 转 null
}

/** 停止识别，返回最终文本（无则空串）。识别器结束是异步的，轮询等它收尾 */
export async function stopSpeechInput(): Promise<string> {
  await call('stop');
  // endAudio 后 recognitionTask 还需几百 ms 出 isFinal 结果，
  // 轮询 getPartialResult 最多 3s 直到 running=false（拿到最终文本）
  for (let i = 0; i < 15; i++) {
    const { text, running } = await getSpeechPartial();
    if (!running && text) return text;
    if (!running) return '';
    await new Promise((r) => setTimeout(r, 200));
  }
  const r = (await call('getPartialResult')) as { text?: string } | null;
  return r?.text || '';
}

/** 放弃本轮识别（不取结果） */
export async function cancelSpeechInput(): Promise<void> {
  await call('cancel');
}

/** 轮询取中间结果：{ text, running } */
export async function getSpeechPartial(): Promise<{ text: string; running: boolean }> {
  const r = (await call('getPartialResult')) as { text?: string; running?: boolean } | null;
  return { text: r?.text || '', running: r?.running === true };
}
