// tests/transcriber.test.js — 転写層の「壊れ方」のテスト（node tests/transcriber.test.js）
//
// なぜ必要か（v13 で踏んだ実バグ）:
// native が注入する window.Capacitor には **registerPlugin が無い**（Plugins と isPluginAvailable だけ。
// registerPlugin は npm @capacitor/core 側＝バンドラ前提）。それを呼んだ結果 TypeError が
// index.html のインラインスクリプトを止め、**音声と無関係な「保存」「クリア」まで死んだ**。
//
// 守るべき不変条件は2つ:
//   1. createTranscriber は **どんな環境でも throw しない**（音声はフォームの補助＝背骨①
//      「フォームが単一の真実」。音声の失敗がフォームを殺してはならない）
//   2. プラグイン取得は Plugins.X を本命、registerPlugin は「あれば使う」保険（あの日と同じ形）
'use strict';
const { createTranscriber } = require('../input/transcriber.js');

let pass = 0, fail = 0;
const failures = [];
function t(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; failures.push(`✗ ${name}\n    ${e.message}`); }
}
function eq(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label || ''} 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`);
  }
}
function ok(cond, label) { if (!cond) throw new Error(label || 'false だった'); }

const H = { onInterim() {}, onFinal() {}, onState() {}, onError() {} };
const withCapacitor = (cap, fn) => {
  const prev = globalThis.Capacitor;
  globalThis.Capacitor = cap;
  try { return fn(); } finally { globalThis.Capacitor = prev; }
};

// ===== 不変条件1: throw しない =====
t('【v13 回帰】registerPlugin が無い native でも throw しない（Plugins も無い）', () => {
  withCapacitor({ isNativePlatform: () => true /* registerPlugin なし = 実機の native bridge */ }, () => {
    const tr = createTranscriber(H); // ここで throw すると保存・クリアまで死ぬ
    ok(tr, 'オブジェクトが返る');
    ok(!!tr.nativeFailure, 'native 失敗の理由が残る（診断に出す）');
    ok(typeof tr.start === 'function' && typeof tr.simulate === 'function', 'API は揃っている');
  });
});

t('【v13 回帰】addListener が throw する（プラグイン未登録）native でも throw しない', () => {
  withCapacitor({
    isNativePlatform: () => true,
    registerPlugin: (n) => ({ addListener: () => { throw new Error(`"${n}" plugin is not implemented on ios`); } }),
  }, () => {
    const tr = createTranscriber(H);
    ok(tr, 'オブジェクトが返る');
    ok(/not implemented/.test(tr.nativeFailure || ''), `失敗理由が残る: ${tr.nativeFailure}`);
  });
});

t('web（Capacitor なし）でも throw しない', () => {
  withCapacitor(undefined, () => {
    const tr = createTranscriber(H);
    ok(tr, 'オブジェクトが返る');
    eq(tr.available, false, 'Node には SpeechRecognition が無いので available=false');
    eq(tr.nativeFailure, null, 'native を期待していないので失敗理由は無い');
  });
});

// ===== 不変条件2: Plugins.X が本命 =====
t('Capacitor.Plugins.SpeechRecognition があればそれを使う（registerPlugin を呼ばない）', () => {
  let registerPluginCalled = false;
  const listeners = [];
  withCapacitor({
    isNativePlatform: () => true,
    Plugins: { SpeechRecognition: { addListener: (ev) => listeners.push(ev) } },
    registerPlugin: () => { registerPluginCalled = true; return {}; },
  }, () => {
    const tr = createTranscriber(H);
    eq(tr.engine, 'sfspeech', 'native エンジンになる');
    eq(tr.available, true, 'available');
    eq(registerPluginCalled, false, 'Plugins.X があれば registerPlugin は呼ばない');
    eq(listeners, ['interim', 'final', 'state', 'error'], '4つのイベントを購読する');
  });
});

t('Plugins.X が無く registerPlugin だけある環境ではそれを保険に使う', () => {
  const listeners = [];
  withCapacitor({
    isNativePlatform: () => true,
    Plugins: {},
    registerPlugin: () => ({ addListener: (ev) => listeners.push(ev) }),
  }, () => {
    const tr = createTranscriber(H);
    eq(tr.engine, 'sfspeech', 'native エンジンになる');
    eq(listeners.length, 4, '購読できている');
  });
});

// ===== simulate は転写層が壊れていても使える（フォームが本体） =====
t('native が全滅していても simulate は発話を流せる', () => {
  withCapacitor({ isNativePlatform: () => true }, () => {
    let got = null;
    const tr = createTranscriber({ ...H, onFinal: (text, meta) => { got = { text, meta }; } });
    tr.simulate('明日15時に歯医者');
    eq(got.text, '明日15時に歯医者', 'テキストが流れる');
    eq(got.meta.engine, 'simulated', 'engine=simulated');
  });
});

console.log(`\ntranscriber.test: ${pass} passed, ${fail} failed`);
if (failures.length) { console.log('\n' + failures.join('\n\n')); process.exit(1); }
