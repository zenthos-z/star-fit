/**
 * T1 调试台 · SSE 事件调试台（issue #53）。
 *
 * 三个区：
 *  1. 实况：输入消息 → 真实 agentClient.chat SSE 流（需后端在跑）。
 *     fetch 旁路 tap（DebugApp 挂载时安装）把每个 wire 帧原样记录——
 *     含 `: ping` 保活注释帧（对生产解析器不可见、对断流诊断关键）。
 *  2. 回放：离线样例字节流（fixtures/sseStreams）喂进同一解析-记录管线，
 *     无后端也能演示/回归帧处理（未知帧/坏帧一律标注不炸）。
 *  3. 事件流：逐轮逐帧展开——kind/时间戳/payload JSON。
 */
import React, { useRef, useState, useSyncExternalStore } from 'react';
import { agentClient, synthesizeUiHint } from '../services/agent/sseAgentClient';
import { getUserId } from '../services/geminiService';
import { ExerciseRenderer } from '../components/execution/ExerciseRenderer';
import { SSE_STREAMS } from './fixtures';
import {
  sseRecorder,
  replayRawStream,
  type SseFrame,
  type SseFrameKind,
  type SseTurn,
} from './sse/recorder';
import type { UiHintCard } from 'shared/contracts';

const KIND_BADGE: Record<SseFrameKind, string> = {
  token: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  thinking: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  uiHint: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  done: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
  error: 'bg-red-500/15 text-red-300 border-red-500/30',
  unknown: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  comment: 'bg-white/5 text-gray-400 border-white/10',
  malformed: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
};

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function fmtDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

// ── 实况聊天（真后端；无后端时错误帧同样被记录展示）────────────────────────

interface LiveChatState {
  busy: boolean;
  text: string;
  thinking: string;
  card?: UiHintCard;
  error?: { code: string; message: string };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LiveChatBox: React.FC = () => {
  const [input, setInput] = useState('');
  const [state, setState] = useState<LiveChatState | null>(null);
  const busyRef = useRef(false);

  const send = async () => {
    const message = input.trim();
    if (!message || busyRef.current) return;
    busyRef.current = true;
    setInput('');
    setState({ busy: true, text: '', thinking: '' });

    const rawId = getUserId();
    // 已登录（UUID）沿用本人身份；否则用一个稳定调试身份，由后端按新用户建档/报错均如实记录
    const userId = UUID_RE.test(rawId) ? rawId : crypto.randomUUID();

    let next: LiveChatState = { busy: true, text: '', thinking: '' };
    try {
      for await (const ev of agentClient.chat({
        userId,
        message,
        scenario: 'chat',
        threadId: `debug_thread_${Date.now()}`,
      })) {
        if (ev.type === 'token' && ev.text) {
          next = { ...next, text: next.text + ev.text };
        } else if (ev.type === 'thinking' && ev.text) {
          next = { ...next, thinking: next.thinking + ev.text };
        } else if (ev.type === 'uiHint' && ev.card) {
          next = { ...next, card: ev.card };
        } else if (ev.type === 'error' && ev.error) {
          next = { ...next, error: { code: ev.error.code, message: ev.error.message } };
        }
        setState({ ...next });
      }
    } catch (err) {
      next = {
        ...next,
        error: { code: 'CLIENT_THROW', message: err instanceof Error ? err.message : String(err) },
      };
    } finally {
      busyRef.current = false;
      setState({ ...next, busy: false });
    }
  };

  return (
    <section className="p-3 border-b border-white/5" data-testid="live-chat">
      <div className="text-xs font-semibold text-gray-200 pb-2">① 实况 · 真后端 SSE</div>
      <div className="text-[10px] text-gray-500 pb-2">
        走生产 agentClient（/api/chat）；无后端时错误帧也会被记录——本身就是诊断素材
      </div>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void send(); }}
          placeholder="给 Agent 发一条消息（如：帮我排明天的训练）"
          className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-gray-100 placeholder:text-gray-600 outline-none focus:border-sky-500/50"
          data-testid="live-chat-input"
        />
        <button
          onClick={() => void send()}
          disabled={!input.trim() || !!state?.busy}
          className="px-4 py-2 rounded-lg bg-sky-600 disabled:bg-white/10 disabled:text-gray-500 text-white text-sm font-medium"
          data-testid="live-chat-send"
        >
          {state?.busy ? '流中…' : '发送'}
        </button>
      </div>

      {state && (
        <div className="mt-3 space-y-2" data-testid="live-chat-result">
          {state.thinking && (
            <details className="px-3 py-2 rounded-lg bg-violet-500/5 border border-violet-500/20">
              <summary className="text-[11px] text-violet-300 cursor-pointer">
                thinking（{state.thinking.length} 字）
              </summary>
              <pre className="text-[11px] text-gray-400 whitespace-pre-wrap break-all mt-1 max-h-40 overflow-y-auto">
                {state.thinking}
              </pre>
            </details>
          )}
          {state.text && (
            <div className="px-4 py-3 rounded-2xl rounded-bl-lg bg-[#E9E9EB] text-gray-900 text-[15px] leading-relaxed whitespace-pre-wrap">
              {state.text}
            </div>
          )}
          {state.card && (
            <ExerciseRenderer uiHint={synthesizeUiHint(state.card) as never} onConfirm={() => undefined} />
          )}
          {state.error && (
            <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-[12px] text-red-300 font-mono">
              error · {state.error.code}：{state.error.message}
            </div>
          )}
        </div>
      )}
    </section>
  );
};

// ── 回放（离线样例）───────────────────────────────────────────────────────

const ReplayBox: React.FC = () => (
  <section className="p-3 border-b border-white/5" data-testid="replay-box">
    <div className="text-xs font-semibold text-gray-200 pb-2">② 回放 · 离线样例（无需后端）</div>
    <div className="grid grid-cols-1 gap-1.5">
      {SSE_STREAMS.map(stream => (
        <button
          key={stream.id}
          onClick={() => replayRawStream(stream.raw, `回放 · ${stream.label}`)}
          className="text-left px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 active:bg-white/15 border border-white/5"
          data-testid={`replay-${stream.id}`}
        >
          <div className="text-[13px] text-gray-100">{stream.label}</div>
          <div className="text-[10px] text-gray-500 mt-0.5 leading-snug">{stream.description}</div>
        </button>
      ))}
    </div>
  </section>
);

// ── 帧检查器 ───────────────────────────────────────────────────────────────

const FrameRow: React.FC<{ frame: SseFrame; turnStartedAt: number }> = ({ frame, turnStartedAt }) => {
  const [open, setOpen] = useState(false);
  const payloadJson = React.useMemo(() => {
    try {
      return JSON.stringify(frame.event ?? { dataText: frame.dataText } ?? null, null, 2);
    } catch {
      return '(序列化失败)';
    }
  }, [frame]);

  return (
    <div className="border border-white/5 rounded-lg overflow-hidden" data-testid={`sse-frame-box-${frame.kind}-${frame.seq}`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-white/5 text-left"
        data-testid={`sse-frame-${frame.kind}-${frame.seq}`}
      >
        <span className="text-[10px] font-mono text-gray-600 w-6 shrink-0">{frame.seq}</span>
        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border shrink-0 ${KIND_BADGE[frame.kind]}`}>
          {frame.kind}
        </span>
        <span className="text-[10px] font-mono text-gray-500 shrink-0">
          +{fmtDuration(Math.max(0, frame.receivedAt - turnStartedAt))}
        </span>
        <span className="text-[11px] text-gray-300 truncate flex-1 min-w-0">{frame.summary}</span>
        <span className="text-[10px] text-gray-600 shrink-0">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-3 pb-2 space-y-1.5">
          <div className="text-[10px] text-gray-500 font-mono">
            receivedAt: {fmtTime(frame.receivedAt)}
          </div>
          <pre className="text-[10px] font-mono text-emerald-300/90 whitespace-pre-wrap break-all bg-black/40 rounded p-2 max-h-60 overflow-y-auto">
            {payloadJson}
          </pre>
          <pre className="text-[10px] font-mono text-gray-500 whitespace-pre-wrap break-all bg-black/20 rounded p-2 max-h-40 overflow-y-auto">
            {frame.raw}
          </pre>
        </div>
      )}
    </div>
  );
};

const TurnCard: React.FC<{ turn: SseTurn }> = ({ turn }) => {
  const [open, setOpen] = useState(false);
  const statusDot =
    turn.status === 'open' ? 'bg-sky-400 animate-pulse'
    : turn.status === 'done' ? 'bg-emerald-400'
    : 'bg-red-400';
  const kindCount = turn.frames.reduce<Record<string, number>>((acc, f) => {
    acc[f.kind] = (acc[f.kind] ?? 0) + 1;
    return acc;
  }, {});
  const countLine = Object.entries(kindCount).map(([k, v]) => `${k}×${v}`).join(' · ') || '（无帧）';

  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/10 overflow-hidden" data-testid={`sse-turn-${turn.source}`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-3 py-2.5 flex items-center gap-2 hover:bg-white/5 text-left"
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${statusDot}`} />
        <span className="flex-1 min-w-0">
          <span className="block text-[12px] text-gray-100 truncate">{turn.label}</span>
          <span className="block text-[10px] text-gray-500 font-mono">
            {fmtTime(turn.startedAt)}
            {turn.endedAt ? ` · ${fmtDuration(turn.endedAt - turn.startedAt)}` : ' · 进行中'}
            {` · ${turn.frames.length} 帧 · ${countLine}`}
          </span>
        </span>
        <span className="text-[10px] text-gray-500 shrink-0">{open ? '▲' : '▼'}</span>
      </button>
      {turn.truncated && (
        <div className="px-3 pb-1 text-[10px] text-amber-400 font-mono">⚠ {turn.errorNote}</div>
      )}
      {open && (
        <div className="px-2 pb-2 space-y-1">
          {turn.requestBody && (
            <details className="px-2 py-1.5 rounded-lg bg-black/20">
              <summary className="text-[10px] text-gray-500 cursor-pointer">请求体</summary>
              <pre className="text-[10px] font-mono text-gray-400 whitespace-pre-wrap break-all mt-1">
                {turn.requestBody}
              </pre>
            </details>
          )}
          {turn.frames.map(f => (
            <FrameRow key={f.seq} frame={f} turnStartedAt={turn.startedAt} />
          ))}
          {turn.frames.length === 0 && (
            <div className="text-[11px] text-gray-600 px-2 py-2">（本轮暂无帧）</div>
          )}
        </div>
      )}
    </div>
  );
};

// ── 面板主体 ──────────────────────────────────────────────────────────────

export const SseConsolePanel: React.FC = () => {
  const turns = useSyncExternalStore(sseRecorder.subscribe, sseRecorder.getSnapshot);
  const ordered = [...turns].reverse(); // 最新一轮在最上

  return (
    <div data-testid="sse-console">
      <LiveChatBox />
      <ReplayBox />
      <section className="p-3" data-testid="event-stream">
        <div className="flex items-center justify-between pb-2">
          <div className="text-xs font-semibold text-gray-200">③ 事件流（{turns.length} 轮）</div>
          <button
            onClick={() => sseRecorder.clear()}
            className="text-[11px] px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10"
            data-testid="sse-clear"
          >
            清空
          </button>
        </div>
        {ordered.length === 0 ? (
          <div className="text-[11px] text-gray-600 px-1 py-3 leading-relaxed">
            暂无记录。发一条实况消息，或点上面的回放样例——
            每一帧的 type / 时间戳 / payload JSON 都会在这里展开。
          </div>
        ) : (
          <div className="space-y-2">
            {ordered.map(turn => (
              <TurnCard key={turn.id} turn={turn} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
