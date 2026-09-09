/**
 * UserAgentChat — 管理界面的悬浮 Agent 对话窗
 *
 * 交互模型（2026-09 用户拍板）：
 * - **悬浮窗**而非固定列：右下角 FAB 唤起，头部可拖拽，独立于页面两列布局。
 * - 面板顶部是**上下文附件 chip 条**：来自 ProfileFullSheet 的「点击区块 → +」
 *   附加。chip 是挂载态展示，**不是**把内容填进输入框；发送时才随消息序列化。
 * - 在 sheet 中附加数据时面板自动弹开。
 * - 聊天内容流式渲染（SSE token / thinking），支持 Markdown。
 * - 对话身份 = 当前选中的目标用户：Agent 的读写工具都作用在该用户画像上。
 *
 * 视觉：Codex 式极简——近单色、1px 边框、扁平；唯一强调色 = 黑（用户气泡/主按钮）。
 *
 * @module UserAgentChat
 * @version 2.0.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, X, Sparkles, Paperclip } from 'lucide-react';
import { adminAgentChat } from '../../services/adminAgentClient';
import {
  useAgentContextAttachments,
  agentContextStore,
} from '../../state/agentContextStore';
import { MarkdownRenderer } from '../../../../components/MarkdownRenderer';

interface ChatMessage {
  role: 'user' | 'ai';
  text: string;
  /** 本条用户消息发送时带上的附件标题快照 */
  attachmentTitles?: string[];
  thinkingText?: string;
  error?: string;
}

interface UserAgentChatProps {
  targetUserId: string;
  targetUserName: string;
}

const PANEL_W = 400;

export const UserAgentChat: React.FC<UserAgentChatProps> = ({ targetUserId, targetUserName }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [open, setOpen] = useState(false);
  const attachments = useAgentContextAttachments();
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 悬浮窗位置（right/bottom 偏移），可拖拽
  const posRef = useRef({ right: 24, bottom: 24 });
  const [pos, setPos] = useState({ right: 24, bottom: 24 });

  // 切换目标用户：清空对话与上下文（附件属于特定用户画像，不能跨用户携带）
  useEffect(() => {
    setMessages([]);
    setInput('');
    agentContextStore.clear();
  }, [targetUserId]);

  // 自动滚底
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, isStreaming]);

  // sheet 中附加数据 → 自动弹开悬浮窗
  const prevAttachCount = useRef(0);
  useEffect(() => {
    if (attachments.length > prevAttachCount.current) setOpen(true);
    prevAttachCount.current = attachments.length;
  }, [attachments.length]);

  const handleSend = async () => {
    const text = input.trim();
    if ((!text && attachments.length === 0) || isStreaming) return;

    const attachmentTitles = attachments.map((a) => a.title);
    const attachedContext = agentContextStore.serialize();
    const message = attachedContext
      ? `${text || '请基于附加的上下文数据进行分析。'}${attachedContext}`
      : text;

    setMessages((prev) => [...prev, { role: 'user', text: text || '（附加上下文）', attachmentTitles }]);
    setInput('');
    agentContextStore.clear();
    setIsStreaming(true);
    setMessages((prev) => [...prev, { role: 'ai', text: '' }]);

    try {
      let acc = '';
      let thinkingAcc = '';
      for await (const ev of adminAgentChat({ targetUserId, message })) {
        if (ev.type === 'token') {
          acc += ev.text;
          setMessages((prev) => {
            const next = [...prev];
            next[next.length - 1] = { ...next[next.length - 1], text: acc };
            return next;
          });
        } else if (ev.type === 'thinking') {
          thinkingAcc += ev.text;
          setMessages((prev) => {
            const next = [...prev];
            next[next.length - 1] = { ...next[next.length - 1], thinkingText: thinkingAcc };
            return next;
          });
        } else if (ev.type === 'error') {
          setMessages((prev) => {
            const next = [...prev];
            next[next.length - 1] = { ...next[next.length - 1], error: ev.error.message };
            return next;
          });
        }
      }
    } finally {
      setIsStreaming(false);
    }
  };

  const startDrag = (e: React.PointerEvent) => {
    // 不拦截头部按钮
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startPos = { ...posRef.current };
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const maxRight = Math.max(window.innerWidth - PANEL_W - 8, 8);
      const maxBottom = Math.max(window.innerHeight - 160, 8);
      const next = {
        right: Math.min(Math.max(startPos.right - dx, 8), maxRight),
        bottom: Math.min(Math.max(startPos.bottom - dy, 8), maxBottom),
      };
      posRef.current = next;
      setPos(next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <>
      {/* FAB：悬浮窗收起时显示 */}
      {!open && (
        <button
          className="fixed bottom-6 right-6 z-[150] w-12 h-12 rounded-full bg-gray-900 text-white shadow-lg flex items-center justify-center hover:bg-gray-700 transition-colors"
          onClick={() => setOpen(true)}
          aria-label="打开 Agent 教练"
          data-testid="agent-chat-fab"
        >
          <Sparkles size={18} />
          {attachments.length > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-white border border-gray-300 text-gray-800 text-[10px] font-semibold flex items-center justify-center">
              {attachments.length}
            </span>
          )}
        </button>
      )}

      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed z-[150] bg-white border border-gray-200 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
            style={{
              width: PANEL_W,
              height: 'min(640px, 80vh)',
              right: pos.right,
              bottom: pos.bottom,
            }}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            data-testid="user-agent-chat"
          >
            {/* 头部（拖拽把手） */}
            <div
              className="flex items-center gap-2.5 px-4 h-12 shrink-0 border-b border-gray-200 cursor-move select-none touch-none"
              onPointerDown={startDrag}
              data-testid="agent-chat-header"
            >
              <Sparkles size={15} className="text-gray-500 shrink-0" />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-medium text-gray-900 leading-tight">Agent 教练</h3>
                <p className="text-[10px] text-gray-400 truncate leading-tight">
                  以「{targetUserName}」的身份对话 · 修改会写入其画像
                </p>
              </div>
              <button
                className="w-7 h-7 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 flex items-center justify-center"
                onClick={() => setOpen(false)}
                aria-label="收起 Agent 教练"
              >
                <X size={15} />
              </button>
            </div>

            {/* 上下文附件 chip 条 */}
            {attachments.length > 0 && (
              <div className="px-4 pt-3 pb-1 shrink-0" data-testid="agent-context-chips">
                <div className="flex flex-wrap gap-1.5">
                  {attachments.map((a) => (
                    <span
                      key={a.id}
                      className="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-lg bg-gray-100 border border-gray-200 text-xs text-gray-700"
                    >
                      <Paperclip size={11} className="text-gray-400 shrink-0" />
                      <span className="max-w-[140px] truncate">{a.title}</span>
                      <button
                        className="w-4 h-4 rounded flex items-center justify-center text-gray-400 hover:text-gray-700"
                        aria-label={`移除附件「${a.title}」`}
                        onClick={() => agentContextStore.remove(a.id)}
                      >
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* 消息流 */}
            <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4">
              {messages.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-center">
                  <p className="text-sm text-gray-500 mb-1.5">以「{targetUserName}」的身份与 Agent 对话</p>
                  <p className="text-xs text-gray-400 max-w-[260px] leading-relaxed">
                    在「完整画像」中点击任意数据块的「+」，即可把该块数据附加为对话上下文。
                  </p>
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={m.role === 'user' ? 'flex flex-col items-end' : 'flex flex-col items-start'}>
                  {/* 用户消息上方的附件引用条（挂载附件，非输入框文本） */}
                  {m.role === 'user' && m.attachmentTitles && m.attachmentTitles.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-1 justify-end">
                      {m.attachmentTitles.map((t) => (
                        <span
                          key={t}
                          className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 border border-gray-200"
                        >
                          <Paperclip size={9} /> {t}
                        </span>
                      ))}
                    </div>
                  )}
                  <div
                    className={
                      m.role === 'user'
                        ? 'max-w-[85%] bg-gray-900 text-white text-sm rounded-2xl rounded-br-md px-3.5 py-2 whitespace-pre-wrap'
                        : 'max-w-full text-sm text-gray-800 leading-relaxed'
                    }
                  >
                    {m.role === 'ai' ? (
                      m.error ? (
                        <p className="text-red-600 text-xs">请求失败：{m.error}</p>
                      ) : m.text ? (
                        <MarkdownRenderer content={m.text} />
                      ) : isStreaming ? (
                        <span className="inline-flex gap-1 py-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-gray-300 animate-bounce" />
                          <span className="w-1.5 h-1.5 rounded-full bg-gray-300 animate-bounce [animation-delay:0.15s]" />
                          <span className="w-1.5 h-1.5 rounded-full bg-gray-300 animate-bounce [animation-delay:0.3s]" />
                        </span>
                      ) : null
                    ) : (
                      m.text
                    )}
                  </div>
                  {m.role === 'ai' && m.thinkingText && (
                    <details className="mt-1">
                      <summary className="text-[10px] text-gray-400 cursor-pointer select-none">Agent 自审过程</summary>
                      <p className="text-[10px] text-gray-400 whitespace-pre-wrap mt-1">{m.thinkingText}</p>
                    </details>
                  )}
                </div>
              ))}
            </div>

            {/* 输入区 */}
            <div className="border-t border-gray-200 p-3 shrink-0">
              <div className="flex items-end gap-2">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  rows={1}
                  placeholder={attachments.length > 0 ? `就附加的 ${attachments.length} 项数据提问…` : `询问「${targetUserName}」的画像或训练…`}
                  className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 resize-none outline-none focus:border-gray-400 text-sm text-gray-800 placeholder:text-gray-400 max-h-24 transition-colors"
                />
                <button
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                    isStreaming || (!input.trim() && attachments.length === 0)
                      ? 'bg-gray-100 text-gray-300'
                      : 'bg-gray-900 text-white hover:bg-gray-700'
                  }`}
                  aria-label="发送"
                  disabled={isStreaming || (!input.trim() && attachments.length === 0)}
                  onClick={handleSend}
                >
                  <Send size={14} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
