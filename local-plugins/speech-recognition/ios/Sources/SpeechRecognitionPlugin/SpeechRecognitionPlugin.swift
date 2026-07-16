import Foundation
import Capacitor
import Speech
import AVFoundation

/// 転写層の native 実装（SPEC §5-①）: SFSpeechRecognizer による日本語転写。
///
/// 契約（input/transcriber.js の native 分岐と一致させる）:
///   start() / stop() … 1回の start = 1発話
///   イベント: "interim" {text} / "final" {text, confidence?, fallback?} / "state" {state}
///             / "error" {message} / "debug" {msg}（診断パネル用・Mac なし開発の「目」）
///
/// 方針:
/// - **オンデバイス優先**（supportsOnDeviceRecognition なら requiresOnDeviceRecognition = true）
///   ＝ローカル完結（SPEC §2）。音声データを外部に送らない。
/// - **無音で自動停止**: 部分結果が止まって 1.8 秒で endAudio()。
/// - 🔴 **確定の保険（v15・実機FBで判明）**: オンデバイス認識は endAudio() しても
///   **isFinal が返ってこないことがある**（iOS の既知の癖。実機で「途中結果は出るのに
///   確定だけ来ない」＝短い発話だけ認識器が自力確定し、長い発話が全滅していた真因）。
///   → endAudio 後 2 秒待って final が来なければ、**最後の途中結果を確定として届ける**
///   （fallback=true を付けて来歴で区別できるようにする）。エラー時も同じ保険を使う。
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
    private var finalizeTimer: Timer?
    private var lastPartial = ""      // 確定の保険に使う最後の途中結果
    private var finished = false      // final/error を JS へ二重に流さないためのガード
    /// 話し終わってから確定するまでの無音（秒）。JS の詳細設定 silenceMs から渡る（v19）。
    /// 既定 1.8s は v15/v16 の決め打ち＝「長い=待たされる/短い=切られる」は実機でしか分からないと
    /// 明言していた箇所なので、ユーザーが自分で調整できるようにした。
    private var silenceSec: TimeInterval = 1.8

    private func debug(_ msg: String) {
        notifyListeners("debug", data: ["msg": msg])
    }

    @objc func available(_ call: CAPPluginCall) {
        call.resolve([
            "available": recognizer?.isAvailable ?? false,
            "onDevice": recognizer?.supportsOnDeviceRecognition ?? false
        ])
    }

    @objc func start(_ call: CAPPluginCall) {
        // 詳細設定（v19）。範囲外は既定に丸める＝壊れた設定でも動く
        if let ms = call.getDouble("silenceMs"), ms >= 500, ms <= 10000 {
            silenceSec = ms / 1000
        }
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

    /// 手動停止（トグル）。endAudio → final を待ち、来なければ保険が確定する
    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.debug("stop() 手動停止")
            self.endAudioAndArmFinalize()
            call.resolve()
        }
    }

    // MARK: - 本体（main thread）

    private func begin(_ call: CAPPluginCall) {
        cleanup()
        finished = false
        lastPartial = ""

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
            let onDevice = recognizer.supportsOnDeviceRecognition
            if onDevice {
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
            debug("開始 onDevice=\(onDevice) 無音\(String(format: "%.1f", silenceSec))s")
            armSilenceTimer(seconds: 6.0) // 一言も聞こえないまま6秒 → 打ち切り（設定とは別）

            task = recognizer.recognitionTask(with: req) { [weak self] result, error in
                guard let self = self else { return }
                DispatchQueue.main.async {
                    if let result = result {
                        let text = result.bestTranscription.formattedString
                        if result.isFinal {
                            self.debug("isFinal 到着")
                            self.deliverFinal(text: text, transcription: result.bestTranscription, fallback: false)
                        } else {
                            self.lastPartial = text
                            self.notifyListeners("interim", data: ["text": text])
                            self.armSilenceTimer(seconds: self.silenceSec) // 部分結果が止まって N 秒 → 発話終わり
                        }
                    }
                    if let error = error {
                        let ns = error as NSError
                        self.debug("認識エラー \(ns.domain)#\(ns.code)")
                        // 🔴 保険: エラーで閉じても途中結果があればそれを確定にする
                        // （オンデバイス認識は endAudio 後に isFinal でなくエラーで終わることがある）
                        if !self.finished && !self.lastPartial.isEmpty {
                            self.deliverFinal(text: self.lastPartial, transcription: nil, fallback: true)
                        } else {
                            self.deliverIdleError(error.localizedDescription)
                        }
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

    /// endAudio ＋「final が来なければ保険で確定」タイマー
    /// ⚠️ ここで audioEngine.stop() を呼ばないこと（v15 で追加して v16 で撤回）:
    /// endAudio 直後にエンジンを止めると認識器の確定処理を妨げる恐れがある。
    /// エンジンの停止は確定を届けた後の cleanup() が行う。
    private func endAudioAndArmFinalize() {
        request?.endAudio()
        finalizeTimer?.invalidate()
        finalizeTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: false) { [weak self] _ in
            guard let self = self, !self.finished else { return }
            self.debug("final 待ちタイムアウト → 途中結果で確定")
            if !self.lastPartial.isEmpty {
                self.deliverFinal(text: self.lastPartial, transcription: nil, fallback: true)
            } else {
                self.deliverIdleError("聞き取れませんでした")
            }
        }
    }

    /// 🔴 v16（実機の診断ログで判明）: **isFinal は届くのに来歴が空**だった。
    /// 犯人は「確定テキストが空なら黙って捨てる」というここの guard。
    /// iOS は endAudio 後に **空の確定結果**を返すことがある（途中結果には文字があるのに）。
    /// → 空なら **最後の途中結果で補う**。両方空の時だけエラーにする＝**絶対に黙って捨てない**。
    private func deliverFinal(text: String, transcription: SFTranscription?, fallback: Bool) {
        guard !finished else { return }
        let usePartial = text.isEmpty && !lastPartial.isEmpty
        let finalText = usePartial ? lastPartial : text
        debug("確定 len=\(text.count) partial=\(lastPartial.count)\(usePartial ? " → 途中結果で補完" : "")")

        if finalText.isEmpty {
            // 空を握り潰さない: 画面（診断・toast）に必ず出す
            deliverIdleError("聞き取れませんでした（確定テキストが空）")
            return
        }

        finished = true
        var data: [String: Any] = ["text": finalText]
        if fallback || usePartial { data["fallback"] = true }
        if let transcription = transcription, !usePartial {
            // segment 平均の確度（オンデバイスでは 0 のことがある → その時は送らない）
            let confs = transcription.segments.map { Double($0.confidence) }
            if !confs.isEmpty {
                let avg = confs.reduce(0, +) / Double(confs.count)
                if avg > 0 { data["confidence"] = avg }
            }
        }
        cleanup()
        notifyListeners("final", data: data)
        notifyListeners("state", data: ["state": "idle"])
    }

    private func deliverIdleError(_ message: String) {
        guard !finished else { return }
        finished = true
        cleanup()
        notifyListeners("state", data: ["state": "idle"])
        notifyListeners("error", data: ["message": message])
    }

    /// 無音タイマー: 発火したら endAudio ＋ 保険タイマー
    private func armSilenceTimer(seconds: TimeInterval) {
        silenceTimer?.invalidate()
        silenceTimer = Timer.scheduledTimer(withTimeInterval: seconds, repeats: false) { [weak self] _ in
            self?.debug("無音\(seconds)s → endAudio")
            self?.endAudioAndArmFinalize()
        }
    }

    private func cleanup() {
        silenceTimer?.invalidate()
        silenceTimer = nil
        finalizeTimer?.invalidate()
        finalizeTimer = nil
        if let engine = audioEngine {
            engine.stop()
            engine.inputNode.removeTap(onBus: 0)
        }
        audioEngine = nil
        request = nil
        task?.cancel()
        task = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
