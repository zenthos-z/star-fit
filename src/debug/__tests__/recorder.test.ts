/**
 * T1 SSE 记录器测试（issue #53）——观测层自身的确定性回归。
 *
 * 覆盖：
 * - classifyFrame：事件帧/ping 注释帧/未知类型/坏 JSON/[DONE]/空帧——禁炸
 * - createFramePipeline：跨 chunk 分帧、CRLF、残尾 flush
 * - installSseFetchTap：tee 旁路不改消费方字节；SSE 识别；卸载恢复
 * - replayRawStream：fixture 流全量入账（含 ping）
 * - SseRecorder：轮数/帧数护栏
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  classifyFrame,
  createFramePipeline,
  installSseFetchTap,
  replayRawStream,
  SseRecorder,
  sseRecorder,
} from '../sse/recorder';
import { SSE_STREAMS } from '../fixtures';

// ── classifyFrame ──────────────────────────────────────────────────────────

describe('classifyFrame · 帧分类（禁炸）', () => {
  it('token / thinking / uiHint / done / error 事件帧正确归类并规整化', () => {
    expect(classifyFrame('data: {"type":"token","text":"你好"}')?.kind).toBe('token');
    expect(classifyFrame('data: {"type":"thinking","text":"推敲中"}')?.kind).toBe('thinking');
    const uiHint = classifyFrame('data: {"type":"uiHint","card":{"type":"plan_card","data":[]}}');
    expect(uiHint?.kind).toBe('uiHint');
    expect(uiHint?.summary).toContain('plan_card');
    expect(classifyFrame('data: {"type":"done"}')?.kind).toBe('done');
    const err = classifyFrame('data: {"type":"error","error":{"code":"CONNECTION_LOST","message":"断流"}}');
    expect(err?.kind).toBe('error');
    expect(err?.summary).toContain('CONNECTION_LOST');
  });

  it('`: ping` 注释帧 → kind=comment（生产解析器不可见，调试台必须可见）', () => {
    const frame = classifyFrame(': ping');
    expect(frame?.kind).toBe('comment');
    expect(frame?.summary).toBe('ping');
    // 冒号后多空格 / 注释文字变体同样识别
    expect(classifyFrame(':   keepalive note')?.kind).toBe('comment');
  });

  it('未知帧类型 → kind=unknown，绝不抛错', () => {
    const frame = classifyFrame('data: {"type":"experimental_frame","payload":1}');
    expect(frame?.kind).toBe('unknown');
    expect(frame?.summary).toContain('experimental_frame');
  });

  it('畸形 JSON → kind=malformed，绝不抛错', () => {
    const frame = classifyFrame('data: {"type":"token",');
    expect(frame?.kind).toBe('malformed');
    expect(frame?.summary).toContain('畸形');
  });

  it('[DONE] 哨兵 → unknown 标注；空帧 → null（不入账）', () => {
    expect(classifyFrame('data: [DONE]')?.kind).toBe('unknown');
    expect(classifyFrame('data: [DONE]')?.summary).toContain('[DONE]');
    expect(classifyFrame('')).toBeNull();
    expect(classifyFrame('   ')).toBeNull();
  });

  it('多行 data 按 SSE 规范拼接成完整 JSON', () => {
    const frame = classifyFrame('data: {"type":"token",\ndata:  "text":"拼接成功"}');
    expect(frame?.kind).toBe('token');
    expect(frame?.event).toEqual({ type: 'token', text: '拼接成功' });
  });

  it('任意恶意输入不抛异常（fuzz 冒烟）', () => {
    const junk = [
      'data: \u0000\u0001',
      'data: {{{{',
      'data: null',
      'data: 123',
      'data: "str"',
      ':\n:\n:',
      'data: {"type":123}',
      'event: custom\ndata: {"type":"token","text":"x"}',
    ];
    for (const input of junk) {
      expect(() => classifyFrame(input)).not.toThrow();
    }
    // 非事件 JSON（123/null）归 unknown，不冒充事件
    expect(classifyFrame('data: 123')?.kind).toBe('unknown');
  });
});

// ── createFramePipeline ────────────────────────────────────────────────────

describe('createFramePipeline · 跨 chunk 增量解析', () => {
  it('字节随意切碎，帧边界完整还原（\n\n 与 \r\n\r\n 混用）', () => {
    const frames: string[] = [];
    const p = createFramePipeline(f => frames.push(f));
    p.ingest('data: {"type":"token","text":"A"}\n');
    p.ingest('\ndata: {"type":"token","text":"B"}\r\n\r');
    p.ingest('\ndata: {"type":"done"}\n\n');
    expect(frames).toEqual([
      'data: {"type":"token","text":"A"}',
      'data: {"type":"token","text":"B"}',
      'data: {"type":"done"}',
    ]);
  });

  it('流结束 flush 残尾（无结尾空行的最后一帧）', () => {
    const frames: string[] = [];
    const p = createFramePipeline(f => frames.push(f));
    p.ingest('data: {"type":"done"}');
    expect(frames).toEqual([]);
    p.flush();
    expect(frames).toEqual(['data: {"type":"done"}']);
  });
});

// ── installSseFetchTap ─────────────────────────────────────────────────────

/** 构造一个 SSE ReadableStream（按给定 chunk 吐字节） */
function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i++]));
      } else {
        controller.close();
      }
    },
  });
}

describe('installSseFetchTap · fetch 旁路（零侵入验证）', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
    // recorder 模块内的 tapInstalled 标志：模块级单例已被卸载函数复位
  });

  it('SSE 响应被 tee：消费方读到的字节与原始完全一致，旁路帧全量入账（含 ping）', async () => {
    const wire = [
      ': ping\n\n',
      'data: {"type":"token","text":"嗨"}\n\n',
      ': ping\n\n',
      'data: {"type":"uiHint","card":{"type":"plan_card","data":[]}}\n\n',
      'data: {"type":"done"}\n\n',
    ].join('');
    const body = sseStream([wire.slice(0, 20), wire.slice(20, 60), wire.slice(60)]);
    const fakeFetch = vi.fn(async () =>
      new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    );
    globalThis.fetch = fakeFetch as unknown as typeof fetch;

    const recorder = new SseRecorder();
    const uninstall = installSseFetchTap(recorder);

    const res = await globalThis.fetch('http://localhost:43111/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: '调试' }),
    });
    expect(res.headers.get('content-type')).toBe('text/event-stream');

    // 消费方（生产 sseAgentClient 同款读法）完整读出
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let consumed = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      consumed += decoder.decode(value, { stream: true });
    }
    expect(consumed).toBe(wire); // ← 零侵入：旁路不改生产字节

    // 旁路记录等一拍（drain 是并行 async）
    await vi.waitFor(() => {
      const turn = recorder.getSnapshot()[0];
      expect(turn?.status).toBe('done');
    });
    const turn = recorder.getSnapshot()[0];
    expect(turn.source).toBe('live');
    expect(turn.requestBody).toContain('调试');
    const kinds = turn.frames.map(f => f.kind);
    expect(kinds).toEqual(['comment', 'token', 'comment', 'uiHint', 'done']);

    uninstall();
    expect(globalThis.fetch).toBe(fakeFetch); // 卸载恢复原 fetch
  });

  it('非 SSE 响应直接透传，不产生 turn', async () => {
    const fakeFetch = vi.fn(async () =>
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    globalThis.fetch = fakeFetch as unknown as typeof fetch;
    const recorder = new SseRecorder();
    const uninstall = installSseFetchTap(recorder);

    const res = await globalThis.fetch('http://x/api/other');
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(recorder.getSnapshot()).toHaveLength(0);
    uninstall();
  });

  it('重复安装幂等（不叠层）', () => {
    const fakeFetch = vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    globalThis.fetch = fakeFetch;
    const recorder = new SseRecorder();
    const u1 = installSseFetchTap(recorder);
    const u2 = installSseFetchTap(recorder); // 第二次应识别为已装
    u2();
    // u2 为 noop：fetch 仍是被包过的；u1 才真正卸载
    expect(globalThis.fetch).not.toBe(fakeFetch);
    u1();
    expect(globalThis.fetch).toBe(fakeFetch);
  });
});

// ── replayRawStream ────────────────────────────────────────────────────────

describe('replayRawStream · 离线回放（同一管线）', () => {
  it('回放样例全量入账：正常流的事件帧 + 保活流的 ping 帧', () => {
    const recorder = new SseRecorder();
    const happy = SSE_STREAMS.find(s => s.id === 'sse-happy-path')!;
    replayRawStream(happy.raw, '回放', recorder, { chunkDelayMs: 0, chunkSize: 24 });
    const happyTurn = recorder.getSnapshot()[0];
    expect(happyTurn.status).toBe('done');
    expect(happyTurn.frames.map(f => f.kind)).toEqual([
      'thinking', 'token', 'token', 'token', 'uiHint', 'token', 'done',
    ]);

    const keepalive = SSE_STREAMS.find(s => s.id === 'sse-keepalive-ping')!;
    replayRawStream(keepalive.raw, '回放', recorder, { chunkDelayMs: 0, chunkSize: 7 });
    const pingTurn = recorder.getSnapshot()[1];
    expect(pingTurn.frames.filter(f => f.kind === 'comment')).toHaveLength(4);
    expect(pingTurn.frames.filter(f => f.kind === 'token')).toHaveLength(2);
  });

  it('异常帧全家桶：未知/坏帧/哨兵标注不炸，可解析的事件帧照常入账', () => {
    const recorder = new SseRecorder();
    const hostile = SSE_STREAMS.find(s => s.id === 'sse-hostile-frames')!;
    expect(() =>
      replayRawStream(hostile.raw, '回放', recorder, { chunkDelayMs: 0, chunkSize: 13 }),
    ).not.toThrow();
    const turn = recorder.getSnapshot()[0];
    const kinds = turn.frames.map(f => f.kind);
    expect(kinds).toContain('unknown');        // experimental_frame / [DONE]
    expect(kinds).toContain('malformed');      // 断半的 JSON
    expect(kinds).toContain('comment');        // : keepalive note
    expect(kinds).toContain('token');          // CRLF 帧 + 多行 data 拼接帧
    expect(kinds).toContain('done');
    // 多行 data 拼接帧确实还原成了事件（"拼接成一个 JSON" 那帧）
    expect(turn.frames.some(f => f.event?.type === 'token' && f.event.text === '多行 data 应拼接成一个 JSON')).toBe(true);
  });

  it('断流样例：有事件无 done，如实入账（终态判断留给 UI/看门狗）', () => {
    const recorder = new SseRecorder();
    const broken = SSE_STREAMS.find(s => s.id === 'sse-broken-stream')!;
    replayRawStream(broken.raw, '回放', recorder, { chunkDelayMs: 0, chunkSize: 16 });
    const turn = recorder.getSnapshot()[0];
    expect(turn.frames.map(f => f.kind)).toEqual(['thinking', 'token', 'token']);
    expect(turn.frames.some(f => f.kind === 'done')).toBe(false);
  });

  it('JSON 气泡回归样例：泄漏的卡片 JSON 以 token 形态可见', () => {
    const recorder = new SseRecorder();
    const leak = SSE_STREAMS.find(s => s.id === 'sse-json-bubble-regression')!;
    replayRawStream(leak.raw, '回放', recorder, { chunkDelayMs: 0, chunkSize: 32 });
    const turn = recorder.getSnapshot()[0];
    const tokenText = turn.frames
      .filter(f => f.kind === 'token')
      .map(f => (f.event && 'text' in f.event ? f.event.text : '')).join('');
    expect(tokenText).toContain('plan_card'); // 泄漏形态可见 → 可诊断
  });
});

// ── SseRecorder 护栏 ──────────────────────────────────────────────────────

describe('SseRecorder · 内存护栏', () => {
  it('轮数封顶丢最旧', () => {
    const recorder = new SseRecorder();
    for (let i = 0; i < 15; i++) recorder.beginTurn({ label: `t${i}`, source: 'replay' });
    expect(recorder.getSnapshot().length).toBe(12);
    expect(recorder.getSnapshot()[0].label).toBe('t3'); // t0-t2 被丢
  });

  it('单轮帧数封顶丢最旧并打标', () => {
    const recorder = new SseRecorder();
    const turn = recorder.beginTurn({ label: 'spam', source: 'replay' });
    for (let i = 0; i < 1510; i++) {
      recorder.pushFrame(turn.id, `data: {"type":"token","text":"${i}"}`, Date.now());
    }
    const t = recorder.getSnapshot()[0];
    expect(t.frames.length).toBe(1500);
    expect(t.truncated).toBe(true);
    // 留下的是最新的帧
    expect(t.frames[t.frames.length - 1].summary).toContain('1509');
  });
});

// 全局单例冒烟：模块导出可用（面板依赖它）
it('sseRecorder 全局单例可用', () => {
  expect(typeof sseRecorder.subscribe).toBe('function');
  expect(Array.isArray(sseRecorder.getSnapshot())).toBe(true);
});
