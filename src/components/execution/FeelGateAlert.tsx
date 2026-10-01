import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { setTabBarHidden } from '../../lib/nativeTabBar';
import type { FeelModalGroup } from './feelGate';

interface FeelGateAlertProps {
  groups: FeelModalGroup[];
  /** [仍要结束]：不写任何字段直接结算 */
  onEnd: () => void;
  /** [去补记]：关闸门，打开聚合表单（补记仍走表单本体） */
  onGoFill: () => void;
}

/**
 * 结算闸门（issue #98 返工②，2026-10-01）：用户原话「只希望有个弹窗，类似配重突变的
 * 卡片弹窗；不需要滑条，只做意图判断和缺少内容提示」——窄卡 iOS Alert 形态完全复用
 * DeviationWarningModal（项目拍板模板）：w-[270px] rounded-[40px] + 图标 + 标题 +
 * bg-gray-50 说明块 + 纵向按钮组。闸门只分流：[仍要结束] 直接结算（不写值），
 * [去补记] 打开 FeelModal 聚合表单（写值只发生在表单本体）。
 */
export const FeelGateAlert: React.FC<FeelGateAlertProps> = ({ groups, onEnd, onGoFill }) => {
  const totalSets = groups.reduce((n, g) => n + g.sets.length, 0);

  // iOS Alert 规范：盖住原生 tab bar（与 DeviationWarningModal 同生命周期）
  useEffect(() => {
    setTabBarHidden(true);
    return () => setTabBarHidden(false);
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        data-testid="feel-gate-alert"
        className="bg-white/95 backdrop-blur-xl w-[270px] rounded-[40px] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-300"
      >
        {/* Icon + Title */}
        <div className="flex flex-col items-center pt-5 px-4">
          <svg className="w-9 h-9 text-star-accent mb-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"
            />
          </svg>
          <h2 className="text-lg font-semibold text-gray-900 text-center leading-snug">
            还有 {totalSets} 组没记感受
          </h2>
        </div>

        {/* 缺失提示：未填组按动作聚合（「动作名 · N 组」） */}
        <div className="px-4 pt-3 pb-4">
          <div className="bg-gray-50 rounded-2xl px-3 py-2.5 text-center">
            {groups.map(g => (
              <p key={g.exId} className="text-[13px] font-semibold leading-relaxed text-gray-700">
                {g.exName} · {g.sets.length} 组
              </p>
            ))}
          </div>
        </div>

        {/* Action Buttons — iOS Alert 纵向：灰字放行结算 / 蓝字主操作去补记 */}
        <div className="border-t border-gray-200">
          <button
            type="button"
            data-testid="feel-gate-end"
            onClick={onEnd}
            className="w-full py-3 text-[17px] font-normal text-gray-400 active:bg-gray-100 transition-colors border-b border-gray-200"
          >
            仍要结束
          </button>
          <button
            type="button"
            data-testid="feel-gate-fill"
            onClick={onGoFill}
            className="w-full py-3 text-[17px] font-semibold text-star-accent active:bg-gray-100 transition-colors"
          >
            去补记
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default FeelGateAlert;
