import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Loader, CheckCircle } from 'lucide-react';

interface StrategyConfirmCardProps {
  uiHint: {
    type: 'strategy_confirm';
    data: {
      title?: string;
      message?: string;
      actionLabel?: string;
      preview: string;
      fullContent: string;
      updatedAt?: string;
    };
  };
  onConfirm?: (payload: any) => void;
}

/**
 * StrategyConfirmCard (STRATEGY_CONFIRM) - Training strategy confirmation card
 *
 * Shown when AI generates a new training strategy for the user.
 * Clicking "View Strategy" opens a fullscreen editing interface using Portal.
 * Visual style matches AuditCompleteCard (dark header, rounded corners, shadows).
 */
type SaveStatus = 'idle' | 'saving' | 'success' | 'error';

export const StrategyConfirmCard: React.FC<StrategyConfirmCardProps> = ({ uiHint, onConfirm }) => {
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);
  const [editedContent, setEditedContent] = useState('');
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');

  const data = uiHint?.data || {} as StrategyConfirmCardProps['uiHint']['data'];
  const title = data.title || '训练策略更新';
  const message = data.message || 'AI 已为您生成新的训练策略';
  const actionLabel = data.actionLabel || '查看策略';
  const fullContent = data.fullContent || '';
  const updatedAt = data.updatedAt;

  // Initialize edited content when opening fullscreen editor
  const handleOpenFullscreen = () => {
    setEditedContent(fullContent);
    setIsFullscreenOpen(true);
    setActiveTab('edit');
    setSaveStatus('idle');
  };

  const handleCloseFullscreen = () => {
    setIsFullscreenOpen(false);
    setEditedContent('');
    setActiveTab('edit');
    setSaveStatus('idle');
  };

  const handleSave = async () => {
    console.log('[StrategyConfirmCard] Save clicked, calling onConfirm');
    setSaveStatus('saving');
    try {
      await onConfirm?.({
        action: 'save',
        content: editedContent
      });
      setSaveStatus('success');
      // Show success briefly before closing
      setTimeout(() => {
        setIsFullscreenOpen(false);
      }, 800);
    } catch (error) {
      console.error('[StrategyConfirmCard] Save failed:', error);
      setSaveStatus('error');
    }
  };

  // Fullscreen Editor Component - Rendered via Portal
  const FullscreenEditor = (
    <div className="fixed inset-0 z-[9999] bg-gray-50 flex flex-col p-4 pt-8">
      {/* Header - Fixed at top */}
      <div className="flex-shrink-0 bg-star-dark px-4 py-4 rounded-t-2xl flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-white text-lg font-black uppercase tracking-widest">编辑训练策略</h3>
        </div>
        <button
          onClick={handleCloseFullscreen}
          className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center text-white/70 hover:text-white hover:bg-white/20 transition-all"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Tab Navigation */}
      <div className="flex-shrink-0 flex bg-white border-b border-gray-100">
        <button
          onClick={() => setActiveTab('edit')}
          className={`flex-1 py-3 text-xs font-black uppercase tracking-widest transition-colors ${
            activeTab === 'edit'
              ? 'text-star-accent border-b-2 border-star-accent'
              : 'text-gray-400 hover:text-gray-600'
          }`}
        >
          编辑
        </button>
        <button
          onClick={() => setActiveTab('preview')}
          className={`flex-1 py-3 text-xs font-black uppercase tracking-widest transition-colors ${
            activeTab === 'preview'
              ? 'text-star-accent border-b-2 border-star-accent'
              : 'text-gray-400 hover:text-gray-600'
          }`}
        >
          预览
        </button>
      </div>

      {/* Content Area - Scrollable with rounded corners */}
      <div className="flex-1 overflow-hidden bg-white rounded-b-2xl mb-4">
        {activeTab === 'edit' ? (
          <textarea
            value={editedContent}
            onChange={(e) => setEditedContent(e.target.value)}
            className="w-full h-full p-6 bg-white text-sm font-medium text-gray-800 leading-relaxed resize-none outline-none custom-scrollbar rounded-b-2xl"
            placeholder="输入训练策略内容..."
            autoFocus
          />
        ) : (
          <div className="w-full h-full p-6 overflow-y-auto custom-scrollbar bg-white rounded-b-2xl">
            <div className="prose prose-base max-w-none prose-headings:font-black prose-headings:text-gray-900 prose-p:text-gray-700 prose-p:leading-relaxed prose-a:text-star-accent prose-a:no-underline hover:prose-a:underline prose-strong:text-gray-900 prose-li:text-gray-700 prose-ul:my-4 prose-ol:my-4">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {editedContent || '*暂无内容*'}
              </ReactMarkdown>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Action Bar */}
      <div className="flex-shrink-0 flex gap-3 px-2 pb-6">
        <button
          onClick={handleCloseFullscreen}
          disabled={saveStatus === 'saving' || saveStatus === 'success'}
          className="flex-1 py-4 rounded-2xl font-black italic uppercase tracking-widest bg-gray-200 text-gray-600 hover:bg-gray-300 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          取消
        </button>
        <div className="flex-1 relative">
          {/* Save Status Indicator - positioned above button */}
          {saveStatus !== 'idle' && (
            <div className="absolute -top-8 left-1/2 -translate-x-1/2 flex items-center gap-2 whitespace-nowrap">
              {saveStatus === 'saving' && (
                <>
                  <Loader className="w-4 h-4 text-yellow-600 animate-spin" />
                  <span className="text-xs text-yellow-600 font-bold uppercase">保存中...</span>
                </>
              )}
              {saveStatus === 'success' && (
                <>
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <span className="text-xs text-green-600 font-bold uppercase">保存成功</span>
                </>
              )}
              {saveStatus === 'error' && (
                <>
                  <div className="w-2 h-2 rounded-full bg-red-500" />
                  <span className="text-xs text-red-600 font-bold uppercase">保存失败</span>
                </>
              )}
            </div>
          )}
          <button
            onClick={handleSave}
            disabled={saveStatus === 'saving' || saveStatus === 'success'}
            className="w-full py-4 rounded-2xl font-black italic uppercase tracking-widest bg-star-accent text-white hover:bg-blue-600 shadow-lg shadow-blue-500/20 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {saveStatus === 'saving' && <Loader className="w-5 h-5 animate-spin" />}
            {saveStatus === 'success' ? '已保存' : '保存策略'}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Main Card - No preview, just info and action button */}
      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-floating">
        {/* Header - dark theme, matching AuditCompleteCard */}
        <div className="bg-star-dark px-4 py-3 flex items-center gap-2">
          <svg className="w-5 h-5 text-star-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <h3 className="text-white text-lg font-black uppercase tracking-widest">{title}</h3>
        </div>

        {/* Content - Simple info display */}
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-12 h-12 rounded-full bg-star-accent/10 flex items-center justify-center">
              <svg className="w-6 h-6 text-star-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-gray-700 leading-relaxed">
                {message}
              </p>
              {updatedAt && (
                <p className="text-xs text-gray-400 mt-1">
                  更新时间: {new Date(updatedAt).toLocaleString('zh-CN')}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Action button */}
        <div className="p-5 pt-0">
          <button
            onClick={handleOpenFullscreen}
            className="w-full py-4 rounded-2xl font-black italic uppercase tracking-widest bg-blue-50 text-star-accent hover:bg-blue-100 transition-all active:scale-95"
          >
            {actionLabel}
          </button>
        </div>
      </div>

      {/* Fullscreen Editor - Rendered via Portal to document.body */}
      {isFullscreenOpen && createPortal(FullscreenEditor, document.body)}
    </>
  );
};
