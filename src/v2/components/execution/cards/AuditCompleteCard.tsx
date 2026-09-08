import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface AuditCompleteCardProps {
  uiHint: {
    type: 'audit_complete';
    data: {
      title?: string;
      message: string;
      actionLabel?: string;
      requiresConfirmation?: boolean;
      updates: Array<{
        field: string;
        label: string;
        count: number;
        details?: string[];
      }>;
      sessionId?: string;
      auditContent?: string;  // Full audit report in Markdown format
    };
  };
  onConfirm?: (value: any) => void;
}

/**
 * AuditCompleteCard (AUDIT_COMPLETE) - Training audit completion notification
 *
 * Shown when training audit is complete and user profile has been updated.
 * Displays a structured list of updates (load anchors, physiological state, etc.).
 * When user clicks "View Details", expands to show the full audit report.
 */
export const AuditCompleteCard: React.FC<AuditCompleteCardProps> = ({ uiHint, onConfirm }) => {
  const [showAuditContent, setShowAuditContent] = useState(false);
  const [expandedUpdateIdx, setExpandedUpdateIdx] = useState<number | null>(null);
  // 「查看详情」全局展开态：无 auditContent 时用于就地展开所有字段明细
  const [showAllDetails, setShowAllDetails] = useState(false);
  const data = uiHint?.data || {} as AuditCompleteCardProps['uiHint']['data'];
  const title = data.title || '审计完成';
  const message = data.message || '您的训练数据已分析完成';
  const actionLabel = data.actionLabel || '查看详情';
  const updates = data.updates || [];
  const auditContent = data.auditContent || '';

  const handleClick = () => {
    if (auditContent) {
      // Toggle showing audit content
      setShowAuditContent(!showAuditContent);
    } else if (updates.some(u => u.details && u.details.length > 0)) {
      // 无完整审计报告时，「查看详情」就地展开/收起各字段明细（此前仅回调父级，
      // 父级无对应处理导致点击无效）
      setShowAllDetails(v => !v);
      setExpandedUpdateIdx(null);
    } else {
      // 真正无内容可看，通知父级
      console.log('[AuditCompleteCard] Button clicked, calling onConfirm');
      onConfirm?.({
        action: 'view_audit_details',
        sessionId: data.sessionId
      });
    }
  };

  const getFieldColor = (field: string) => {
    switch (field) {
      case 'loadAnchors':
      case 'load_anchors': return 'text-blue-600 bg-blue-50';
      case 'physiological':
      case 'recovery_state': return 'text-green-600 bg-green-50';
      case 'preferences':
      case 'memories': return 'text-purple-600 bg-purple-50';
      case 'basicInfo':
      case 'active_limitations': return 'text-orange-600 bg-orange-50';
      default: return 'text-gray-600 bg-gray-50';
    }
  };

  const getFieldIcon = (field: string) => {
    switch (field) {
      case 'loadAnchors':
      case 'load_anchors':
        return (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        );
      case 'physiological':
      case 'recovery_state':
        return (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
          </svg>
        );
      case 'preferences':
      case 'memories':
        return (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        );
      case 'basicInfo':
      case 'active_limitations':
        return (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        );
      default:
        return null;
    }
  };

  return (
    <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-floating">
      {/* Header - dark theme */}
      <div className="bg-star-dark px-4 py-3 flex items-center gap-2">
        <svg className="w-5 h-5 text-star-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <h3 className="text-white text-lg font-black uppercase tracking-widest">{title}</h3>
        {showAuditContent && (
          <button
            onClick={() => setShowAuditContent(false)}
            className="ml-auto text-white/70 hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Content */}
      {!showAuditContent ? (
        <div className="p-6">
          <div className="flex items-start gap-4 mb-4">
            <div className="flex-shrink-0 w-12 h-12 rounded-full bg-star-accent/10 flex items-center justify-center">
              <svg className="w-6 h-6 text-star-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-gray-700 leading-relaxed">
                {message}
              </p>
            </div>
          </div>

          {/* Updates list */}
          {updates.length > 0 && (
            <div className="space-y-2 mt-4 pt-4 border-t border-gray-100">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">已更新内容</p>
              {updates.map((update, idx) => (
                <div key={idx}>
                  <div className={`flex items-center gap-3 px-3 py-2 rounded-xl ${getFieldColor(update.field)}`}>
                    <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-white/50 flex items-center justify-center">
                      <span className="text-sm font-black">{update.count}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {getFieldIcon(update.field)}
                      <span className="text-sm font-bold">{update.label}</span>
                    </div>
                    {update.details && update.details.length > 0 && (
                      <button
                        onClick={() => setExpandedUpdateIdx(expandedUpdateIdx === idx ? null : idx)}
                        aria-expanded={expandedUpdateIdx === idx}
                        className="ml-auto flex-shrink-0 text-xs px-2 py-0.5 bg-white/60 rounded-full font-medium hover:bg-white transition-colors"
                      >
                        {expandedUpdateIdx === idx ? '收起明细' : `${update.details.length} 条明细`}
                      </button>
                    )}
                  </div>
                  {update.details && update.details.length > 0 && (expandedUpdateIdx === idx || showAllDetails) && (
                    <ul className="mt-1 ml-11 space-y-1">
                      {update.details.map((detail, i) => (
                        <li key={i} className="text-xs text-gray-600 leading-relaxed flex items-start gap-1.5">
                          <span className="flex-shrink-0 mt-1 w-1 h-1 rounded-full bg-gray-400" aria-hidden="true" />
                          <span className="break-words">{detail}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Audit Content (Markdown) */
        <div className="p-6 max-h-[60vh] overflow-y-auto custom-scrollbar">
          <div className="prose prose-sm max-w-none prose-headings:font-black prose-headings:text-gray-900 prose-p:text-gray-700 prose-p:leading-relaxed prose-a:text-star-accent prose-a:no-underline hover:prose-a:underline prose-strong:text-gray-900 prose-li:text-gray-700">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {auditContent}
            </ReactMarkdown>
          </div>
        </div>
      )}

      {/* Action button */}
      {!showAuditContent && (
        <div className="p-5 pt-0">
          <button
            onClick={handleClick}
            className="w-full py-4 rounded-2xl font-black italic uppercase tracking-widest bg-star-accent text-white hover:bg-blue-600 shadow-lg shadow-blue-500/20 transition-all active:scale-95"
          >
            {auditContent ? (showAuditContent ? '收起详情' : actionLabel)
              : updates.some(u => u.details && u.details.length > 0) ? (showAllDetails ? '收起详情' : actionLabel)
              : actionLabel}
          </button>
        </div>
      )}
    </div>
  );
};
