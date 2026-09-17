import AppIntents
import Foundation

/// Ultra Action 按钮 / 辅助手势可触发的动作（watchOS 11+ App Intents）。
///
/// 背景：表冠「按下」是系统保留手势（回表盘），App 无法监听（Apple HIG 明文）。
/// 替代通路 = Apple Watch Ultra 的 Action 按钮（设置 → Action 按钮 → 快捷指令/App 内动作）
/// 与 AssistiveTouch 辅助手势（握拳=点击焦点元素）。
/// 动作直接路由到全局 WatchSessionModel（App 级单例持有）。
enum WorkoutActionRouter {
    /// App 级模型引用，由 App 入口注入（SwiftUI @StateObject 与 Intent 共享同一实例）
    static weak var model: WatchSessionModel?
}

/// 完成本组（执行态的主按钮等价动作）
struct CompleteSetIntent: AppIntent {
    static var title: LocalizedStringResource = "完成本组"
    static var description = IntentDescription("确认完成当前训练组（可映射到 Ultra Action 按钮）")

    func perform() async throws -> some IntentResult {
        await MainActor.run {
            guard let model = WorkoutActionRouter.model else { return }
            if model.phase == .activeSet {
                model.completeCurrentSet()
            } else if model.phase == .resting {
                model.endRest()
            }
        }
        return .result()
    }
}
