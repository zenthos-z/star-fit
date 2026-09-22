import { WebSocket } from "ws";

/**
 * ChannelBroadcaster — 通用 WS 频道广播器（batch4-3，合并原 wsService +
 * websocketProgressService 两个同构浅模块）。
 *
 * 频道 key 语义由调用方约定：
 * - /api/ws/sync 通道：key = userId（用户维度），envelope {type, data, ts}
 * - /videos/progress 通道：key = taskId（任务维度），envelope {...event, time}
 *
 * 同一个 key 下可挂多个 socket；broadcast 到该 key 的全部活跃连接。
 */

type AnySocket = WebSocket & {
  deviceId?: string;
  socket?: { readyState?: number; send?: (data: string) => void };
  [key: string]: any;
};

/** 从直连 WebSocket 或 SocketStream 包装中读取 readyState / send（batch4-3 前两通道各自的兼容逻辑，收敛于此）。 */
function getReadyState(socket: AnySocket): number | undefined {
  if (typeof socket.readyState === "number") return socket.readyState;
  if (typeof socket.socket?.readyState === "number")
    return socket.socket.readyState;
  return undefined;
}

function socketSend(socket: AnySocket, message: string): void {
  try {
    if (typeof socket.send === "function") socket.send(message);
    else if (typeof socket.socket?.send === "function")
      socket.socket.send(message);
  } catch {
    // 发送失败（对端刚断开等）不阻断其余客户端
  }
}

function socketAlive(socket: AnySocket): boolean {
  const rs = getReadyState(socket);
  return rs == null || rs === WebSocket.OPEN;
}

export class ChannelBroadcaster {
  private channels: Map<string, Set<AnySocket>> = new Map();
  /** 每个挂载过的 socket 挂一个 close 清理器，避免重复绑定 */
  private cleanupBound = new WeakSet<object>();

  /** 注册 socket 到频道；自动绑定 close 清理（幂等）。 */
  subscribe(channelKey: string, socket: AnySocket): void {
    if (!this.channels.has(channelKey)) {
      this.channels.set(channelKey, new Set());
    }
    this.channels.get(channelKey)!.add(socket);

    if (!this.cleanupBound.has(socket)) {
      this.cleanupBound.add(socket);
      socket.on("close", () => {
        // socket 可能挂在多个频道（当前架构一个 socket 只进一个频道，防御性兜底）
        for (const [key, set] of this.channels.entries()) {
          set.delete(socket);
          if (set.size === 0) this.channels.delete(key);
        }
      });
    }
  }

  /** 手动取消订阅（socket 未触发 close 的场景兜底）。 */
  unsubscribe(channelKey: string, socket: AnySocket): void {
    const set = this.channels.get(channelKey);
    if (set) {
      set.delete(socket);
      if (set.size === 0) this.channels.delete(channelKey);
    }
  }

  /**
   * 广播到频道全部活跃客户端。
   * @param opts.excludeDeviceId 跳过指定设备（sync 场景排除发起设备）
   * @param opts.adminConsoleOnly 只发 deviceId='admin-console' 的连接
   *   （跨用户管理台广播；当前仓库暂无调用方，保留语义）
   */
  broadcast(
    channelKey: string,
    payload: { type: string; data: any },
    opts?: { excludeDeviceId?: string; adminConsoleOnly?: boolean },
  ): void {
    const set = this.channels.get(channelKey);
    if (!set || set.size === 0) return;

    const message = JSON.stringify({
      type: payload.type,
      data: payload.data,
      ts: Date.now(),
    });

    for (const socket of set) {
      if (opts?.excludeDeviceId && socket.deviceId === opts.excludeDeviceId)
        continue;
      if (opts?.adminConsoleOnly && socket.deviceId !== "admin-console")
        continue;
      if (!socketAlive(socket)) continue;
      socketSend(socket, message);
    }
  }

  /**
   * 视频进度事件广播（原 websocketProgressService.broadcast 语义）：
   * envelope = {...event, time}，time 缺省补 ISO 时间戳。
   */
  broadcastProgressEvent(
    channelKey: string,
    event: { type: string; data: any; time?: string },
  ): void {
    const set = this.channels.get(channelKey);
    if (!set || set.size === 0) return;

    const message = JSON.stringify({
      ...event,
      time: event.time || new Date().toISOString(),
    });

    for (const socket of set) {
      const rs = getReadyState(socket);
      if (rs != null && rs !== WebSocket.OPEN) continue;
      socketSend(socket, message);
    }
  }

  /** 频道活跃连接数（调试用）。 */
  getConnectionCount(channelKey: string): number {
    return this.channels.get(channelKey)?.size ?? 0;
  }
}

/** 用户维度同步/管理广播（原 wsService 单例，key=userId） */
export const wsService = new ChannelBroadcaster();

/** 任务维度视频进度广播（原 WebSocketProgressBroadcaster 单例，key=taskId） */
export const WebSocketProgressBroadcaster = new ChannelBroadcaster();
