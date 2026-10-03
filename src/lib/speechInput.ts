/**
 * speechInput — 语音输入双轨（2026-10-01 返工③-② 项目主人定调）：
 *
 * 轨 1 · iOS 原生壳：SpeechRecognitionPlugin → SFSpeechRecognizer 原生桥（既有链路，
 *        权限/流式/轮询全走原生）。WKWebView 里虽有 Web Speech API，仍走原生桥——
 *        原生 STT 是 iOS 侧拍板路径（与 AI 教练输入栏同源）。
 * 轨 2 · Web / 安卓（含安卓 Capacitor WebView = Chromium 内核）：浏览器 Web Speech API
 *        （SpeechRecognition / webkitSpeechRecognition 特征检测）。浏览器兼容 → 显示
 *        麦克风入口；不支持 → 降级隐藏（isSpeechInputSupported=false）。
 *
 * 用途：AI 教练输入栏「按住说话」、#98 感受表单「记录细节」——流式中文识别，
 * 中间结果实时回填输入框，最终文本交用户确认后走现有链路（后端零改动）。
 *
 * 工程约束：
 * - iOS 原生轨：事件通道（notifyListeners）在本工程不可靠（nativeGlassPanel 同源教训），
 *   中间结果一律轮询 getPartialResult 获取。
 * - 两轨对外契约完全一致（同一组导出函数/返回形状），消费方（FeelModal / AI 对话框）
 *   无需感知当前在哪条轨。
 * - Web 轨的麦克风授权由 recognition.start() 触发浏览器弹窗（requestSpeechPermissions
 *   直接放行 granted），拒绝时经 onerror('not-allowed') 从 getSpeechPartial().error 上报。
 */
import { Capacitor } from '@capacitor/core';

const platform = Capacitor.getPlatform();
/** iOS 原生壳 → 原生桥轨；其余环境一律走 Web Speech 轨 */
const useNative = platform === 'ios';

// ---- Web Speech 轨：特征检测（同步，供渲染层条件渲染） ----

/** 最小化 Web Speech 类型（避免引入 DOM lib 差异；Chrome/Safari 实现细节不进契约） */
interface WebSpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>; resultIndex: number }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type WebSpeechCtor = new () => WebSpeechRecognitionLike;

const getWebSpeechCtor = (): WebSpeechCtor | null => {
  const w = globalThis as unknown as Record<string, unknown>;
  if (typeof w.SpeechRecognition === 'function') return w.SpeechRecognition as WebSpeechCtor;
  if (typeof w.webkitSpeechRecognition === 'function') return w.webkitSpeechRecognition as WebSpeechCtor;
  return null;
};

/** iOS 原生壳=原生桥恒可用；Web/安卓=浏览器特征检测（兼容显示，不支持隐藏） */
export const isSpeechInputSupported = useNative || getWebSpeechCtor() !== null;

// ---- 轨 1 · iOS 原生桥（既有实现原样保留） ----

interface SpeechBridge {
  nativePromise?: (plugin: string, method: string, args?: Record<string, unknown>) => Promise<unknown>;
}
const bridge = Capacitor as unknown as SpeechBridge;

async function callNative(method: string, args: Record<string, unknown> = {}): Promise<unknown> {
  if (!useNative) return null;
  try {
    if (!bridge.nativePromise) return null;
    return await bridge.nativePromise('SpeechRecognitionPlugin', method, args);
  } catch (err: any) {
    console.warn('[speechInput] plugin call failed:', method, err?.message || err);
    return null;
  }
}

// ---- 轨 2 · Web Speech 状态（模块级，与原生桥的会话语义对齐：同一时刻一轮识别） ----

let webRec: WebSpeechRecognitionLike | null = null;
let webFinal = '';
let webInterim = '';
let webRunning = false;
let webError: string | undefined;
let webFinalizedCount = 0;

const webReset = () => {
  webRec = null;
  webFinal = '';
  webInterim = '';
  webRunning = false;
  webFinalizedCount = 0;
};

function webStart(locale: string): boolean {
  const Ctor = getWebSpeechCtor();
  if (!Ctor) return false;
  webReset();
  webError = undefined;
  const rec = new Ctor();
  rec.lang = locale;
  rec.continuous = true;
  rec.interimResults = true;
  rec.onresult = (e) => {
    let interim = '';
    for (let i = webFinalizedCount; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) {
        webFinal += res[0].transcript;
        webFinalizedCount++;
      } else {
        interim += res[0].transcript;
      }
    }
    webInterim = interim;
  };
  rec.onerror = (e) => {
    webError = e.error; // not-allowed / network / language-not-supported…（读即清语义在 getSpeechPartial）
  };
  rec.onend = () => {
    webRunning = false; // 引擎自停（静音超时等）：轮询侧据此收口
  };
  try {
    rec.start();
  } catch (err) {
    console.warn('[speechInput] web start failed:', err);
    webReset();
    return false;
  }
  webRec = rec;
  webRunning = true;
  return true;
}

function webStop(): Promise<string> {
  return new Promise((resolve) => {
    if (!webRec) {
      resolve('');
      return;
    }
    const rec = webRec;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      const text = (webFinal + webInterim).trim();
      webReset();
      resolve(text);
    };
    rec.onend = finish; // stop() 后引擎冲刷最终结果再触发 onend
    try {
      rec.stop();
    } catch {
      finish();
      return;
    }
    setTimeout(finish, 1500); // 兜底：个别引擎不触发 onend（幂等，done 守卫）
  });
}

function webCancel(): void {
  const rec = webRec;
  webReset();
  try {
    rec?.abort();
  } catch {
    /* 已死会话 abort 抛错无意义，静默 */
  }
}

// ---- 对外契约（两轨共用签名，内部分流） ----

export interface SpeechPermissionState {
  /** speech: granted / denied / restricted / notDetermined */
  speech: string;
  /** mic: granted / denied / notDetermined */
  mic: string;
}

export async function requestSpeechPermissions(): Promise<SpeechPermissionState | null> {
  if (useNative) return (await callNative('requestSpeechPermissions')) as SpeechPermissionState | null;
  // Web 轨：真实麦克风授权由 recognition.start() 触发浏览器弹窗；
  // 此处放行让流程走通，拒绝时 onerror('not-allowed') 从 getSpeechPartial().error 上报
  return { speech: 'granted', mic: 'granted' };
}

export async function isSpeechRecognizerAvailable(): Promise<boolean> {
  if (useNative) {
    const r = (await callNative('checkSupported')) as { supported?: boolean } | null;
    return r?.supported === true;
  }
  return getWebSpeechCtor() !== null;
}

/** 开始流式识别（iOS 原生桥 / Web Speech 双轨）；返回 true=已启动 */
export async function startSpeechInput(locale = 'zh-CN'): Promise<boolean> {
  if (useNative) {
    const r = (await callNative('start', { locale, partialResults: true })) as { started?: boolean } | null;
    return r !== null; // resolve() 即启动成功；reject 已被 catch 转 null
  }
  return webStart(locale);
}

/** 停止识别，返回最终文本（无则空串）。识别器结束是异步的，轮询等它收尾 */
export async function stopSpeechInput(): Promise<string> {
  if (useNative) {
    await callNative('stop');
    // endAudio 后 recognitionTask 还需几百 ms 出 isFinal 结果，
    // 轮询 getPartialResult 最多 3s 直到 running=false（拿到最终文本）
    for (let i = 0; i < 15; i++) {
      const { text, running } = await getSpeechPartial();
      if (!running && text) return text;
      if (!running) return '';
      await new Promise((r) => setTimeout(r, 200));
    }
    const r = (await callNative('getPartialResult')) as { text?: string } | null;
    return r?.text || '';
  }
  return webStop();
}

/** 放弃本轮识别（不取结果） */
export async function cancelSpeechInput(): Promise<void> {
  if (useNative) {
    await callNative('cancel');
    return;
  }
  webCancel();
}

/** 轮询取中间结果：{ text, running, error? }（error 读即清，来自识别回调） */
export async function getSpeechPartial(): Promise<{ text: string; running: boolean; error?: string }> {
  if (useNative) {
    const r = (await callNative('getPartialResult')) as { text?: string; running?: boolean; error?: string } | null;
    return { text: r?.text || '', running: r?.running === true, error: r?.error };
  }
  const text = webFinal + webInterim;
  const err = webError;
  webError = undefined; // 读即清（与原生桥 error 语义一致）
  return { text, running: webRunning, error: err };
}
