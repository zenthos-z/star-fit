import SwiftUI

/// 心率专属屏（watchOS 26 Liquid Glass，表冠翻页第 2 页）——**心率大展示 + 心率区间**。
///
/// 信息架构（用户拍板）：心率是第 2 屏的主角，含实时大数字 + 五区间条 + 当前区间/范围 + 组均值。
/// 心率区间锚点：HRmax 默认 190（年龄基准 220-age，30 岁），后续可由手机端「静态负荷锚点」
/// （最大/静息心率）经 WatchConnectivity 同步覆盖——见 docs/adr/0001 心率模型。
struct HeartRateView: View {
    @EnvironmentObject private var model: WatchSessionModel

    /// 最大心率锚点（kg 默认 190；待手机静态负荷锚点同步后替换）
    private let hrMax = 190

    // MARK: 区间计算
    private var currentZone: Int {
        guard let bpm = model.liveBPM else { return 0 }
        let pct = Double(bpm) / Double(hrMax)
        switch pct {
        case ..<0.6: return 1
        case ..<0.7: return 2
        case ..<0.8: return 3
        case ..<0.9: return 4
        default: return 5
        }
    }

    private var zoneLabel: String {
        switch currentZone {
        case 1: return "轻松"
        case 2: return "燃脂"
        case 3: return "有氧"
        case 4: return "无氧"
        case 5: return "极限"
        default: return "--"
        }
    }

    private var zoneRange: String {
        let lo = Int(Double(hrMax) * Double(currentZone - 1) * 0.1 + Double(hrMax) * 0.5)
        let hi = currentZone == 5 ? hrMax : Int(Double(hrMax) * (0.5 + Double(currentZone) * 0.1))
        return "\(lo)–\(hi) BPM"
    }

    var body: some View {
        VStack(spacing: 8) {
            Spacer(minLength: 0)
            bigBPM                 // 实时大数字（主角）
            zoneBar                // 五区间条 + 当前区间标记
            zoneMeta               // 区间名 + 范围
            Spacer(minLength: 0)
            avgLine                // 组均值（附属）
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    // MARK: 实时大数字
    private var bigBPM: some View {
        VStack(spacing: 0) {
            Text(bpmText)
                .font(.system(size: 52, weight: .heavy, design: .rounded))
                .monospacedDigit()
                .contentTransition(.numericText())
                .animation(.snappy, value: model.liveBPM)
            Text("BPM")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
        }
    }

    // MARK: 五区间条（当前区间高亮 + 指针）
    private var zoneBar: some View {
        VStack(spacing: 4) {
            HStack(spacing: 4) {
                ForEach(1...5, id: \.self) { z in
                    Capsule()
                        .fill(zoneColor(z))
                        .frame(height: 8)
                        .opacity(z == currentZone ? 1.0 : 0.45)
                }
            }
            HStack {
                Text("Z1")
                Spacer()
                Text("Z5")
            }
            .font(.caption2)
            .foregroundStyle(.tertiary)
        }
    }

    // MARK: 区间名 + 范围
    private var zoneMeta: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(zoneColor(currentZone))
                .frame(width: 8, height: 8)
            Text(zoneLabel)
                .font(.headline)
            Text(zoneRange)
                .font(.caption)
                .foregroundStyle(.secondary)
                .monospacedDigit()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .glassEffect()
        .clipShape(Capsule())
    }

    // MARK: 组均值（附属）
    private var avgLine: some View {
        HStack(spacing: 5) {
            Text("本组均值")
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(model.currentSetAvgBPM.map { "\($0)" } ?? "--")
                .font(.subheadline.weight(.semibold))
                .monospacedDigit()
        }
    }

    // MARK: 区间配色（Liquid Glass 明度内，语义可辨）
    private func zoneColor(_ z: Int) -> Color {
        switch z {
        case 1: return .teal
        case 2: return .green
        case 3: return .yellow
        case 4: return .orange
        default: return .red
        }
    }

    private var bpmText: String {
        guard let bpm = model.liveBPM else { return "--" }
        return "\(bpm)"
    }
}
