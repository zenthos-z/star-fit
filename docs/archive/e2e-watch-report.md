# Starfit 手表伴侣 E2E 联调报告（WCSession 双向链路）

- 分支: `zenthos-z/starfit-watch-e2e` @ `fbea9a9`（联调期间的本地修改见文末「修改清单」）
- 环境: Xcode 27.0 (27A266a) / macOS (Darwin 27.0.0) / iOS 26.5 + watchOS 26.5 模拟器运行时
- 设备: Apple Watch Series 11 (46mm) `C8AFD885-E883-4AC4-84C1-E0D4987C5190` × iPhone 17 Pro Max `3E171599-D7E9-4443-ACBD-FCE3F91A7997`
- 结论速览: 见每步「结论」；总闸见文末。

---

## ⚠️ 0. 前提证伪与主线文件必改说明（先读）

任务卡背景称「手表 App 已通过子工程嵌入 iPhone 主工程（App.xcodeproj 引用 StarfitWatch.xcodeproj，Embed Watch Content 阶段 dstSubfolderSpec=16）」。

**该前提与仓库事实不符**：

```bash
$ git log --all --oneline -S 'StarfitWatch' -- ios/App/App.xcodeproj/project.pbxproj
# 输出为空 —— 全部历史中 App.xcodeproj 从未引用过 StarfitWatch
```

App 工程此前只嵌入了 StarfitWidget（`ios/App/App.xcodeproj/project.pbxproj` 内仅有 `StarfitWidget.appex` 相关 4 处对象）。手表 App（commit `94a18ca` 引入）一直是**独立工程**，从未随 iPhone App 分发。

因此「构建 iPhone App（含嵌入 Watch App）并验证包内 `Watch/StarfitWatch.app` 存在 / 验证随 iPhone 分发生效」这两项联调内容**必须先补嵌入关系**。依据两张任务卡口径（卡1：允许动 pbxproj；卡2：改 pbxproj 须在报告说明），本次修改如下，全部位于 `ios/App/App.xcodeproj/project.pbxproj`（未触碰其他主线文件）：

| # | 对象类型 | ID | 作用 |
| --- | --- | --- | --- |
| 1 | PBXFileReference | `EC4A…0001` | 指向 `../WatchApp/StarfitWatch.xcodeproj`（wrapper.pb-project） |
| 2 | PBXContainerItemProxy | `EC4A…0002` | proxyType=1，remoteGlobalIDString=子工程 target `B6CE709D69516D085F5F7275`（构建依赖用） |
| 3 | PBXContainerItemProxy | `EC4A…0003` | proxyType=2，remoteGlobalIDString=子工程产品 fileRef `B4E30BB8AF4CFB5878A19054`（产品引用用） |
| 4 | PBXReferenceProxy | `EC4A…0004` | `StarfitWatch.app`，sourceTree=BUILT_PRODUCTS_DIR |
| 5 | PBXBuildFile | `EC4A…0005` | StarfitWatch.app in Embed Watch Content |
| 6 | PBXTargetDependency | `EC4A…0006` | targetProxy=2 号代理（跨工程依赖，无 target 键） |
| 7 | PBXCopyFilesBuildPhase | `EC4A…0007` | **Embed Watch Content**，`dstPath="$(CONTENTS_FOLDER_PATH)/Watch"`，**dstSubfolderSpec=16** |
| 8 | 挂载 | — | 主 group children += 子工程；Products group += 手表 App；App target buildPhases/dependencies 各 +=1 |

Info.plist 核查结论（**零改动**）：手表侧 `Info.plist` 已含 `WKApplication=true` + `WKCompanionAppBundleIdentifier=io.starfit.app`；手机侧 Info.plist 按 SwiftUI 单 target 手表 App 规范无需 WK 键；bundle id 前缀 `io.starfit.app.watchkitapp` ⊂ `io.starfit.app` 合法；手表 target `SKIP_INSTALL=YES` 已满足嵌入前提。

**踩坑记录（pbxproj 手写编辑）**：proxyType=2 的 `remoteGlobalIDString` 初版误填子工程 native target ID，导致 `xcodebuild -list` 崩溃：

```
xcodebuild: error: Unable to read project 'App.xcodeproj' ... The project "App" is damaged
Exception: -[PBXNativeTarget path]: unrecognized selector sent to instance
```

根因：Xcode 把 proxyType=2 解析结果当 file-like 对象取 `path`，PBXNativeTarget 不实现 `path`。改指产品 fileRef（`B4E30BB8…/StarfitWatch.app`）后 `xcodebuild -list` 恢复正常。proxyType=1（target dependency）仍指 target ID，两者不可混。

---

## 1. 配对 Watch + iPhone 模拟器 ✅

```bash
$ xcrun simctl shutdown C8AFD885-E883-4AC4-84C1-E0D4987C5190
$ xcrun simctl shutdown 3E171599-D7E9-4443-ACBD-FCE3F91A7997
# （其中一台已是 Shutdown 状态时 shutdown 报 405 "device in current state: Shutdown"，无害）
$ xcrun simctl unpair F53685FA-...   # 清理先前 stale pair
$ xcrun simctl pair C8AFD885-E883-4AC4-84C1-E0D4987C5190 3E171599-D7E9-4443-ACBD-FCE3F91A7997
$ xcrun simctl boot C8AFD885-E883-4AC4-84C1-E0D4987C5190
$ xcrun simctl boot 3E171599-D7E9-4443-ACBD-FCE3F91A7997
```

验证：

```
$ xcrun simctl list pairs | grep -B1 -A2 F53685FA
F53685FA-7886-4AD3-8D62-676A0CAEDE99 (active, connected)
    Watch: Apple Watch Series 11 (46mm) (C8AFD885-...) (Booted)
    Phone: iPhone 17 Pro Max (3E171599-...) (Booted)
```

**结论**：pair 建立、双机 Booted。附注：Xcode 27 已移除 `Simulator.app`，设备面板在 `/Applications/Xcode.app/Contents/Applications/DeviceHub.app`（内嵌 tile 展示，截屏确认两台在列）。

---

## 2. 构建 + 安装

### 2.1 Web 构建 + cap sync ✅

```bash
$ npm run build && npx cap sync ios   # exit 0（Vite 构建产物拷入 ios/App/App/public）
```

### 2.2 手表 App 独立构建 ✅

```bash
$ xcodebuild -project ios/WatchApp/StarfitWatch.xcodeproj -scheme StarfitWatch \
    -configuration Debug -sdk watchsimulator \
    -destination 'generic/platform=watchOS Simulator' \
    -derivedDataPath /tmp/starfit-e2e-dd build    # exit 0
$ ls /tmp/starfit-e2e-dd/Build/Products/Debug-watchsimulator/
StarfitWatch.app  StarfitWatch.swiftmodule
```

> 时序注记：该次独立构建在补观测日志**之前**完成。随后加日志时手表侧误用了 iOS-only API `session.isPaired`（watchOS 不可用），独立产物未暴露（未重建），由 §2.3 首次手机构建（依赖链连带编译 StarfitWatch）暴露：

```
ConnectivityManager.swift:41:156: error: 'isPaired' is unavailable in watchOS
```

**小修（fix 提交项）**：手表侧日志去掉 `isPaired`，配对真值以 `isCompanionAppInstalled` 为准（与任务卡口径一致）。修复后手表产物由手机构建依赖链自动重建（同 derivedDataPath），两安装路径共用同一产物。

### 2.3 手机 App 构建（含嵌入 Watch App）⏳

命令（destination 为 iOS Simulator 以便装入模拟器；任务卡中 `generic/platform=iOS` 为真机口径，模拟器联调必须改 Simulator 平台；未加 `-sdk iphonesimulator`，遵守任务卡禁令，子工程经 target dependency 自动按 watchsimulator 解析）：

```bash
$ xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
    -destination 'generic/platform=iOS Simulator' \
    -derivedDataPath /tmp/starfit-e2e-dd build
```

首次运行失败于 SPM 网络抖动（非代码问题）：

```
xcodebuild: error: Could not resolve package dependencies:
  Failed to clone repository https://github.com/ionic-team/ion-ios-camera.git:
    fatal: unable to access ... LibreSSL SSL_connect: SSL_ERROR_SYSCALL in connection to github.com:443
```

重试同样失败——本机当前无法直连 github.com（LibreSSL SSL_ERROR_SYSCALL，网络环境阻断，非仓库问题）。**离线绕过**：从既有 `~/Library/Developer/Xcode/DerivedData/App-*/SourcePackages`（capacitor-swift-pm + ion-ios-camera 克隆缓存齐全）拷入构建目录，加 `-disableAutomaticPackageResolution` 禁止联网解析：

```bash
$ cp -R ~/Library/Developer/Xcode/DerivedData/App-bqqq…/SourcePackages /tmp/starfit-e2e-dd/SourcePackages
$ xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
    -destination 'generic/platform=iOS Simulator' \
    -derivedDataPath /tmp/starfit-e2e-dd -disableAutomaticPackageResolution build
** BUILD SUCCEEDED **（首次因 watch 日志误用 iOS-only `isPaired` 编译失败，修复后通过；watch 产物经依赖链自动重建为双架构 fat binary）
```

手表产物 WK 键核验（嵌入前提）：

```
$ plutil -p …/Debug-watchsimulator/StarfitWatch.app/Info.plist | grep -i 'WKApp\|WKCompanion\|BundleId'
  "CFBundleIdentifier" => "io.starfit.app.watchkitapp"
  "WKApplication" => true
  "WKCompanionAppBundleIdentifier" => "io.starfit.app"
```

### 2.4 包内 Watch/StarfitWatch.app 存在性验证 ✅

```
$ ls /tmp/starfit-e2e-dd/Build/Products/Debug-iphonesimulator/App.app/Watch/
StarfitWatch.app
$ plutil -p …/App.app/Watch/StarfitWatch.app/Info.plist | grep -i 'BundleId\|WKApp\|WKCompanion'
  "CFBundleIdentifier" => "io.starfit.app.watchkitapp"
  "WKApplication" => true
  "WKCompanionAppBundleIdentifier" => "io.starfit.app"
$ lipo -info …/App.app/Watch/StarfitWatch.app/StarfitWatch
Architectures … are: x86_64 arm64
```

日志编入核验：Xcode 26 Debug 产物采用 debug-dylib 拆分（主可执行仅 89KB 桩），真实代码在 `App.debug.dylib` / `StarfitWatch.debug.dylib`——对主可执行 grep 日志串会误判为 0，需查 `.debug.dylib`：

```
$ grep -aoc 'WC\]\[phone\]'  …/App.app/App.debug.dylib          # 16
$ grep -aoc 'WC\]\[watch\]'  …/Watch/StarfitWatch.app/StarfitWatch.debug.dylib  # 12
```

### 2.5 安装 + 随 iPhone 分发验证 ⚠️（包内嵌 ✓ / 自动分发未触发）

```
$ xcrun simctl install 3E171599-… …/Debug-iphonesimulator/App.app   # INSTALL_OK
$ sleep 20 && xcrun simctl listapps C8AFD885-… | grep -i starfit    # 无输出
$ xcrun simctl launch 3E171599-… io.starfit.app                      # 触发 WCSession 激活
$ sleep 25 && xcrun simctl listapps C8AFD885-… | grep -i starfit    # 仍无输出
```

**结论**：App 包内已正确嵌入 Watch App（§2.4），但模拟器上「随 iPhone 自动分发」未在装后+启动后共 45s 内触发（真机走 Xcode/watchOS App 安装或 TestFlight 时由系统完成分发）。按任务卡预案转独立安装路径。

### 2.6 手表独立安装 ✅

```
$ xcrun simctl install C8AFD885-… …/App.app/Watch/StarfitWatch.app  # 即嵌入产物本体
$ xcrun simctl listapps C8AFD885-… | grep -A4 io.starfit
    "io.starfit.app.watchkitapp" = { CFBundleDisplayName = Starfit; … }
```

---

## 3. WCSession 状态验证 ✅（含一个真 bug 修复）

> 任务卡所述 `getWatchStatus` 方法在 WatchConnectivityPlugin.swift 中不存在（实际仅 `broadcastSetState` / `isWatchReachable`）。按更新卡口径改为日志验证。

方法：双端 `xcrun simctl launch --console-pty` 抓 stdout（Xcode 26 下 print 经 pty 可见；后台 tee 落盘 /tmp/{phone,watch}-console.log）。

**第一次尝试：双端 0 条 [WC] 日志。** 排查发现真因——**`cap sync` 把 `capacitor.config.json` 的 `packageClassList` 清空**（AppDelegate.swift:43 注释明示该坑：「cap sync 会清空该列表——每次 sync 后需重跑 scripts/patch-capacitor-json.sh」，而流程文档未把 patch 纳入构建链）。插件不在列表 → WatchConnectivityPlugin 不被 Capacitor 桥注册 → `load()` 不执行 → WCSession 从未 activate。**修复：`bash scripts/patch-capacitor-json.sh` 恢复 8 插件列表（含 WatchConnectivityPlugin）→ 增量重建重装 → 日志立现。**

```
=== PHONE ===
[WC][phone] activationDidComplete state=2 error=nil paired=true watchAppInstalled=true reachable=true
=== WATCH ===
[WC][watch] activationDidComplete state=2 error=nil companionAppInstalled=true reachable=false
[WC][watch] reachabilityChanged reachable=true
```

**结论**：手机侧 `activationState=activated(state=2) + paired + watchAppInstalled` 全真；手表侧按任务卡口径 `companionAppInstalled=true` 且随后 `reachable=true`（激活瞬间 reachable=false 属正常握手次序，reachabilityChanged 跟进为 true）。WCSession 双向链路底层就绪。

## 4. 手机→手表镜像（applicationContext）✅

验证分两层：Tier1 越过 UI 直调插件（验证 Swift 桥 + WCSession 链路本身），Tier2 走完整真实 UI 流（验证 LockScreen → broadcastCurrentSet → 插件 → 手表解码全链）。

### 4.0 驱动方法（模拟器容器注入）

safaridriver 路线（Allow Remote Automation 开关无法打开）与 mac 像素坐标路线（窗口漂移）均废弃后，改用**容器注入 + console 通道**：

1. 直接编辑已安装 App 包内 `public/index.html`（WKWebView 从 bundle 磁盘加载），`</body>` 前注入一段 driver 脚本（原文件备份 `/tmp/index.html.orig`）。driver 能力：
   - `console.log('[DRIVER] …')` → App stdout → `--console-pty` 落盘 `/tmp/phone-console.log`，构成**免 safaridriver 的下行通道**；
   - `fetch('/wc-driver-cmd.json', {cache:'no-store'})` 每 2.5s 轮询包内命令文件（id 递增去重），支持 `dump`（页面文本）/ `click`（innerText 精确匹配）/ `eval`（任意 JS，Promise 结果回显）三个 op，构成**免重启 App 的上行通道**。
2. 注入只改模拟器容器内的构建产物，**不触碰仓库文件**；webview console 里的 React 错误/状态同样可见，一举两得。

> 踩坑两则：① 命令文件必须是合法 JSON——一次 heredoc 写入带了控制字符，`r.json()` 静默 reject，driver 每 2.5s 跳过同一坏文件毫无报错（表现为「命令发出去没反应」），改用 `python3 json.dump` 生成后恢复；② `click` 只匹配 innerText 精确相等，图标钮/文字不符钮会 MISS——此时按钮枚举（eval）通常能看到它有 `aria-label`，改用 eval 按 aria-label 查找并 `.click()`。

### 4.1 Tier1：driver 直调插件方法（合成 payload）✅

webview 内直接 `Capacitor.nativePromise('WatchConnectivityPlugin','broadcastSetState',{state})`，payload 严格按 `src/v2/services/watchConnectivity.ts` 的 `WatchSetMirror` 契约（camelCase）构造两组：

```
[WC][phone] broadcastSetState ok: [PLANNED: exerciseName=杠铃卧推 setIndex=0
  completedCount=1 weight=80 reps=8 isResting=0 …]
[WC][phone] broadcastSetState ok: [休息态: setIndex=1 completedCount=2 weight=85
  isResting=1 restEndTime=1789725834812 …]

=== 手表侧（逐字段解码一致，camelCase 契约对齐）===
[WC][watch] didReceiveApplicationContext: ["set_state": { … weight=80 reps=8 … }]
[WC][watch] didReceiveApplicationContext: ["set_state": { … isResting=1 restEndTime=1789725834812 … }]
```

**结论**：`broadcastSetState`（Swift）→ `WCSession.updateApplicationContext(["set_state": state])` → 手表 `didReceiveApplicationContext` 解码，链路通，plist 类型约束（payload 只含原生类型）满足。

### 4.2 Tier2：真实 UI 全链 ✅（含焦点组变化重广播）

先厘清触发路径（任务卡只说「进入训练态后触发」，实际有两道门）：

- `App.tsx:1425` — LockScreen **仅在 `isLockScreenOpen` 且 session active/paused 时挂载**；`isLockScreenOpen` 由 `TimerCapsule` 的**下拉手势**（`dy > 90px`，`components/TimerCapsule.tsx:147`）置位——训练开始不会自动开始镜像，锁屏挂载才开始（设计如此：锁屏 = 训练中主界面）。
- 镜像 effect 在 `LockScreen.tsx:300-321`，依赖 `[focusKey, exercises]`，`focus.kind==='done'` 时不广播。

驱动序列（全部经 wc-driver-cmd.json，结果见 /tmp/phone-console.log）：

| CMD | 操作 | 结果 |
| --- | --- | --- |
| #1-#8 | 挑选动作 → 杠铃卧推 → 确认添加（该钮 aria-label 命中、innerText 为空，click MISS 后改 eval） | 主页出现 `杠铃卧推 常规负重 01 KG 次数 开始运动 添加动作` |
| #15 | click `开始运动`（TimerCapsule idle 态主按钮） | session active，页面出现计时 `00:02` |
| #18 | 合成 TouchEvent 下拉手势（touchstart y=90 → touchmove y=260 → touchend，dy=170 > 90）作用于胶囊计时器元素 | LockScreen 挂载：`07:25 力量训练 杠铃卧推 20 kg 10 次 完成第 1 组 上滑解锁` |
| #20 | 合成 PointerEvent 长按 `完成第 1 组`（HoldToConfirm HOLD_MS=700，pointerdown → 1000ms → pointerup；stub `Element.prototype.setPointerCapture` 防非受信 pointer 抛 NotFoundError） | 组完成 + 自动进休息：`休息中 1:00 结束休息 +10 秒` |

真实广播证据（手机发 ↔ 手表收，逐字段一致）：

```
=== 挂载即广播（真实训练数据，非合成）===
[WC][phone] broadcastSetState ok: ["exerciseName": "杠铃卧推", "status": "PLANNED",
  "setIndex": 0, "weight": 20, "reps": 10, "totalSets": 1,
  "exerciseType": "resistance", "completedCount": 0, "isResting": 0, …]
[WC][watch] didReceiveApplicationContext: ["set_state": {
    exerciseName = "\U6760\U94c3\U5367\U63a8";   // = 杠铃卧推
    exerciseType = resistance; weight = 20; reps = 10;
    setIndex = 0; totalSets = 1; completedCount = 0; status = PLANNED; }]

=== 焦点组变化重广播（完成组 → 自动休息 60s）===
[WC][phone] broadcastSetState ok: ["setIndex": 0, "completedCount": 1,
  "status": "COMPLETED", "isResting": 1, "restEndTime": 1789726501541, …]
[WC][watch] didReceiveApplicationContext: ["set_state": {
    completedCount = 1; status = COMPLETED; isResting = 1;
    restEndTime = 1789726501541; … }]   // restEndTime 毫秒值逐字节一致
```

**结论**：§4 验收达成——「手机 LockScreen broadcastCurrentSet 在焦点组变化时触发，手表 ConnectivityManager.swift 收到 applicationContext 更新」。两层证据：LockScreen 挂载时首播 + 长按完成组后焦点变 rest 重播；手表两次解码与手机发送 payload 完全一致。

## 5. 手表→手机事件（set_completed / rest_action）✅

触发方式：手表 DEBUG 启动参数（`WatchSessionModel.swift:55`）。

```bash
xcrun simctl terminate C8AFD885-… io.starfit.app.watchkitapp
xcrun simctl launch --console-pty C8AFD885-… io.starfit.app.watchkitapp \
  --auto-demo --auto-rest --demo-exercise-index 0 2>&1 | tee /tmp/watch-console3.log
# --auto-demo   启动 1s 后 startDemo()（演示计划：卧推 4 组×80kg，exerciseIndex=0）
# --auto-rest   再 2s 后 completeCurrentSet() → 发 set_completed + 本地进 60s 休息
# 休息到期后 endRest() → 发 rest_action end
```

**首轮失败与修复（本身就是一条重要实证）**：第一次 relaunch 后手表只打了 3 行日志（激活 + reachable true→false），`set_completed` 消失。根因不是没发，而是**竞态**：auto-demo 在启动后 3s 触发，而模拟器 WCSession 握手要 15s+——`sendToPhone`（`WatchSessionModel.swift:188`）此刻 `isReachable=false`，payload 静默进 `pendingOps`（该分支无 print）；随后链路一直没恢复，积压永不 flush。用手机侧 Tier1 合成广播轻推链路，applicationContext **成功带外送达**（不需要 reachability，又一出向证据）但 reachability 未回升。最终按已知修复路径 `simctl uninstall + install`（`/tmp/starfit-e2e-dd/Build/Products/Debug-watchsimulator/StarfitWatch.app`）重装复位双方信念后重启——reachability ~3s 即回升，**积压的 set_completed 自动补发**（`flushPendingOps`，「断连积压、回连补发」设计被顺带实证）。

完整四层证据链（两类事件各一条，时间 2026-09-18 18:20–18:22 CST）：

```
=== 事件 1：set_completed（积压补发）===
[WC][watch] sendMessage: ["kind": "set_completed", "completed_at": "2026-09-18T10:20:44Z",
                          "exercise_index": 0, "set_index": 0]
[WC][phone] didReceiveMessage: ["completed_at": 2026-09-18T10:20:44Z, "set_index": 0,
                                "kind": set_completed, "exercise_index": 0]
[WC][phone] forwardWatchEvent: {"completed_at":"2026-09-18T10:20:44Z","set_index":0,
                                "kind":"set_completed","exercise_index":0}
⚡️ [DRIVER] starfit:watch-event detail={"completed_at":"2026-09-18T10:20:44Z","set_index":0,
                                "kind":"set_completed","exercise_index":0}

=== 事件 2：rest_action end（本地 60s 休息到期，准时 +0s）===
[WC][watch] sendMessage: ["kind": "rest_action", "action": "end"]
[WC][phone] didReceiveMessage: ["action": end, "kind": rest_action]
[WC][phone] forwardWatchEvent: {"action":"end","kind":"rest_action"}
⚡️ [DRIVER] starfit:watch-event detail={"action":"end","kind":"rest_action"}
```

四层 = 手表发送（sendMessage）→ 手机原生接收（didReceiveMessage）→ 插件派发（forwardWatchEvent，`evaluateJavaScript` 注入 webview 的 CustomEvent）→ **webview 实收**（driver 挂在 `document` 上的 `starfit:watch-event` listener 打出 detail，JSON 逐字段一致）。§5 验收原文「手表发 set_completed，手机 watchConnectivity.ts onWatchEvent 收到并派发 starfit:watch-event」——派发层有硬证据，实收层有 listener 硬证据。

**消费语义（代码核对，`LockScreen.tsx:328-361`）**：本场景手机焦点已是 done（唯一组早已完成、休息超时），`set_completed` 走焦点校验分支被忽略、`rest_action` end 被非 rest 态 guard 忽略——两事件到达后手机广播计数维持 3（2 真实 + 1 合成），无虚假重播，幂等符合设计。若事件在 rest 态到达，`set_completed` → `onEndRest`（手机休息态 = 对下一组的确认）、`rest_action` → 结束/延长休息。

---

## 修改清单（本地，未 push）

| 文件 | 性质 | 说明 |
| --- | --- | --- |
| `ios/App/App.xcodeproj/project.pbxproj` | fix（必改） | 见 §0 嵌入关系补齐 |
| `ios/App/App/WatchConnectivityPlugin.swift` | fix（观测） | 手机侧补 `[WC][phone]` 前缀 print 日志（激活/可达/收发/广播）+ sessionReachabilityDidChange |
| `ios/WatchApp/StarfitWatch/Services/ConnectivityManager.swift` | fix（观测） | 手表侧补 `[WC][watch]` 前缀 print 日志（同上维度） |
| `e2e-watch-report.md` | 文档 | 本报告 |
| `ios/App/App/capacitor.config.json` | 非仓库文件 | 被 `ios/.gitignore:12` 忽略（cap sync 生成产物）；`packageClassList` 补丁由已跟踪的 `scripts/patch-capacitor-json.sh` 在每次 `cap sync` 后重打（见已知问题 ①） |
| 模拟器容器 `public/index.html` + `public/wc-driver-cmd.json` | 非仓库文件 | 构建产物内注入的调试 driver（§4.0），不进版本库；现场已恢复/清理（见下） |

## 已知问题 / 卡点

1. **`packageClassList` 被 `cap sync` 清空（流程性真 bug）**：`npx cap sync ios` 会重写 `ios/App/App/capacitor.config.json` 并清空 `packageClassList`，手写原生插件（`Capacitor.nativePromise` 调用路径）随之失效，且**无任何报错**——webview 侧 promise 静默不 resolve。修复脚本 `scripts/patch-capacitor-json.sh` 已存在，但需要人工记得在每次 cap sync 后重跑。建议后续把该脚本挂进 `cap sync` 的 npm 钩子（本次未改，属流程改造非小修）。
2. **模拟器不自动随 iPhone 分发内嵌 Watch App**：手机 App.app 内 `Watch/StarfitWatch.app` 存在且结构正确（§2.4），但 `simctl install` iPhone 后手表侧不会自动出现 App（§2.5，Xcode 真机/常规模拟器流程会走自动分发）。模拟器联调需独立安装手表 App，属模拟器行为，非工程缺陷。
3. **iOS 侧 `watchAppInstalled` 信念漂移**：多次 terminate/relaunch 手表 App 后，链路 reachability 可能双双掉线且不再自愈（本次 §5 首轮即中招）；`simctl uninstall + install` 手表 App 可稳定复位。推断为模拟器 WCSession 对 counterpart 安装态的缓存问题。
4. **auto-demo 与 WCSession 握手的固定竞态**：`--auto-rest` 在启动后固定 3s 触发，早于 15s+ 的握手窗口。行为上被积压队列兜底（回连补发），但联调时要意识到「sendMessage 没打印 ≠ 没触发」。可改进：`sendToPhone` 的入队分支补一行 print（本次未改，属观测性小Enhancement，已列入 Swift 日志修改的后续项）。
5. **镜像只在 LockScreen 挂载期间广播（设计口径说明，非 bug）**：训练开始不触发 `broadcastCurrentSet`；需 TimerCapsule 下拉进锁屏后才开始镜像，锁屏退出即停。任务卡「进入训练态后触发」的口径与实现的差异在此说明——对手表用户语义合理（锁屏=训练主界面），但断连期间手表完全无镜像，依赖本地演示态。
6. **`getCurrentTab` 轮询风暴（无害但刷屏）**：训练激活后 `LiquidGlassPlugin getCurrentTab` 以 ~2 次/秒刷 console，淹没其他日志。建议生产构建降噪/降频（未改）。
7. **观察：plist 类型约束**：`Int?` 为 nil 时必须显式省略键，`NSNull` 装箱会触发 `WCErrorCodePayloadUnsupportedTypes`（`WatchSessionModel.swift:112` 已有注释与正确处理，2026-09-17 实锤）。
8. **路线废弃记录**：safaridriver（Allow Remote Automation 开关无法打开）与 mac 像素坐标（窗口漂移）两条 UI 自动化路线废弃，由容器注入 + console 通道取代（§4.0）。

## 总结论

| 验收项 | 结果 | 关键证据 |
| --- | --- | --- |
| 1. 配对 | ✅ | pair active/connected |
| 2. 构建 + 安装（双端 + 包内嵌验证） | ✅（自动分发 ⚠️ 见已知问题 ②） | BUILD SUCCEEDED ×2；App.app/Watch/StarfitWatch.app 存在 |
| 3. WCSession 状态 | ✅ | 手表 companionAppInstalled=true reachable=true；手机 activationState=activated |
| 4. 手机→手表镜像 | ✅ | Tier1 合成 ×2 + Tier2 真实 UI ×2（挂载首播 + 焦点变化重播），手表解码逐字段一致（含 restEndTime 毫秒值） |
| 5. 手表→手机事件 | ✅ | set_completed + rest_action end 双事件四层链路（sendMessage → didReceiveMessage → forwardWatchEvent → webview CustomEvent 实收） |

WCSession 双向链路在模拟器上全通。工程侧真 bug 一个（`packageClassList` 被 cap sync 清空，已有脚本修复但流程未自动化）；其余为模拟器行为与观测性改进项。
