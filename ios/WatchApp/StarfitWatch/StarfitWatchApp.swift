import SwiftUI
import WatchKit

@main
struct StarfitWatchApp: App {
    @StateObject private var session = WatchSessionModel()

    init() {
        // 注入全局引用：Ultra Action 按钮 App Intent / 辅助手势路由到同一模型实例
        WorkoutActionRouter.model = session
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(session)
                .background(Color.black) // 玻璃可见性铁律：玻璃下须有内容变化
        }
    }
}
