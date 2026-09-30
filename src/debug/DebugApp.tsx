/**
 * T1 调试台外壳（issue #53）——仅 `?debug=1` + DEV 构建可达（src/index.tsx
 * 条件动态 import；生产构建里该分支是死代码，整个 src/debug 不进产物）。
 *
 * 挂载时安装 SSE fetch 旁路 tap（页面生命周期内常驻）：此后本页发起的
 * 所有 event-stream 请求都会被逐帧记录（含 `: ping` 保活帧）。
 */
import React, { useEffect, useState } from 'react';
import { ScenarioPanel } from './ScenarioPanel';
import { SseConsolePanel } from './SseConsolePanel';
import { PayloadAuditPanel } from './PayloadAuditPanel';
import { installSseFetchTap } from './sse/recorder';

type Tab = 'cards' | 'sse' | 'payloads';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'cards', label: '卡片场景' },
  { key: 'sse', label: 'SSE 调试台' },
  { key: 'payloads', label: 'Payload 审计' },
];

export const DebugApp: React.FC = () => {
  const [tab, setTab] = useState<Tab>('cards');

  useEffect(() => {
    // 页面级常驻：不卸载（调试台在，观测层就在）
    installSseFetchTap();
  }, []);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100" data-testid="debug-app">
      <header className="sticky top-0 z-10 bg-gray-950/95 backdrop-blur border-b border-white/10 pt-[env(safe-area-inset-top)]">
        <div className="px-4 pt-3 pb-2 flex items-center gap-2">
          <span className="text-sm font-bold">Starfit 调试台</span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
            DEV · T1
          </span>
          <span className="ml-auto text-[10px] font-mono text-gray-600">?debug=1</span>
        </div>
        <nav className="flex">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 py-2 text-[13px] font-medium border-b-2 transition-colors ${
                tab === t.key
                  ? 'text-sky-300 border-sky-400'
                  : 'text-gray-500 border-transparent hover:text-gray-300'
              }`}
              data-testid={`tab-${t.key}`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      <main className="pb-16 max-w-2xl mx-auto">
        {tab === 'cards' ? (
          <ScenarioPanel />
        ) : tab === 'sse' ? (
          <SseConsolePanel />
        ) : (
          <PayloadAuditPanel />
        )}
      </main>
    </div>
  );
};
