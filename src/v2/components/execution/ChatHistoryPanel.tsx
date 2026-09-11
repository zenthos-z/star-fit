import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ChatThread } from '@/storage';
import { transitions } from '../../lib/animations';

interface ChatHistoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  threads: ChatThread[];
  currentThreadId: string;
  onSelectThread: (threadId: string) => void;
  onCreateNewThread: () => void;
  formatRelativeTime: (timestamp: number) => string;
}

/**
 * ChatHistoryPanel - Full-screen chat history list panel
 *
 * Design (iOS HIG):
 * - Full-screen sheet: slides up from the bottom edge with the SAME curve as
 *   AICoachOverlay and other full-screen pages — one app-wide enter/exit
 *   transition (transitions.sheet).
 * - List rows are large-radius cards (24px), matching the chat bubbles.
 * - Comfortable row height + prominent timestamp.
 * - "New chat" lives in THIS panel's header (top-right "+"), next to the list it acts on.
 */
export const ChatHistoryPanel: React.FC<ChatHistoryPanelProps> = ({
  isOpen,
  onClose,
  threads,
  currentThreadId,
  onSelectThread,
  onCreateNewThread,
  formatRelativeTime
}) => {
  const handleSelectThread = (threadId: string) => {
    onSelectThread(threadId);
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={transitions.sheet} // 与 AI 教练等其他全屏页统一：底部滑入 sheet
          className="fixed inset-0 z-[70] bg-[#FAFAFA] flex flex-col"
        >
          {/* Header with Safe Area support for Notch/Dynamic Island */}
          <div
            className="flex-shrink-0 px-4 flex items-center border-b border-gray-100"
            style={{
              paddingTop: 'max(12px, env(safe-area-inset-top))',
              height: 'calc(64px + max(12px, env(safe-area-inset-top)))'
            }}
          >
            <button
              onClick={onClose}
              className="w-11 h-11 rounded-full bg-white shadow-sm flex items-center justify-center text-gray-800 active:scale-95 transition-all"
              aria-label="返回"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            <h1 className="flex-1 text-center text-lg font-black text-gray-900 tracking-tighter -ml-11">
              历史对话
            </h1>

            {/* 右上角：新建话题（从 AI 教练主页迁移至此，紧邻它作用的历史列表） */}
            <button
              onClick={() => {
                onClose();
                onCreateNewThread();
              }}
              className="w-11 h-11 rounded-full bg-white shadow-sm flex items-center justify-center text-gray-700 active:scale-95 transition-all"
              aria-label="新建对话"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>

          {/* Thread List */}
          <div className="flex-1 overflow-y-auto px-4 py-5">
            {threads.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="space-y-3.5">
                {threads.map((thread) => (
                  <button
                    key={thread.id}
                    type="button"
                    onClick={() => handleSelectThread(thread.id)}
                    className={`
                      w-full text-left px-5 py-5 rounded-[24px] cursor-pointer
                      transition-all active:scale-[0.98]
                      ${thread.id === currentThreadId
                        ? 'bg-gray-200'
                        : 'bg-white hover:bg-gray-50'
                      }
                      shadow-[0_2px_12px_rgba(0,0,0,0.08)]
                    `}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        {/* Title */}
                        <h3 className="text-[15px] font-bold truncate text-gray-900">
                          {thread.title}
                        </h3>

                        {/* Preview */}
                        {thread.preview && (
                          <p className="text-[13px] text-gray-500 mt-1.5 line-clamp-1">
                            {thread.preview}
                          </p>
                        )}

                        {/* Meta info — timestamp prominent */}
                        <div className="flex items-center gap-2 mt-3">
                          <span className="text-xs font-semibold text-gray-600">
                            {formatRelativeTime(thread.updatedAt)}
                          </span>
                          <span className="w-1 h-1 rounded-full bg-gray-300 flex-shrink-0" />
                          <span className="text-xs text-gray-400">
                            {thread.messageCount} 条消息
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Bottom hint */}
          {threads.length > 0 && (
            <div className="flex-shrink-0 px-4 py-3 bg-gray-50 border-t border-gray-100">
              <p className="text-[10px] text-gray-400 text-center">
                最多保留 10 条历史对话，超出后自动删除最旧的
              </p>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

/**
 * Empty state when no threads exist
 */
const EmptyState: React.FC = () => (
  <motion.div
    initial={{ opacity: 0, scale: 0.95 }}
    animate={{ opacity: 1, scale: 1 }}
    transition={transitions.sheet}
    className="flex flex-col items-center justify-center h-full py-20"
  >
    <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-6">
      <svg className="w-10 h-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    </div>
    <h3 className="text-lg font-black text-gray-900 tracking-tighter mb-2">
      暂无历史对话
    </h3>
    <p className="text-sm text-gray-500 text-center max-w-[200px]">
      点击右上角"+"开始与 AI 教练对话
    </p>
  </motion.div>
);
