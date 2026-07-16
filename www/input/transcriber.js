// input/transcriber.js — 転写層（SPEC §5-①）: 音声 → テキスト
//
// v0 web = Web Speech API（Chrome/Edge で動く開発用）。iOS native では
// SFSpeechRecognizer のローカルプラグイン（speech-recognition）に差し替える予定。
// どの実装でも出口は同じ: onInterim(text) / onFinal(text)。
// simulate(text) はテキスト入力を「発話」として同じ経路に流す開発・検証用の口
// （転写と解釈が分離しているから、ここを差し替えても解釈層は不変）。
(function (global) {
  'use strict';

  function createTranscriber(handlers) {
    const h = Object.assign({ onInterim() {}, onFinal() {}, onState() {}, onError() {} }, handlers);
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
        let interim = '', final = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) final += r[0].transcript;
          else interim += r[0].transcript;
        }
        if (interim) h.onInterim(interim);
        if (final) h.onFinal(final.trim(), { engine: 'webspeech' });
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
      // テキストを発話として注入（開発用・マイクなし環境用）
      simulate(text) { const t = String(text || '').trim(); if (t) h.onFinal(t, { engine: 'simulated' }); },
    };
  }

  const api = { createTranscriber };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.VCTranscriber = api;
})(typeof window !== 'undefined' ? window : globalThis);
