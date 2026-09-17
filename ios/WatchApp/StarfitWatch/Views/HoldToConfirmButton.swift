import SwiftUI
import WatchKit

/// 长按确认按钮（防误触，训练场景标配：Apple 锻炼 App 同款交互）。
///
/// 交互：按住 → 按钮视觉填充（0.6s）→ 触发动作。
/// 震动反馈：按下 start 震一下、填充中段震一下、触发时 success 震动。
/// 提前松手 = 取消，无动作。
///
/// 性能：填充宽度由 SwiftUI `.linear` 动画驱动（GPU 合成，满帧），
/// 不用 Timer 逐帧改 progress（那会锁 20fps 掉帧）；定时器只负责震动时机。
struct HoldToConfirmButton: View {
    let label: String
    let icon: String
    let tint: Color
    var duration: Double = 0.6
    let action: () -> Void

    @State private var progress: CGFloat = 0
    @State private var isHolding = false
    @State private var midpointHaptic: DispatchWorkItem?
    @State private var completeWork: DispatchWorkItem?

    private let shape = Capsule(style: .continuous)

    var body: some View {
        GeometryReader { geo in
            ZStack {
                // 底：按钮底色（胶囊，与系统 borderedProminent 视觉一致）
                shape
                    .fill(tint.opacity(isHolding ? 0.95 : 0.75))
                // 中：长按填充层（.linear 动画由渲染管线驱动，不掉帧）
                HStack {
                    Rectangle()
                        .fill(Color.white.opacity(0.85))
                        .frame(width: geo.size.width * progress)
                    Spacer(minLength: 0)
                }
                .clipShape(shape)
                // 文字
                HStack(spacing: 6) {
                    Image(systemName: icon)
                        .font(.system(size: 22, weight: .black))
                    Text(isHolding ? "松手取消" : label)
                        .font(.body.weight(.bold))
                }
                .foregroundStyle(isHolding ? tint : .white)
            }
        }
        .frame(height: 54)
        .animation(.easeInOut(duration: 0.15), value: isHolding)
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in
                    if !isHolding {
                        isHolding = true
                        playHaptic(.start)
                        startFill()
                    }
                }
                .onEnded { _ in
                    // 填满后 onEnded（松手）不再重复触发——completeWork 已置 nil
                    if let complete = completeWork {
                        complete.cancel()
                        completeWork = nil
                        // 未填满松手 = 取消
                        cancel(haptic: true)
                    }
                }
        )
    }

    // MARK: 开始填充：一条 linear 动画推到 1，两个异步点管震动与触发
    private func startFill() {
        cancelPending()
        withAnimation(.linear(duration: duration)) {
            progress = 1.0
        }

        // 过半震动
        let mid = DispatchWorkItem { playHaptic(.click) }
        midpointHaptic = mid
        DispatchQueue.main.asyncAfter(deadline: .now() + duration / 2, execute: mid)

        // 填满触发
        let done = DispatchWorkItem {
            completeWork = nil
            playHaptic(.success)
            action()
            finish()
        }
        completeWork = done
        DispatchQueue.main.asyncAfter(deadline: .now() + duration, execute: done)
    }

    // MARK: 松手取消
    private func cancel(haptic: Bool) {
        cancelPending()
        if haptic { playHaptic(.click) }
        withAnimation(.easeOut(duration: 0.2)) { progress = 0 }
        isHolding = false
    }

    // MARK: 触发后收尾
    private func finish() {
        withAnimation(.easeOut(duration: 0.2)) { progress = 0 }
        isHolding = false
    }

    private func cancelPending() {
        midpointHaptic?.cancel()
        midpointHaptic = nil
        completeWork?.cancel()
        completeWork = nil
    }
}
