/**
 * T1 调试台 · 卡片场景面板（issue #53）。
 *
 * 一键加载预置场景：fixture 数据直灌 ExerciseRenderer——与真实聊天挂卡完全
 * 同一条渲染链路（卡片注册表按 uiHint.type / exercise.type 分发，#88 分册3），
 * 零 Agent 调用，秒开目标 UI。onConfirm 回调在调试台里被显式可视化
 * （确认载荷日志），让「卡片 → 回传」双向都可观测。
 */
import React, { useState } from 'react';
import { ExerciseRenderer } from '../components/execution/ExerciseRenderer';
import { DEBUG_SCENARIOS, SCENARIO_GROUPS } from './fixtures';
import type { DebugScenario } from './fixtures';

interface ConfirmLogEntry {
  at: number;
  scenarioId: string;
  payload: unknown;
}

const GROUP_STYLE: Record<string, string> = {
  'chat-card': 'text-emerald-300',
  'chat-card-frontend-only': 'text-amber-300',
  'execution-card': 'text-sky-300',
};

export const ScenarioPanel: React.FC = () => {
  const [selected, setSelected] = useState<DebugScenario | null>(null);
  const [confirmLog, setConfirmLog] = useState<ConfirmLogEntry[]>([]);

  const handleConfirm = (scenarioId: string) => (payload: unknown) => {
    setConfirmLog(prev => [{ at: Date.now(), scenarioId, payload }, ...prev].slice(0, 6));
  };

  if (selected) {
    return (
      <div className="p-3 space-y-3" data-testid="scenario-view">
        <button
          onClick={() => setSelected(null)}
          className="text-xs text-gray-400 hover:text-gray-200 flex items-center gap-1"
          data-testid="scenario-back"
        >
          ← 返回场景列表
        </button>

        <div className="text-[10px] font-mono text-gray-500 break-all">
          id: {selected.id} · 分发键: {selected.wireCard?.type ?? (selected.exercise as { uiHint?: { cardType?: string } })?.uiHint?.cardType ?? '(exercise.type)'}
        </div>

        {/* 模拟真实聊天上下文：AI 气泡正文（灰底）+ 卡片（气泡下方独立挂载） */}
        <div className="max-w-md mx-auto space-y-2.5">
          {selected.bubbleText && (
            <div className="flex flex-col items-start">
              <div className="w-full px-5 py-3.5 text-[16px] leading-[1.45] bg-[#E9E9EB] text-gray-900 rounded-[24px] rounded-bl-[8px]">
                {selected.bubbleText}
              </div>
            </div>
          )}
          <div className="w-full">
            <ExerciseRenderer
              uiHint={selected.wireCard as never}
              exercise={selected.exercise as never}
              onConfirm={handleConfirm(selected.id)}
              onUpdate={() => undefined}
            />
          </div>
        </div>

        {/* 确认回传日志：卡片按钮触发的 payload 在这里显式可见 */}
        <div className="max-w-md mx-auto" data-testid="confirm-log">
          <div className="text-[11px] text-gray-500 pt-2 pb-1">
            onConfirm 回传日志（点击卡片按钮后出现）
          </div>
          {confirmLog.length === 0 ? (
            <div className="text-[11px] text-gray-600 font-mono px-3 py-2 rounded-lg bg-black/30">
              （暂无——点击卡片上的按钮试试）
            </div>
          ) : (
            confirmLog.map((entry, i) => (
              <div key={i} className="text-[11px] font-mono px-3 py-2 rounded-lg bg-black/30 mb-1.5">
                <div className="text-gray-500">
                  {new Date(entry.at).toLocaleTimeString('zh-CN', { hour12: false })} · {entry.scenarioId}
                </div>
                <pre className="text-emerald-300 whitespace-pre-wrap break-all mt-1">
                  {JSON.stringify(entry.payload, null, 2)}
                </pre>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-4" data-testid="scenario-list">
      {SCENARIO_GROUPS.map(group => (
        <section key={group.key}>
          <div className={`text-xs font-semibold pb-0.5 ${GROUP_STYLE[group.key]}`}>{group.label}</div>
          <div className="text-[10px] text-gray-500 pb-2">{group.hint}</div>
          <div className="space-y-1.5">
            {DEBUG_SCENARIOS.filter(s => s.group === group.key).map(scenario => (
              <button
                key={scenario.id}
                onClick={() => { setConfirmLog([]); setSelected(scenario); }}
                className="w-full text-left px-3 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 active:bg-white/15 border border-white/5 transition-colors"
                data-testid={`scenario-row-${scenario.id}`}
              >
                <div className="text-sm text-gray-100 font-medium">{scenario.label}</div>
                <div className="text-[11px] text-gray-400 mt-0.5 leading-snug">{scenario.description}</div>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
};
