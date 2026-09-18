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
        CAPPluginMethod(name: "getWatchStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reconnect", returnType: CAPPluginReturnPromise),
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

    /// JS 主动查询手表完整状态（设置页「Apple Watch」卡数据源）
    @objc func getWatchStatus(_ call: CAPPluginCall) {
        queue.async {
            guard WCSession.isSupported() else {
                call.resolve(["supported": false, "activated": false, "paired": false,
                              "appInstalled": false, "reachable": false]); return
            }
            let s = WCSession.default
            call.resolve([
                "supported": true,
                "activated": s.activationState == .activated,
                "paired": s.isPaired,
                "appInstalled": s.isWatchAppInstalled,
                "reachable": s.isReachable,
            ])
        }
    }

    /// JS 主动重连：重新激活 WCSession（手表刚解锁/回到 App 时可手动触发）
    @objc func reconnect(_ call: CAPPluginCall) {
        queue.async {
            guard WCSession.isSupported() else { call.resolve(["ok": false, "supported": false]); return }
            let s = WCSession.default
            if s.activationState != .activated {
                s.activate()
            }
            call.resolve(["ok": true, "supported": true])
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
    public func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        // 激活完成即向 JS 推一次状态（设置页卡片/训练页可据此刷新，无需轮询）
        if activationState == .activated {
            forwardWatchEvent(["kind": "watch_status", "reachable": session.isReachable,
                               "paired": session.isPaired, "appInstalled": session.isWatchAppInstalled])
        }
    }

    public func sessionDidBecomeInactive(_ session: WCSession) {}

    public func sessionDidDeactivate(_ session: WCSession) {
        WCSession.default.activate()
    }

    /// 可达性变化（手表抬腕解锁/离开范围）→ 主动推事件，替代轮询
    public func sessionWatchReachabilityDidChange(_ session: WCSession) {
        forwardWatchEvent(["kind": "watch_status", "reachable": session.isReachable,
                           "paired": session.isPaired, "appInstalled": session.isWatchAppInstalled])
    }

    public func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        forwardWatchEvent(message)
    }

    public func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        forwardWatchEvent(userInfo)
    }
}
