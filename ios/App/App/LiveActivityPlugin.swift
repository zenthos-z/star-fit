import Foundation
import Capacitor
import ActivityKit

/**
 * LiveActivityPlugin — 训练计时 Live Activity 桥（灵动岛 + 锁屏实时活动）。
 *
 * API：
 *   startActivity { workoutId, displayStart(ms) }   训练开始 / 恢复 / App 启动重建
 *   pauseActivity { frozenAt(ms) }                  暂停（冻结计时）
 *   endActivity {}                                  结束（立即清场）
 *   isSupported {}                                  能力探测（iOS<16.2 / 系统开关关闭 → false）
 *
 * 时间语义与 App 内 TimerCapsule 完全一致：elapsed = now - startTime - pausedDuration
 * → displayStart = startTime + pausedDuration，交给系统 Text(timerInterval:) 跳秒。
 */
@objc(LiveActivityPlugin)
public class LiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "LiveActivityPlugin"
    public let jsName = "LiveActivityPlugin"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "startActivity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pauseActivity", returnType: CAPPluginReturnNone),
        CAPPluginMethod(name: "endActivity", returnType: CAPPluginReturnNone),
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
    ]

    private let queue = DispatchQueue.main
    private let staleInterval: TimeInterval = 12 * 3600

    // MARK: - Capability

    @objc func isSupported(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve(["supported": false]); return
        }
        call.resolve(["supported": ActivityAuthorizationInfo().areActivitiesEnabled])
    }

    // MARK: - Start / Resume

    @objc func startActivity(_ call: CAPPluginCall) {
        queue.async { [weak self] in
            guard let self = self else { return }
            guard #available(iOS 16.2, *) else { call.resolve(); return }

            let workoutId = call.getString("workoutId") ?? UUID().uuidString
            let displayStartMs = call.getDouble("displayStart") ?? Date().timeIntervalSince1970 * 1000
            let displayStart = Date(timeIntervalSince1970: displayStartMs / 1000)

            guard ActivityAuthorizationInfo().areActivitiesEnabled else {
                print("[LiveActivity] disabled by system setting, skip")
                call.resolve(); return
            }

            // 幂等：同会话已在跑 → 更新（恢复场景：displayStart 已被 JS 后移）
            if let existing = self.findActivity(workoutId: workoutId) {
                let state = WorkoutActivityAttributes.ContentState(displayStart: displayStart, frozenAt: nil)
                Task {
                    await existing.update(
                        ActivityContent(state: state, staleDate: Date().addingTimeInterval(self.staleInterval))
                    )
                }
                call.resolve(); return
            }

            // 防串台：清掉其它遗留活动（正常同时只有一个训练会话）
            self.endAllExcept(workoutId: workoutId)

            let attributes = WorkoutActivityAttributes(workoutId: workoutId)
            let state = WorkoutActivityAttributes.ContentState(displayStart: displayStart, frozenAt: nil)
            Task {
                do {
                    _ = try Activity<WorkoutActivityAttributes>.request(
                        attributes: attributes,
                        content: ActivityContent(state: state, staleDate: Date().addingTimeInterval(self.staleInterval))
                    )
                    print("[LiveActivity] started:", workoutId)
                } catch {
                    print("[LiveActivity] start failed:", error)
                }
            }
            call.resolve()
        }
    }

    // MARK: - Pause

    /// 暂停：全部活动冻结在 frozenAt。恢复走 startActivity（displayStart 后移）。
    @objc func pauseActivity(_ call: CAPPluginCall) {
        queue.async { [weak self] in
            guard #available(iOS 16.2, *) else { return }
            guard let self = self else { return }
            let frozenAtMs = call.getDouble("frozenAt") ?? Date().timeIntervalSince1970 * 1000
            let frozenAt = Date(timeIntervalSince1970: frozenAtMs / 1000)

            Task {
                for activity in Activity<WorkoutActivityAttributes>.activities {
                    let state = WorkoutActivityAttributes.ContentState(
                        displayStart: activity.content.state.displayStart,
                        frozenAt: frozenAt
                    )
                    await activity.update(
                        ActivityContent(state: state, staleDate: Date().addingTimeInterval(self.staleInterval))
                    )
                }
            }
        }
    }

    // MARK: - End

    @objc func endActivity(_ call: CAPPluginCall) {
        queue.async {
            guard #available(iOS 16.2, *) else { return }
            Task {
                for activity in Activity<WorkoutActivityAttributes>.activities {
                    await activity.end(nil, dismissalPolicy: .immediate)
                }
            }
        }
    }

    // MARK: - Helpers

    @available(iOS 16.2, *)
    private func findActivity(workoutId: String) -> Activity<WorkoutActivityAttributes>? {
        Activity<WorkoutActivityAttributes>.activities.first { $0.attributes.workoutId == workoutId }
    }

    @available(iOS 16.2, *)
    private func endAllExcept(workoutId: String) {
        for activity in Activity<WorkoutActivityAttributes>.activities
        where activity.attributes.workoutId != workoutId {
            let a = activity
            Task { await a.end(nil, dismissalPolicy: .immediate) }
        }
    }
}
