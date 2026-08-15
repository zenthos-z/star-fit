import { outboxManager } from './OutboxManager';
import { API_BASE, getUserId } from '@/services/geminiService';

/**
 * WebSocketClient: Unified transport gateway with automatic reconnection and outbox integration
 * Based on DATA_PROTOCOL_STANDARD.md
 */
export class WebSocketClient {
  private socket: WebSocket | null = null;
  private url: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private handlers: Map<string, ((payload: any) => void)[]> = new Map();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private readonly HEARTBEAT_INTERVAL = 30000; // 30 seconds

  constructor(url: string) {
    this.url = url;
  }

  public connect() {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    try {
      this.socket = new WebSocket(this.url);
      
      // Register as sender for Outbox
      outboxManager.setSender((type, payload) => this.rawSend(type, payload));

      this.socket.onopen = () => {
        console.log('[WS] Connected');
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        outboxManager.triggerSync();
      };

      this.socket.onmessage = (event) => {
        try {
          this.handleMessage(JSON.parse(event.data));
        } catch (e) {
          console.error('[WS] Failed to parse message:', e);
        }
      };

      this.socket.onclose = () => {
        console.log('[WS] Disconnected');
        this.stopHeartbeat();
        this.handleReconnect();
      };

      this.socket.onerror = (error) => {
        console.error('[WS] Error:', error);
      };
    } catch (e) {
      console.error('[WS] Connection failed:', e);
      this.handleReconnect();
    }
  }

  private handleReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
      console.log(`[WS] Reconnecting in ${delay}ms... (Attempt ${this.reconnectAttempts})`);
      setTimeout(() => this.connect(), delay);
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.send('ping', { ts: Date.now() }, false);
      }
    }, this.HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private handleMessage(message: any) {
    const { jsonrpc, method, params, type, data } = message;
    const messageType = type || method;
    const payload = data ?? params ?? (message as any).payload;

    // Heartbeat response - ignore
    if (messageType === 'pong') {
      return;
    }

    // System messages for sync coordination
    if (messageType === 'sync_needed') {
      this.handleSyncNeeded();
      return;
    }
    if (messageType === 'knowledge_updated') {
      this.handleKnowledgeUpdated();
      return;
    }
    if (messageType === 'config_updated') {
      this.handleConfigUpdated();
      return;
    }

    console.log(`[WS] Received: ${messageType}`, payload);

    if (payload?.uiHint) {
      this.dispatchUIHint(payload.uiHint);
    }

    const typeHandlers = this.handlers.get(messageType);
    console.log(`[WS] Handlers for ${messageType}:`, typeHandlers?.length || 0);
    if (typeHandlers) {
      typeHandlers.forEach(handler => handler(payload));
    }

    const globalHandlers = this.handlers.get('*');
    if (globalHandlers) {
      globalHandlers.forEach(handler => handler(message));
    }
  }

  private async handleSyncNeeded() {
    console.log('[WS] Sync needed, pulling...');
    const { SyncService } = await import('@/services/syncService');
    await SyncService.pull();
    window.dispatchEvent(new CustomEvent('history-updated'));
  }

  private async handleKnowledgeUpdated() {
    console.log('[WS] Knowledge updated, pulling...');
    const { SyncService } = await import('@/services/syncService');
    await SyncService.pull();
  }

  private async handleConfigUpdated() {
    console.log('[WS] Config updated, pulling...');
    const { SyncService } = await import('@/services/syncService');
    await SyncService.pull();
    window.dispatchEvent(new CustomEvent('config-updated'));
  }

  private dispatchUIHint(uiHint: any) {
    // 1. Direct dispatch to window for legacy components
    window.dispatchEvent(new CustomEvent('starfit-ui-hint', { detail: uiHint }));

    // 2. Specialized dispatch for non-blocking coach insights
    if (uiHint.type === 'coach.insight') {
      const typeHandlers = this.handlers.get('coach.insight');
      if (typeHandlers) {
        typeHandlers.forEach(handler => handler(uiHint));
      }
    }
  }

  public subscribe(type: string, handler: (payload: any) => void) {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, []);
    }
    this.handlers.get(type)!.push(handler);
    console.log(`[WS] Subscribed to ${type}, total handlers: ${this.handlers.get(type)!.length}`);
    return () => {
      const h = this.handlers.get(type);
      if (h) {
        this.handlers.set(type, h.filter(x => x !== handler));
        console.log(`[WS] Unsubscribed from ${type}`);
      }
    };
  }

  /**
   * Sends a message through the outbox (reliable) or directly (unreliable)
   */
  public send(type: string, payload: any, reliable = true) {
    const envelope = {
      specversion: '1.0',
      type,
      source: '/client/frontend',
      id: crypto.randomUUID(),
      time: new Date().toISOString(),
      datacontenttype: 'application/json',
      data: payload,
    };

    if (reliable) {
      outboxManager.enqueue(type, envelope);
    } else {
      this.rawSend(type, envelope);
    }
  }

  private rawSend(_type: string, envelope: any): boolean {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(envelope));
      return true;
    }
    return false;
  }

  /**
   * Check if WebSocket is connected
   * Compatible with legacy SocketService interface
   */
  public isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  /**
   * Emit event with payload
   * Compatible with legacy eventTracking interface
   */
  public emit(eventType: string, payload: any) {
    this.send(eventType, payload, false);
  }
}

// Singleton instance
export const socketService = new WebSocketClient(
  (() => {
    const configuredUrl = (import.meta.env as any).VITE_WS_URL;
    const userId = encodeURIComponent(getUserId());
    
    // If a full URL with path is provided, use it (but ensure userId is present if missing)
    if (configuredUrl && configuredUrl.includes('/ws/')) {
      return configuredUrl.includes('userId=') 
        ? configuredUrl 
        : `${configuredUrl}${configuredUrl.includes('?') ? '&' : '?'}userId=${userId}&deviceId=web`;
    }

    // Fallback or incomplete URL: Build standard path
    const httpBase = String(configuredUrl || API_BASE || '').replace(/\/api\/?$/, '');
    const wsBase = httpBase.startsWith('https://')
      ? `wss://${httpBase.slice('https://'.length)}`
      : httpBase.startsWith('http://')
        ? `ws://${httpBase.slice('http://'.length)}`
        : httpBase.startsWith('ws') 
          ? httpBase 
          : `ws://${httpBase}`;
          
    return `${wsBase.replace(/\/$/, '')}/api/ws/sync?userId=${userId}&deviceId=web`;
  })()
);

socketService.connect();
