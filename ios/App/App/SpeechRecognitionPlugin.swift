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
        AVAudioSession.sharedInstance().requestRecordPermission { granted in
            micStatus = granted ? "granted" : "denied"
            group.leave()
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

        // 录音会话：AI 教练场景不需要扬声器播放，只录音
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: [.duckOthers])
            try session.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            call.reject("audio session error: \(error.localizedDescription)")
            return
        }

        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { [weak self] buffer, _ in
            self?.recognitionRequest?.append(buffer)
        }

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
                self.notifyListeners("onError", data: ["message": error.localizedDescription])
                self.stopEngine()
            }
        }

        isRunning = true
        partialText = ""
        call.resolve()
    }

    @objc func getPartialResult(_ call: CAPPluginCall) {
        call.resolve(["text": partialText, "running": isRunning])
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
