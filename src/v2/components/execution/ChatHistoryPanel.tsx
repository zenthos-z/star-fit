import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ChatThread } from '@/storage';

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
 * Features:
 * - Full-screen overlay with slide-in animation
 * - List of threads with title, time, message count, and preview
 * - Current thread highlighted
 * - Empty state display
 * - New thread creation button
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
  const handleCreateNew = () => {
    onCreateNewThread();
    onClose();
  };

  const handleSelectThread = (threadId: string) => {
    onSelectThread(threadId);
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'tween', duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
          className="fixed inset-0 z-[70] bg-white flex flex-col"
        >
          {/* Header with Safe Area support for Notch/Dynamic Island */}
          <div
            className="flex-shrink-0 px-4 flex items-center justify-between border-b border-gray-100"
            style={{
              paddingTop: 'max(12px, env(safe-area-inset-top))',
              height: 'calc(64px + max(12px, env(safe-area-inset-top)))'
            }}
          >
            <button
              onClick={onClose}
              className="w-10 h-10 rounded-2xl bg-gray-100/80 flex items-center justify-center text-gray-500 hover:bg-gray-200 hover:text-black transition-all active:scale-95"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            <h1 className="text-lg font-black text-gray-900 tracking-tighter">
              历史对话
            </h1>

            <button
              onClick={handleCreateNew}
              className="h-10 px-4 rounded-2xl bg-blue-600 text-white text-sm font-bold flex items-center gap-1.5 hover:bg-blue-700 active:scale-95 transition-all shadow-lg shadow-blue-500/20"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              <span>新建</span>
            </button>
          </div>

          {/* Thread List */}
          <div className="flex-1 overflow-y-auto px-4 py-4">
            {threads.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="space-y-2">
                {threads.map((thread) => (
                  <div
                    key={thread.id}
                    onClick={() => handleSelectThread(thread.id)}
                    className={`
                      p-4 rounded-2xl cursor-pointer transition-all active:scale-95
                      ${thread.id === currentThreadId
                        ? 'bg-blue-50 border-2 border-blue-200'
                        : 'bg-gray-50 border-2 border-transparent hover:bg-gray-100'
                      }
                    `}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        {/* Title */}
                        <h3 className={`
                          text-sm font-bold truncate
                          ${thread.id === currentThreadId ? 'text-blue-900' : 'text-gray-900'}
                        `}>
                          {thread.title}
                        </h3>

                        {/* Preview */}
                        {thread.preview && (
                          <p className="text-xs text-gray-500 mt-1 line-clamp-1">
                            {thread.preview}
                          </p>
                        )}

                        {/* Meta info */}
                        <div className="flex items-center gap-3 mt-2">
                          <span className="text-[10px] text-gray-400 font-medium">
                            {formatRelativeTime(thread.updatedAt)}
                          </span>
                          <span className="text-[10px] text-gray-400">
                            {thread.messageCount} 条消息
                          </span>
                        </div>
                      </div>

                      {/* Current indicator */}
                      {thread.id === currentThreadId && (
                        <div className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0 mt-1.5" />
                      )}
                    </div>
                  </div>
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
    className="flex flex-col items-center justify-center h-full py-20"
  >
    <div className="w-20 h-20 bg-gray-100 rounded-3xl flex items-center justify-center mb-6">
      <svg className="w-10 h-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    </div>
    <h3 className="text-lg font-black text-gray-900 tracking-tighter mb-2">
      暂无历史对话
    </h3>
    <p className="text-sm text-gray-500 text-center max-w-[200px]">
      点击右上角"新建"开始与 AI 教练对话
    </p>
  </motion.div>
);
