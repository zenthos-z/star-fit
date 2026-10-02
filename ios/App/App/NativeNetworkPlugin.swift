import Foundation
import Capacitor

// MARK: - NativeNetworkPlugin — 本机局域网 IPv4 桥（#84 返工定案）
//
// 背景：iOS WKWebView 对 RTCPeerConnection host candidate 默认做 mDNS
// 混淆（Apple 隐私策略），WebRTC 路径拿到的是 xxx.local 而非真实 IP →
// serverDetector 推不出本机网段，全网扫描打在错误网段上，局域网服务器
// 永远扫不出来。本插件用 getifaddrs 枚举接口拿真实 IPv4，是 iOS 上
// 定位本机网段的唯一可靠路径。
//
// 候选顺序：en0（Wi-Fi）优先，其次其余 en*/eth* 接口；只认 RFC1918
// 私网段与回环。JS 侧（src/lib/nativeNetwork.ts）拿不到时回退 WebRTC
// 旧路径（dev 浏览器场景）。

@objc(NativeNetworkPlugin)
public class NativeNetworkPlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "NativeNetworkPlugin"
    public let jsName = "NativeNetworkPlugin"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getLanIpv4", returnType: CAPPluginReturnPromise)
    ]

    /// 枚举网络接口，返回本机私网 IPv4（en0 优先）。
    /// 成功 resolve { ip: "192.168.31.50", interface: "en0" }；
    /// getifaddrs 失败或无私网接口时 reject（JS 侧回退 WebRTC）。
    @objc func getLanIpv4(_ call: CAPPluginCall) {
        var ifaddr: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&ifaddr) == 0, let first = ifaddr else {
            call.reject("getifaddrs failed")
            return
        }
        defer { freeifaddrs(ifaddr) }

        var enAddresses: [(name: String, ip: String)] = []
        var otherAddresses: [(name: String, ip: String)] = []
        var cursor: UnsafeMutablePointer<ifaddrs>? = first
        while let current = cursor {
            defer { cursor = current.pointee.ifa_next }
            let ifa = current.pointee
            guard let sa = ifa.ifa_addr, sa.pointee.sa_family == UInt8(AF_INET) else { continue }

            var addr = sockaddr_in()
            memcpy(&addr, sa, MemoryLayout<sockaddr_in>.size)
            var sinAddr = addr.sin_addr
            var ipBuffer = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
            guard inet_ntop(AF_INET, &sinAddr, &ipBuffer, socklen_t(INET_ADDRSTRLEN)) != nil else { continue }
            let ip = String(cString: ipBuffer)
            guard Self.isPrivateIpv4(ip) else { continue }

            let name = String(cString: ifa.ifa_name)
            if name == "en0" {
                enAddresses.append((name, ip))
            } else if name.hasPrefix("en") || name.hasPrefix("eth") {
                otherAddresses.append((name, ip))
            }
        }

        if let hit = enAddresses.first ?? otherAddresses.first {
            call.resolve(["ip": hit.ip, "interface": hit.name])
        } else {
            call.reject("no private IPv4 interface found")
        }
    }

    /// RFC1918 私网段 + 回环（127/8）判定——非私网 IP（蜂窝公网地址等）
    /// 不参与网段推断（公网 /24 没有扫描意义）。
    static func isPrivateIpv4(_ ip: String) -> Bool {
        let octets = ip.split(separator: ".").compactMap { UInt8($0) }
        guard octets.count == 4 else { return false }
        switch octets[0] {
        case 10, 127:
            return true
        case 172:
            return octets[1] >= 16 && octets[1] <= 31
        case 192:
            return octets[1] == 168
        default:
            return false
        }
    }
}
