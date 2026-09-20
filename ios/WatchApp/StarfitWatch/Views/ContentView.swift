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
            case .workoutDone:
                WorkoutDoneView()
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
        // 调试版本指纹（发布前移除）：底部小字 build 时间，肉眼即可确认手表是不是新包
        .overlay(alignment: .bottom) {
            Text(Self.debugVersionTag)
                .font(.system(size: 9, weight: .semibold, design: .monospaced))
                .foregroundStyle(.secondary.opacity(0.55))
                .padding(.bottom, 2)
        }
        .toolbar { ToolbarItem(placement: .cancellationAction) { connectionDot } }
    }

    /// 调试版本指纹：__DATE__ __TIME__ = 编译时刻（发布前删除此 overlay）
    static var debugVersionTag: String {
        let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"
        let b = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "0"
        return "v\(v) b\(b)"
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
            if model.setState.status == "READY" && model.setState.totalSets > 0 {
                // 计划已导入（手机 idle）：预告首个动作，等手机点开始
                Image(systemName: model.setState.typeIcon)
                    .font(.system(size: 36))
                    .foregroundStyle(.tint)
                Text(model.setState.exerciseName)
                    .font(.headline)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                if let target = model.setState.targetLabel {
                    Text(target)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Text(model.isConnected ? "已就绪 · 在手机上开始训练" : "计划已同步 · 等待连接")
                    .font(.caption2)
                    .foregroundStyle(.secondary)

                Button {
                    model.requestSyncFromPhone()
                } label: {
                    Label("同步手机数据", systemImage: "arrow.triangle.2.circlepath")
                        .font(.footnote.bold())
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(.blue)
            } else {
                Image(systemName: "figure.strengthtraining.traditional")
                    .font(.system(size: 44))
                    .foregroundStyle(.tint)
                Text("等待训练计划")
                    .font(.headline)
                Text(model.isConnected ? "计划将显示在手表上" : "未连接手机 · 可用演示模式")
                    .font(.caption2)
                    .foregroundStyle(.secondary)

                Button {
                    model.requestSyncFromPhone()
                } label: {
                    Label("同步手机数据", systemImage: "arrow.triangle.2.circlepath")
                        .font(.footnote.bold())
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(.blue)

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
        }
        .padding(.horizontal)
    }
}


// MARK: - 训练完成（恭喜页；DONE 镜像进入。2026-09-20）

struct WorkoutDoneView: View {
    @EnvironmentObject private var model: WatchSessionModel

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "trophy.fill")
                .font(.system(size: 40))
                .foregroundStyle(.yellow)
            Text("训练结束")
                .font(.headline)
            Text("干得漂亮 💪")
                .font(.caption)
                .foregroundStyle(.secondary)
            if let start = model.setState.displayStartMs, start > 0 {
                Text(Self.elapsedText(since: start))
                    .font(.title3.weight(.black).monospacedDigit())
                    .foregroundStyle(.tint)
            }
            Button {
                model.acknowledgeDone()
            } label: {
                Label("完成", systemImage: "checkmark")
                    .font(.footnote.bold())
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(.green)
        }
        .padding(.horizontal)
    }

    private static func elapsedText(since startMs: Int64) -> String {
        let elapsed = max(0, Int64(Date().timeIntervalSince1970) - startMs / 1000)
        let h = elapsed / 3600
        let m = (elapsed % 3600) / 60
        let s = elapsed % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%02d:%02d", m, s)
    }
}
