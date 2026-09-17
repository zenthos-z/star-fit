import Foundation
import Combine
import WatchConnectivity
import WatchKit

/// 会话状态机：手机镜像 + 本地演示态（断连时）。
/// - 连接时：状态来自 WCSession applicationContext（手机每步同步）。
/// - 断连时：本地演示态推进（可真实跑 HKWorkoutSession 心率 + 本地组推进）。
enum AppPhase: Equatable {
    case idle          // 未开始 / 等待手机计划
    case activeSet     // 执行当前组
    case resting       // 组间休息
}

final class WatchSessionModel: ObservableObject {
    @Published var phase: AppPhase = .idle
    @Published var setState = WatchSetState()
    @Published var liveBPM: Int? = nil      // 实时心率（HealthKit，未接入时 nil）
    @Published var currentSetAvgBPM: Int? = nil // 当前组累计平均心率
    @Published var isConnected: Bool = false   // 手机 WCSession 可达

    // 心率采集（HealthKit）
    let hrEngine = HeartRateEngine()

    // 演示态推进（断连时的本地组推进）
    private var restTimer: Timer?

    // 待同步操作队列（断连时积压，回连后补发）—— 简化：内存队列，进程存活期内有效
    private var pendingOps: [[String: Any]] = []

    init() {
        hrEngine.onLiveSample = { [weak self] bpm in
            DispatchQueue.main.async { self?.liveBPM = bpm }
        }
        hrEngine.onSetComplete = { [weak self] avg in
            DispatchQueue.main.async {
                self?.currentSetAvgBPM = avg
                self?.completeCurrentSet(avgHR: avg)
            }
        }
        ConnectivityManager.shared.onApplicationContext = { [weak self] dict in
            DispatchQueue.main.async { self?.applyPhoneContext(dict) }
        }
        ConnectivityManager.shared.onReachabilityChanged = { [weak self] reachable in
            DispatchQueue.main.async {
                self?.isConnected = reachable
                if reachable { self?.flushPendingOps() }
            }
        }
        ConnectivityManager.shared.activate()
        hrEngine.requestAuthorization()

        // DEBUG 脚手架：`simctl launch <bundle> --auto-demo` 直接进演示训练，
        // `--auto-rest` 额外自动完成第一组进入休息态；`--auto-page2` 启动即翻到概览页。
        if ProcessInfo.processInfo.arguments.contains("--auto-demo") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
                self?.startDemo()
                if ProcessInfo.processInfo.arguments.contains("--auto-rest") {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
                        self?.completeCurrentSet()
                    }
                }
            }
        }
        if ProcessInfo.processInfo.arguments.contains("--auto-page2") {
            // no-op: page 跳转在 ContentView.onAppear 处理（selection 是 View state）
        }
    }

    // MARK: - 手机镜像

    private func applyPhoneContext(_ dict: [String: Any]) {
        guard let data = dict["set_state"] as? [String: Any] else { return }
        if let json = try? JSONSerialization.data(withJSONObject: data),
           let decoded = try? JSONDecoder().decode(WatchSetState.self, from: json) {
            setState = decoded
            isConnected = true
            // 休息状态与手机对齐
            if decoded.isResting {
                enterRest()
            } else if phase == .resting {
                endRest()
            }
            if decoded.status == "COMPLETED" {
                phase = .idle
            } else if phase == .idle && decoded.totalSets > 0 {
                phase = .activeSet
            }
        }
    }

    // MARK: - 执行流（本地演示态 + 遥控上报）

    func startDemo() {
        // 断连时给一块完整演示计划：卧推 4 组 × 80kg
        // --demo-exercise-index N：对齐手机端焦点动作（联调用，验证 set_completed 焦点校验链路）
        let demoIndex = ProcessInfo.processInfo.arguments.firstIndex(of: "--demo-exercise-index")
            .flatMap { ProcessInfo.processInfo.arguments[$0 + 1].isEmpty ? nil : Int(ProcessInfo.processInfo.arguments[$0 + 1]) } ?? 0
        setState = WatchSetState(exerciseIndex: demoIndex,
                                 exerciseName: "卧推", exerciseType: "resistance",
                                 setIndex: 0, totalSets: 4, completedCount: 0,
                                 weight: 80, reps: 8, status: "PLANNED")
        phase = .activeSet
        currentSetAvgBPM = nil
        hrEngine.startSession(demoHeartRate: true)
        isConnected = false
    }

    func completeCurrentSet(avgHR: Int? = nil) {
        guard phase == .activeSet else { return }
        playHaptic(.success)
        // WCSession payload 只接受 plist 原生类型：Int? 为 nil 时必须显式省略键（NSNull/Any 装箱会触发
        // WCErrorCodePayloadUnsupportedTypes，2026-09-17 联调实锤）
        var payload: [String: Any] = [
            "kind": "set_completed",
            "exercise_index": setState.exerciseIndex,
            "set_index": setState.setIndex,
            "completed_at": ISO8601DateFormatter().string(from: Date()),
        ]
        if let hr = avgHR ?? currentSetAvgBPM {
            payload["avg_hr"] = hr
        }
        sendToPhone(payload)

        // 本地推进
        setState.completedCount += 1
        if setState.completedCount >= setState.totalSets {
            finishWorkout()
            return
        }
        // 自动进入休息
        enterRest()
    }

    func enterRest() {
        phase = .resting
        setState.isResting = true
        setState.restEndTime = Int64((Date().timeIntervalSince1970 + 60) * 1000) // 默认休息 60s
        playHaptic(.retry) // 休息开始：轻提示
        scheduleRestCountdown()
    }

    func endRest() {
        restTimer?.invalidate()
        phase = .activeSet
        setState.isResting = false
        setState.restEndTime = nil
        playHaptic(.start)
        sendToPhone(["kind": "rest_action", "action": "end"])
    }

    func extendRest(by seconds: Int = 10) {
        if let end = setState.restEndTime {
            setState.restEndTime = end + Int64(seconds * 1000)
        } else {
            setState.restEndTime = Int64((Date().timeIntervalSince1970 + Double(seconds)) * 1000)
        }
        playHaptic(.click)
        scheduleRestCountdown()
        sendToPhone(["kind": "rest_action", "action": "extend", "seconds": seconds])
    }

    private func scheduleRestCountdown() {
        restTimer?.invalidate()
        restTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            guard let self = self, self.phase == .resting else { return }
            if let end = self.setState.restEndTime,
               Date().timeIntervalSince1970 * 1000 >= Double(end) {
                self.endRest()
                playHaptic(.stop) // 休息结束：提示
            }
        }
    }

    func finishWorkout() {
        restTimer?.invalidate()
        phase = .idle
        setState.status = "COMPLETED"
        playHaptic(.notification) // 训练完成
        // 训后批量同步完整心率样本
        let samples = hrEngine.exportSamples()
        if !samples.isEmpty {
            sendToPhone(["kind": "hr_batch", "samples": samples.map { $0.payload }])
        }
        hrEngine.endSession()
    }

    private func sendToPhone(_ payload: [String: Any]) {
        if ConnectivityManager.shared.isReachable {
            ConnectivityManager.shared.sendMessage(payload)
        } else {
            pendingOps.append(payload)
        }
    }

    private func flushPendingOps() {
        let ops = pendingOps
        pendingOps.removeAll()
        for op in ops {
            ConnectivityManager.shared.sendMessage(op)
        }
    }
}

// MARK: - 震动封装（watchOS HIG 语义触感）

func playHaptic(_ type: WKHapticType) {
    WKInterfaceDevice.current().play(type)
}
