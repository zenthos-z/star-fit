// MARK: - 原生 Liquid Glass 菜单（点按「···」按钮弹出的系统按钮菜单）
//
// 官方组件路线（对标 tab bar「系统组件直接用」）：
// UIButton.showsMenuAsPrimaryAction = true —— 原生邮件/音乐「···」按钮同款。
// 原生透明 UIButton 叠在 Web「···」按钮正上方，点按直接弹系统 UIMenu：
// Liquid Glass 材质、弹出动画、触感、presenting 全部系统负责。
//
// 与旧锚点按钮方案的两处本质区别：
// 1. 挂载点 = bridge.viewController.view（VC 层级内，responder chain 完整，
//    不会报 "Failed to find a presenting view controller"）；
// 2. 坐标换算 = UIKit 官方 convert(_:from:)（WebView→VC view 坐标系自动处理
//    transform/偏移），JS 只上报 getBoundingClientRect 视觉视口坐标。
//
// 选中项经 evaluateJavaScript 直调 window.__glassMenuSelect 回传 JS
// （notifyListeners 事件通道在本工程不可靠，MainTabBar 的 tabSelect 同款问题）。
// 上一版 WebKit context menu 长按管线（GlassContextMenuDelegate）已整体废弃删除。

import Foundation
import WebKit
import UIKit
import Capacitor

extension LiquidGlassPlugin {

    /// 显示原生按钮菜单：在 (x, y, size) 锚点叠透明 UIButton，点按弹系统菜单。
    /// debug=true 时锚点半透明红色，用于模拟器对齐验证。
    @objc func showMenu(_ call: CAPPluginCall) {
        guard let itemsArray = call.getArray("items", [String: Any].self), !itemsArray.isEmpty else {
            call.reject("items required")
            return
        }
        let x = call.getDouble("x") ?? 0
        let y = call.getDouble("y") ?? 0
        let size = call.getDouble("size") ?? 44
        let debug = call.getBool("debug") ?? false

        DispatchQueue.main.async { [weak self] in
            guard let self = self, let webView = self.webView else {
                call.reject("webView unavailable")
                return
            }
            // 必须挂 VC 层级：游离视图 responder chain 走不到 VC，菜单弹不出
            guard let vc = self.bridge?.viewController else {
                call.reject("host view controller unavailable")
                return
            }
            self.hideMenuAnchor()

            // JS 视觉视口坐标（CSS px ≈ pt）→ VC view 坐标系（UIKit 官方换算）
            let rectInWebView = CGRect(x: x, y: y, width: size, height: size)
            let frame = vc.view.convert(rectInWebView, from: webView)

            let button = UIButton(type: .system)
            button.frame = frame.integral
            button.backgroundColor = debug ? UIColor.red.withAlphaComponent(0.5) : .clear
            button.showsMenuAsPrimaryAction = true
            button.menu = Self.buildUIMenu(from: itemsArray, webView: webView)
            vc.view.addSubview(button)
            self.menuAnchorButton = button
            call.resolve()
        }
    }

    @objc func hideMenu(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            self?.hideMenuAnchor()
            call.resolve()
        }
    }

    private func hideMenuAnchor() {
        menuAnchorButton?.removeFromSuperview()
        menuAnchorButton = nil
    }

    private var menuAnchorButton: UIButton? {
        get { objc_getAssociatedObject(self, &AssociatedKeys.anchorButton) as? UIButton }
        set { objc_setAssociatedObject(self, &AssociatedKeys.anchorButton, newValue, .OBJC_ASSOCIATION_RETAIN_NONATOMIC) }
    }

    /// items → UIMenu（separator 切 .displayInline 分组 = 原生分组线）
    private static func buildUIMenu(from itemsArray: [[String: Any]], webView: WKWebView) -> UIMenu {
        var groups: [[UIMenuElement]] = [[]]
        for (i, dict) in itemsArray.enumerated() {
            if (dict["separator"] as? Bool) == true {
                groups.append([])
                continue
            }
            let title = dict["title"] as? String ?? ""
            let icon = dict["icon"] as? String ?? ""
            let danger = dict["danger"] as? Bool ?? false
            let idx = i
            let action = UIAction(
                title: title,
                image: icon.isEmpty ? nil : UIImage(systemName: icon),
                attributes: danger ? [.destructive] : []
            ) { _ in
                DispatchQueue.main.async {
                    webView.evaluateJavaScript("window.__glassMenuSelect && window.__glassMenuSelect(\(idx))", completionHandler: nil)
                }
            }
            groups[groups.count - 1].append(action)
        }
        var children: [UIMenuElement] = []
        for group in groups where !group.isEmpty {
            if children.isEmpty {
                children.append(contentsOf: group)
            } else {
                children.append(UIMenu(options: .displayInline, children: group))
            }
        }
        return UIMenu(children: children)
    }
}

private enum AssociatedKeys {
    static var anchorButton = "glassMenuAnchorButton"
}
