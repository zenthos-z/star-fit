import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * speechInput Web 轨单测（2026-10-01 返工③-② 语音双轨改造）：
 * iOS 原生桥轨由 FeelModal.test.tsx（整模块 mock）与 AI 对话框既有链路覆盖，
 * 这里覆盖 Web/安卓的 Web Speech API 轨：
 * - 特征检测：有 SpeechRecognition/webkitSpeechRecognition → supported；无 → 隐藏入口
 * - 启动 / partial 回填（final 累计 + interim 即时）/ 停止取最终文本 / 取消放弃
 * - 错误上报（not-allowed 等，读即清语义与原生桥一致）
 * jsdom 无 SpeechRecognition → 假构造器注入 globalThis，
 * vi.resetModules + 动态 import 重新求值模块级特征检测。
 */

type Resultish = { isFinal: boolean; 0: { transcript: string } };

/** start() 抛错开关（模块级而非 prototype：类字段初始化会遮蔽原型注入） */
let fakeStartShouldFail: unknown = null;

class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = '';
  continuous = false;
  interimResults = false;
  onresult: ((e: { results: Resultish[]; resultIndex: number }) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  started = false;
  constructor() {
    FakeRecognition.instances.push(this);
  }
  start() {
    if (fakeStartShouldFail) throw fakeStartShouldFail;
    this.started = true;
  }
  stop() {
    this.onend?.();
  }
  abort() {
    this.onend?.();
  }
  emit(results: Resultish[]) {
    this.onresult?.({ results, resultIndex: 0 });
  }
  fail(code: string) {
    this.onerror?.({ error: code });
  }
}

const loadModule = async () => {
  vi.resetModules();
  return await import('../speechInput');
};

beforeEach(() => {
  FakeRecognition.instances = [];
  fakeStartShouldFail = null;
  (globalThis as unknown as Record<string, unknown>).webkitSpeechRecognition = FakeRecognition;
});

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).webkitSpeechRecognition;
});

describe('speechInput · Web/安卓 Web Speech 轨（返工③-② 双轨）', () => {
  it('特征检测：浏览器有 webkitSpeechRecognition → isSpeechInputSupported=true', async () => {
    const m = await loadModule();
    expect(m.isSpeechInputSupported).toBe(true);
  });

  it('特征检测：无任何 Web Speech 构造器 → supported=false（降级隐藏入口）', async () => {
    delete (globalThis as unknown as Record<string, unknown>).webkitSpeechRecognition;
    const m = await loadModule();
    expect(m.isSpeechInputSupported).toBe(false);
    expect(await m.startSpeechInput()).toBe(false);
    expect(await m.requestSpeechPermissions()).toEqual({ speech: 'granted', mic: 'granted' });
  });

  it('启动：构造实例、lang/continuous/interimResults 就位，轮询 running=true', async () => {
    const m = await loadModule();
    await expect(m.startSpeechInput('zh-CN')).resolves.toBe(true);
    const rec = FakeRecognition.instances[0];
    expect(rec.started).toBe(true);
    expect(rec.lang).toBe('zh-CN');
    expect(rec.continuous).toBe(true);
    expect(rec.interimResults).toBe(true);
    await expect(m.getSpeechPartial()).resolves.toEqual({ text: '', running: true });
  });

  it('partial 回填：final 累计不重复、interim 即时拼接', async () => {
    const m = await loadModule();
    await m.startSpeechInput();
    const rec = FakeRecognition.instances[0];
    rec.emit([{ isFinal: false, 0: { transcript: '今天' } }]);
    await expect(m.getSpeechPartial()).resolves.toMatchObject({ text: '今天', running: true });
    rec.emit([
      { isFinal: true, 0: { transcript: '今天' } },
      { isFinal: false, 0: { transcript: '很累' } },
    ]);
    // 同一 final 再入不重复累计（finalizedCount 游标），interim 拼在尾部
    await expect(m.getSpeechPartial()).resolves.toMatchObject({ text: '今天很累', running: true });
  });

  it('停止：取最终文本，会话收口（running=false、后续 partial 归零）', async () => {
    const m = await loadModule();
    await m.startSpeechInput();
    const rec = FakeRecognition.instances[0];
    rec.emit([
      { isFinal: true, 0: { transcript: '今天很累 ' } },
      { isFinal: false, 0: { transcript: '但是值' } },
    ]);
    await expect(m.stopSpeechInput()).resolves.toBe('今天很累 但是值');
    await expect(m.getSpeechPartial()).resolves.toEqual({ text: '', running: false });
  });

  it('取消：abort 后状态重置，不产出文本', async () => {
    const m = await loadModule();
    await m.startSpeechInput();
    FakeRecognition.instances[0].emit([{ isFinal: false, 0: { transcript: '半句话' } }]);
    await m.cancelSpeechInput();
    await expect(m.getSpeechPartial()).resolves.toEqual({ text: '', running: false });
  });

  it('错误上报：not-allowed 读即清（第二次轮询 error 消失，与原生桥语义一致）', async () => {
    const m = await loadModule();
    await m.startSpeechInput();
    FakeRecognition.instances[0].fail('not-allowed');
    await expect(m.getSpeechPartial()).resolves.toMatchObject({ error: 'not-allowed' });
    const second = await m.getSpeechPartial();
    expect(second.error).toBeUndefined();
  });

  it('start 抛错（引擎拒启）→ 返回 false 且状态干净', async () => {
    fakeStartShouldFail = new Error('engine refused');
    const m = await loadModule();
    await expect(m.startSpeechInput()).resolves.toBe(false);
    await expect(m.getSpeechPartial()).resolves.toEqual({ text: '', running: false });
  });
});
