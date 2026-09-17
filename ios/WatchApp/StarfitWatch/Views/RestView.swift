import SwiftUI

/// 组间休息（Liquid Glass）：
/// 倒计时 + 双按钮（结束休息主 / +10 秒次）。
struct RestView: View {
    @EnvironmentObject private var model: WatchSessionModel
    @State private var now = Date()

    private let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    private var remainingSec: Int {
        guard let end = model.setState.restEndTime else { return 0 }
        return max(0, Int((Double(end) / 1000).rounded()) - Int(now.timeIntervalSince1970))
    }

    var body: some View {
        VStack(spacing: 10) {
            restCard
            endRestButton
            extendButton
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .onReceive(timer) { t in now = t }
    }

    // MARK: 倒计时玻璃卡
    private var restCard: some View {
        VStack(spacing: 2) {
            Text(timeString(remainingSec))
                .font(.system(size: 44, weight: .heavy, design: .monospaced))
                .monospacedDigit()
                .contentTransition(.numericText())
            Text("休息中")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .glassEffect() // watchOS 26 Liquid Glass 官方管线（Glass.regular）
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
    }

    // MARK: 结束休息（长按确认防误触）
    private var endRestButton: some View {
        HoldToConfirmButton(
            label: "结束休息",
            icon: "arrow.right.circle.fill",
            tint: .orange
        ) {
            model.endRest()
        }
        .accessibilityLabel("结束休息")
        .accessibilityAction(.default) { model.endRest() } // 辅助手势稳定命中
    }

    // MARK: +10 秒（次按钮）
    private var extendButton: some View {
        Button {
            model.extendRest(by: 10)
        } label: {
            Label("+10 秒", systemImage: "plus.circle")
                .font(.footnote.bold())
                .frame(maxWidth: .infinity)
                .frame(height: 48)
        }
        .buttonStyle(.bordered)
        .tint(.orange)
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private func timeString(_ s: Int) -> String {
        String(format: "%02d:%02d", s / 60, s % 60)
    }
}
