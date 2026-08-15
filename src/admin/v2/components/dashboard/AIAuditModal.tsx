/**
 * AI Audit Modal
 *
 * AI 审计报告弹窗
 */

import React from 'react';
import { Button } from '../ui/Button';
import { X, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface AIAuditModalProps {
  auditText: string;
  sessionTitle: string;
  isOpen: boolean;
  onClose: () => void;
}

export const AIAuditModal: React.FC<AIAuditModalProps> = ({
  auditText,
  sessionTitle,
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-bold">AI 训练审计报告</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X size={20} />
          </button>
        </div>
        
        {/* Content */}
        <div className="p-4 space-y-4 overflow-y-auto">
        {/* 头部 */}
        <div className="border-b pb-4 flex items-center gap-2">
          <Sparkles size={20} className="text-emerald-500" />
          <div>
            <h3 className="font-bold">{sessionTitle}</h3>
            <p className="text-sm text-gray-500">AI 生成的训练分析报告</p>
          </div>
        </div>

        {/* 审计内容 */}
        <div className="prose prose-sm max-w-none">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => <h1 className="text-xl font-bold text-gray-900 mb-4">{children}</h1>,
              h2: ({ children }) => <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-3 flex items-center gap-2">{children}</h2>,
              h3: ({ children }) => <h3 className="text-base font-medium text-gray-700 mt-4 mb-2">{children}</h3>,
              p: ({ children }) => <p className="text-gray-600 mb-3 leading-relaxed">{children}</p>,
              ul: ({ children }) => <ul className="list-disc list-inside space-y-1 mb-3 text-gray-600">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal list-inside space-y-1 mb-3 text-gray-600">{children}</ol>,
              li: ({ children }) => <li className="ml-2">{children}</li>,
              strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
              em: ({ children }) => <em className="italic text-gray-700">{children}</em>,
              blockquote: ({ children }) => (
                <blockquote className="border-l-4 border-emerald-300 pl-4 py-2 bg-emerald-50 rounded-r my-3 text-gray-700">
                  {children}
                </blockquote>
              ),
              // 表格支持
              table: ({ children, ...props }) => (
                <div className="overflow-x-auto my-4 border border-gray-200 rounded-lg">
                  <table className="min-w-full border-collapse" {...props}>
                    {children}
                  </table>
                </div>
              ),
              thead: ({ children, ...props }) => (
                <thead className="bg-gray-100 border-b border-gray-200" {...props}>
                  {children}
                </thead>
              ),
              tbody: ({ children, ...props }) => (
                <tbody className="bg-white" {...props}>
                  {children}
                </tbody>
              ),
              tr: ({ children, ...props }) => (
                <tr className="border-b border-gray-200 last:border-b-0 hover:bg-gray-50" {...props}>
                  {children}
                </tr>
              ),
              th: ({ children, ...props }) => (
                <th 
                  className="px-4 py-3 text-left text-sm font-semibold text-gray-700 border-b border-gray-200 bg-gray-100"
                  {...props}
                >
                  {children}
                </th>
              ),
              td: ({ children, ...props }) => (
                <td 
                  className="px-4 py-3 text-sm text-gray-600 border-b border-gray-200 last:border-b-0"
                  {...props}
                >
                  {children}
                </td>
              ),
            }}
          >
            {auditText}
          </ReactMarkdown>
        </div>

        {/* 关闭按钮 */}
        <div className="flex justify-end pt-4 border-t">
          <Button variant="outline" onClick={onClose}>
            <X size={16} className="mr-1" />
            关闭
          </Button>
        </div>
        </div>
      </div>
    </div>
  );
};
