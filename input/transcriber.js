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

  // ---- native (iOS): SFSpeechRecognizer プラグイン ----
  function createNative(h, C) {
    const plugin = C.registerPlugin('SpeechRecognition');
    let listening = false;
    plugin.addListener('interim', (d) => h.onInterim(d.text || ''));
    plugin.addListener('final', (d) => {
      const meta = { engine: 'sfspeech' };
      if (typeof d.confidence === 'number') meta.confidence = d.confidence;
      h.onFinal((d.text || '').trim(), meta);
    });
    plugin.addListener('state', (d) => {
      listening = d.state === 'listening';
      h.onState(d.state || 'idle');
    });
    plugin.addListener('error', (d) => h.onError(d.message || 'speech-error'));
    return {
      available: true,
      engine: 'sfspeech',
      start() {
        plugin.start().catch((e) => {
          listening = false;
          h.onState('idle');
          h.onError((e && e.message) || String(e));
        });
      },
      stop() { plugin.stop().catch(() => {}); },
      toggle() { listening ? this.stop() : this.start(); },
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
      start,
      stop,
      toggle() { listening ? stop() : start(); },
      isListening: () => listening,
      simulate(text) { const t = String(text || '').trim(); if (t) h.onFinal(t, { engine: 'simulated' }); },
    };
  }

  function createTranscriber(handlers) {
    const h = Object.assign({ onInterim() {}, onFinal() {}, onState() {}, onError() {} }, handlers);
    const C = global.Capacitor;
    if (C && C.isNativePlatform && C.isNativePlatform()) return createNative(h, C);
    return createWebSpeech(h);
  }

  const api = { createTranscriber };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.VCTranscriber = api;
})(typeof window !== 'undefined' ? window : globalThis);
