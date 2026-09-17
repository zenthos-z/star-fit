import Foundation

/// 单组状态（手机镜像：WatchConnectivity 下发，或断连时本地演示态）。
/// 字段与手机端 ExerciseAction.set 对齐；camelCase 与 JS 桥契约一致。
struct WatchSetState: Codable, Equatable {
    var sessionId: String = ""
    var exerciseIndex: Int = 0
    var exerciseName: String = "卧推"
    var exerciseType: String = "resistance"
    var isUnilateral: Bool = false // 单侧训练标志（与 type 正交，如单臂哑铃卧推）
    var setIndex: Int = 0          // 当前焦点组 index（0-based）
    var totalSets: Int = 4
    var completedCount: Int = 0
    var weight: Double? = 80
    var reps: Int? = 8
    var durationSec: Int? = nil
    var distanceM: Double? = nil
    var status: String = "PLANNED" // PLANNED | COMPLETED
    var isResting: Bool = false
    var restEndTime: Int64? = nil  // epoch ms，休息结束时刻

    /// 动作类型徽标（与手机端 types.ts ExerciseType 9 类对齐）
    var typeBadge: String {
        switch exerciseType {
        case "resistance": return "负重"
        case "unilateral": return "单侧"
        case "bodyweight": return "自重"
        case "assisted": return "辅助"
        case "isometric": return "静力"
        case "cardio": return "有氧"
        case "flexibility": return "柔韧"
        case "heavy_weight": return "大重量"
        case "rep_training": return "计次"
        case "outdoor": return "户外"
        default: return ""
        }
    }

    /// 类型徽标 SF Symbol（列表页视觉锚）
    var typeIcon: String {
        switch exerciseType {
        case "resistance", "heavy_weight": return "dumbbell.fill"
        case "unilateral": return "square.split.2x1.fill"
        case "bodyweight": return "figure.strengthtraining.traditional"
        case "assisted": return "hand.draw.fill"
        case "isometric": return "timer"
        case "cardio", "outdoor": return "figure.run"
        case "flexibility": return "figure.flexibility"
        case "rep_training": return "number"
        default: return "dumbbell.fill"
        }
    }

    /// 类型感知目标文案：不同动作类型目标展示内容不同。
    /// resistance/weight_only → 重量×次数；rep_training/bodyweight → 次数；
    /// isometric/cardio(countdown) → 时长；outdoor/cardio(distance) → 距离；
    /// 单侧（unilateral 类型或 isUnilateral 标志）追加「每侧」。
    var targetLabel: String? {
        let suffix = isUnilateral || exerciseType == "unilateral" ? " 每侧" : ""
        switch exerciseType {
        case "resistance", "heavy_weight", "weight_only", "assisted":
            let w = weight.map { String(format: "%.0fkg", $0) } ?? ""
            let r = reps.map { "×\($0)" } ?? ""
            let core = [w, r].filter { !$0.isEmpty }.joined(separator: " ")
            return core.isEmpty ? nil : core + suffix
        case "rep_training":
            return reps.map { "×\($0)\(suffix)" }
        case "bodyweight":
            // 自重：次数优先（如俯卧撑 ×15），负重附加（负重俯卧撑 +10kg ×12）
            if let r = reps {
                let w = weight.map { "+\(String(format: "%.0fkg", $0)) " } ?? ""
                return "\(w)×\(r)\(suffix)"
            }
            return "自重"
        case "isometric":
            return durationSec.map { "\($0)s\(suffix)" } ?? "保持"
        case "cardio":
            if let d = distanceM { return String(format: "%.1fkm", d / 1000) }
            if let s = durationSec { return "\(s)s" }
            return nil
        case "outdoor":
            if let d = distanceM { return String(format: "%.1fkm", d / 1000) }
            if let s = durationSec { return "\(s)s" }
            return nil
        case "flexibility":
            return durationSec.map { "\($0)s" } ?? "拉伸"
        default:
            if let d = durationSec { return "\(d)s" }
            if let m = distanceM { return String(format: "%.1fkm", m / 1000) }
            let w = weight.map { String(format: "%.0fkg", $0) } ?? ""
            let r = reps.map { "×\($0)" } ?? ""
            return [w, r].filter { !$0.isEmpty }.joined(separator: " ")
        }
    }

    var progressDots: [Bool] {
        (0..<max(totalSets, 1)).map { $0 < completedCount }
    }
}
