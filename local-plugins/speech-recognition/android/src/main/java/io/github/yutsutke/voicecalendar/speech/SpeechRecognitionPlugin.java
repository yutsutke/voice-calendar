package io.github.yutsutke.voicecalendar.speech;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;
import java.util.Arrays;

/**
 * 転写層の Android native 実装（SPEC §5-①）: android.speech.SpeechRecognizer による日本語転写。
 *
 * 契約（input/transcriber.js の native 分岐と一致させる＝iOS の SpeechRecognitionPlugin.swift と同じ）:
 *   start({silenceMs?, hints?}) / stop() / available() … 1回の start = 1発話
 *   イベント: "interim" {text} / "final" {text, confidence?, fallback?} / "state" {state}
 *             / "error" {message} / "debug" {msg}（診断パネル用＝実機開発の「目」）
 *
 * iOS 版から引き継ぐ設計（v15/v16 の実機バグで買った知見・Android でも同じ构造で守る）:
 * - 無音で自動停止: 部分結果が止まって silenceMs（既定1.8s）で stopListening()。
 *   Android 自身のエンドポインティング（onEndOfSpeech→onResults）もあるが、
 *   EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS は Google 実装が無視することが多い
 *   ＝自前タイマーが正（iOS と同じ発想）。
 * - 確定の保険（v15）: stopListening 後 2 秒待って onResults が来なければ最後の途中結果で確定
 *   （fallback=true 付き）。エラーで閉じた時も途中結果があればそれを確定にする。
 * - 🔴 黙って捨てない（v16）: 確定テキストが空なら最後の途中結果で補い、両方空の時だけ
 *   エラーとして表に出す。診断に「確定 len=N partial=M」の数字を出す。
 *
 * Android 固有の注意:
 * - SpeechRecognizer の生成・操作はメインスレッド必須 → Handler(mainLooper) に寄せる。
 * - オンデバイス認識: 初版は**システム既定の認識サービス**を使う（端末により on-device / クラウド）。
 *   API 31+ の createOnDeviceSpeechRecognizer は ja モデル未取得だと失敗する等の分岐が増えるため、
 *   まず既定サービスで実機の挙動を診断ログで観察してから硬化する（診断駆動＝このプロジェクトの流儀）。
 *   on-device 対応の有無は debug に出す。
 * - 語彙ヒント（v22/v44 の contextualStrings 相当）: API 33+ の EXTRA_BIASING_STRINGS に渡す。
 *   それ未満の端末では効かない（無視されるだけ＝壊れない）。
 */
@CapacitorPlugin(
    name = "SpeechRecognition",
    permissions = { @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "microphone") }
)
public class SpeechRecognitionPlugin extends Plugin {

    private final Handler main = new Handler(Looper.getMainLooper());
    private SpeechRecognizer recognizer;
    private String lastPartial = "";      // 確定の保険に使う最後の途中結果
    private boolean finished = false;     // final/error を JS へ二重に流さないためのガード
    private long silenceMs = 1800;        // v19 の詳細設定 silenceMs から渡る（既定 1.8s）
    private ArrayList<String> extraHints = new ArrayList<>(); // v44: 辞書の値（正しい表記）
    private Runnable silenceRunnable;
    private Runnable finalizeRunnable;
    private long t0; // 起動〜録音開始の実測用（v22「場所は一度目だけミスる」の裏取り）

    // ---- v82 長文モード（ゆう要求「長文で吐き出したい／この会話に限り自動で止めない」）----
    /** この録音だけ「無音で止めない」。録音中に JS から setContinuous で入る（start の引数ではない） */
    private boolean continuous = false;
    /** 🔑 Android の SpeechRecognizer も**1回の startListening で長くは持たない**（無言や上限で
     *  onResults/onError を返して終わる）。「止めない」だけでは長文がそこで切れるので、
     *  終わったら**その場で startListening し直し**、それまでの文章をここに積んで継ぎ足す。
     *  JS から見た契約は不変＝1回の録音＝1回の final。 */
    private String carried = "";
    /** 開き直しが**空のまま高速に回り続ける**時の歯止め（沈黙は正常＝回数でなく間隔で見る・v83） */
    private int emptyRestarts = 0;
    private long lastRestartMs = 0;
    private static final long SPIN_MS = 500; // これ未満の間隔で空振りが続く＝認識器が壊れている
    /** 開き直しに使う Intent（begin で組んだものを取っておく＝設定が1回の録音の中でブレない） */
    private Intent listenIntent;
    private Runnable maxRunnable;
    private static final long MAX_CONTINUOUS_MS = 600000; // 10分＝マイクを握ったまま忘れる事故の最後の砦

    /** 欄指定発話の欄名（engine/parser.js の FIELD_KEYS と揃える＝iOS の fieldHints と同一） */
    private static final String[] FIELD_HINTS = { "場所", "メモ", "終了", "開始", "タイトル", "件名" };

    private void debug(String msg) {
        JSObject d = new JSObject();
        d.put("msg", msg);
        notifyListeners("debug", d);
    }

    private void emitState(String s) {
        JSObject d = new JSObject();
        d.put("state", s);
        notifyListeners("state", d);
    }

    @PluginMethod
    public void available(PluginCall call) {
        JSObject out = new JSObject();
        out.put("available", SpeechRecognizer.isRecognitionAvailable(getContext()));
        out.put("onDevice", Build.VERSION.SDK_INT >= 31
            && SpeechRecognizer.isOnDeviceRecognitionAvailable(getContext()));
        call.resolve(out);
    }

    @PluginMethod
    public void start(PluginCall call) {
        // 詳細設定（v19）。範囲外は既定に丸める＝壊れた設定でも動く
        // ℹ️ ここは getDouble で正しい: Capacitor の getDouble は Integer/Float/Double しか通さず
        //    **Long を落とす**（v66 で calendar 側が全滅した罠）が、silenceMs は 500〜10000 ＝
        //    org.json が必ず Integer で持つ範囲。**ms エポックのような大きい値をここに増やすなら
        //    CalendarEventsPlugin.msOf() と同じ Number 経由の読み方に変えること。**
        Double ms = call.getDouble("silenceMs");
        if (ms != null && ms >= 500 && ms <= 10000) silenceMs = ms.longValue();
        // v44: 辞書の値（人名・社名などの正しい表記）を認識器に教える。JS 側が上限件数まで絞って渡す
        extraHints = new ArrayList<>();
        try {
            JSArray hints = call.getArray("hints");
            if (hints != null) {
                for (int i = 0; i < hints.length(); i++) {
                    String h = String.valueOf(hints.get(i)).trim();
                    if (!h.isEmpty()) extraHints.add(h);
                }
            }
        } catch (Exception ignored) { /* hints は補助＝壊れていても録音は始める */ }

        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "micPermCallback");
            return;
        }
        main.post(() -> begin(call));
    }

    @PermissionCallback
    private void micPermCallback(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            main.post(() -> begin(call));
        } else {
            call.reject("マイクが許可されていません（設定 > アプリ > ボイスカレンダー > 権限）", "PERMISSION_DENIED");
        }
    }

    /** 手動停止（トグル）。stopListening → onResults を待ち、来なければ保険が確定する */
    @PluginMethod
    public void stop(PluginCall call) {
        main.post(() -> {
            debug("stop() 手動停止");
            continuous = false;   // 止めると言われた＝もう開き直さない（この1行が無いと止まらない）
            clearMaxTimer();
            endAudioAndArmFinalize();
            call.resolve();
        });
    }

    /**
     * v82: この録音だけ「無音で止めない」。**録音中に**呼ばれる（JS の一時オーバーライド）。
     * 一方通行にしない＝false で普段の無音停止に戻る（入った袋小路から出られる）。
     * ℹ️ getBool は Boolean しか通さない（v66 の型の罠は数値の話＝ここは該当しない）。
     */
    @PluginMethod
    public void setContinuous(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", Boolean.FALSE));
        main.post(() -> {
            // 録音していない時に触られても何もしない（無音タイマーだけが動き出して
            // 「録っていないのに聞き取れませんでした」を出す、という嘘を作らない）
            if (recognizer == null || finished) {
                debug("長文モード: 録音中でないため無視");
                call.resolve();
                return;
            }
            continuous = on;
            if (on) {
                if (silenceRunnable != null) { main.removeCallbacks(silenceRunnable); silenceRunnable = null; }
                armMaxTimer();
                debug("長文モード ON（無音で止めない・上限" + (MAX_CONTINUOUS_MS / 1000) + "s）");
            } else {
                clearMaxTimer();
                armSilence(silenceMs); // 普段の動きへ戻す
                debug("長文モード OFF（無音"
                    + String.format(java.util.Locale.ROOT, "%.1f", silenceMs / 1000.0) + "s で確定）");
            }
            call.resolve();
        });
    }

    // ---- 本体（main thread） ----

    private void begin(PluginCall call) {
        cleanup();
        finished = false;
        lastPartial = "";
        continuous = false;   // v82: 「この録音だけ」＝録音ごとにリセット（JS の recOverride と同じ約束）
        carried = "";
        emptyRestarts = 0;

        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
            call.reject("音声認識が利用できません（Google アプリと音声入力の設定を確認）");
            return;
        }

        t0 = System.currentTimeMillis();
        try {
            recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
            recognizer.setRecognitionListener(makeListener());

            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ja-JP");
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
            // 参考値として渡す（Google 実装は無視することが多い＝上の自前タイマーが正）
            intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, silenceMs);
            // 欄名に寄せる（v22）＋辞書の値に寄せる（v44）。欄名が先＝欄指定発話の成否を守る
            if (Build.VERSION.SDK_INT >= 33) {
                ArrayList<String> biasing = new ArrayList<>(Arrays.asList(FIELD_HINTS));
                biasing.addAll(extraHints);
                intent.putExtra(RecognizerIntent.EXTRA_BIASING_STRINGS, biasing);
            }

            boolean onDeviceAvail = Build.VERSION.SDK_INT >= 31
                && SpeechRecognizer.isOnDeviceRecognitionAvailable(getContext());

            listenIntent = intent;   // v82: 開き直す時に同じ設定で聞き直す（1回の録音の中でブレない）
            recognizer.startListening(intent);
            emitState("listening");
            long warmMs = System.currentTimeMillis() - t0;
            debug("🎙 語彙ヒント 欄名=" + FIELD_HINTS.length + " 辞書=" + extraHints.size()
                + (Build.VERSION.SDK_INT >= 33 ? "" : "（API<33＝ヒント非対応）"));
            debug("開始 onDevice対応=" + onDeviceAvail + "（初版は既定サービス使用） 無音"
                + String.format(java.util.Locale.ROOT, "%.1f", silenceMs / 1000.0) + "s 起動" + warmMs + "ms");
            armSilence(6000); // 一言も聞こえないまま6秒 → 打ち切り（iOS と同じ・Android 自身の SPEECH_TIMEOUT も別途ある）
            call.resolve();
        } catch (Exception e) {
            cleanup();
            emitState("idle");
            call.reject("録音を開始できません: " + e.getMessage());
        }
    }

    private RecognitionListener makeListener() {
        return new RecognitionListener() {
            @Override public void onReadyForSpeech(Bundle params) {
                debug("readyForSpeech " + (System.currentTimeMillis() - t0) + "ms");
            }
            @Override public void onBeginningOfSpeech() { debug("発話検出"); }
            @Override public void onRmsChanged(float rmsdB) {}
            @Override public void onBufferReceived(byte[] buffer) {}
            @Override public void onEndOfSpeech() { debug("endOfSpeech（認識器が発話終了を検出）"); }

            @Override public void onError(int error) {
                main.post(() -> {
                    debug("認識エラー #" + error + " " + errorName(error));
                    // v82: 長文モードでは、無言（#6/#7）や上限で終わるのは**普通のこと**＝
                    // 開き直して続ける。何も拾えないまま繰り返すなら本当の故障＝正直に終わる。
                    if (continuous && !finished) { rotateSegment(lastPartial); return; }
                    // 🔴 保険: エラーで閉じても途中結果があればそれを確定にする（iOS と同じ）
                    if (!finished && !lastPartial.isEmpty()) {
                        deliverFinal(lastPartial, null, true);
                    } else {
                        deliverIdleError(errorMessage(error));
                    }
                });
            }

            @Override public void onResults(Bundle results) {
                main.post(() -> {
                    ArrayList<String> list = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    float[] conf = results.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES);
                    String text = (list != null && !list.isEmpty()) ? list.get(0) : "";
                    debug("onResults 到着");
                    if (continuous && !finished) { rotateSegment(text); return; } // v82: 終わらせずに継ぎ足す
                    Double c = (conf != null && conf.length > 0 && conf[0] > 0) ? (double) conf[0] : null;
                    deliverFinal(text, c, false);
                });
            }

            @Override public void onPartialResults(Bundle partialResults) {
                main.post(() -> {
                    ArrayList<String> list = partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    String text = (list != null && !list.isEmpty()) ? list.get(0) : "";
                    if (text.isEmpty()) return;
                    lastPartial = text;
                    JSObject d = new JSObject();
                    // v82: 長文モードでは**これまでの合計**を見せる（画面が「今の断片」だけになると、
                    // 話した分が消えたように見える＝黙って捨てたのと同じ体験になる・v16）
                    d.put("text", carried + text);
                    notifyListeners("interim", d);
                    armSilence(silenceMs); // 部分結果が止まって N 秒 → 発話終わり
                });
            }

            @Override public void onEvent(int eventType, Bundle params) {}
        };
    }

    /** stopListening ＋「onResults が来なければ保険で確定」タイマー（iOS の endAudioAndArmFinalize と同じ） */
    private void endAudioAndArmFinalize() {
        if (recognizer != null) {
            try { recognizer.stopListening(); } catch (Exception ignored) {}
        }
        if (finalizeRunnable != null) main.removeCallbacks(finalizeRunnable);
        finalizeRunnable = () -> {
            if (finished) return;
            debug("final 待ちタイムアウト → 途中結果で確定");
            if (!lastPartial.isEmpty()) {
                deliverFinal(lastPartial, null, true);
            } else {
                deliverIdleError("聞き取れませんでした");
            }
        };
        main.postDelayed(finalizeRunnable, 2000);
    }

    /**
     * 🔴 v16 の鉄則を Android でも守る: 確定テキストが空なら**最後の途中結果で補う**。
     * 両方空の時だけエラーにする＝絶対に黙って捨てない。数字を診断に出す。
     */
    private void deliverFinal(String text, Double confidence, boolean fallback) {
        if (finished) return;
        boolean usePartial = text.isEmpty() && !lastPartial.isEmpty();
        // v82: 長文モードで継ぎ足してきた分を必ず前に付ける。**最後の区切りが空でも
        // これまでの文章は届く**（carried があれば下の空チェックも通る）＝黙って捨てない。
        String finalText = carried + (usePartial ? lastPartial : text);
        debug("確定 len=" + text.length() + " partial=" + lastPartial.length()
            + " 継ぎ足し=" + carried.length() + (usePartial ? " → 途中結果で補完" : ""));

        if (finalText.isEmpty()) {
            deliverIdleError("聞き取れませんでした（確定テキストが空）");
            return;
        }

        finished = true;
        JSObject data = new JSObject();
        data.put("text", finalText);
        if (fallback || usePartial) data.put("fallback", true);
        if (confidence != null && !usePartial) data.put("confidence", confidence);
        cleanup();
        notifyListeners("final", data);
        emitState("idle");
    }

    /**
     * 🔴 v83（実機FB第45回・v82 の実バグ）: 長文モードで**継ぎ足してきた文章ごとエラーにしていた**。
     *
     * 症状「話すと文字は出る → 赤いマイクで止めると『聞き取れませんでした』」の道筋:
     *   一区切りが終わる → rotateSegment が carried へ積み、**lastPartial を空にする**
     *   → 直後に停止 → 新しい認識器はまだ何も拾っていない（lastPartial は空）
     *   → onError(#7 NO_MATCH) か 2秒の保険が「何も無い」と判断 → ここへ来て**全部捨てていた**
     *
     * 🔑 直し方は「**呼ぶ側で carried を数える**」ではなく「**ここで引き受ける**」。
     *    エラーを報告する入口は3つ（onError / 保険タイマー / 確定が空）あり、呼ぶ側に条件を撒くと
     *    入口が増えた日にまた片方だけ落ちる（v74 の形）。**持っている文章があるならエラーではない**。
     */
    private void deliverIdleError(String message) {
        if (finished) return;
        if (!carried.isEmpty()) {
            debug("エラーだが継ぎ足し=" + carried.length() + "字あり → 捨てずに確定する（" + message + "）");
            deliverFinal("", null, true);   // finalText = carried（+ 残っていれば途中結果）
            return;
        }
        finished = true;
        cleanup();
        emitState("idle");
        JSObject d = new JSObject();
        d.put("message", message);
        notifyListeners("error", d);
    }

    /**
     * v82: 認識器が1区切りを終えた（無音・上限・エラー）→ **終わらせずに継ぎ足して開き直す**。
     * iOS の rotateSegment と同じ形（両 OS で同じ壊れ方・同じ直り方にする＝v15/v16 の流儀）。
     */
    private void rotateSegment(String text) {
        if (!continuous || finished) return;
        String seg = (text == null || text.isEmpty()) ? lastPartial : text;
        if (seg == null || seg.isEmpty()) {
            // 🚨 v83: 「認識器が壊れている」と「**考えて黙っている**」を回数では区別できない。
            //   長文モードでは沈黙こそ普通（数十秒考えることがある）＝回数で切ると熟考で録音が終わる。
            //   危ないのは**空のまま高速に回り続ける**こと（電池を焼く）なので、**時間で見分ける**。
            //   ゆっくりの空振り（沈黙）は何度でも許し、止めるのは10分の上限に任せる。
            long now = System.currentTimeMillis();
            boolean spinning = (now - lastRestartMs) < SPIN_MS;
            lastRestartMs = now;
            emptyRestarts = spinning ? emptyRestarts + 1 : 0;
            if (emptyRestarts >= 3) {
                debug("長文モード: 空のまま高速に回っている（" + SPIN_MS + "ms 未満×3）→ 打ち切り");
                continuous = false;
                endAudioAndArmFinalize();
                return;
            }
        } else {
            emptyRestarts = 0;
            lastRestartMs = System.currentTimeMillis();
            carried += seg;
        }
        lastPartial = "";
        if (silenceRunnable != null) { main.removeCallbacks(silenceRunnable); silenceRunnable = null; }
        debug("継ぎ足し len=" + (seg == null ? 0 : seg.length()) + " 合計=" + carried.length());
        JSObject d = new JSObject();
        d.put("text", carried);
        notifyListeners("interim", d);
        // 🚨 同じ recognizer を即座に使い回すと、端末によっては ERROR_CLIENT が返る。
        //    Android の SpeechRecognizer は「1回の startListening = 1発話」の道具で、
        //    連続利用は作り直すのが確実（生成は安い・v65 の流儀＝端末差は保守的に倒す）。
        if (recognizer != null) {
            try { recognizer.cancel(); } catch (Exception ignored) {}
            try { recognizer.destroy(); } catch (Exception ignored) {}
            recognizer = null;
        }
        try {
            recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
            recognizer.setRecognitionListener(makeListener());
            recognizer.startListening(listenIntent);
        } catch (Exception e) {
            debug("長文モード: 開き直せず → 確定 (" + e.getMessage() + ")");
            continuous = false;
            deliverFinal("", null, true);   // carried があるので中身は失われない
        }
    }

    private void armMaxTimer() {
        clearMaxTimer();
        maxRunnable = () -> {
            if (finished) return;
            debug("長文モード: 上限" + (MAX_CONTINUOUS_MS / 1000) + "s → 確定（ここまでを届ける）");
            continuous = false;
            endAudioAndArmFinalize();
        };
        main.postDelayed(maxRunnable, MAX_CONTINUOUS_MS);
    }

    private void clearMaxTimer() {
        if (maxRunnable != null) { main.removeCallbacks(maxRunnable); maxRunnable = null; }
    }

    /** 無音タイマー: 発火したら stopListening ＋ 保険タイマー */
    private void armSilence(long ms) {
        if (silenceRunnable != null) { main.removeCallbacks(silenceRunnable); silenceRunnable = null; }
        // v82: 長文モードは「無音で止めない」＝**ここで張らないのが唯一の実装**（呼び出し側に
        // if を撒くと、新しい呼び出し口が増えた日に片方だけ止まる＝v74 と同じ形になる）。
        if (continuous) return;
        silenceRunnable = () -> {
            debug("無音" + String.format(java.util.Locale.ROOT, "%.1f", ms / 1000.0) + "s → stopListening");
            endAudioAndArmFinalize();
        };
        main.postDelayed(silenceRunnable, ms);
    }

    /** マイクは必ず手放す（使用中インジケータを残さない＝iOS の cleanup と同じ思想） */
    private void cleanup() {
        if (silenceRunnable != null) { main.removeCallbacks(silenceRunnable); silenceRunnable = null; }
        if (finalizeRunnable != null) { main.removeCallbacks(finalizeRunnable); finalizeRunnable = null; }
        clearMaxTimer();
        continuous = false;   // v82: 次の録音に長文モードを持ち越さない（「この録音だけ」）
        if (recognizer != null) {
            try { recognizer.cancel(); } catch (Exception ignored) {}
            try { recognizer.destroy(); } catch (Exception ignored) {}
            recognizer = null;
        }
    }

    private String errorName(int e) {
        switch (e) {
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT: return "NETWORK_TIMEOUT";
            case SpeechRecognizer.ERROR_NETWORK: return "NETWORK";
            case SpeechRecognizer.ERROR_AUDIO: return "AUDIO";
            case SpeechRecognizer.ERROR_SERVER: return "SERVER";
            case SpeechRecognizer.ERROR_CLIENT: return "CLIENT";
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: return "SPEECH_TIMEOUT";
            case SpeechRecognizer.ERROR_NO_MATCH: return "NO_MATCH";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY: return "BUSY";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: return "PERMISSIONS";
            case SpeechRecognizer.ERROR_TOO_MANY_REQUESTS: return "TOO_MANY_REQUESTS";
            case SpeechRecognizer.ERROR_SERVER_DISCONNECTED: return "SERVER_DISCONNECTED";
            case SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED: return "LANG_NOT_SUPPORTED";
            case SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE: return "LANG_UNAVAILABLE";
            default: return "#" + e;
        }
    }

    /** 人に見せるエラー文（toast/診断）。iOS 版の文言と同じ調子で */
    private String errorMessage(int e) {
        switch (e) {
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
            case SpeechRecognizer.ERROR_NO_MATCH:
                return "聞き取れませんでした";
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
            case SpeechRecognizer.ERROR_SERVER:
            case SpeechRecognizer.ERROR_SERVER_DISCONNECTED:
                return "音声認識サービスに接続できません（ネットワークを確認）";
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                return "マイクが許可されていません（設定 > アプリ > ボイスカレンダー > 権限）";
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
                return "音声認識が使用中です（もう一度）";
            case SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED:
            case SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE:
                return "この端末の音声認識が日本語に対応していません";
            default:
                return "音声認識エラー（" + errorName(e) + "）";
        }
    }
}
