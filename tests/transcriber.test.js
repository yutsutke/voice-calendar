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
    eq(listeners.slice().sort(), ['debug', 'error', 'final', 'interim', 'state'], '5つのイベントを購読する（debug は診断用・v15。順不同）');
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
    eq(listeners.length, 5, '購読できている');
  });
});

// ===== v65: Android 対応＝engine 名は事実・native 判定はフラグ =====
// 🚨 なぜテストするか: v65 まで index.html は engine==='sfspeech' を「native の音声が生きている」の
// 代理に使っていた。Android で engine 名を正直（androidspeech）にした瞬間、名前ゲートは
// **起動即録音（v24）を Android でだけ黙って殺す**。判定は .native フラグ＝名前と分離して固定する。
t('v65: Android では engine=androidspeech（診断・来歴・CSV に嘘を書かない）＋ native フラグ', () => {
  withCapacitor({
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    Plugins: { SpeechRecognition: { addListener: () => {} } },
  }, () => {
    const tr = createTranscriber(H);
    eq(tr.engine, 'androidspeech', 'Android の実体は android.speech.SpeechRecognizer');
    eq(tr.native, true, '起動即録音（v24）のゲートはこのフラグを見る');
  });
});

t('v65: native フラグは iOS でも立ち・web には無い（名前でなくフラグが判定の正）', () => {
  withCapacitor({
    isNativePlatform: () => true,
    getPlatform: () => 'ios',
    Plugins: { SpeechRecognition: { addListener: () => {} } },
  }, () => {
    const tr = createTranscriber(H);
    eq(tr.engine, 'sfspeech', 'iOS は従来どおり sfspeech');
    eq(tr.native, true, 'iOS でも native フラグ');
  });
  withCapacitor(undefined, () => {
    ok(!createTranscriber(H).native, 'web に native フラグは無い（起動即録音は走らない）');
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

// ===== v44: start の opts が native へ**そのまま**渡ること（JS ⇄ Swift の契約） =====
// 🚨 なぜテストするか（calendar.test.js と同じ理由・v23 の教訓）:
// Swift は call.getArray("hints", ...) / call.getDouble("silenceMs") でキー名を決め打ちで読む。
// **キー名がズレても誰も落ちない**——native は「渡されなかった」として既定で動き、
// 語彙ヒントが効かないまま「なんとなく認識が悪い」になる＝実機でも原因に辿り着けない。
// Windows に Xcode が無く Swift をコンパイルできない以上、契約はここでしか守れない。
t('v44: start(opts) は native プラグインへそのまま渡る（hints / silenceMs のキー名を固定）', () => {
  let got = null;
  withCapacitor({
    isNativePlatform: () => true,
    Plugins: { SpeechRecognition: { addListener: () => {}, start: (o) => { got = o; return Promise.resolve(); }, stop: () => Promise.resolve() } },
  }, () => {
    const tr = createTranscriber(H);
    eq(tr.engine, 'sfspeech', 'native 経路が取れている');
    tr.start({ silenceMs: 1800, hints: ['今井', '横浜支店'] });
    ok(got, 'native の start が呼ばれた');
    eq(got.silenceMs, 1800, 'Swift の call.getDouble("silenceMs") と同じキー');
    eq(got.hints, ['今井', '横浜支店'], 'Swift の call.getArray("hints", String.self) と同じキー');
  });
});

t('v44: opts 無しでも native の start は呼べる（ヒント無し＝欄名だけで従来どおり）', () => {
  let got = 'not-called';
  withCapacitor({
    isNativePlatform: () => true,
    Plugins: { SpeechRecognition: { addListener: () => {}, start: (o) => { got = o; return Promise.resolve(); }, stop: () => Promise.resolve() } },
  }, () => {
    createTranscriber(H).start();
    eq(got, {}, '未指定は空オブジェクト＝Swift 側は既定に落ちる');
  });
});

// ===== v82: 長文モード（この録音だけ自動で止めない） =====
// 🚨 なぜここで縛るか（v44 と同じ理由）: Swift / Java は call.getBool("on") でキー名を決め打ちで読む。
//    **キー名がズレても誰も落ちない**——native は「渡されなかった」＝false として動き、
//    ボタンを押しても止まり続ける＝実機で「効かない」としか分からない（v66 の型の罠と同じ形）。
t('v82: setContinuous は {on: boolean} を native へ渡す（キー名と型を固定）', () => {
  const got = [];
  withCapacitor({
    isNativePlatform: () => true,
    Plugins: { SpeechRecognition: { addListener: () => {}, start: () => Promise.resolve(), stop: () => Promise.resolve(), setContinuous: (o) => { got.push(o); return Promise.resolve(); } } },
  }, () => {
    const tr = createTranscriber(H);
    ok(tr.canKeepOpen, 'native では長文モードのボタンを出す');
    tr.setContinuous(true);
    tr.setContinuous(false);
    eq(got, [{ on: true }, { on: false }], 'Swift の call.getBool("on") / Java の getBoolean("on") と同じキー');
  });
});

t('v82: web では長文モードを出さない（押せるのに効かないボタンを作らない）', () => {
  withCapacitor(undefined, () => {
    const tr = createTranscriber(H);
    eq(tr.canKeepOpen, false, 'web の無音判定はブラウザ側＝こちらから外せない');
    tr.setContinuous(true); // 呼んでも何も起きない（throw もしない）
  });
});

// 🚨 **古い native に新しい web が載る**のは Pages 運用では日常（アプリの更新より web が先）。
//    その時「押しても何も起きない」を作らない＝理由を表に出す（v16）。
t('v82: native に setContinuous が無い版では黙らずエラーにする', () => {
  let err = null;
  withCapacitor({
    isNativePlatform: () => true,
    Plugins: { SpeechRecognition: { addListener: () => {}, start: () => Promise.resolve(), stop: () => Promise.resolve() } },
  }, () => {
    const tr = createTranscriber({ ...H, onError: (m) => { err = m; } });
    tr.setContinuous(true);
    ok(err && /未対応/.test(err), `理由が出ない: ${err}`);
  });
});

// ===== v83: 長文モードの「継ぎ足した文章を捨てない」を **native のソースで**縛る =====
//
// 症状（実機FB第45回・Android）: 長文モードで話すと文字は出るのに、赤いマイクで止めると
//   「音声認識エラー 聞き取れませんでした」＝**継ぎ足してきた文章ごと消えた**。
// 真因: 一区切りが終わると carried へ積んで lastPartial を空にする → 直後に停止すると
//   新しい認識器はまだ何も拾っていない → 「何も無い」と判断してエラー経路へ落ち、carried を捨てた。
// 🚨 なぜここで縛るか: **JS から native の中身は見えない**（上の契約テストは引数名しか見ていない）。
//   Swift は Windows でコンパイルすらできない。calendar.test.js の不変条件6 と同じ手で、
//   **ソースを読んで構造を固定する**（CLAUDE.md「プラグインを増やしたら同じガードを新しいソースにも」）。
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const SPEECH_JAVA = readFileSync(join(
  __dirname, '..', 'local-plugins', 'speech-recognition', 'android', 'src', 'main',
  'java', 'io', 'github', 'yutsutke', 'voicecalendar', 'speech', 'SpeechRecognitionPlugin.java'
), 'utf8');
const SPEECH_SWIFT = readFileSync(join(
  __dirname, '..', 'local-plugins', 'speech-recognition', 'ios', 'Sources',
  'SpeechRecognitionPlugin', 'SpeechRecognitionPlugin.swift'
), 'utf8');

// コメントを落とした「実コードだけ」（コメント中の carried を実装と数えない）
const stripComments = (s) => s.split('\n').filter((ln) => {
  const t = ln.trim();
  return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
}).join('\n');
const JAVA = stripComments(SPEECH_JAVA);
const SWIFT = stripComments(SPEECH_SWIFT);
// 名前つきの関数/メソッド本体を波括弧の対応で切り出す
function block(src, header) {
  const i = src.indexOf(header);
  if (i < 0) throw new Error(`${header} が見つからない（名前を変えたならこのテストも直す）`);
  const s = src.indexOf('{', i);
  let depth = 0;
  for (let j = s; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(s, j + 1); }
  }
  throw new Error(`${header} の本体を閉じられない`);
}

t('🚨【v83 回帰・Android】エラー経路が継ぎ足した文章を捨てない', () => {
  const b = block(JAVA, 'private void deliverIdleError');
  ok(/carried/.test(b), 'deliverIdleError が carried を見ていない＝長文が丸ごと消える（v16 違反）');
  ok(/deliverFinal\(/.test(b), '持っている文章を確定として届けていない');
});

t('🚨【v83 回帰・iOS】エラー経路が継ぎ足した文章を捨てない（両OSで同じ直り方）', () => {
  const b = block(SWIFT, 'private func deliverIdleError');
  ok(/carried/.test(b), 'deliverIdleError が carried を見ていない＝長文が丸ごと消える（v16 違反）');
  ok(/deliverFinal\(/.test(b), '持っている文章を確定として届けていない');
});

t('🚨【v83】確定は必ず carried を前に付ける（両OS）', () => {
  ok(/carried \+ \(usePartial/.test(JAVA), 'Java の deliverFinal が carried を前に付けていない');
  ok(/carried \+ \(usePartial/.test(SWIFT), 'Swift の deliverFinal が carried を前に付けていない');
});

// 長文モードでは**沈黙こそ普通**。回数で打ち切ると「考えていたら録音が終わった」になる。
t('🚨【v83】空振りの打ち切りは回数でなく間隔で見る（沈黙で録音を終わらせない）', () => {
  for (const [name, src, spin] of [['Java', JAVA, /SPIN_MS/], ['Swift', SWIFT, /spinSec/]]) {
    ok(spin.test(src), `${name}: 高速回転の判定（間隔）が無い＝沈黙の回数で打ち切っている`);
    ok(/spinning/.test(src), `${name}: spinning の判定が無い`);
  }
});

// ===== v49: 言い間違えの「やめる」（cancel） =====
// stop は「止めて確定する」・cancel は「止めて、この発話を無かったことにする」＝**別の操作**。
// 🔑 Swift に cancel を足さずに済ませている（確定を受け取ってから捨てる）＝native の再ビルド無しで成立する。
//    その代わり **JS 側が確実に捨てること**がこの機能の全てなので、ここで縛る。
function nativeWithListeners() {
  const L = {};
  const plugin = {
    addListener: (name, fn) => { L[name] = fn; },
    start: () => Promise.resolve(),
    stop: () => Promise.resolve(),
  };
  return { L, cap: { isNativePlatform: () => true, Plugins: { SpeechRecognition: plugin } } };
}

t('v49: cancel の後に届いた final は解釈へ流さない（native）', () => {
  const { L, cap } = nativeWithListeners();
  withCapacitor(cap, () => {
    let finals = [], interims = [];
    const tr = createTranscriber({ onInterim: (t2) => interims.push(t2), onFinal: (t2) => finals.push(t2), onState() {}, onError() {} });
    tr.start();
    L.interim({ text: '明日15時に' });
    tr.cancel();
    L.interim({ text: '明日15時に歯医者' }); // キャンセル後の途中結果
    L.final({ text: '明日15時に歯医者' });    // stop の結果として必ず飛んでくる
    eq(interims, ['明日15時に'], 'キャンセル前の途中結果までは届いている');
    eq(finals, [], '🔴 キャンセル後の確定は1つも流れない（流れると言い間違えが入る）');
    ok(tr.isCancelled(), 'キャンセル済みだと分かる');
  });
});

t('v49: 次の start でキャンセルは解除される（1回きりの効果）', () => {
  const { L, cap } = nativeWithListeners();
  withCapacitor(cap, () => {
    let finals = [];
    const tr = createTranscriber({ onInterim() {}, onFinal: (t2) => finals.push(t2), onState() {}, onError() {} });
    tr.start();
    tr.cancel();
    L.final({ text: '捨てられる' });
    tr.start(); // 言い直し
    L.final({ text: '明日15時に歯医者' });
    eq(finals, ['明日15時に歯医者'], '🔴 次の発話まで捨て続けたら音声が死ぬ');
    ok(!tr.isCancelled(), 'start で解除されている');
  });
});

t('v49: cancel は録音を止める（既存の stop を使う＝Swift の追加メソッド不要）', () => {
  const { cap } = nativeWithListeners();
  let stopped = 0;
  cap.Plugins.SpeechRecognition.stop = () => { stopped++; return Promise.resolve(); };
  withCapacitor(cap, () => {
    const tr = createTranscriber(H);
    tr.start();
    tr.cancel();
    eq(stopped, 1, 'マイクは実際に止まる（赤いままにしない）');
  });
});

console.log(`\ntranscriber.test: ${pass} passed, ${fail} failed`);
if (failures.length) { console.log('\n' + failures.join('\n\n')); process.exit(1); }
