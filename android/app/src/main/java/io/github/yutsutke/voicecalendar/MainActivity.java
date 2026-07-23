package io.github.yutsutke.voicecalendar;

import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.BridgeActivity;

/**
 * v64 の Android 版: ホーム画面の長押し（App Shortcut）で「リスト」を開く。
 * iOS の AppDelegate.deliverPendingShortcut と同じ設計:
 * - 起動直後は WebView が index.html を実行し終えておらず window.__vcQuickAction が未定義
 *   → 定義されて受理（true）を返すまで 0.3s×最大15回リトライして届ける（cold/warm 両対応）。
 * - 未知の action は黙って捨てる（害がない・将来 action を増やす時ここに足す）。
 * - plugin を新設せず Activity から WebView へ evaluateJavascript で直接届ける
 *   （iOS と同じ「1機能のために plugin を新設しない」判断）。
 */
public class MainActivity extends BridgeActivity {

    private String pendingShortcut;
    private final Handler handler = new Handler(Looper.getMainLooper());

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        captureShortcut(getIntent()); // cold start: 長押しから起動された場合ここに intent が来る
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // warm: launchMode=singleTask なので既存インスタンスのここに来る
        setIntent(intent);
        captureShortcut(intent);
        deliverPendingShortcut(0);
    }

    @Override
    public void onResume() {
        super.onResume();
        // cold start 分はここで配信を開始（WebView が整うまではリトライが待つ）。
        // pendingShortcut が null なら即 return＝通常起動は無害（iOS の applicationDidBecomeActive と同じ）。
        deliverPendingShortcut(0);
    }

    private void captureShortcut(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        // 「リストを開く」だけを扱う（shortcuts.xml の action 末尾 ".list"＝iOS の type 末尾判定と同じ）
        if (action != null && action.endsWith(".list")) pendingShortcut = action;
    }

    private void deliverPendingShortcut(int attempt) {
        if (pendingShortcut == null) return;
        if (attempt >= 15) { pendingShortcut = null; return; } // 0.3s×15 ≒ 4.5s で諦める（永久ループにしない）
        if (getBridge() == null || getBridge().getWebView() == null) {
            handler.postDelayed(() -> deliverPendingShortcut(attempt + 1), 300);
            return;
        }
        String js = "(typeof window.__vcQuickAction==='function') ? (window.__vcQuickAction('list'), true) : false";
        getBridge().getWebView().evaluateJavascript(js, value -> {
            if ("true".equals(value)) {
                pendingShortcut = null; // 届いた
            } else {
                handler.postDelayed(() -> deliverPendingShortcut(attempt + 1), 300);
            }
        });
    }
}
