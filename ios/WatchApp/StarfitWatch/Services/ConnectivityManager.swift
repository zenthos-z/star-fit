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

    // MARK: - WCSessionDelegate

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        DispatchQueue.main.async { [weak self] in
            self?.isReachable = session.isReachable
        }
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        DispatchQueue.main.async { [weak self] in
            self?.isReachable = session.isReachable
            self?.onReachabilityChanged?(session.isReachable)
        }
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        onApplicationContext?(applicationContext)
    }
}
