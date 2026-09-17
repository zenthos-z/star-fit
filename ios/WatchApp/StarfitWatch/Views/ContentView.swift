import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var model: WatchSessionModel
    /// DEBUG 脚手架：`--auto-page2` 启动时直接翻到概览页（模拟器无表冠，用于无头验证第二页渲染）
    @State private var initialSelection: Int = 0

    var body: some View {
        Group {
            switch model.phase {
            case .idle:
                IdleView()
            case .activeSet:
                // 表冠旋转切信息屏：verticalPage TabView 原生由表冠驱动翻页（watchOS 10+ HIG 主输入）。
                // 第一页=当前组（主角），第二页=训练概览。
                TabView(selection: $initialSelection) {
                    CurrentSetView().tag(0)   // 第 1 屏：练什么（动作/目标/组次为主，心率附属）
                    HeartRateView().tag(1)    // 第 2 屏：心率大展示 + 心率区间
                }
                .tabViewStyle(.verticalPage)
                .ignoresSafeArea(.all, edges: .bottom)
                // DEBUG 脚手架：--auto-page2 启动直接翻到概览页（模拟器无表冠）
                .onAppear {
                    if ProcessInfo.processInfo.arguments.contains("--auto-page2") {
                        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                            initialSelection = 1
                        }
                    }
                }
            case .resting:
                RestView()
            }
        }
        .animation(.spring(duration: 0.35), value: model.phase)
        .toolbar { ToolbarItem(placement: .cancellationAction) { connectionDot } }
    }

    /// 连接状态指示：绿=手机可达，橙=断连（演示态）
    private var connectionDot: some View {
        Circle()
            .fill(model.isConnected ? Color.green : Color.orange)
            .frame(width: 10, height: 10)
            .padding(6)
            .background(
                Circle().fill(.ultraThinMaterial)
            )
    }
}

// MARK: - 空闲态（等待手机计划 / 本地演示入口）

struct IdleView: View {
    @EnvironmentObject private var model: WatchSessionModel

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "figure.strengthtraining.traditional")
                .font(.system(size: 44))
                .foregroundStyle(.tint)
            Text("等待训练计划")
                .font(.headline)
            Text(model.isConnected ? "计划将显示在手表上" : "未连接手机 · 可用演示模式")
                .font(.caption2)
                .foregroundStyle(.secondary)

            Button {
                model.startDemo()
            } label: {
                Label("演示训练", systemImage: "play.fill")
                    .font(.footnote.bold())
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(.blue)
        }
        .padding(.horizontal)
    }
}
