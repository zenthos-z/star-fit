import Foundation
import ActivityKit

/**
 * WorkoutActivityAttributes — Live Activity 契约（App target 与 Widget 扩展 target 共享编译）。
 *
 * 时间模型与 App 内 TimerCapsule 完全一致：
 *   elapsed = now - startTime - pausedDuration
 * 为让系统 `Text(timerInterval:)` 直接跳秒（退后台也精确），
 * ContentState 传「展示起点」而非原始时刻：
 *   displayStart = startTime + pausedDuration   → 运行态从该点向上计时
 *   frozenAt     = 暂停瞬间                      → 暂停态冻结在 displayStart...frozenAt
 */
@available(iOS 16.1, *)
struct WorkoutActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        /// 计时展示起点（= startTime + pausedDuration）
        var displayStart: Date
        /// 暂停的时刻；nil = 运行中
        var frozenAt: Date?

        var isPaused: Bool { frozenAt != nil }
    }

    /// 本次训练会话 id（对应 Session.id）
    var workoutId: String
}
