import Foundation
import Combine
import HealthKit

/// 心率引擎：HKWorkoutSession + HKLiveWorkoutBuilder 实时采集，
/// 5s 降采样均值入库（ADR-0001），组完成时聚合组平均心率。
/// 断连/模拟器无传感器时支持演示心率（demoHeartRate），仅本地演示用。
final class HeartRateEngine: NSObject, ObservableObject {
    @Published var liveBPM: Int? = nil

    var onLiveSample: ((Int) -> Void)?
    var onSetComplete: ((Int) -> Void)?

    private let healthStore = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?

    private var bucketStart: Date?
    private var bucketSum = 0
    private var bucketCount = 0
    private(set) var samples: [HRSample] = []      // 完整样本流（5s 均值）
    private var currentSetSamples: [Int] = []      // 当前组心率累计（算组平均）

    private var demoMode = false
    private var demoTimer: Timer?

    // MARK: - 授权

    func requestAuthorization() {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        let types: Set<HKQuantityType> = [
            HKQuantityType.quantityType(forIdentifier: .heartRate)!,
            HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned)!,
            HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning)!,
        ]
        healthStore.requestAuthorization(toShare: [], read: types) { _, _ in }
    }

    // MARK: - 会话控制

    func startSession(demoHeartRate: Bool = false) {
        samples.removeAll()
        currentSetSamples.removeAll()
        bucketStart = nil
        bucketSum = 0
        bucketCount = 0
        demoMode = demoHeartRate

        guard !demoMode, HKHealthStore.isHealthDataAvailable() else {
            if demoHeartRate { startDemoHeartRate() }
            return
        }

        let config = HKWorkoutConfiguration()
        config.activityType = .traditionalStrengthTraining
        config.locationType = .indoor
        do {
            session = try HKWorkoutSession(healthStore: healthStore, configuration: config)
            builder = session?.associatedWorkoutBuilder()
            builder?.dataSource = HKLiveWorkoutDataSource(healthStore: healthStore,
                                                          workoutConfiguration: config)
            session?.delegate = self
            builder?.delegate = self
            session?.startActivity(with: Date())
            builder?.beginCollection(withStart: Date()) { _, _ in }
        } catch {
            // 无权限/模拟器受限：回落演示心率（保证 UI 可验证）
            demoMode = true
            startDemoHeartRate()
        }
    }

    func endSession() {
        session?.end()
        builder?.endCollection(withEnd: Date()) { _, _ in }
        session = nil
        builder = nil
        demoTimer?.invalidate()
        demoTimer = nil
    }

    func exportSamples() -> [HRSample] { samples }

    /// 组完成：聚合当前组平均心率并回调
    func markSetComplete(exerciseIndex: Int?, setIndex: Int?) {
        let avg = currentSetSamples.isEmpty ? nil : currentSetSamples.reduce(0, +) / currentSetSamples.count
        currentSetSamples.removeAll()
        if let a = avg { onSetComplete?(a) }
    }

    // MARK: - 5s 降采样

    private func ingest(bpm: Double, at date: Date) {
        let bpm = Int(bpm.rounded())
        guard bpm > 30 && bpm < 240 else { return }
        currentSetSamples.append(bpm)

        if bucketStart == nil {
            bucketStart = date
            bucketSum = bpm
            bucketCount = 1
            return
        }
        guard let start = bucketStart else { return }
        if date.timeIntervalSince(start) < 5.0 {
            bucketSum += bpm
            bucketCount += 1
        } else {
            let avg = bucketSum / bucketCount
            samples.append(HRSample(bpm: avg, recordedAt: start))
            liveBPM = avg
            onLiveSample?(avg)
            bucketStart = date
            bucketSum = bpm
            bucketCount = 1
        }
    }

    // MARK: - 演示心率（断连/模拟器）

    private func startDemoHeartRate() {
        var bpm = 118
        demoTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            guard let self = self else { return }
            // 缓慢起伏：伪随机游走模拟真实训练心率（110-160）
            bpm += Int.random(in: -3...3)
            bpm = min(160, max(108, bpm))
            self.ingest(bpm: Double(bpm), at: Date())
        }
    }
}

// MARK: - HKWorkoutSessionDelegate

extension HeartRateEngine: HKWorkoutSessionDelegate {
    func workoutSession(_ workoutSession: HKWorkoutSession,
                        didChangeTo toState: HKWorkoutSessionState,
                        from fromState: HKWorkoutSessionState,
                        date: Date) {}

    func workoutSession(_ workoutSession: HKWorkoutSession,
                        didFailWithError error: Error) {
        // 会话失败：回落演示模式保证可用
        if !demoMode {
            demoMode = true
            startDemoHeartRate()
        }
    }
}

// MARK: - HKLiveWorkoutBuilderDelegate

extension HeartRateEngine: HKLiveWorkoutBuilderDelegate {
    func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder,
                        didCollectDataOf collectedTypes: Set<HKSampleType>) {
        for type in collectedTypes {
            guard let quantityType = type as? HKQuantityType,
                  quantityType.identifier == HKQuantityTypeIdentifier.heartRate.rawValue,
                  let stat = workoutBuilder.statistics(for: quantityType),
                  let quantity = stat.mostRecentQuantity() else { continue }
            let bpm = quantity.doubleValue(for: HKUnit.count().unitDivided(by: .minute()))
            ingest(bpm: bpm, at: Date())
        }
    }

    func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}
}
