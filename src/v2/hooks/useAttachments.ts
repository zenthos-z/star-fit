import { useState, useCallback, useEffect } from 'react';
import { Attachment } from '../components/execution/FloatingAttachment';
import { socketService } from '../services/transport/WebSocketClient';

/**
 * useAttachments Hook
 * Provides a simple interface for card plugins and AI streams to push non-blocking context snippets.
 */
export const useAttachments = () => {
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  const addAttachment = useCallback((attachment: Omit<Attachment, 'id' | 'timestamp'>) => {
    const id = Math.random().toString(36).substring(2, 9);
    const newAttachment: Attachment = {
      ...attachment,
      id,
      timestamp: Date.now(),
    };
    setAttachments(prev => [...prev, newAttachment]);
  }, []);

  const dismissAttachment = useCallback((id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  }, []);

  // Listen for AI Coach Insights from WebSocket and UI Hints
  useEffect(() => {
    const handleInsight = (payload: any) => {
      addAttachment({
        type: payload.type || 'insight',
        content: payload.content,
        duration: payload.duration || 5000
      });
    };

    const unsubscribe = socketService.subscribe('coach.insight', handleInsight);
    
    // Also listen for local events (like from DeviationLogger)
    const handleLocalEvent = (e: any) => {
      if (e.detail?.type === 'coach.insight') {
        handleInsight(e.detail);
      }
    };
    window.addEventListener('starfit-ui-hint', handleLocalEvent);

    return () => {
      unsubscribe();
      window.removeEventListener('starfit-ui-hint', handleLocalEvent);
    };
  }, [addAttachment]);

  return {
    attachments,
    addAttachment,
    dismissAttachment
  };
};
