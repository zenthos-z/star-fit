/**
 * BatchAddBanner — 购物车批量添加进度横幅（issue #31）
 *
 * 批量模式反馈面：running 显示「已添加 n/m」+ blue-500 进度条；
 * partial 显示失败条数 + 单条重试（red-500 错误色，非阻断可关）；
 * done 短暂呈现成功态后自动收起。
 *
 * 视觉锚点：picker 悬浮条同族（白卡 rounded-[20px]、star-gray 页面底、
 * blue-500 主操作、禁 emoji/渐变）。
 */

import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { BatchCreateState } from '../../hooks/useBatchExerciseCreate';
import { isNativeTabBar } from '../../lib/nativeTabBar';

interface BatchAddBannerProps {
  state: BatchCreateState;
  onRetry: () => void;
  onDismiss: () => void;
}

const BatchAddBanner: React.FC<BatchAddBannerProps> = ({ state, onRetry, onDismiss }) => {
  const visible = state.status !== 'idle';
  const allDone = state.status === 'done';

  // done 态自动收起（失败态常驻，等用户重试或手动关）
  useEffect(() => {
    if (!allDone) return;
    const timer = setTimeout(onDismiss, 2000);
    return () => clearTimeout(timer);
  }, [allDone, onDismiss]);

  const progressPct = state.total > 0 ? Math.round((state.succeeded / state.total) * 100) : 0;

  // 避让 Tab Bar（issue #85）：横幅常驻根层级、picker 关闭后 tab bar 复现，
  // bottom-0 会被盖（iOS 原生 bar 悬浮 WebView 之上；CSS 回落 bar z-105 高于旧 z-90）。
  // 抬升至 bar 之上：iOS 原生 = safe-area + 72px（MainTabBar body 避让同款常量）；
  // CSS 回落 = safe-bottom + 64px（bar 实高 ≈59px：py-2.5 + 图标20 + gap4 + 文字15）。
  // z-[106]：层叠表上 CSS tab bar(105) 之上、AI sheet(110) 之下的空档。
  const tabbarClearance = isNativeTabBar
    ? 'calc(env(safe-area-inset-bottom, 0px) + 72px)'
    : 'calc(var(--safe-bottom, 0px) + 64px)';

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ type: 'tween', duration: 0.2, ease: 'easeOut' }}
          className="fixed inset-x-0 z-[106] px-4"
          style={{ bottom: tabbarClearance }}
          role="status"
          aria-label="批量添加进度"
        >
          <div className="mx-auto max-w-md bg-white rounded-[20px] shadow-lg border border-gray-100 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                {state.status === 'running' && (
                  <p className="text-[14px] font-semibold text-star-dark">
                    批量添加中 <span className="text-blue-500 tabular-nums">{state.succeeded}</span>
                    <span className="text-gray-400 tabular-nums">/{state.total}</span>
                  </p>
                )}
                {state.status === 'partial' && (
                  <p className="text-[14px] font-semibold text-star-dark">
                    已添加 {state.succeeded} 个，
                    <span className="text-red-500">{state.failed.length} 个添加失败</span>
                  </p>
                )}
                {allDone && (
                  <p className="text-[14px] font-semibold text-star-dark">
                    已添加 <span className="text-blue-500">{state.succeeded}</span> 个动作
                  </p>
                )}
                {/* 进度条（blue-500 主操作色；失败段不覆盖进度语义） */}
                <div className="mt-1.5 h-1 rounded-full bg-gray-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-all duration-300"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {state.status === 'partial' && (
                  <button
                    onClick={onRetry}
                    className="bg-blue-500 active:bg-blue-600 text-white text-[13px] font-semibold px-4 h-9 rounded-full active:scale-95 transition-all"
                  >
                    重试失败
                  </button>
                )}
                <button
                  onClick={onDismiss}
                  aria-label="关闭批量添加进度"
                  className="w-9 h-9 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center active:scale-90 transition-all"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default BatchAddBanner;
