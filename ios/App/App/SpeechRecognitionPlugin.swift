import Foundation
import Capacitor
import AVFoundation
import Speech

/**
 * SpeechRecognitionPlugin — 系统语音输入桥（SFSpeechRecognizer，原生，免费）。
 *
 * 用途：AI 教练输入栏的「按住说话」——流式识别中文，中间结果实时回调，
 * 最终文本交给 Web 层进现有聊天链路（SSE /api/chat 不变）。
 *
 * API：
 *   requestPermissions() -> { speech: 'granted'|'denied'|'notDetermined', mic: 'granted'|'denied'|'notDetermined' }
 *   start({ locale?, partialResults? }) —— 开始流式识别，事件 onPartialResult { text }
 *   stop() -> { text }  —— 停止并返回最终文本（同时发 onFinalResult）
 *   cancel()             —— 放弃本轮（不发 final）
 *   isSupported() -> { supported, onDevice }
 * 事件：onPartialResult { text } / onFinalResult { text } / onError { message }
 */
@objc(SpeechRecognitionPlugin)
public class SpeechRecognitionPlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "SpeechRecognitionPlugin"
    public let jsName = "SpeechRecognitionPlugin"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestSpeechPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnNone),
        CAPPluginMethod(name: "getPartialResult", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkSupported", returnType: CAPPluginReturnPromise)
    ]

    private let audioEngine = AVAudioEngine()
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var recognizer: SFSpeechRecognizer?
    private var isRunning = false
    private var partialText = ""

    /// 最近一次识别错误（getPartialResult 轮询可见——notifyListeners 真机不可靠）
    private var lastError: String?

    private func makeRecognizer(_ locale: String?) -> SFSpeechRecognizer? {
        if let locale = locale, !locale.isEmpty {
            return SFSpeechRecognizer(locale: Locale(identifier: locale))
        }
        return SFSpeechRecognizer()
    }

    // MARK: - 权限

    @objc func requestSpeechPermissions(_ call: CAPPluginCall) {
        var speechStatus = "notDetermined"
        var micStatus = "notDetermined"
        let group = DispatchGroup()

        group.enter()
        SFSpeechRecognizer.requestAuthorization { status in
            switch status {
            case .authorized: speechStatus = "granted"
            case .denied: speechStatus = "denied"
            case .restricted: speechStatus = "restricted"
            default: speechStatus = "notDetermined"
            }
            group.leave()
        }

        group.enter()
        // 2026-09-20 三轮：真机 RMS=0 实锤「权限granted但音频为零」= TCC 实际拒绝
        // 而旧 requestRecordPermission 回调的是缓存值。改用 AVAudioApplication
        // 读真实 TCC 状态 + 埋点对照。
        if #available(iOS 17.0, *) {
            let real = AVAudioApplication.shared.recordPermission
            NSLog("[SRS] AVAudioApplication recordPermission = %@", String(describing: real))
            switch real {
            case .granted: micStatus = "granted"
            case .denied: micStatus = "denied"
            default: micStatus = "notDetermined"
            }
            group.leave()
        } else {
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                micStatus = granted ? "granted" : "denied"
                group.leave()
            }
        }

        group.notify(queue: .main) {
            call.resolve(["speech": speechStatus, "mic": micStatus])
        }
    }

    @objc func checkSupported(_ call: CAPPluginCall) {
        let recognizer = SFSpeechRecognizer()
        let supported = recognizer != nil && recognizer!.isAvailable
        let onDevice = recognizer?.supportsOnDeviceRecognition ?? false
        call.resolve(["supported": supported, "onDevice": onDevice])
    }

    // MARK: - 识别

    @objc func start(_ call: CAPPluginCall) {
        guard !isRunning else {
            call.reject("already running")
            return
        }
        guard let recognizer = makeRecognizer(call.getString("locale")) else {
            call.reject("recognizer unavailable for locale")
            return
        }
        guard recognizer.isAvailable else {
            call.reject("recognizer unavailable")
            return
        }
        self.recognizer = recognizer

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = call.getBool("partialResults", true)
        if #available(iOS 13.0, *) {
            request.requiresOnDeviceRecognition = call.getBool("onDevice", false)
        }
        recognitionRequest = request

        // 录音会话：AI 教练场景不需要扬声器播放，只录音。
        // 2026-09-20 修复 code=1110 No speech detected：.measurement 模式绕过
        // 系统语音处理链（AGC/回声消除全关），系统大版本更新后增益策略变化，
        // 语音进不了识别阈值 → 判定无语音。改 .default（保留语音处理）+
        // 允许蓝牙耳机麦克风路由（HFP），实测口径以 [SRS] 日志为准。
        // 三轮：进录音前显式读真实 TCC（与 requestSpeechPermissions 交叉验证）
        if #available(iOS 17.0, *) {
            NSLog("[SRS] pre-start recordPermission = %@", String(describing: AVAudioApplication.shared.recordPermission))
        }

        do {
            let session = AVAudioSession.sharedInstance()
            // 2026-09-20 二轮（tap RMS=0 实锤：缓冲在流但纯零 = 输入路由没给音频）：
            // ① 类目改 .playAndRecord + defaultToSpeaker（Apple WWDC 语音示例同款，
            //    单纯 .record 在部分系统版本上 input 路由不激活）
            // ② 输入锁定内置麦克风（防路由到不供流的远端设备，如手表/未激活的BT麦）
            // ③ 引擎 reset（防同进程二次 start 的零数据残态）
            try session.setCategory(.playAndRecord, mode: .default,
                                    options: [.duckOthers, .defaultToSpeaker])
            for input in session.availableInputs ?? [] {
                NSLog("[SRS] available input: %@ type=%@", input.portName, String(describing: input.portType.rawValue))
            }
            if let builtin = (session.availableInputs ?? []).first(where: { $0.portType == .builtInMic }) {
                try session.setPreferredInput(builtin)
                NSLog("[SRS] preferred input locked: builtInMic")
            }
            try session.setActive(true, options: .notifyOthersOnDeactivation)
            let route = session.currentRoute
            NSLog("[SRS] audio session ok inputs=%@ sampleRate=%.0f",
                  route.inputs.map { "\($0.portName)(\($0.portType.rawValue))" }, session.sampleRate)
        } catch {
            NSLog("[SRS] audio session FAILED: %@", error.localizedDescription)
            call.reject("audio session error: \(error.localizedDescription)")
            return
        }
        audioEngine.reset()

        let inputNode = audioEngine.inputNode
        // 2026-09-20 1110 排障：tap 格式改用 inputFormat（部分系统版本 outputFormat
        // 在 record 类目下返回 0 通道格式 → append 的是零帧静默 buffer → 1110）
        let recordingFormat = inputNode.inputFormat(forBus: 0)
        NSLog("[SRS] tap format: %@ ch=%d rate=%.0f",
              String(describing: recordingFormat.commonFormat), recordingFormat.channelCount, recordingFormat.sampleRate)
        // 音频电平诊断：累计 RMS，每 ~1s 打一次——区分「麦没进数据(RMS≈0)」
        // 与「数据健康但识别器不认」两种病灶
        var tapFrames: Int = 0
        var tapEnergy: Float = 0
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { [weak self] buffer, _ in
            self?.recognitionRequest?.append(buffer)
            let n = Int(buffer.frameLength)
            if n > 0 {
                let d = buffer.floatChannelData![0]
                var sum: Float = 0
                var i = 0
                while i < n { sum += d[i] * d[i]; i += 16 } // 抽样降CPU
                tapFrames += n
                tapEnergy += sum * 16
            }
            if tapFrames >= 48000 { // ~1s @48k
                let rms = (tapEnergy / Float(tapFrames)).squareRoot()
                NSLog("[SRS] level frames=%d rms=%.6f %@", tapFrames, rms,
                      rms < 0.0001 ? "<<<< SILENT (mic data not arriving)" : "(healthy)")
                tapFrames = 0
                tapEnergy = 0
            }
        }

        // 2026-09-20 四轮（权限grnt+路由正确+仍全零 → AVAudioEngine 渲染链陷阱）：
        // 只 installTap 而无任何节点连接时，inputNode 不会形成活跃 render path，
        // 部分 iOS 版本上 tap 恒吐零帧（Apple dev forums 确认的行为变化）。
        // 修法：input → mainMixer → output 连成完整链（音量为 0，不产生外放）。
        let mainMixer = audioEngine.mainMixerNode
        mainMixer.outputVolume = 0
        audioEngine.connect(inputNode, to: mainMixer, format: recordingFormat)
        do {
            audioEngine.prepare()
            try audioEngine.start()
        } catch {
            call.reject("audio engine start error: \(error.localizedDescription)")
            return
        }

        recognitionTask = recognizer.recognitionTask(with: request) { [weak self] result, error in
            guard let self = self else { return }
            var isFinal = false
            if let result = result {
                isFinal = result.isFinal
                let text = result.bestTranscription.formattedString
                NSLog("[SRS] result isFinal=%d text=%@", isFinal, text)
                if isFinal {
                    self.partialText = text
                    self.notifyListeners("onFinalResult", data: ["text": text])
                    self.stopEngine()
                } else {
                    self.partialText = text
                    self.notifyListeners("onPartialResult", data: ["text": text])
                }
            }
            if let error = error, !isFinal {
                NSLog("[SRS] recognitionTask ERROR domain=%@ code=%ld msg=%@",
                      (error as NSError).domain, (error as NSError).code, error.localizedDescription)
                // 错误必须走轮询通道可见（notifyListeners 真机不可靠，档案实锤）
                self.lastError = "\((error as NSError).domain) code=\((error as NSError).code): \(error.localizedDescription)"
                self.notifyListeners("onError", data: ["message": error.localizedDescription])
                self.stopEngine()
            }
        }

        isRunning = true
        partialText = ""
        call.resolve()
    }

    @objc func getPartialResult(_ call: CAPPluginCall) {
        var payload: [String: Any] = ["text": partialText, "running": isRunning]
        if let err = lastError {
            payload["error"] = err
            lastError = nil // 读即清
        }
        call.resolve(payload)
    }

    @objc func stop(_ call: CAPPluginCall) {
        // 结束音频输入，让识别器出最终结果（isFinal → onFinalResult 里统一收尾）
        recognitionRequest?.endAudio()
        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
        call.resolve()
    }

    @objc func cancel(_ call: CAPPluginCall) {
        recognitionTask?.cancel()
        stopEngine()
        call.resolve()
    }

    private func stopEngine() {
        guard isRunning else { return }
        isRunning = false
        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
        recognitionTask?.cancel()
        recognitionRequest = nil
        recognitionTask = nil
        recognizer = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
