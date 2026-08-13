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
        CAPPluginMethod(name: "setContinuous", returnType: CAPPluginReturnPromise),
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

    /// 認識器に「出てくる語」を教える（v22・実機FB「場所は一度目だけミスる」）。
    /// 欄指定発話（engine/parser.js の FIELD_KEYS）は**先頭の欄名が命**で、そこを外すと
    /// 通常発話として解釈され「場所」が入らない。contextualStrings でこれらの語に寄せる。
    private let fieldHints = ["場所", "メモ", "終了", "開始", "タイトル", "件名"]

    /// v44: 辞書の値（人名・社名などの正しい表記）。start() ごとに JS から渡される。
    /// 欄名（fieldHints）と足して contextualStrings に入れる＝欄名の優先度を落とさない。
    private var extraHints: [String] = []

    // MARK: - v82 長文モード（ゆう要求「おもったことを長文で吐き出したい／この会話に限り自動で止めない」）
    /// この録音だけ「無音で止めない」。録音中に JS から setContinuous で入る（start の引数ではない）。
    private var continuous = false
    /// 🔑 **SFSpeechRecognizer は1分前後で自分から確定して終わる**（Apple の既知の挙動）。
    /// 「止めない」だけでは長文がそこで切れるので、確定が来たら**その場で認識器を開き直し**、
    /// それまでの文章をここに積んで継ぎ足す。JS から見た契約は不変＝1回の録音＝1回の final。
    private var carried = ""
    /// 開き直しが空振りし続けた時の歯止め（認識器が壊れている＝無限に開き直さない）
    private var emptyRestarts = 0
    /// 長文モードの打ち切り上限。**マイクを握ったまま忘れる**のを防ぐ最後の砦（電池・プライバシー）。
    /// 打ち切っても**それまでの文章は確定として届く**＝黙って捨てない（v16）。
    private var maxTimer: Timer?
    private let maxContinuousSec: TimeInterval = 600 // 10分
    /// 🚨 開き直すと**古い認識タスクの通知が後から届く**（cancel 自体がエラーとして返ってくる）。
    /// それを「区切りが終わった」と読むと、また開き直して…＝**無限ループ**になる。
    /// 世代番号を照合して、今動いている認識のものだけを受ける（痕跡は診断へ＝黙って捨てない v16）。
    private var runId = 0

    private func debug(_ msg: String) {
        notifyListeners("debug", data: ["msg": msg])
    }

    /// 🔴 v22: オーディオセッションの**カテゴリだけ**を起動時に設定しておく（マイクは掴まない）。
    /// 実機FB「場所は一度目はミスるが2度目以降は急に理解する」の原因はここと見ている:
    /// 毎回 cleanup で setActive(false) → 次の start でセッションが冷えており、
    /// マイクが録り始めるまでの数百 ms で**冒頭の「場所」が欠ける** → 欄指定として解釈されない。
    /// 2度目以降は直前まで動いていたぶん立ち上がりが速く、冒頭が録れる＝「急に理解する」の正体。
    /// カテゴリ設定を前倒しすると setActive の実費が減り、初回の欠けが縮む。
    public override func load() {
        try? AVAudioSession.sharedInstance().setCategory(.record, mode: .measurement, options: .duckOthers)
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
        // v44: 辞書の**値**（正しい表記）を認識器に教える＝そもそも「今井」と認識されるようにする。
        // 辞書が後から直す（v37/v44）のと段階的に噛み合う: 一度直して登録した固有名詞が、
        // 次からは認識の時点で当たるようになる。JS 側が上限件数まで絞って渡す。
        extraHints = (call.getArray("hints", String.self) ?? [])
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
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
            self.continuous = false        // 止めると言われた＝もう開き直さない（この1行が無いと止まらない）
            self.maxTimer?.invalidate()
            self.maxTimer = nil
            self.endAudioAndArmFinalize()
            call.resolve()
        }
    }

    /// v82: この録音だけ「無音で止めない」。**録音中に**呼ばれる（JS の一時オーバーライド）。
    /// 一方通行にしない＝false で普段の無音停止に戻る（入った袋小路から出られる）。
    @objc func setContinuous(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? false
        DispatchQueue.main.async {
            // 録音していない時に触られても何もしない（無音タイマーだけが動き出して
            // 「録っていないのに聞き取れませんでした」を出す、という嘘を作らない）
            guard self.task != nil, !self.finished else {
                self.debug("長文モード: 録音中でないため無視")
                call.resolve()
                return
            }
            self.continuous = on
            if on {
                self.silenceTimer?.invalidate()   // 動いている無音タイマーをその場で外す
                self.silenceTimer = nil
                self.armMaxTimer()
                self.debug("長文モード ON（無音で止めない・上限\(Int(self.maxContinuousSec))s）")
            } else {
                self.maxTimer?.invalidate()
                self.maxTimer = nil
                self.armSilenceTimer(seconds: self.silenceSec) // 普段の動きへ戻す
                self.debug("長文モード OFF（無音\(String(format: "%.1f", self.silenceSec))s で確定）")
            }
            call.resolve()
        }
    }

    // MARK: - 本体（main thread）

    private func begin(_ call: CAPPluginCall) {
        cleanup()
        finished = false
        lastPartial = ""
        continuous = false   // v82: 「この録音だけ」＝録音ごとにリセット（JS の recOverride と同じ約束）
        carried = ""
        emptyRestarts = 0

        guard let recognizer = recognizer, recognizer.isAvailable else {
            call.reject("音声認識が利用できません（Siri と音声入力の設定・ネットワークを確認）")
            return
        }

        let t0 = Date() // 起動〜録音開始の実測用（v22）
        do {
            let session = AVAudioSession.sharedInstance()
            // カテゴリは load() で設定済み。冷えていた場合の保険として再設定（同じ値なら安い）
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)

            debug("🎙 語彙ヒント 欄名=\(fieldHints.count) 辞書=\(extraHints.count)")
            let onDevice = recognizer.supportsOnDeviceRecognition

            let engine = AVAudioEngine()
            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            // 🔴 v31: 完全終了→Siri 起動の一瞬は、Siri がまだ audio session（マイク）を握っていて、
            // 入力フォーマットが sampleRate=0 の無効値になることがある。その format で installTap すると
            // **NSException（Swift の do/catch では捕まらない）でプロセスごとクラッシュ**する
            // ＝実機症状「待機（バックグラウンド）からは開けるが、完全終了だと Siri 起動でクラッシュ」の正体。
            // → 無効なら installTap せず graceful に中止。JS 側が数百 ms 後にリトライ＝HW が温まれば録れる。
            // この guard は安全（正常な format なら従来どおり・異常時だけクラッシュを回避）。
            guard format.sampleRate > 0, format.channelCount > 0 else {
                debug("マイク未準備 sr=\(format.sampleRate) ch=\(format.channelCount) → 中止（起動直後にSiriがHWを解放中の可能性）")
                cleanup()
                notifyListeners("state", data: ["state": "idle"])
                call.reject("マイクの準備ができていません（もう一度）", "AUDIO_NOT_READY")
                return
            }
            // 🔑 v82: **その時点の request** に流し込む（req を掴まない）。長文モードでは認識器を
            // 開き直して request を差し替えるので、掴んでいると音が古い request に流れ続けて
            // 「録音中なのに何も認識されない」になる。差し替えは同じ main スレッドで一瞬＝音は途切れない。
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
                self?.request?.append(buffer)
            }
            engine.prepare()
            try engine.start()

            audioEngine = engine
            guard startRecognition() else {
                cleanup()
                notifyListeners("state", data: ["state": "idle"])
                call.reject("音声認識を開始できません")
                return
            }
            notifyListeners("state", data: ["state": "listening"])
            // 起動〜録音開始までの実測（v22）: 実機FB「場所は一度目だけミスる」の裏取り用。
            // 初回だけ warm が大きければ「冒頭が欠けて欄名を落としている」仮説の証拠になる。
            let warmMs = Int(Date().timeIntervalSince(t0) * 1000)
            debug("開始 onDevice=\(onDevice) 無音\(String(format: "%.1f", silenceSec))s 起動\(warmMs)ms")
            armSilenceTimer(seconds: 6.0) // 一言も聞こえないまま6秒 → 打ち切り（設定とは別）
            call.resolve()
        } catch {
            cleanup()
            notifyListeners("state", data: ["state": "idle"])
            call.reject("録音を開始できません: \(error.localizedDescription)")
        }
    }

    /// 認識だけを（開き）直す。**音声エンジンには触らない**＝マイクは握ったまま request だけ差し替える。
    /// v82 で begin() から切り出した。切り出す前は task の生成が begin の中にしか無く、
    /// 「認識器が自分で終わったら開き直す」を書く場所が無かった。
    @discardableResult
    private func startRecognition() -> Bool {
        guard let recognizer = recognizer, recognizer.isAvailable else { return false }
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        // 欄名に寄せる（v22）＋辞書の値に寄せる（v44）。欄名が先＝欄指定発話の成否を守る
        req.contextualStrings = fieldHints + extraHints
        if recognizer.supportsOnDeviceRecognition {
            req.requiresOnDeviceRecognition = true // ローカル完結（対応端末・対応言語なら）
        }
        runId += 1
        let myRun = runId        // この認識の世代（古い task の通知を見分ける）
        task?.cancel()
        request = req
        task = recognizer.recognitionTask(with: req) { [weak self] result, error in
            guard let self = self else { return }
            DispatchQueue.main.async {
                guard myRun == self.runId else {
                    // 差し替えた古い認識からの通知。ここを通すと開き直しが連鎖して止まらなくなる。
                    if error != nil { self.debug("古い認識の通知を無視（世代\(myRun)）") }
                    return
                }
                if let result = result {
                    let text = result.bestTranscription.formattedString
                    if result.isFinal {
                        self.debug("isFinal 到着")
                        if self.continuous {
                            self.rotateSegment(text)   // v82: 終わらせずに継ぎ足して開き直す
                        } else {
                            self.deliverFinal(text: text, transcription: result.bestTranscription, fallback: false)
                        }
                    } else {
                        self.lastPartial = text
                        // 長文モードでは**これまでの合計**を見せる（画面が「今の断片」だけになると、
                        // 話した分が消えたように見える＝黙って捨てたのと同じ体験になる・v16）
                        self.notifyListeners("interim", data: ["text": self.carried + text])
                        self.armSilenceTimer(seconds: self.silenceSec) // 部分結果が止まって N 秒 → 発話終わり
                    }
                }
                if let error = error {
                    let ns = error as NSError
                    self.debug("認識エラー \(ns.domain)#\(ns.code)")
                    // v82: 長文モードでは、認識器が自分の上限や無言で終わるのは**普通のこと**＝
                    // 開き直して続ける。ただし何も拾えないまま繰り返すなら本当の故障＝正直に終わる。
                    if self.continuous && !self.finished {
                        self.rotateSegment(self.lastPartial)
                        return
                    }
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
        return true
    }

    /// v82: 認識器が1区切りを終えた（無音・自分の上限・エラー）→ **終わらせずに継ぎ足して開き直す**。
    private func rotateSegment(_ text: String) {
        guard continuous, !finished else { return }
        let seg = text.isEmpty ? lastPartial : text
        if seg.isEmpty {
            emptyRestarts += 1
            // 3回続けて何も拾えない＝認識器が本当に死んでいる。**黙って回り続けない**（v16）
            if emptyRestarts >= 3 {
                debug("長文モード: 3回続けて空 → 打ち切り")
                continuous = false
                endAudioAndArmFinalize()
                return
            }
        } else {
            emptyRestarts = 0
            carried += seg
        }
        lastPartial = ""
        silenceTimer?.invalidate()
        silenceTimer = nil
        debug("継ぎ足し len=\(seg.count) 合計=\(carried.count)")
        notifyListeners("interim", data: ["text": carried])
        if !startRecognition() {
            debug("長文モード: 開き直せず → 確定")
            continuous = false
            deliverFinal(text: "", transcription: nil, fallback: true)
        }
    }

    /// 長文モードの打ち切り上限（握ったまま忘れるのを防ぐ最後の砦）。**それまでの文章は確定として届く**。
    private func armMaxTimer() {
        maxTimer?.invalidate()
        maxTimer = Timer.scheduledTimer(withTimeInterval: maxContinuousSec, repeats: false) { [weak self] _ in
            guard let self = self, !self.finished else { return }
            self.debug("長文モード: 上限\(Int(self.maxContinuousSec))s → 確定（ここまでを届ける）")
            self.continuous = false
            self.endAudioAndArmFinalize()
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
        // v82: 長文モードで継ぎ足してきた分を必ず前に付ける。**最後の区切りが空でも
        // これまでの文章は届く**（carried があれば下の空チェックも通る）＝黙って捨てない。
        let finalText = carried + (usePartial ? lastPartial : text)
        debug("確定 len=\(text.count) partial=\(lastPartial.count) 継ぎ足し=\(carried.count)\(usePartial ? " → 途中結果で補完" : "")")

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
        silenceTimer = nil
        // v82: 長文モードは「無音で止めない」＝**ここで張らないのが唯一の実装**（呼び出し側に
        // if を撒くと、新しい呼び出し口が増えた日に片方だけ止まる＝v74 と同じ形になる）。
        guard !continuous else { return }
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
        maxTimer?.invalidate()
        maxTimer = nil
        continuous = false   // v82: 次の録音に長文モードを持ち越さない（「この録音だけ」）
        if let engine = audioEngine {
            engine.stop()
            engine.inputNode.removeTap(onBus: 0)
        }
        audioEngine = nil
        request = nil
        task?.cancel()
        task = nil
        // セッションは必ず手放す（マイク使用中インジケータを残さない＝ローカル完結の思想 SPEC §2）。
        // 立ち上がりの速さは load() のカテゴリ前倒しで稼ぐ（繋ぎっぱなしにはしない）。
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
