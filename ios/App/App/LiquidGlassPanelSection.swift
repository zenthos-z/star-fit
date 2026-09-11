// MARK: - 原生 Liquid Glass 附件面板（iMessage「+」面板同款观感）
//
// 官方管线：SwiftUI .glassEffect(.regular, in: .rect(cornerRadius: 40))——
// 玻璃材质/折射/边缘 specular rim 全由系统 shader 渲染（Web backdrop-blur 只是近似）。
// 面板内容（相机/照片/文件三行）也原生化：UIButton/SwiftUI 原生点按 +
// SF Symbol/自绘 Photos 花瓣图标，选中经 evaluateJavaScript 直调
// window.__glassPanelSelect 回传 JS（notifyListeners 事件通道本工程不可靠）。
//
// 布局约定：JS 上报「输入栏上沿」bottomY + 面板宽 width（视觉视口坐标），
// 原生 convert(_:from:) 换算后把面板底边锚在 bottomY 上方（不遮挡输入框），
// 高度由 SwiftUI 自适应 sizing 得出（JS 无需猜高度）。
//
// iOS < 26 或旧二进制：showGlassPanel 直接 reject，JS 回落自绘 Web 面板。

import Foundation
import SwiftUI
import Capacitor

@available(iOS 26.0, *)
struct GlassPanelView: View {
    let width: CGFloat
    let onSelect: (Int) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            panelRow(index: 0, title: "相机") { cameraIcon }
            panelRow(index: 1, title: "照片") { photosIcon }
            panelRow(index: 2, title: "文件") {
                iconCircle(
                    background: LinearGradient(
                        colors: [Color(red: 0.23, green: 0.61, blue: 1.0), Color(red: 0.04, green: 0.42, blue: 1.0)],
                        startPoint: .topLeading, endPoint: .bottomTrailing
                    )
                ) {
                    Image(systemName: "doc.fill")
                        .font(.system(size: 24, weight: .medium))
                        .foregroundStyle(.white)
                }
            }
        }
        .padding(.vertical, 14)
        .padding(.horizontal, 10)
        .frame(width: width, alignment: .leading)
        .glassEffect(.regular, in: .rect(cornerRadius: 40))
    }

    @ViewBuilder
    private func panelRow(index: Int, title: String, @ViewBuilder icon: () -> some View) -> some View {
        Button {
            onSelect(index)
        } label: {
            HStack(spacing: 24) {
                icon()
                Text(title)
                    .font(.system(size: 22))
                    .foregroundStyle(.primary)
                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func iconCircle<Content: View>(background: some ShapeStyle, @ViewBuilder content: () -> Content) -> some View {
        ZStack {
            Circle().fill(background)
            content()
        }
        .frame(width: 56, height: 56)
        .shadow(color: .black.opacity(0.12), radius: 4, y: 2)
    }

    private var cameraIcon: some View {
        iconCircle(
            background: LinearGradient(
                colors: [Color(red: 0.23, green: 0.23, blue: 0.24), Color(red: 0.11, green: 0.11, blue: 0.12)],
                startPoint: .topLeading, endPoint: .bottomTrailing
            )
        ) {
            Image(systemName: "camera.fill")
                .font(.system(size: 24))
                .foregroundStyle(.white)
        }
    }

    /// Photos App 多彩花瓣（8 瓣椭圆旋转，对标系统照片图标）
    private var photosIcon: some View {
        iconCircle(background: .white) {
            FlowerGlyph()
                .frame(width: 34, height: 34)
        }
    }
}

struct FlowerGlyph: View {
    static let colors: [Color] = [
        Color(red: 1.00, green: 0.58, blue: 0.00),
        Color(red: 1.00, green: 0.80, blue: 0.00),
        Color(red: 0.20, green: 0.78, blue: 0.35),
        Color(red: 0.00, green: 0.78, blue: 0.75),
        Color(red: 0.04, green: 0.52, blue: 1.00),
        Color(red: 0.37, green: 0.36, blue: 0.90),
        Color(red: 1.00, green: 0.18, blue: 0.33),
        Color(red: 1.00, green: 0.22, blue: 0.37),
    ]

    var body: some View {
        ZStack {
            ForEach(0..<8, id: \.self) { i in
                Ellipse()
                    .fill(Self.colors[i].opacity(0.88))
                    .frame(width: 9, height: 18)
                    .offset(y: -8.5)
                    .rotationEffect(.degrees(Double(i) * 45))
            }
        }
    }
}

extension LiquidGlassPlugin {

    /// 显示原生玻璃面板：JS 上报 { x, width, bottomY }（视觉视口坐标，CSS px ≈ pt），
    /// 面板底边锚在 bottomY 上方 12pt，高度由 SwiftUI 自适应。
    /// 同时铺全屏透明 backdrop：点面板外任意处收起面板并通知 JS 复位状态。
    @objc func showGlassPanel(_ call: CAPPluginCall) {
        let x = call.getDouble("x") ?? 16
        let width = call.getDouble("width") ?? 300
        let bottomY = call.getDouble("bottomY") ?? 700

        DispatchQueue.main.async { [weak self] in
            guard let self = self, let webView = self.webView else {
                call.reject("webView unavailable")
                return
            }
            guard let vc = self.bridge?.viewController else {
                call.reject("host view controller unavailable")
                return
            }
            guard #available(iOS 26.0, *) else {
                call.reject("glass requires iOS 26")
                return
            }
            self.hideGlassPanelView()

            // 全屏透明 backdrop：点外部 = 收起面板 + 通知 JS（__glassPanelDismiss 复位「+」等状态）
            let dismissToJS = { [weak self] in
                self?.hideGlassPanelView()
                webView.evaluateJavaScript(
                    "window.__glassPanelDismiss && window.__glassPanelDismiss()",
                    completionHandler: nil
                )
            }
            let backdrop = UIControl()
            backdrop.backgroundColor = .clear
            backdrop.frame = vc.view.bounds
            backdrop.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            backdrop.addTarget(self, action: #selector(panelBackdropTapped), for: .touchUpInside)
            // 面板挂在 backdrop 之上：backdrop 覆盖全屏（含输入栏），面板区域正常可点
            let panel = GlassPanelView(width: width) { idx in
                DispatchQueue.main.async {
                    self.hideGlassPanelView()
                    webView.evaluateJavaScript(
                        "window.__glassPanelSelect && window.__glassPanelSelect(\(idx))",
                        completionHandler: nil
                    )
                }
            }
            let hosting = UIHostingController(rootView: panel)
            hosting.view.backgroundColor = .clear
            let fitting = hosting.view.sizeThatFits(CGSize(width: width, height: UIView.layoutFittingCompressedSize.height))
            let frameInWebView = CGRect(x: x, y: bottomY - fitting.height, width: width, height: fitting.height)
            let frame = vc.view.convert(frameInWebView, from: webView)

            hosting.view.frame = frame.integral
            hosting.view.alpha = 0
            hosting.view.transform = CGAffineTransform(scaleX: 0.95, y: 0.95)
            vc.view.addSubview(backdrop)
            vc.view.addSubview(hosting.view)
            objc_setAssociatedObject(self, &PanelKeys.panelHosting, hosting, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
            objc_setAssociatedObject(self, &PanelKeys.panelBackdrop, backdrop, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
            objc_setAssociatedObject(self, &PanelKeys.dismissHandler, dismissToJS, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)

            UIView.animate(
                withDuration: 0.28, delay: 0,
                usingSpringWithDamping: 0.8, initialSpringVelocity: 0.5,
                options: [.allowUserInteraction]
            ) {
                hosting.view.alpha = 1
                hosting.view.transform = .identity
            }
            call.resolve()
        }
    }

    @objc private func panelBackdropTapped() {
        (objc_getAssociatedObject(self, &PanelKeys.dismissHandler) as? (() -> Void))?()
    }

    @objc func hideGlassPanel(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.hideGlassPanelView()
            call.resolve()
        }
    }

    private func hideGlassPanelView() {
        if #available(iOS 26.0, *) {
            if let hosting = objc_getAssociatedObject(self, &PanelKeys.panelHosting) as? UIHostingController<GlassPanelView> {
                UIView.animate(withDuration: 0.18, animations: {
                    hosting.view.alpha = 0
                }) { _ in
                    hosting.view.removeFromSuperview()
                }
            }
            (objc_getAssociatedObject(self, &PanelKeys.panelBackdrop) as? UIControl)?.removeFromSuperview()
        }
        objc_setAssociatedObject(self, &PanelKeys.panelHosting, nil, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
        objc_setAssociatedObject(self, &PanelKeys.panelBackdrop, nil, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
        objc_setAssociatedObject(self, &PanelKeys.dismissHandler, nil, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
    }
}

private enum PanelKeys {
    static var panelHosting = "glassPanelHosting"
    static var panelBackdrop = "glassPanelBackdrop"
    static var dismissHandler = "glassPanelDismissHandler"
}
