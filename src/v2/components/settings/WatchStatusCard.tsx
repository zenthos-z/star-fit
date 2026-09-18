/**
 * WatchStatusCard — 设置页「Apple Watch」连接状态卡。
 *
 * 数据源：WatchConnectivityPlugin.getWatchStatus（WCSession 真实状态）。
 * 刷新通道：
 * - 进入页面时主动查询 + reconnect()（激活后 activationDidComplete 会回推状态）
 * - 订阅 starfit:watch-event 的 watch_status 事件（抬腕解锁/离开范围实时推送）
 * - 「重新检测」按钮手动触发
 *
 * 非 iOS 平台 / 无原生桥：整卡隐藏（与 watchConnectivity.ts 静默 no-op 同策略）。
 *
 * @version 1.0.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  getWatchStatus,
  isWatchBridge,
  onWatchEvent,
  reconnectWatch,
  type WatchStatus,
} from '../../services/watchConnectivity';
import { checkBackendHealth, useBackendHealth } from '../../services/connectivity';

type RowDef = {
  key: 'paired' | 'appInstalled' | 'reachable';
  label: string;
  /** 整体不满足前置条件时的兜底文案（如未配对时 App 安装行） */
  naText?: string;
};

const STATUS_ROWS: RowDef[] = [
  { key: 'paired', label: '手表配对' },
  { key: 'appInstalled', label: '已安装 Starfit' },
  { key: 'reachable', label: '连接' },
];

function stateText(status: WatchStatus | null, row: RowDef): { text: string; ok: boolean } {
  if (!status || !status.supported) return { text: '不支持', ok: false };
  if (row.key === 'appInstalled' && !status.paired) {
    return { text: row.naText ?? '—', ok: false };
  }
  const ok = status[row.key];
  return { text: ok ? '正常' : '未连接', ok };
}

export function WatchStatusCard(): JSX.Element | null {
  const [status, setStatus] = useState<WatchStatus | null>(null);
  const [checking, setChecking] = useState(false);

  const refresh = useCallback(async (opts?: { reconnect?: boolean }) => {
    setChecking(true);
    try {
      if (opts?.reconnect) await reconnectWatch();
      // reconnect 激活是异步的，稍等 activationDidComplete 回推后再取一次快照
      if (opts?.reconnect) await new Promise((r) => setTimeout(r, 800));
      const s = await getWatchStatus();
      if (s) setStatus(s);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!isWatchBridge) return;
    void refresh();

    // 原生侧可达性/激活变化 → 实时刷新（抬腕解锁立即变绿的关键）
    const off = onWatchEvent((event) => {
      if ((event as { kind?: string }).kind === 'watch_status') {
        void refresh();
      }
    });
    return off;
  }, [refresh]);

  if (!isWatchBridge) return null;

  const overallOk = status?.paired && status?.appInstalled && status?.reachable;
  const overallText = !status
    ? '检测中…'
    : overallOk
      ? '已连接'
      : status.paired
        ? status.appInstalled
          ? '手表未连接（点亮手表屏幕试试）'
          : '手表上未安装 Starfit'
        : '未检测到配对的 Apple Watch';

  return (
    <div className="bg-white rounded-[24px] shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-gray-900 tracking-tight">Apple Watch</h2>
        <button
          onClick={() => void refresh({ reconnect: true })}
          disabled={checking}
          className="text-xs font-semibold text-star-accent active:opacity-60 disabled:opacity-40 transition-opacity"
        >
          {checking ? '检测中…' : '重新检测'}
        </button>
      </div>

      <p className={`text-sm font-semibold mb-4 ${overallOk ? 'text-green-600' : 'text-amber-600'}`}>
        {overallText}
      </p>

      <div className="space-y-3">
        {STATUS_ROWS.map((row) => {
          const s = stateText(status, row);
          return (
            <div key={row.key} className="flex items-center justify-between">
              <span className="text-sm text-gray-500">{row.label}</span>
              <span className={`text-sm font-semibold ${s.ok ? 'text-green-600' : 'text-gray-400'}`}>
                {s.text}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 后端连接行（设置页测试入口，fix/backend-connectivity-watch）。
 * 显示 API 地址 + 实时连接状态 + 「测试后端」按钮（主动探测 /healthz）。
 * 独立导出：WatchStatusCard 在非 iOS 环境隐藏，但后端测试任何平台都要可用，
 * 所以 Settings.tsx 分别挂载。
 */
export function BackendConnectionRow(): JSX.Element {
  const health = useBackendHealth();
  const [manualTesting, setManualTesting] = useState(false);
  const [manualResult, setManualResult] = useState<string | null>(null);

  const onTest = useCallback(async () => {
    setManualTesting(true);
    setManualResult(null);
    const r = await checkBackendHealth();
    setManualResult(r.ok ? `连通（${r.latencyMs ?? '?'}ms）` : `失败：${r.error ?? '未知'}`);
    setManualTesting(false);
  }, []);

  return (
    <div className="bg-white rounded-[24px] shadow-[0_2px_12px_rgba(0,0,0,0.08)] p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-gray-900 tracking-tight">后端服务</h2>
        <button
          onClick={() => void onTest()}
          disabled={manualTesting}
          className="text-xs font-semibold text-star-accent active:opacity-60 disabled:opacity-40 transition-opacity"
        >
          {manualTesting ? '测试中…' : '测试后端'}
        </button>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-gray-500 shrink-0">连接状态</span>
          <span className={`text-sm font-semibold flex items-center gap-1.5 ${
            health.checking ? 'text-gray-400' : health.ok ? 'text-green-600' : 'text-red-500'
          }`}>
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${
              health.checking ? 'bg-gray-300' : health.ok ? 'bg-green-500' : 'bg-red-500'
            }`} />
            {health.checking ? '检测中…' : health.ok ? `在线（${health.latencyMs ?? '?'}ms）` : '离线'}
          </span>
        </div>
        {manualResult && (
          <div className={`text-xs font-medium ${manualResult.startsWith('连通') ? 'text-green-600' : 'text-red-500'}`}>
            {manualResult}
          </div>
        )}
        {!health.ok && !health.checking && health.error && (
          <div className="text-xs text-gray-400 break-all [overflow-wrap:anywhere]">
            最近失败：{health.error}
          </div>
        )}
      </div>
    </div>
  );
}

export default WatchStatusCard;
