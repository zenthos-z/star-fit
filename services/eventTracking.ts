// Use unified WebSocketClient instead of legacy SocketService
import { socketService } from '../src/v2/services/transport/WebSocketClient';

export enum TrackingEvent {
  CORRECTION_WEIGHT = 'correction_weight',
  CORRECTION_EXERCISE = 'correction_exercise',
  HITL_RESPONSE = 'hitl_response',
  AI_PLAN_CONFIRMED = 'ai_plan_confirmed'
}

export const eventTracking = {
  track(event: TrackingEvent, payload: any) {
    const userId = localStorage.getItem('starfit_user_id') || 'anonymous';
    const timestamp = Date.now();
    
    const data = {
      event,
      userId,
      timestamp,
      payload
    };

    console.log(`[Tracking] ${event}:`, data);

    // If socket is connected, send to backend for real-time analysis/logging
    if (socketService.isConnected()) {
      socketService.emit('track_event', data);
    }

    // Also log to local storage for batch sync if offline
    this.saveLocal(data);
  },

  saveLocal(data: any) {
    try {
      const logs = JSON.parse(localStorage.getItem('starfit_tracking_logs') || '[]');
      logs.push(data);
      // Keep last 100 logs
      if (logs.length > 100) logs.shift();
      localStorage.setItem('starfit_tracking_logs', JSON.stringify(logs));
    } catch (e) {
      console.error('Failed to save tracking log:', e);
    }
  }
};
