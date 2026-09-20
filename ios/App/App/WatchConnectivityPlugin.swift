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
        CAPPluginMethod(name: "sendStateMessage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isWatchReachable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getWatchStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reconnect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "drainWatchEvents", returnType: CAPPluginReturnPromise),
    ]

    private let queue = DispatchQueue.main

    override public func load() {
        super.load()
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        session.activate()
    }

    /// JS → 手表：镜像当前组状态。双通道（2026-09-19 真机实锤 applicationContext
    /// 在部分真机链路上不送达）：applicationContext（缓存快照，手表后开可补收）
    /// + sendMessage（可达即推，实时通道）。手表端两条 delegate 都收，幂等处理。
    @objc func broadcastSetState(_ call: CAPPluginCall) {
        guard let state = call.getObject("state") else {
            call.reject("state required"); return
        }
        cacheSetState(state)
        queue.async {
            guard WCSession.isSupported() else { call.resolve(["ok": false]); return }
            let payload = ["set_state": state]
            // 1) applicationContext：最新快照，重连/手表后开补发
            do {
                try WCSession.default.updateApplicationContext(payload)
            } catch {
                // 快照失败不阻塞实时通道，仅记录
                NSLog("[WC] updateApplicationContext failed: \(error.localizedDescription)")
            }
            // 2) sendMessage：可达即推（真机可达通道可靠，连接状态即靠它）
            if WCSession.default.isReachable {
                WCSession.default.sendMessage(payload, replyHandler: nil) { error in
                    NSLog("[WC] sendMessage fallback error: \(error.localizedDescription)")
                }
            }
            call.resolve(["ok": true])
        }
    }

    /// JS → 手表：仅 sendMessage 直推（同步按钮触发时用，要求手表立即响应）
    @objc func sendStateMessage(_ call: CAPPluginCall) {
        guard let state = call.getObject("state") else {
            call.reject("state required"); return
        }
        queue.async {
            guard WCSession.isSupported() else { call.resolve(["ok": false]); return }
            let payload = ["set_state": state]
            let reachable = WCSession.default.isReachable
            if reachable {
                WCSession.default.sendMessage(payload, replyHandler: nil) { error in
                    NSLog("[WC] sendStateMessage error: \(error.localizedDescription)")
                }
            }
            call.resolve(["ok": true, "reachable": reachable])
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

    /// 手表 → 手机事件转发（桥事件），失败时 evaluateJavaScript 直调兜底
    /// 2026-09-20 P1：推模式补拉模式——转发前先入环形缓冲，
    /// JS 侧每 2s drainWatchEvents 主动拉取兜底（上行链路真机不可靠根修，
    /// 与 request_sync 原生直答同思路：JS→native 调用方向已被证明可靠）。
    private func forwardWatchEvent(_ payload: [String: Any]) {
        let json: String
        if let d = try? JSONSerialization.data(withJSONObject: payload),
           let s = String(data: d, encoding: .utf8) {
            json = s
        } else {
            return
        }

        // 入环形缓冲（容量 64：hr_live 5s 一条 ≈ 5 分钟窗口，足够补拉）
        eventBuffer.append(json)
        if eventBuffer.count > 64 { eventBuffer.removeFirst(eventBuffer.count - 64) }

        notifyListeners("watchEvent", data: payload)
        // 兜底直调：`window.dispatchEvent(new CustomEvent('starfit:watch-event', {detail: ...}))`
        let js = "window.dispatchEvent(new CustomEvent('starfit:watch-event',{detail:\(json)}));"
        DispatchQueue.main.async {
            self.bridge?.webView?.evaluateJavaScript(js) { _, _ in }
        }
    }

    /// JS 主动拉取缓冲事件（读即清；重复消费由 JS 侧 onWatchEvent 幂等处理）
    @objc func drainWatchEvents(_ call: CAPPluginCall) {
        let events = eventBuffer
        eventBuffer.removeAll()
        call.resolve(["events": events])
    }

    // MARK: - 状态快照（原生层缓存，供 request_sync 直答；JS 每次广播时刷新）

    private var lastSetState: [String: Any]?
    /// 上行事件环形缓冲（drainWatchEvents 拉取兜底的数据源）
    private var eventBuffer: [String] = []

    /// JS 广播时同步缓存一份到原生层（request_sync replyHandler 直答数据源）
    private func cacheSetState(_ state: [String: Any]) {
        lastSetState = state
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
        // 无应答版本：统一转给带 replyHandler 的重载处理
        self.session(session, didReceiveMessage: message, replyHandler: { _ in })
    }

    /// 手表 sendMessage 带 replyHandler 时 WCSession 走此回调（带应答通道）
    public func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        if (message["kind"] as? String) == "request_sync" {
            NSLog("[WC] request_sync (reply) received, cached=%@", lastSetState != nil ? "yes" : "nil")
            if let state = lastSetState {
                replyHandler(["set_state": state])
            } else {
                replyHandler([:])
                forwardWatchEvent(["kind": "request_sync"])
            }
            return
        }
        forwardWatchEvent(message)
        replyHandler([:])
    }

    public func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        forwardWatchEvent(userInfo)
    }
}
