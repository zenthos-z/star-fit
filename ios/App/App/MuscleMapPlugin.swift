import Foundation
import SwiftUI
import Capacitor
import MuscleMap

// MARK: - MuscleMapPlugin — 原生人体肌群图桥（A4，issue #12 定案）
//
// 素材：MuscleMap Swift Package（github.com/melihcolpan/MuscleMap，MIT，
// iOS 17+）。SwiftUI BodyView front/back 双视图，纯色高亮：
// 主发力高饱和橙红 / 次发力同色系低饱和（色值由 JS 侧传入，
// 常量真源 = 前端 src/lib/muscleMap.ts，全局配色统一项目色板）。
//
// 布局约定：JS 上报占位容器 rect（视觉视口坐标，CSS px ≈ pt），原生
// convert(_:from:) 后原位覆盖在 WebView 上方；滚动时 JS 重报 rect（原生只
// 更新 frame），sheet 拖拽/关闭或弹层打开时 JS 调 hideMuscleMap 收起。
// Web/Android 或 MuscleMap 桥不可用：JS 侧回落肌群文字胶囊。
//
// 17 基准肌群词表 → MuscleMap 枚举映射在前端完成（slug = Muscle.rawValue），
// 原生只认合法 slug，未知值忽略。

/// 人体图 SwiftUI 内容（iOS 17+，MuscleMap 依赖的最低平台线）
@available(iOS 17.0, *)
struct MuscleMapFiguresView: View {
    let primary: [Muscle]
    let secondary: [Muscle]
    let primaryColor: Color
    let secondaryColor: Color
    let secondaryOpacity: Double

    var body: some View {
        HStack(spacing: 10) {
            figure(side: .front)
            figure(side: .back)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func figure(side: BodySide) -> BodyView {
        var view = BodyView(gender: .male, side: side, style: .minimal)
        for muscle in primary {
            view = view.highlight(muscle, color: primaryColor)
        }
        for muscle in secondary {
            view = view.highlight(muscle, color: secondaryColor, opacity: secondaryOpacity)
        }
        return view
    }
}

@objc(MuscleMapPlugin)
public class MuscleMapPlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "MuscleMapPlugin"
    public let jsName = "MuscleMapPlugin"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "showMuscleMap", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hideMuscleMap", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise)
    ]

    private var hostingView: UIView?
    /// 最近一次呈现的 payload 摘要（muscles + colors）——变化时重建内容，相同仅移 frame
    private var lastPayloadKey: String?

    // MARK: - 显示 / 更新

    /// 在 JS 上报的 rect 处显示（或更新）肌群图。
    /// 参数：{ x, y, width, height, primary: [slug], secondary: [slug],
    ///         primaryColor: "#RRGGBB", secondaryColor, secondaryOpacity }
    /// 重复调用 = 滚动重定位（payload 相同仅更新 frame；变化则重建内容）。
    @objc func showMuscleMap(_ call: CAPPluginCall) {
        let x = call.getDouble("x") ?? 0
        let y = call.getDouble("y") ?? 0
        let width = call.getDouble("width") ?? 0
        let height = call.getDouble("height") ?? 0
        let primarySlugs = call.getArray("primary", String.self) ?? []
        let secondarySlugs = call.getArray("secondary", String.self) ?? []
        let primaryColor = Self.color(from: call.getString("primaryColor")) ?? .orange
        let secondaryColor = Self.color(from: call.getString("secondaryColor")) ?? .orange.opacity(0.5)
        let secondaryOpacity = call.getDouble("secondaryOpacity") ?? 0.55

        guard width > 0, height > 0 else {
            call.reject("invalid rect")
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            guard let webView = self.webView, let vc = self.bridge?.viewController else {
                call.reject("host unavailable")
                return
            }
            guard #available(iOS 17.0, *) else {
                call.reject("muscle map requires iOS 17")
                return
            }

            let frameInWebView = CGRect(x: x, y: y, width: width, height: height)
            let frame = vc.view.convert(frameInWebView, from: webView).integral
            let payloadKey = [
                primarySlugs.joined(separator: ","),
                secondarySlugs.joined(separator: ","),
                call.getString("primaryColor") ?? "",
                call.getString("secondaryColor") ?? "",
                String(format: "%.2f", secondaryOpacity),
            ].joined(separator: "|")

            if let existing = self.hostingView, self.lastPayloadKey == payloadKey {
                // 已呈现且内容未变：仅移动 frame（滚动重定位的快路径）
                existing.frame = frame
                call.resolve()
                return
            }
            // 内容变化或首次：重建（先清旧视图）
            self.hostingView?.removeFromSuperview()
            self.lastPayloadKey = payloadKey

            let primary = primarySlugs.compactMap { Muscle(rawValue: $0) }
            let secondary = secondarySlugs.compactMap { Muscle(rawValue: $0) }
            let figures = MuscleMapFiguresView(
                primary: primary,
                secondary: secondary,
                primaryColor: primaryColor,
                secondaryColor: secondaryColor,
                secondaryOpacity: secondaryOpacity
            )
            let hosting = UIHostingController(rootView: figures)
            hosting.view.backgroundColor = .clear
            hosting.view.frame = frame
            hosting.view.alpha = 0
            vc.view.addSubview(hosting.view)
            self.hostingView = hosting.view

            UIView.animate(withDuration: 0.2, delay: 0, options: [.allowUserInteraction]) {
                hosting.view.alpha = 1
            }
            call.resolve()
        }
    }

    // MARK: - 隐藏

    @objc func hideMuscleMap(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let view = self?.hostingView else {
                call.resolve()
                return
            }
            UIView.animate(withDuration: 0.15, animations: {
                view.alpha = 0
            }) { _ in
                view.removeFromSuperview()
            }
            self?.hostingView = nil
            self?.lastPayloadKey = nil
            call.resolve()
        }
    }

    // MARK: - 探测

    @objc func isAvailable(_ call: CAPPluginCall) {
        if #available(iOS 17.0, *) {
            call.resolve(["available": true])
        } else {
            call.resolve(["available": false])
        }
    }

    // MARK: - Helpers

    /// "#RRGGBB" → Color（失败返回 nil，调用方用默认色兜底）
    private static func color(from hex: String?) -> Color? {
        guard let hex = hex else { return nil }
        var value: UInt64 = 0
        let cleaned = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        guard cleaned.count == 6, Scanner(string: cleaned).scanHexInt64(&value) else {
            return nil
        }
        return Color(
            red: Double((value >> 16) & 0xFF) / 255.0,
            green: Double((value >> 8) & 0xFF) / 255.0,
            blue: Double(value & 0xFF) / 255.0
        )
    }
}
