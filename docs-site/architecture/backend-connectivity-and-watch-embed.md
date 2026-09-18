# 后端连接感知与手表伴侣嵌入架构

> 2026-09-18 · 分支 `fix/backend-connectivity-watch`

本文记录两项基础设施改动：**App 对后端连通性的前台感知**，以及 **watchOS 伴侣 App 嵌入 iPhone 主工程**。前者的直接动因是「手机 App 对后端离线完全无感知、设置调试 ping 不通」；后者解决「手表上看不到 Starfit」。

---

## 1. 后端健康探针：`/healthz` 双通道

### 1.1 端点拓扑

| 端点 | 鉴权 | 用途 |
|------|------|------|
| `GET /health`（后端 43111 根级） | 免令牌 | LAN 扫描发现探针，带 `app: "starfit"` 标识 |
| `GET /healthz`（后端 43111 根级） | 免令牌 | **前端连接探针**（2026-09-18 新增），与 `/health` 同响应体 |
| `GET /healthz`（nginx:80） | 免令牌 | 反向代理直通后端 `/healthz`（旧版曾转发 `/api/ping`，带鉴权部署时必 401——这是「调试功能 ping 不通」的根因） |
| `GET /api/ping` | 需 `X-Access-Token` | 诊断 ping（回显 ip/headers），不用于连接探测 |

### 1.2 鉴权白名单

`backend/src/server.ts` 的 access-token gate 放行 `/health`、`/healthz`、`OPTIONS`、`/uploads/*`。设置 `STARFIT_ACCESS_TOKEN` 后，未带令牌的请求（含 nginx 转发的）一律 401——**401 表示「没带令牌」而不是「服务挂了」**，前端探测代码必须走免令牌端点。

### 1.3 前端探测服务

`src/v2/services/connectivity.ts`：

- `checkBackendHealth()`：单次探测 `{API_BASE 去掉 /api}/healthz`，3s `AbortSignal.timeout` 快失败，返回 `{ok, lastOkAt, error, latencyMs}`。
- `useBackendHealth()` React hook：订阅共享状态；进前台（`visibilitychange`）/网络恢复（`online`）自动重探；30s 心跳轮询（有订阅者才跑）。
- `subscribeBackendHealth()`：非 hook 场景订阅入口，返回清理函数。

消费方：AI 教练界面头部状态灯（绿=在线/红=离线/灰=检测中，文案随之切换）、设置页「后端服务」卡。

## 2. 移动端默认 API 地址与穿透

`services/geminiService.ts` 的 `API_BASE` 解析优先级：登录写入的 `starfit_server_url` > `STARFIT_API_BASE` > 环境变量 > 移动端固定兜底。移动端兜底 2026-09-18 起走公网穿透 `http://8.138.169.218:19902/api`（frpc `starfit_backend` 代理，配置在 `~/.hermes/frpc/frpc.toml`，指向开发机 43111）；旧局域网 IP 降为 `services/serverDetector.ts` 的低优先候选。**局域网 IP 会漂移，勿写死进代码。**

## 3. Watch App 嵌入 iPhone 主工程

### 3.1 架构：子工程引用，不拷源码

`ios/App/App.xcodeproj` 通过 `PBXProject.projectReferences` 挂载 `../WatchApp/StarfitWatch.xcodeproj` 子工程：

- `PBXContainerItemProxy`（proxyType=2）代理子工程 target 的产物 `StarfitWatch.app`；
- `PBXTargetDependency` 让 App target 构建前先构建 StarfitWatch；
- **Embed Watch Content**（`PBXCopyFilesBuildPhase`，`dstSubfolderSpec = 16`）把产物拷进 `App.app/Watch/`；
- `ios/WatchApp` 的 xcodegen 工作流（`project.yml`）完全不受影响。

### 3.2 手写 pbxproj 的四个坑

1. **`dstSubfolderSpec = 16`** 才是「Watch 目录」语义。`0` 是绝对路径语义，会把产物拷到文件系统根的 `/App.app/Watch`（报 Stale file / The file doesn't exist）。
2. **子工程产物 fileRef 路径**不能用 `sourceTree = BUILT_PRODUCTS_DIR`（会解析到主 App 自己的 SDK 目录 `Debug-iphoneos`，而 Watch 产物在 `Debug-watchos`）。必须显式 `path = "$(BUILD_DIR)/$(CONFIGURATION)-watchos/StarfitWatch.app"`。
3. **Embed 阶段的 files 数组必须引用 PBXBuildFile**（`fileRef` 指向产物 fileRef）。直接引用 PBXFileReference 会报 `invalid value for "files"`，项目直接打不开。
4. **构建命令禁加 `-sdk iphonesimulator`**：会强制子工程 target 也按 iOS SDK 编译，WatchKit 模块解析失败。设备构建用 `-destination 'generic/platform=iOS'`；如需模拟器手表构建，对子工程单独 `xcodebuild -project ios/WatchApp/StarfitWatch.xcodeproj -sdk watchsimulator`。

### 3.3 分发模型

iPhone App 构建产物 `App.app/Watch/StarfitWatch.app`（bundle `io.starfit.app.watchkitapp`，Info.plist `WKCompanionAppBundleIdentifier = io.starfit.app`）。装 iPhone 后手表自动出现伴侣 App（需 WCSession 配对）。独立开发调试仍可对 `ios/WatchApp` 单独构建直装手表（真机 `devicectl device install app`，隧道偶发 `Connection invalid` 重试即可）。

## 4. 手表连接状态桥（iOS 侧）

`ios/App/App/WatchConnectivityPlugin.swift` 新增：

- `getWatchStatus`：返回 `{supported, activated, paired, appInstalled, reachable}`，设置页 Apple Watch 卡数据源；
- `reconnect`：JS 主动 `WCSession.activate()`（手表刚解锁/进设置页触发）；
- delegate 补 `activationDidCompleteWith` 与 `sessionWatchReachabilityDidChange`：激活完成/可达性变化即向 JS 推 `watch_status` 事件（`starfit:watch-event` 通道）——**手表抬腕解锁，手机侧状态实时刷新，无需轮询**。

JS 封装在 `src/v2/services/watchConnectivity.ts`（`getWatchStatus` / `reconnectWatch` / `WatchStatus` 类型）；UI 在 `src/v2/components/settings/WatchStatusCard.tsx`（非 iOS 平台整卡返回 null）。
