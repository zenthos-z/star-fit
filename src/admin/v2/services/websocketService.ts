/**
 * WebSocket Service - 前端 WebSocket 连接服务
 * 
 * 用于实时接收后端推送的用户画像更新通知
 */

const WS_BASE_URL = import.meta.env.VITE_WS_URL || `ws://localhost:43111`;

class WebSocketService {
  private socket: WebSocket | null = null;
  private listeners: Map<string, Set<Function>> = new Map();
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 3000;

  connect(userId: string, deviceId: string = 'admin-console') {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      console.log('[WebSocket] Already connected');
      return;
    }

    // 防止重复连接
    if (this.socket && (this.socket.readyState === WebSocket.CONNECTING || this.socket.readyState === WebSocket.CLOSING)) {
      console.log('[WebSocket] Connection in progress, skipping');
      return;
    }

    const url = `${WS_BASE_URL}/api/ws/sync?userId=${encodeURIComponent(userId)}&deviceId=${encodeURIComponent(deviceId)}`;
    console.log('[WebSocket] Connecting to:', url);

    try {
      this.socket = new WebSocket(url);

      this.socket.onopen = () => {
        console.log('[WebSocket] Connected');
        this.reconnectAttempts = 0;
      };

      this.socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log('[WebSocket] Received:', message);
          this.emit(message.type, message.data);
        } catch (error) {
          console.error('[WebSocket] Failed to parse message:', error);
        }
      };

      this.socket.onerror = (error) => {
        // WebSocket 错误不会中断页面功能，静默处理
        console.warn('[WebSocket] Connection error (this is expected if backend WebSocket is not available)');
      };

      this.socket.onclose = (event) => {
        console.log(`[WebSocket] Connection closed (code: ${event.code}, reason: ${event.reason || 'none'})`);
        this.socket = null;

        // 只在非正常关闭时重连
        if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          console.log(`[WebSocket] Reconnecting (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
          setTimeout(() => {
            this.connect(userId, deviceId);
          }, this.reconnectDelay);
        }
      };
    } catch (error) {
      console.error('[WebSocket] Failed to create WebSocket:', error);
      this.socket = null;
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
      console.log('[WebSocket] Disconnected');
    }
  }

  on(event: string, callback: Function) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  off(event: string, callback: Function) {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.delete(callback);
      if (eventListeners.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  private emit(event: string, data: any) {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`[WebSocket] Error in listener for ${event}:`, error);
        }
      });
    }
  }

  send(type: string, data: any) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      const message = JSON.stringify({ type, data, ts: Date.now() });
      this.socket.send(message);
    } else {
      console.warn('[WebSocket] Not connected, cannot send message');
    }
  }
}

export const wsService = new WebSocketService();
