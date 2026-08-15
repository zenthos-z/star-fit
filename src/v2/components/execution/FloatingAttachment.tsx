import React, { useState, useEffect } from 'react';

export interface Attachment {
  id: string;
  type: 'insight' | 'tip' | 'warning' | 'celebration';
  content: string;
  timestamp: number;
  duration?: number; // ms to auto-hide
}

interface FloatingAttachmentProps {
  attachments: Attachment[];
  onDismiss: (id: string) => void;
}

/**
 * FloatingAttachment - The Interaction Gateway landing component.
 * Displays non-blocking AI context snippets and insights.
 * Implements Phase 4 of Plan 02.
 */
export const FloatingAttachment: React.FC<FloatingAttachmentProps> = ({ attachments, onDismiss }) => {
  return (
    <div className="fixed bottom-24 right-6 z-50 flex flex-col gap-3 items-end pointer-events-none">
      {attachments.map((attachment) => (
        <AttachmentItem 
          key={attachment.id} 
          attachment={attachment} 
          onDismiss={() => onDismiss(attachment.id)} 
        />
      ))}
    </div>
  );
};

const AttachmentItem: React.FC<{ attachment: Attachment; onDismiss: () => void }> = ({ attachment, onDismiss }) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Entrance animation
    const timer = setTimeout(() => setIsVisible(true), 10);
    
    // Auto-dismiss if duration provided
    let dismissTimer: any;
    if (attachment.duration) {
      dismissTimer = setTimeout(onDismiss, attachment.duration);
    }

    return () => {
      clearTimeout(timer);
      if (dismissTimer) clearTimeout(dismissTimer);
    };
  }, [attachment.duration, onDismiss]);

  const typeStyles = {
    insight: 'bg-blue-600 text-white border-blue-400',
    tip: 'bg-amber-500 text-white border-amber-300',
    warning: 'bg-rose-600 text-white border-rose-400',
    celebration: 'bg-emerald-600 text-white border-emerald-400'
  };

  const iconMap = {
    insight: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    tip: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
    ),
    warning: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ),
    celebration: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-7.714 2.143L11 21l-2.286-6.857L1 12l7.714-2.143L11 3z" />
      </svg>
    )
  };

  return (
    <div 
      className={`pointer-events-auto max-w-xs transition-all duration-300 transform border shadow-2xl rounded-2xl p-3 flex gap-3 items-start ${
        typeStyles[attachment.type]
      } ${isVisible ? 'translate-x-0 opacity-100' : 'translate-x-12 opacity-0'}`}
    >
      <div className="mt-0.5 opacity-80">{iconMap[attachment.type]}</div>
      <div className="flex-1">
        <p className="text-xs font-medium leading-relaxed">{attachment.content}</p>
      </div>
      <button 
        onClick={onDismiss}
        className="opacity-60 hover:opacity-100 transition-all active:scale-95 p-1"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
};
