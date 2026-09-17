import Foundation

/// 心率样本（5s 降采样均值，对齐后端 heart_rate_samples 契约）。
struct HRSample: Codable, Equatable {
    var bpm: Int
    var recordedAt: Date
    var exerciseIndex: Int? = nil
    var setIndex: Int? = nil

    var payload: [String: Any] {
        var d: [String: Any] = ["bpm": bpm, "recorded_at": ISO8601DateFormatter().string(from: recordedAt)]
        if let e = exerciseIndex { d["exercise_index"] = e }
        if let s = setIndex { d["set_index"] = s }
        return d
    }
}
