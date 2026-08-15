import { FastifyInstance } from 'fastify';
export class WsService {
  private clients: Map<string, Set<any>> = new Map();

  registerClient(userId: string, connection: any) {
    if (!this.clients.has(userId)) {
      this.clients.set(userId, new Set());
    }
    this.clients.get(userId)!.add(connection);
    console.log(`[WsService] User ${userId} registered a client. Total clients for user: ${this.clients.get(userId)!.size}`);
  }

  unregisterClient(userId: string, connection: any) {
    const userClients = this.clients.get(userId);
    if (userClients) {
      userClients.delete(connection);
      if (userClients.size === 0) {
        this.clients.delete(userId);
      }
      console.log(`[WsService] User ${userId} unregistered a client.`);
    }
  }

  async broadcastToUser(userId: string, type: string, payload: any, excludeDeviceId?: string) {
    const userClients = this.clients.get(userId);
    if (userClients) {
      const message = JSON.stringify({ type, data: payload, ts: Date.now() });
      userClients.forEach(socket => {
        if (socket.deviceId === excludeDeviceId) return;

        const readyState =
          typeof socket.readyState === "number"
            ? socket.readyState
            : (typeof socket.socket?.readyState === "number" ? socket.socket.readyState : undefined);

        if (readyState != null && readyState !== 1) return;

        try {
          if (typeof socket.send === "function") socket.send(message);
          else if (typeof socket.socket?.send === "function") socket.socket.send(message);
        } catch {}
      });
    }
  }

  /**
   * 广播到所有 admin-console 设备（跨用户）
   * 用于管理控制台实时同步所有用户更新
   */
  async broadcastToAdminConsole(type: string, payload: any) {
    const message = JSON.stringify({ type, data: payload, ts: Date.now() });

    // 遍历所有用户，向 deviceId='admin-console' 的连接广播
    for (const [userId, clients] of this.clients.entries()) {
      clients.forEach(socket => {
        if (socket.deviceId !== 'admin-console') return;

        const readyState =
          typeof socket.readyState === "number"
            ? socket.readyState
            : (typeof socket.socket?.readyState === "number" ? socket.socket.readyState : undefined);

        if (readyState != null && readyState !== 1) return;

        try {
          if (typeof socket.send === "function") socket.send(message);
          else if (typeof socket.socket?.send === "function") socket.socket.send(message);
        } catch {}
      });
    }
  }
}

export const wsService = new WsService();
