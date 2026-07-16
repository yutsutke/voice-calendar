import Foundation
import Capacitor
import Speech
import AVFoundation

/// 転写層の native 実装（SPEC §5-①）: SFSpeechRecognizer による日本語転写。
///
/// 契約（input/transcriber.js の native 分岐と一致させる）:
///   start() / stop() … 1回の start = 1発話
///   イベント: "interim" {text} / "final" {text, confidence?} / "state" {state} / "error" {message}
///
/// 方針:
/// - **オンデバイス優先**（supportsOnDeviceRecognition なら requiresOnDeviceRecognition = true）
///   ＝ローカル完結（SPEC §2）。音声データを外部に送らない。
/// - **無音で自動停止**: WebSpeech（continuous=false）と同じ「話し終わったら勝手に確定」の
///   手触りに揃える。部分結果が止まって 1.8 秒で endAudio() → final が飛ぶ。
///   何も聞き取れないまま 6 秒経ったら打ち切る（ノールックの前提＝手で止めさせない）。
@objc(SpeechRecognitionPlugin)
public class SpeechRecognitionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SpeechRecognitionPlugin"
    public let jsName = "SpeechRecognition"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise)
    ]

    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "ja-JP"))
    private var audioEngine: AVAudioEngine?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var silenceTimer: Timer?
    private var finished = false // final/error を JS へ二重に流さないためのガード

    @objc func available(_ call: CAPPluginCall) {
        call.resolve([
            "available": recognizer?.isAvailable ?? false,
            "onDevice": recognizer?.supportsOnDeviceRecognition ?? false
        ])
    }

    @objc func start(_ call: CAPPluginCall) {
        SFSpeechRecognizer.requestAuthorization { [weak self] auth in
            guard let self = self else { return }
            guard auth == .authorized else {
                call.reject("音声認識が許可されていません（設定 > プライバシー > 音声認識）", "PERMISSION_DENIED")
                return
            }
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                guard granted else {
                    call.reject("マイクが許可されていません（設定 > プライバシー > マイク）", "PERMISSION_DENIED")
                    return
                }
                DispatchQueue.main.async { self.begin(call) }
            }
        }
    }

    /// 発話中でも呼べる手動停止（トグル）。endAudio → 認識器が final を返して閉じる
    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.request?.endAudio()
            call.resolve()
        }
    }

    // MARK: - 本体（main thread）

    private func begin(_ call: CAPPluginCall) {
        cleanup() // 前回分の掃除（多重 start 保険）
        finished = false

        guard let recognizer = recognizer, recognizer.isAvailable else {
            call.reject("音声認識が利用できません（Siri と音声入力の設定・ネットワークを確認）")
            return
        }

        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)

            let req = SFSpeechAudioBufferRecognitionRequest()
            req.shouldReportPartialResults = true
            if recognizer.supportsOnDeviceRecognition {
                req.requiresOnDeviceRecognition = true // ローカル完結（対応端末・対応言語なら）
            }

            let engine = AVAudioEngine()
            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
                req.append(buffer)
            }
            engine.prepare()
            try engine.start()

            audioEngine = engine
            request = req
            notifyListeners("state", data: ["state": "listening"])
            armSilenceTimer(seconds: 6.0) // 無音のまま6秒 → 打ち切り

            task = recognizer.recognitionTask(with: req) { [weak self] result, error in
                guard let self = self else { return }
                DispatchQueue.main.async {
                    if let result = result {
                        let text = result.bestTranscription.formattedString
                        if result.isFinal {
                            self.deliverFinal(text: text, transcription: result.bestTranscription)
                        } else {
                            self.notifyListeners("interim", data: ["text": text])
                            self.armSilenceTimer(seconds: 1.8) // 部分結果が止まって1.8秒 → 発話終わり
                        }
                    }
                    if let error = error {
                        self.deliverError(error)
                    }
                }
            }
            call.resolve()
        } catch {
            cleanup()
            notifyListeners("state", data: ["state": "idle"])
            call.reject("録音を開始できません: \(error.localizedDescription)")
        }
    }

    private func deliverFinal(text: String, transcription: SFTranscription) {
        guard !finished else { return }
        finished = true
        var data: [String: Any] = ["text": text]
        // segment 平均の確度（オンデバイスでは 0 のことがある → その時は送らない）
        let confs = transcription.segments.map { Double($0.confidence) }
        if !confs.isEmpty {
            let avg = confs.reduce(0, +) / Double(confs.count)
            if avg > 0 { data["confidence"] = avg }
        }
        cleanup()
        if !text.isEmpty { notifyListeners("final", data: data) }
        notifyListeners("state", data: ["state": "idle"])
    }

    private func deliverError(_ error: Error) {
        guard !finished else { return }
        finished = true
        cleanup()
        notifyListeners("state", data: ["state": "idle"])
        // 無音打ち切り等で「結果なし」のエラーが返るのは正常系に近い → error イベントは出すが短文で
        notifyListeners("error", data: ["message": error.localizedDescription])
    }

    /// 無音タイマー: 発火したら endAudio()（→ 認識器が final を確定して閉じる）
    private func armSilenceTimer(seconds: TimeInterval) {
        silenceTimer?.invalidate()
        silenceTimer = Timer.scheduledTimer(withTimeInterval: seconds, repeats: false) { [weak self] _ in
            self?.request?.endAudio()
        }
    }

    private func cleanup() {
        silenceTimer?.invalidate()
        silenceTimer = nil
        if let engine = audioEngine {
            engine.stop()
            engine.inputNode.removeTap(onBus: 0)
        }
        audioEngine = nil
        request = nil
        task = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
