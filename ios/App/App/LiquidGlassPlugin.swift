import Foundation
import Capacitor
import UIKit

/**
 * LiquidGlassPlugin — 系统组件版导航（苹果官方 UI 效果和交互规范）。
 *
 * 常驻 Tab Bar（3 页签：历史/开始运动/AI Agent，默认中间）
 * 载体 = UIKit 原生 UITabBarController：视图背景全透明，只有 tabBar 本体（系统玻璃）。
 * WebView 缩短到 bar 上沿，内容滚动到底不被遮挡。
 *
 * API：showTabBar { tabs, selection } / setCurrentTab { selection } / hideTabBar
 * 事件：tabSelect { tab } → JS（路由仍由 Web 层拥有）
 * 旧桥（showMenu/setLens/setLabel/hideLens）为迁移期兼容 no-op。
 */
@objc(LiquidGlassPlugin)
public class LiquidGlassPlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "LiquidGlassPlugin"
    public let jsName = "LiquidGlassPlugin"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "showTabBar", returnType: CAPPluginReturnNone),
        CAPPluginMethod(name: "setCurrentTab", returnType: CAPPluginReturnNone),
        CAPPluginMethod(name: "getCurrentTab", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setTabBarDimmed", returnType: CAPPluginReturnNone),
        CAPPluginMethod(name: "hideTabBar", returnType: CAPPluginReturnNone),
        CAPPluginMethod(name: "showMenu", returnType: CAPPluginReturnNone),
        CAPPluginMethod(name: "hideMenu", returnType: CAPPluginReturnNone),
        CAPPluginMethod(name: "setMenuItems", returnType: CAPPluginReturnNone),
        CAPPluginMethod(name: "clearMenuItems", returnType: CAPPluginReturnNone),
        CAPPluginMethod(name: "setLens", returnType: CAPPluginReturnNone),
        CAPPluginMethod(name: "setLabel", returnType: CAPPluginReturnNone),
        CAPPluginMethod(name: "hideLens", returnType: CAPPluginReturnNone)
    ]

    private let queue = DispatchQueue.main
    private var hostView: UIView?
    private var tabControllerRef: UITabBarController?
    private var selectionObservation: NSKeyValueObservation?
    private var searchKVOSuppressed = false

    /// KVO 观察 selectedIndex：tabs 模式下 delegate 不可靠；程序性设置挂起防回环
    private func observeTabSelection(_ ctrl: UITabBarController) {
        selectionObservation = ctrl.observe(\.selectedIndex, options: [.new]) { [weak self] ctrl, change in
            guard let self = self, !self.searchKVOSuppressed else { return }
            guard let nv = change.newValue else { return }
            self.notifyListeners("tabSelect", data: ["tab": nv])
        }
    }

    private var menuHosting: UIViewController?
    private var menuHostView: UIView?
    private var menuModel = MenuModel()

    // MARK: - Tab Bar

    @objc func showTabBar(_ call: CAPPluginCall) {
        queue.async { [weak self] in
            guard let self = self else { return }
            let selection = call.getInt("selection") ?? 1
            guard let tabsArray = call.getArray("tabs", [String: Any].self) else {
                call.reject("tabs required"); return
            }
            guard let webView = self.webView, let host = self.ensureHost(webView) else {
                call.reject("no host"); return
            }

            var items: [UITabBarItem] = []
            for (i, raw) in tabsArray.enumerated() {
                guard let dict = raw as? [String: Any] else { continue }
                let title = dict["title"] as? String ?? ""
                let symbol = dict["icon"] as? String ?? ""
                let item = UITabBarItem(title: title,
                                        image: UIImage(systemName: symbol),
                                        selectedImage: UIImage(systemName: symbol)?.withBaselineOffset(fromBottom: UIView.noIntrinsicMetric))
                item.tag = i
                items.append(item)
            }

            // 底部 bar 区域：胶囊高 ~76pt + 底部安全区。
            // 容器左右各收 24pt：浮动胶囊+搜索钮整体向页面中央收拢，间距更紧凑（居中略偏左）
            let windowH = host.bounds.height
            let safeBottom = host.safeAreaInsets.bottom
            let barH: CGFloat = 76 + safeBottom
            let hInset: CGFloat = 44
            let rect = CGRect(x: hInset, y: windowH - barH, width: host.bounds.width - hInset * 2, height: barH)
            // 底部露出区域与 web 内容底色一致（#FAFAFA），消除 bar 后色差分割线
            let pageBg = UIColor(red: 250/255.0, green: 250/255.0, blue: 250/255.0, alpha: 1)
            webView.backgroundColor = pageBg
            webView.scrollView.backgroundColor = pageBg
            if #available(iOS 15.0, *) { webView.underPageBackgroundColor = pageBg }
            host.backgroundColor = pageBg
            host.superview?.backgroundColor = pageBg

            let tabCtrl: UITabBarController
            if let existing = self.tabControllerRef {
                tabCtrl = existing
                if let vcs = tabCtrl.viewControllers {
                    for (i, vc) in vcs.enumerated() where i < items.count {
                        vc.tabBarItem = items[i]
                    }
                }
            } else {
                tabCtrl = UITabBarController()
                // 每个 tab 一个透明 VC（tabBarItem 挂在 VC 上，不能直接赋 tabBar.items）
                let vcs = items.map { item -> UIViewController in
                    let vc = UIViewController()
                    vc.view.backgroundColor = .clear
                    vc.tabBarItem = item
                    return vc
                }
                tabCtrl.delegate = self
                if #available(iOS 18.0, *) {
                    // 官方姿势：iOS18+ 只用 tabs API。勿与 viewControllers 混用。
                    // 3 个常规页签（历史/开始运动/AI Agent）——不再用 UISearchTab 圆钮
                    let tabs: [UITab] = items.map { item in
                        let vc = UIViewController()
                        vc.view.backgroundColor = .clear
                        let title = item.title ?? ""
                        return UITab(title: title, image: item.image, identifier: title) { _ in vc }
                    }
                    tabCtrl.tabs = tabs
                } else {
                    tabCtrl.viewControllers = vcs
                }

                // 视图背景全透明——只有 tabBar 本体（系统玻璃）
                tabCtrl.view.backgroundColor = .clear
                tabCtrl.view.isOpaque = false
                let ap = UITabBarAppearance()
                ap.configureWithTransparentBackground()
                ap.backgroundColor = .clear
                ap.shadowColor = .clear
                ap.shadowImage = UIImage()
                tabCtrl.tabBar.standardAppearance = ap
                if #available(iOS 15.0, *) {
                    tabCtrl.tabBar.scrollEdgeAppearance = ap
                }
                tabCtrl.tabBar.isTranslucent = true
                tabCtrl.tabBar.backgroundColor = .clear

                tabCtrl.view.frame = rect
                tabCtrl.view.clipsToBounds = false // 搜索圆钮可溢出容器，触摸不被裁剪
                host.addSubview(tabCtrl.view)
                self.tabControllerRef = tabCtrl
            }
            if #available(iOS 18.0, *) {
                tabCtrl.selectedIndex = min(selection, max(tabCtrl.tabs.count - 1, 0))
            } else {
                tabCtrl.selectedIndex = min(selection, max((tabCtrl.viewControllers?.count ?? 1) - 1, 0))
            }

            // WebView 保持全屏：内容延伸到 bar 后面（系统玻璃透出内容=官方 Liquid Glass 层次），
            // Web 侧用 env(safe-area-inset-bottom) 留出滚动余量，滚动到底不被遮
            if webView.frame != host.bounds {
                webView.frame = host.bounds
            }
            call.resolve()
        }
    }

    @objc func getCurrentTab(_ call: CAPPluginCall) {
        queue.async { [weak self] in
            guard let self = self else { return }
            let idx = self.tabControllerRef?.selectedIndex ?? 1
            call.resolve(["tab": idx])
        }
    }

    @objc func setCurrentTab(_ call: CAPPluginCall) {
        queue.async { [weak self] in
            guard let self = self else { return }
            let sel = min(max(call.getInt("selection") ?? 1, 0), 2) // 常规页签 0/1/2
            if let ctrl = self.tabControllerRef {
                self.searchKVOSuppressed = true
                ctrl.selectedIndex = sel
                self.searchKVOSuppressed = false
            }
            call.resolve()
        }
    }

    /// sheet 呈现时把 tab bar 整体隐藏（sheet 盖在 tab bar 之上 = iOS 标准层次）
    @objc func setTabBarDimmed(_ call: CAPPluginCall) {
        queue.async { [weak self] in
            guard let self = self else { return }
            let dimmed = call.getBool("dimmed") ?? false
            self.tabControllerRef?.view.isHidden = dimmed
            call.resolve()
        }
    }

    @objc func hideTabBar(_ call: CAPPluginCall) {
        queue.async { [weak self] in
            guard let self = self else { return }
            self.tabControllerRef?.view.isHidden = false
            self.tabControllerRef?.view.removeFromSuperview()
            self.tabControllerRef = nil
            // 恢复 WebView 全屏
            if let webView = self.webView, let host = webView.superview {
                webView.frame = host.bounds
            }
            call.resolve()
        }
    }

    // MARK: - 原生 Liquid Glass 菜单（点按触发，官方组件 UIButton.showsMenuAsPrimaryAction）
    //
    // showMenu/hideMenu 实现在 LiquidGlassMenuSection.swift：
    // 透明锚点按钮挂在 bridge.viewController.view 层级，坐标经 convert(_:from:) 换算，
    // 点按弹系统 UIMenu（Liquid Glass 材质）。旧的 context menu 长按管线已整体废弃。
    @objc func setLens(_ call: CAPPluginCall) { call.resolve() }
    @objc func setLabel(_ call: CAPPluginCall) { call.resolve() }
    @objc func hideLens(_ call: CAPPluginCall) { call.resolve() }

    /// HIG 触感反馈：light/medium/heavy/rigid + success/warning/error 通知
    @objc func haptic(_ call: CAPPluginCall) {
        let styleStr = call.getString("style") ?? "light"
        DispatchQueue.main.async {
            switch styleStr {
            case "success", "warning", "error":
                let n = UINotificationFeedbackGenerator()
                n.prepare()
                n.notificationOccurred(styleStr == "success" ? .success : styleStr == "warning" ? .warning : .error)
            case "medium":
                let g = UIImpactFeedbackGenerator(style: .medium); g.prepare(); g.impactOccurred()
            case "heavy":
                let g = UIImpactFeedbackGenerator(style: .heavy); g.prepare(); g.impactOccurred()
            case "rigid":
                if #available(iOS 13.0, *) {
                    let g = UIImpactFeedbackGenerator(style: .rigid); g.prepare(); g.impactOccurred()
                } else {
                    let g = UIImpactFeedbackGenerator(style: .medium); g.prepare(); g.impactOccurred()
                }
            default:
                let g = UIImpactFeedbackGenerator(style: .light); g.prepare(); g.impactOccurred()
            }
            call.resolve()
        }
    }

    // MARK: - Helpers

    private func ensureHost(_ webView: UIView) -> UIView? {
        if let host = hostView, host.window != nil { return host }
        guard let parent = webView.superview else { return nil }
        hostView = parent
        return parent
    }
}

extension LiquidGlassPlugin: UITabBarControllerDelegate {
    public func tabBarController(_ tabBarController: UITabBarController, shouldSelect viewController: UIViewController) -> Bool {
        let idx = tabBarController.viewControllers?.firstIndex(of: viewController) ?? 0
        notifyListeners("tabSelect", data: ["tab": idx])
        return true
    }
}

final class MenuModel: ObservableObject {
    @Published var selection: Int = -1
    @Published var items: [[String: String]] = []
}
