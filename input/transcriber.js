// input/transcriber.js — 転写層（SPEC §5-①）: 音声 → テキスト
//
// 実装は環境で切り替えるが、出口はどれも同じ:
//   onInterim(text) / onFinal(text, {engine, confidence?}) / onState('listening'|'idle') / onError(msg)
//   - native (iOS): SFSpeechRecognizer プラグイン（local-plugins/speech-recognition。
//     オンデバイス優先・無音で自動停止＝ローカル完結 SPEC §2）
//   - web: Web Speech API（開発・GitHub Pages 検証用）
//   - simulate(text): テキストを「発話」として同じ経路に流す（全実装共通・マイクなし環境用）
// 転写と解釈が分離しているから、ここを差し替えても解釈層（engine/parser.js）は不変。
(function (global) {
  'use strict';

  // 🔴 バンドラ無し運用でのプラグイン取得（v13 で踏んだ実バグ）:
  // **native が注入する window.Capacitor には registerPlugin が無い**（Plugins と
  // isPluginAvailable だけ）。registerPlugin は npm の @capacitor/core 側 API ＝バンドラ前提。
  // よって `C.registerPlugin(...)` は native で TypeError になり、インラインスクリプトごと
  // 落ちて**保存・クリアまで死んだ**。あの日の index.html は最初から
  //   (Plugins && Plugins.X) || (typeof registerPlugin === 'function' ? registerPlugin('X') : null)
  // と書いており、こちらが正しい。Plugins.X が本命・registerPlugin は「あれば使う」保険。
  function nativePlugin(C, name) {
    if (!C) return null;
    if (C.Plugins && C.Plugins[name]) return C.Plugins[name];
    if (typeof C.registerPlugin === 'function') return C.registerPlugin(name);
    return null;
  }

  // ---- native (iOS): SFSpeechRecognizer プラグイン ----
  // ⚠️ 失敗しても **絶対に throw しない**（null を返す）。v13 で踏んだ実バグ:
  // プラグイン未登録だと registerPlugin の proxy が addListener で同期的に throw し、
  // それが index.html のインラインスクリプトを止めて **保存・クリアまで死んだ**
  // （音声と無関係なフォームが巻き添え＝背骨①「フォームが単一の真実」の違反）。
  // 音声はフォームの補助であって前提ではない。ここは静かに諦めて呼び手に返す。
  function createNative(h, C) {
    let plugin, listening = false;
    try {
      plugin = nativePlugin(C, 'SpeechRecognition');
      if (!plugin) return { failed: 'SpeechRecognition プラグインが native に登録されていません' };
      plugin.addListener('interim', (d) => h.onInterim(d.text || ''));
      plugin.addListener('final', (d) => {
        const meta = { engine: 'sfspeech' };
        if (typeof d.confidence === 'number') meta.confidence = d.confidence;
        if (d.fallback) meta.fallback = true; // isFinal が来ず途中結果で確定した印（v15 の保険）
        h.onFinal((d.text || '').trim(), meta);
      });
      // Swift 内部の出来事（開始/無音タイマー/確定タイムアウト/エラー番号）。
      // Mac なし開発の「目」＝診断パネルに流す（v15）
      plugin.addListener('debug', (d) => { if (h.onDebug) h.onDebug(d.msg || ''); });
      plugin.addListener('state', (d) => {
        listening = d.state === 'listening';
        h.onState(d.state || 'idle');
      });
      plugin.addListener('error', (d) => h.onError(d.message || 'speech-error'));
    } catch (e) {
      return { failed: (e && e.message) || String(e) }; // 呼び手が診断に出す
    }
    return {
      available: true,
      engine: 'sfspeech',
      // opts.silenceMs: 話し終わってから確定するまでの無音（v19 の設定。native へ渡す）
      start(opts) {
        try {
          plugin.start(opts || {}).catch((e) => {
            listening = false;
            h.onState('idle');
            // v31: 完全終了→Siri 起動の一瞬はマイク HW が未準備で native が AUDIO_NOT_READY を返す
            // （クラッシュではなく graceful に中止するよう Swift を直した）。これは一過性なので
            // **トーストで騒がず診断だけに出す**。呼び手（起動時自動録音）が静かにリトライする。
            if (e && e.code === 'AUDIO_NOT_READY') {
              if (h.onDebug) h.onDebug('起動直後マイク未準備（リトライ）');
            } else {
              h.onError((e && e.message) || String(e));
            }
          });
        } catch (e) { h.onError((e && e.message) || String(e)); }
      },
      stop() { try { plugin.stop().catch(() => {}); } catch {} },
      toggle(opts) { listening ? this.stop() : this.start(opts); },
      isListening: () => listening,
      simulate(text) { const t = String(text || '').trim(); if (t) h.onFinal(t, { engine: 'simulated' }); },
    };
  }

  // ---- web: Web Speech API（開発用） ----
  function createWebSpeech(h) {
    const SR = global.SpeechRecognition || global.webkitSpeechRecognition;
    let rec = null;
    let listening = false;

    function start() {
      if (!SR || listening) return;
      rec = new SR();
      rec.lang = 'ja-JP';
      rec.interimResults = true;
      rec.continuous = false; // 1回の押下 = 1発話。話し終わりで自動停止
      rec.onresult = (e) => {
        let interim = '', final = '', confidence = null;
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) {
            final += r[0].transcript;
            if (typeof r[0].confidence === 'number') confidence = r[0].confidence;
          } else interim += r[0].transcript;
        }
        if (interim) h.onInterim(interim);
        // confidence は来歴に残す: 「認識が悪いのか、解釈が悪いのか」の切り分け（SPEC §10）に使う
        if (final) h.onFinal(final.trim(), { engine: 'webspeech', confidence });
      };
      rec.onend = () => { listening = false; h.onState('idle'); };
      rec.onerror = (e) => { listening = false; h.onState('idle'); h.onError(e.error || 'speech-error'); };
      listening = true;
      h.onState('listening');
      rec.start();
    }

    function stop() {
      if (rec && listening) rec.stop();
    }

    return {
      available: !!SR,
      engine: SR ? 'webspeech' : 'none',
      start, // opts（silenceMs 等）は web では効かない＝Web Speech API 側が無音判定を持つ
      stop,
      toggle() { listening ? stop() : start(); },
      isListening: () => listening,
      simulate(text) { const t = String(text || '').trim(); if (t) h.onFinal(t, { engine: 'simulated' }); },
    };
  }

  // どんな環境でも **必ずオブジェクトを返す**（throw しない）。音声が全滅しても
  // フォーム（＝製品の本体）は動き続けること。native 失敗の理由は .nativeFailure に残す。
  function createTranscriber(handlers) {
    const h = Object.assign({ onInterim() {}, onFinal() {}, onState() {}, onError() {} }, handlers);
    const C = global.Capacitor;
    let nativeFailure = null;
    if (C && C.isNativePlatform && C.isNativePlatform()) {
      const native = createNative(h, C);
      if (native && native.available) return native;
      nativeFailure = (native && native.failed) || 'native プラグインが応答しません';
    }
    const web = createWebSpeech(h);
    web.nativeFailure = nativeFailure; // native を期待したのに web に落ちた＝診断に出す
    return web;
  }

  const api = { createTranscriber };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.VCTranscriber = api;
})(typeof window !== 'undefined' ? window : globalThis);
