import Foundation
import Capacitor
import WatchConnectivity

/**
 * WatchConnectivityPlugin — 手表伴侣镜像桥（ADR-0001）。
 *
 * 方向：
 * - JS → 手表：broadcastSetState（手机把当前焦点组状态镜像到手表 applicationContext）
 * - 手表 → JS：watchEvent 事件（set_completed / rest_action / hr_batch），
 *   由 JS 侧 watchConnectivity.ts 订阅并接入训练状态机 / 心率同步
 *
 * 桥模式沿用 LiquidGlassPlugin（手写原生插件 + packageClassList 注册），
 * 事件通道不可靠时用 evaluateJavaScript 直调兜底（既有教训）。
 */
@objc(WatchConnectivityPlugin)
public class WatchConnectivityPlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "WatchConnectivityPlugin"
    public let jsName = "WatchConnectivityPlugin"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "broadcastSetState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isWatchReachable", returnType: CAPPluginReturnPromise),
    ]

    private let queue = DispatchQueue.main

    override public func load() {
        super.load()
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        session.activate()
    }

    /// JS → 手表：镜像当前组状态（applicationContext，最省电，重连自动补发）
    @objc func broadcastSetState(_ call: CAPPluginCall) {
        guard let state = call.getObject("state") else {
            call.reject("state required"); return
        }
        queue.async {
            guard WCSession.isSupported() else { call.resolve(["ok": false]); return }
            do {
                try WCSession.default.updateApplicationContext(["set_state": state])
                call.resolve(["ok": true])
            } catch {
                call.reject("updateApplicationContext failed: \(error.localizedDescription)")
            }
        }
    }

    @objc func isWatchReachable(_ call: CAPPluginCall) {
        queue.async {
            let reachable = WCSession.isSupported() && WCSession.default.isReachable
            call.resolve(["reachable": reachable])
        }
    }

    /// 手表 → JS 事件转发（桥事件），失败时 evaluateJavaScript 直调兜底
    private func forwardWatchEvent(_ payload: [String: Any]) {
        let json: String
        if let d = try? JSONSerialization.data(withJSONObject: payload),
           let s = String(data: d, encoding: .utf8) {
            json = s
        } else {
            return
        }
        notifyListeners("watchEvent", data: payload)
        // 兜底直调：`window.dispatchEvent(new CustomEvent('starfit:watch-event', {detail: ...}))`
        let js = "window.dispatchEvent(new CustomEvent('starfit:watch-event',{detail:\(json)}));"
        DispatchQueue.main.async {
            self.bridge?.webView?.evaluateJavaScript(js) { _, _ in }
        }
    }
}

// MARK: - WCSessionDelegate

extension WatchConnectivityPlugin: WCSessionDelegate {
    public func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {}

    public func sessionDidBecomeInactive(_ session: WCSession) {}

    public func sessionDidDeactivate(_ session: WCSession) {
        WCSession.default.activate()
    }

    public func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        forwardWatchEvent(message)
    }

    public func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        forwardWatchEvent(userInfo)
    }
}
