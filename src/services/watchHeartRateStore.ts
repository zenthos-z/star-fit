/**
 * watchHeartRateStore — 手表实时心率样本的 App 层唯一消费点与发布源。
 *
 * 背景（2026-09-20 补齐）：技能档案记载 09-19 有此实现，但当前分支从未合入
 * ——手机端无人消费手表 hr_live/hr_batch 事件，户外跑/跑步卡片的
 * 「连接手表自动记录」永远是静态死文案（用户实锤）。
 *
 * 数据流：
 * - hr_live（手表 5s bucket 实时推）→ liveBpm（15s 新鲜度窗口，超时回落 null）
 * - hr_batch（训后批量）→ sampleCount（「手表已记录 N 个样本」）
 * - useSyncExternalStore 发布；LockScreen / RunningCard / Outdoor 共用。
 */
type Listener = () => void;

interface WatchHRState {
  liveBpm: number | null;
  liveTs: number | null;
  sampleCount: number;
}

let state: WatchHRState = { liveBpm: null, liveTs: null, sampleCount: 0 };
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l());
}

/** 心率新鲜度窗口：超时读数视为陈旧（断连/摘表），展示层回落 */
const LIVE_FRESH_MS = 15_000;
let staleTimer: ReturnType<typeof setInterval> | null = null;

function ensureStaleWatch() {
  if (staleTimer) return;
  staleTimer = setInterval(() => {
    if (state.liveTs && Date.now() - state.liveTs > LIVE_FRESH_MS && state.liveBpm !== null) {
      state = { ...state, liveBpm: null };
      emit();
    }
  }, 5_000);
}

export const watchHeartRateStore = {
  /** 手表 hr_live 事件喂入（watchConnectivity onWatchEvent 分发） */
  ingestLive(bpm: number): void {
    state = { ...state, liveBpm: bpm, liveTs: Date.now() };
    ensureStaleWatch();
    emit();
  },
  /** 手表 hr_batch 事件喂入（训后批量样本计数） */
  ingestBatch(sampleCount: number): void {
    state = { ...state, sampleCount };
    emit();
  },
  reset(): void {
    state = { liveBpm: null, liveTs: null, sampleCount: 0 };
    emit();
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): WatchHRState {
    return state;
  },
};

/** React hook：卡片订阅实时心率三态（bpm / 已记录N样本 / null） */
export function getWatchHR(): WatchHRState {
  return state;
}
