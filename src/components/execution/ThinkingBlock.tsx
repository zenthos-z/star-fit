import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { clampThinkingWindow } from '../../hooks/streamProgress';
import {
  snapIfFollowing,
  updateScrollFollow,
  THINKING_FOLLOW_DETACH_PX,
} from '../../hooks/chatScrollFollow';

/**
 * ThinkingBlock — 折叠的 Agent 思考区（主流 Agent UX 模式）：
 * - 默认收起，只显示一行状态标签（不与答案争夺视觉层级）；
 * - 流式生成中自动展开实时预览，结束后自动收起；
 * - 用户手动展开/收起后尊重用户选择。
 *
 * [B5b 返工·白屏修复] memo 化：text 来自 streamProgress 尾部窗口（≤4000 字符），
 * 相同 props 直接跳过重渲染，避免聊天列表其它消息的 setState 连带重解析。
 *
 * [issue #55 三修]：
 * 1. 溢出兜底：渲染层自行夹紧到 THINKING_WINDOW_CHARS——历史存量消息或未来
 *    新接入路径即使绕过 streamProgress 尾窗，DOM 文本节点也有界；容器
 *    max-height + overflow-y-auto 双保险，内容永远撑不穿屏幕。
 * 2. 自动滚动让位：流式时小窗自动贴底，但用户在窗内上滑后暂停贴底，
 *    回到底部才恢复跟随（与聊天主容器同一套 chatScrollFollow 口径）。
 * 3. 横向锁死：overflow-x-hidden + break-words + overflow-wrap:anywhere，
 *    长 token（URL/代码/无空格串）折行而不撑宽，容器内只保留竖向滚动。
 */
const ThinkingBlock: React.FC<{ text?: string; streaming?: boolean }> = React.memo(function ThinkingBlock({ text, streaming }) {
  const [manuallyToggled, setManuallyToggled] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  // [issue #55-2] 用户在思考窗内上滑 → 让位；回到底部 → 恢复跟随
  const followRef = React.useRef(true);

  // [issue #55-1] 渲染路径兜底夹紧：无论上游是否走 streamProgress 尾窗，
  // 渲染出的文本恒 ≤ WINDOW+1 字符（头部丢弃，前置省略号，与尾窗同语义）。
  const clipped = clampThinkingWindow(text);

  // 思考窗口限高 4 行（用户拍板 2026-09-18）：流式时固定在小窗内滚动、始终展示最新内容，
  // 不随思考增长撑满屏幕；[issue #55-2] 用户上滑让位后不自动滚，手动展开后同样尊重阅读位置。
  useEffect(() => {
    if (streaming && !manuallyToggled && bodyRef.current) {
      snapIfFollowing(bodyRef.current, followRef);
    }
  }, [clipped, streaming, manuallyToggled]);

  const handleBodyScroll = () => {
    if (bodyRef.current) {
      updateScrollFollow(bodyRef.current, followRef, THINKING_FOLLOW_DETACH_PX);
    }
  };

  if (!text) return null;

  // 流式中默认展开；结束后默认收起；用户手动操作后以用户为准
  const isOpen = manuallyToggled ? expanded : streaming;

  return (
    <div className="mb-3 w-full max-w-[92%] min-w-0">
      <button
        onClick={() => { setManuallyToggled(true); setExpanded(!isOpen); }}
        className="flex items-center gap-2 px-3 py-1.5 bg-gray-50/80 backdrop-blur-sm border border-gray-100 rounded-lg hover:bg-gray-100/80 transition-colors active:scale-[0.98]"
      >
        {streaming ? (
          <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
        ) : (
          <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
          </svg>
        )}
        <span className="text-[10px] font-bold text-gray-400 tracking-wide">
          {streaming ? '思考中…' : '已深度思考（点击展开）'}
        </span>
        <svg
          className={`w-3 h-3 text-gray-300 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      <motion.div
        initial={false}
        animate={{ height: isOpen ? 'auto' : 0, opacity: isOpen ? 1 : 0 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="overflow-hidden"
      >
        <div
          ref={bodyRef}
          onScroll={handleBodyScroll}
          data-testid="thinking-body"
          className="mt-2 px-4 py-3 bg-gray-50/50 border-l-2 border-gray-200 rounded-r-lg text-xs leading-relaxed text-gray-500 whitespace-pre-wrap break-words [overflow-wrap:anywhere] min-w-0 max-h-[7.5rem] overflow-y-auto overflow-x-hidden"
        >
          {clipped}
        </div>
      </motion.div>
    </div>
  );
});

export { ThinkingBlock };
