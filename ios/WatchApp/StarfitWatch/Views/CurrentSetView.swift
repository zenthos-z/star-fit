import SwiftUI

/// 单组屏（watchOS 26 Liquid Glass，表冠翻页第 1 屏）——**主信息屏：练什么**。
///
/// 排版 v3（用户要求换思路：不用上下居中堆叠）：
/// 左右分区布局——
/// ┌─────────────────────┐
/// │ 动作名(两行大字)  心率 │  ← 左 2/3 主信息 · 右 1/3 附属
/// │ 目标            组号  │
/// ├─────────────────────┤
/// │ ▓▓▓▓▓░░░░ 细进度条    │  ← 全宽细进度条（替代圆点，更省纵向）
/// │ [    ✓ 完成本组     ] │  ← 全宽大按钮
/// └─────────────────────┘
struct CurrentSetView: View {
    @EnvironmentObject private var model: WatchSessionModel

    var body: some View {
        // 徽标钉在屏幕最顶端（与右上角系统时间上边缘对齐）；内容区在状态栏下方原位不动。
        ZStack(alignment: .topLeading) {
            typeBadge
                .padding(.leading, 12)
                .padding(.top, 16) // 像素实测：时间顶部 y≈17-27pt，16pt 使徽标上边缘与时间对齐
            VStack(spacing: 8) {
                infoGrid        // 左右分区主信息（动作名主角）
                progressBar     // 全宽细进度条
                completeButton  // 全宽大按钮
            }
            .padding(.horizontal, 12)
            .padding(.top, 66)  // 状态栏行(32) + 徽标高(~26) + 间距：内容在徽标行下方，不重叠
            .padding(.bottom, 6)
        }
        .ignoresSafeArea(.all, edges: .top) // 只为让徽标进入状态栏区；内容已用 padding 定位
    }

    // MARK: 类型徽标（动作属性标签，与系统时间上边缘对齐）
    private var typeBadge: some View {
        HStack(spacing: 4) {
            Image(systemName: model.setState.typeIcon)
                .font(.caption2)
            Text(model.setState.typeBadge)
                .font(.caption2.weight(.bold))
            // 已训练时长（手机胶囊同源口径）。
            // 暂停感知（2026-09-20 修复"5 秒跳变"）：暂停中手机每秒平移 displayStartMs，
            // 但 WC 链路对高频小差异 payload 有合并节流 → 手表「本地走秒+周期拉回」跳变。
            // 手表端改本地冻结：收到 PAUSED 即锁定 elapsed（镜像平移只作校准，误差<1s 不闪）。
            if let start = model.setState.displayStartMs, start > 0 {
                if model.setState.sessionPhase == "PAUSED" {
                    Text("· " + Self.elapsedText(since: start, now: Date()))
                        .font(.caption2.weight(.bold))
                        .monospacedDigit()
                        .foregroundStyle(.orange) // 暂停可视化：橙色=冻结
                } else {
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        Text("· " + Self.elapsedText(since: start, now: context.date))
                            .font(.caption2.weight(.bold))
                            .monospacedDigit()
                    }
                }
            }
        }
        .foregroundStyle(.tint)
        .padding(.horizontal, 7)
        .padding(.vertical, 2)
        .glassEffect()
        .clipShape(Capsule())
    }

    /// 已训练时长 mm:ss（静态工具：now 由 TimelineView context 提供）
    private static func elapsedText(since startMs: Int64, now: Date) -> String {
        let elapsed = max(0, Int64(now.timeIntervalSince1970) - startMs / 1000)
        let m = elapsed / 60
        let s = elapsed % 60
        return String(format: "%02d:%02d", m, s)
    }

    // MARK: 左右分区（左 2/3 动作+目标，右 1/3 心率+组号）
    private var infoGrid: some View {
        HStack(alignment: .top, spacing: 10) {
            // 左：动作名（自适应大字，绝对主角）+ 目标
            VStack(alignment: .leading, spacing: 4) {
                Text(model.setState.exerciseName)
                    .font(.system(size: fontSize(for: model.setState.exerciseName), weight: .black, design: .rounded))
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)          // 超长名自动缩字，容器内绝不截断
                    .fixedSize(horizontal: false, vertical: true)
                    .multilineTextAlignment(.leading)
                    .accessibilityLabel("当前动作 \(model.setState.exerciseName)")
                Text(targetText)
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, -4) // 动作名上边缘与右栏心率图标顶部对齐（实测低 5-10px）

            // 右：心率小卡（上）+ 组号大字（下），窄列右对齐
            VStack(alignment: .trailing, spacing: 6) {
                HStack(spacing: 3) {
                    Image(systemName: "heart.fill")
                        .font(.caption2)
                        .foregroundStyle(.pink)
                    Text(bpmText)
                        .font(.footnote.weight(.bold))
                        .monospacedDigit()
                        .contentTransition(.numericText())
                }
                .foregroundStyle(.secondary)

                Text("\(model.setState.completedCount + 1)/\(model.setState.totalSets)")
                    .font(.title2.weight(.black))
                    .monospacedDigit()
                    .foregroundStyle(.tint)
            }
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: 全宽细进度条（第几组，替代圆点）
    private var progressBar: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color.secondary.opacity(0.25))
                Capsule()
                    .fill(Color.green)
                    .frame(width: progressWidth(geo.size.width))
            }
        }
        .frame(height: 6)
        .animation(.snappy, value: model.setState.completedCount)
    }

    // MARK: 完成按钮（长按确认防误触 + 震动反馈）
    private var completeButton: some View {
        HoldToConfirmButton(
            label: "完成本组",
            icon: "checkmark",
            tint: .green
        ) {
            model.completeCurrentSet()
        }
        .accessibilityLabel("完成本组")
        .accessibilityAction(.default) { model.completeCurrentSet() } // 辅助手势（AssistiveTouch 捏合/握拳）稳定命中
    }

    // MARK: 数据
    /// 按名称长度自适应基准字号（容器内再由 minimumScaleFactor 兜底缩放）：
    /// 2-3 字 → 40pt；4-5 字 → 32pt；6 字以上 → 26pt
    private func fontSize(for name: String) -> CGFloat {
        switch name.count {
        case ...3: return 40
        case 4...5: return 32
        default: return 26
        }
    }

    private func progressWidth(_ total: CGFloat) -> CGFloat {
        let n = max(model.setState.totalSets, 1)
        let done = CGFloat(min(model.setState.completedCount, n)) / CGFloat(n)
        return total * done
    }

    private var targetText: String {
        guard let t = model.setState.targetLabel else { return "—" }
        return "目标 \(t)"
    }

    private var bpmText: String {
        guard let bpm = model.liveBPM else { return "--" }
        return "\(bpm)"
    }
}
