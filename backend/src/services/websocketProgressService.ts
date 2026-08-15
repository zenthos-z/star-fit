import { WebSocket } from 'ws';

interface ProgressEvent {
  type: string;
  data: any;
  time?: string;
}

/**
 * WebSocket 进度广播器
 * 用于向订阅了特定 taskId 的客户端发送视频处理进度
 */
class WebSocketProgressBroadcasterClass {
  private clients: Map<string, WebSocket[]> = new Map();

  /**
   * 客户端订阅特定 taskId 的进度
   */
  subscribe(taskId: string, ws: WebSocket): void {
    if (!this.clients.has(taskId)) {
      this.clients.set(taskId, []);
    }
    this.clients.get(taskId)!.push(ws);

    // 客户端断开时自动清理
    ws.on('close', () => {
      this.unsubscribe(taskId, ws);
    });
  }

  /**
   * 取消订阅
   */
  unsubscribe(taskId: string, ws: WebSocket): void {
    const clients = this.clients.get(taskId);
    if (clients) {
      const index = clients.indexOf(ws);
      if (index > -1) {
        clients.splice(index, 1);
      }
      if (clients.length === 0) {
        this.clients.delete(taskId);
      }
    }
  }

  /**
   * 广播进度事件到所有订阅了该 taskId 的客户端
   */
  broadcast(taskId: string, event: ProgressEvent): void {
    const clients = this.clients.get(taskId);
    if (!clients) return;

    const message = JSON.stringify({
      ...event,
      time: event.time || new Date().toISOString()
    });

    clients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    });
  }

  /**
   * 获取活跃连接数（用于调试）
   */
  getConnectionCount(taskId: string): number {
    const clients = this.clients.get(taskId);
    return clients ? clients.length : 0;
  }
}

export const WebSocketProgressBroadcaster = new WebSocketProgressBroadcasterClass();
