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
    case workoutDone   // 全部动作完成（恭喜页；DONE 镜像进入）
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
            // 实时心率直推手机（hr_live）：断连即弃不积压（陈旧心率补发无意义）
            ConnectivityManager.shared.sendMessage(["kind": "hr_live", "bpm": bpm])
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

    /// 恭喜页「完成」按钮：回到 idle（等待下一个计划）
    func acknowledgeDone() {
        phase = .idle
        setState = WatchSetState()
    }

    /// 同步按钮：手表主动请求手机立即重推当前状态（sendMessage 实时通道，
    /// 手机端 useWatchMirror 收到 request_sync 后重播，双通道齐发）。
    func requestSyncFromPhone() {
        playHaptic(.click)
        ConnectivityManager.shared.requestSync()
    }

    private func applyPhoneContext(_ dict: [String: Any]) {
        guard let data = dict["set_state"] as? [String: Any] else {
            NSLog("[WSM] applyPhoneContext: no set_state key, keys=%@", dict.keys.map { String($0) }.joined(separator: ","))
            return
        }
        if let json = try? JSONSerialization.data(withJSONObject: data) {
            guard let decoded = try? JSONDecoder().decode(WatchSetState.self, from: json) else {
                NSLog("[WSM] applyPhoneContext: DECODE FAILED, raw=%@", String(data: json, encoding: .utf8) ?? "?")
                return
            }
            NSLog("[WSM] applyPhoneContext: status=%@ sessionPhase=%@ totalSets=%d phase=%@", decoded.status, decoded.sessionPhase, decoded.totalSets, "\(phase)")
            // ── 会话层状态机（2026-09-20 根修 status 语义混用）：
            // set.status 只描述组；手表 phase 完全由 sessionPhase 驱动。
            let isFirstRealState = phase == .idle
            setState = decoded
            isConnected = true
            switch decoded.sessionPhase {
            case "DONE":
                // 全部动作完成 → 恭喜页（幂等：重复 DONE 镜像不重复收尾）
                if phase != .workoutDone { finishWorkout() }
                setState.displayStartMs = decoded.displayStartMs ?? setState.displayStartMs
                return
            case "READY":
                // 计划已导入未开练：预告态，不开采集
                if phase != .idle { phase = .idle; restTimer?.invalidate() }
                setState.status = "READY"
                return
            case "REST":
                if phase == .idle || phase == .workoutDone {
                    phase = .activeSet
                    if isFirstRealState { hrEngine.startSession() }
                }
                enterRestFromPhone(decoded)
            case "PAUSED":
                // 暂停：保持当前屏（计时由 displayStartMs 平移冻结），不切态
                if (phase == .idle || phase == .workoutDone) && decoded.totalSets > 0 {
                    phase = .activeSet
                    if isFirstRealState { hrEngine.startSession() }
                }
            default: // ACTIVE
                if phase == .resting {
                    // 手机结束休息（手表端 endRest 会给手机发消息，这里防双触发）
                    restTimer?.invalidate()
                    phase = .activeSet
                    setState.isResting = false
                    setState.restEndTime = nil
                } else if (phase == .idle || phase == .workoutDone) && decoded.totalSets > 0 {
                    phase = .activeSet
                    // 首个真实镜像 → 启动真实心率采集（2026-09-19 修复）
                    if isFirstRealState { hrEngine.startSession() }
                }
            }
        }
    }

    /// 手机驱动的休息（区别于本地 enterRest：不发消息回手机，防回环）
    private func enterRestFromPhone(_ decoded: WatchSetState) {
        guard phase == .activeSet || phase == .resting || phase == .workoutDone else { return }
        let wasResting = phase == .resting
        phase = .resting
        setState.isResting = true
        // P2：优先用剩余秒数按本地时钟换算终点（免两端时钟漂移）
        if let remain = decoded.restRemainSec, remain > 0 {
            setState.restEndTime = Int64((Date().timeIntervalSince1970 + Double(remain)) * 1000)
        } else {
            setState.restEndTime = decoded.restEndTime
        }
        if !wasResting {
            playHaptic(.retry)
        }
        scheduleRestCountdown()
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
            "exercise_name": setState.exerciseName,
            "set_index": setState.setIndex,
            "completed_at": ISO8601DateFormatter().string(from: Date()),
        ]
        if let hr = avgHR ?? currentSetAvgBPM {
            payload["avg_hr"] = hr
        }
        sendToPhone(payload)

        // 本地推进（2026-09-20 修复「最后一组闪回等待界面」）：
        // 本地不再裁决训练结束——手机才是会话真源，完成最后一组后
        // 手机必然广播下一个 sessionPhase（REST=动作间休息 / DONE=全部结束）。
        // 本地提前 finishWorkout 会把 phase 打回 idle，手机 REST 镜像
        // 稍后到达才又拉回休息 → 用户看到「等待训练计划」闪屏。
        setState.completedCount += 1
        if setState.completedCount >= setState.totalSets {
            // 全组完成：本地只置完成态，停在当前屏等手机镜像（通常 <1s）
            setState.status = "COMPLETED"
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
        phase = .workoutDone
        setState.status = "COMPLETED"
        playHaptic(.notification) // 训练完成
        // 训后批量同步完整心率样本。
        // 2026-09-19 修复：手机中途结束训练也要发 hr_batch（原仅本地跑完全部组才发，
        // 手机端提前结束 → 表上样本永不入库）。终态镜像到达 → finishWorkout → 此处补发。
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
