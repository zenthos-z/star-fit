import Foundation
import WatchConnectivity

/// WatchConnectivity 封装（手表侧）：
/// - applicationContext：手机 → 手表（当前组状态镜像，最省电通道）
/// - message：手表 → 手机（组完成 / 休息动作 / 心率批），可达时即发
/// - 断连：调用方（WatchSessionModel）积压，回连后补发
final class ConnectivityManager: NSObject, WCSessionDelegate, ObservableObject {
    static let shared = ConnectivityManager()

    var onApplicationContext: (([String: Any]) -> Void)?
    var onReachabilityChanged: ((Bool) -> Void)?
    @Published private(set) var isReachable = false

    private override init() { super.init() }

    func activate() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        session.activate()
    }

    func sendMessage(_ payload: [String: Any]) {
        guard WCSession.isSupported(), WCSession.default.isReachable else { return }
        WCSession.default.sendMessage(payload, replyHandler: nil) { [weak self] error in
            // 消息发送失败（如超时）：不再重试，操作在手机侧由状态最终一致性兜底
            self?.onReachabilityChanged?(false)
        }
    }

    /// 手表 → 手机：请求立即重推当前训练状态（同步按钮用）。
    /// 用 replyHandler：手机原生层直接用缓存的最新 set_state 作答（2026-09-19：
    /// 真机 JS 事件转发链不可靠，replyHandler 原路返回最稳）。
    func requestSync() {
        guard WCSession.isSupported(), WCSession.default.isReachable else {
            NSLog("[WCM] requestSync: NOT reachable, dropped")
            return
        }
        NSLog("[WCM] requestSync: sending")
        WCSession.default.sendMessage(["kind": "request_sync"], replyHandler: { [weak self] reply in
            NSLog("[WCM] requestSync reply keys=%@", reply.keys.map { String($0) }.joined(separator: ","))
            if !reply.isEmpty {
                DispatchQueue.main.async { self?.onApplicationContext?(reply) }
            }
        }, errorHandler: { error in
            NSLog("[WCM] requestSync error: \(error.localizedDescription)")
        })
    }

    // MARK: - WCSessionDelegate

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        DispatchQueue.main.async { [weak self] in
            self?.isReachable = session.isReachable
        }
        // 激活完成 → 主动拉取手机缓存的最新快照。
        // 场景：手表后开（手机早把 READY/训练态广播过了）——didReceiveApplicationContext
        // 只在「新快照到达」时触发，缓存快照必须在这里主动读，否则手表永远等不到。
        if activationState == .activated,
           !session.receivedApplicationContext.isEmpty {
            let dict = session.receivedApplicationContext
            DispatchQueue.main.async { [weak self] in
                self?.onApplicationContext?(dict)
            }
        }
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        DispatchQueue.main.async { [weak self] in
            self?.isReachable = session.isReachable
            self?.onReachabilityChanged?(session.isReachable)
        }
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        NSLog("[WCM] didReceiveApplicationContext keys=%@", applicationContext.keys.map { String($0) }.joined(separator: ","))
        onApplicationContext?(applicationContext)
    }

    /// 双通道接收（2026-09-19）：手机 sendMessage 直推的 set_state 也走同一处理
    /// （真机 applicationContext 不送达，实时通道为主）。幂等：WatchSessionModel
    /// 按 status/completedCount 判定，重复快照无副作用。
    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        NSLog("[WCM] didReceiveMessage kind=%@", (message["kind"] as? String) ?? (message["set_state"] != nil ? "set_state" : "?"))
        if message["set_state"] != nil {
            onApplicationContext?(message)
        }
    }
}
