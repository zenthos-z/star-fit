import SwiftUI
import WidgetKit
import ActivityKit

/**
 * StarfitWidgetBundle — 训练计时 Live Activity（灵动岛 + 锁屏实时活动）。
 *
 * 设计规范（Apple HIG / ActivityKit）：
 * - 计时用系统 `Text(timerInterval:)`，由系统渲染跳秒，进程被杀也继续准确走表
 * - 灵动岛 compact：leading = 动作图标，trailing = 计时；minimal = 图标
 * - 锁屏卡：标准左图右文布局，SF Symbol + 蓝 tint，无私有材质
 * - 点按默认行为即打开宿主 App，不设 widgetURL
 */
@main
struct StarfitWidgetBundle: WidgetBundle {
    var body: some Widget {
        WorkoutLiveActivityWidget()
    }
}

struct WorkoutLiveActivityWidget: Widget {

    /// 运行态：displayStart..远未来（系统持续向上跳秒）；暂停态：冻结在 displayStart...frozenAt
    private func elapsedRange(_ state: WorkoutActivityAttributes.ContentState) -> ClosedRange<Date> {
        let end = state.frozenAt ?? state.displayStart.addingTimeInterval(12 * 3600)
        return state.displayStart...max(state.displayStart, end)
    }

    var body: some WidgetConfiguration {
        ActivityConfiguration(for: WorkoutActivityAttributes.self) { context in
            LockScreenCapsule(state: context.state)
                .padding()
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: "figure.run")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(.blue)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(timerInterval: elapsedRange(context.state), countsDown: false)
                        .font(.system(.title3, design: .rounded).weight(.semibold))
                        .monospacedDigit()
                        .foregroundStyle(context.state.isPaused ? .secondary : .primary)
                }
            } compactLeading: {
                Image(systemName: "figure.run")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.blue)
            } compactTrailing: {
                Text(timerInterval: elapsedRange(context.state), countsDown: false)
                    .font(.system(.callout, design: .rounded).weight(.semibold))
                    .monospacedDigit()
                    .frame(maxWidth: 64)
            } minimal: {
                Image(systemName: "figure.run")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.blue)
            }
        }
    }
}

/// 锁屏实时活动卡：HIG 标准布局——左侧图标徽章 + 状态标签 + 大号计时
private struct LockScreenCapsule: View {
    let state: WorkoutActivityAttributes.ContentState

    private var elapsedRange: ClosedRange<Date> {
        let end = state.frozenAt ?? state.displayStart.addingTimeInterval(12 * 3600)
        return state.displayStart...max(state.displayStart, end)
    }

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: "figure.run")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(.blue)
                .frame(width: 42, height: 42)
                .background(Circle().fill(.blue.opacity(0.12)))

            VStack(alignment: .leading, spacing: 2) {
                Text(state.isPaused ? "已暂停" : "运动中")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
                Text(timerInterval: elapsedRange, countsDown: false)
                    .font(.system(size: 30, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(state.isPaused ? Color.secondary : Color.primary)
            }

            Spacer(minLength: 0)
        }
    }
}
