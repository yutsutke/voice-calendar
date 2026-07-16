// tests/schema.test.js — 共有状態＋欄ロック（SPEC §8）の単体テスト
// v1 で「ロック（イベント基準）と描画スキップ（activeElement 基準）の二重管理」により
// **ストアと画面がズレて画面と違う値が保存される**バグを踏んだ。核心機能なのでテストで固定する。
'use strict';
const { createDraftStore, FIELDS } = require('../www/engine/schema.js');

let pass = 0, fail = 0;
const failures = [];
function t(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; failures.push(`✗ ${name}\n    ${e.message}`); }
}
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label || ''} 期待 ${b} / 実際 ${a}`);
}

// ===== 2経路が同じ1つの state を更新する（背骨①） =====
t('音声パッチと手入力が同じ state を更新する', () => {
  const s = createDraftStore();
  s.applyVoicePatch({ title: '歯医者', startDate: '2026-07-17' }, '明日 歯医者');
  s.setByHuman('location', '駅前クリニック');
  eq(s.get().title, '歯医者', 'title');
  eq(s.get().location, '駅前クリニック', 'location');
});

// ===== 明示 lock（DOM を持たない宿主用） =====
t('lock した欄には音声が書かない・skipped に出る', () => {
  const s = createDraftStore();
  s.setByHuman('title', '手で書いた');
  s.lock('title');
  const r = s.applyVoicePatch({ title: '声で書いた', startTime: '15:00' }, 'x');
  eq(r.written, ['startTime'], 'written');
  eq(r.skipped, ['title'], 'skipped');
  eq(s.get().title, '手で書いた', 'ロック中の値は不変');
  eq(s.get().startTime, '15:00', 'ロックされていない欄は書ける');
});

t('unlock すると再び書ける（フォーカスが外れたら解除）', () => {
  const s = createDraftStore();
  s.lock('title');
  s.applyVoicePatch({ title: 'A' }, 'x');
  eq(s.get().title, '', 'ロック中は書かれない');
  s.unlock('title');
  s.applyVoicePatch({ title: 'B' }, 'x');
  eq(s.get().title, 'B', '解除後は書ける');
});

// ===== lockSource（宿主が「編集中か」の正を注入）＝ v1 バグの再発防止 =====
t('lockSource が true を返す欄には音声が書かない', () => {
  const s = createDraftStore();
  let editing = 'title';
  s.setLockSource((f) => f === editing);
  s.setByHuman('title', '手で書いた');
  const r = s.applyVoicePatch({ title: '声で書いた', startTime: '15:00' }, 'x');
  eq(r.skipped, ['title'], 'skipped');
  eq(s.get().title, '手で書いた', 'ストアも守られる（画面だけでなく）');
  editing = null;
  s.applyVoicePatch({ title: '声で書いた' }, 'x');
  eq(s.get().title, '声で書いた', 'フォーカスが外れたら書ける');
});

t('【v1 バグの回帰】lockSource が locked と言う欄は getFieldState も locked（描画スキップと一致）', () => {
  const s = createDraftStore();
  s.setLockSource((f) => f === 'title');
  s.setByHuman('title', '歯医者');
  // 描画は isLocked でスキップを決める。ここが false だと「スキップしないのに書かれない」
  // 逆に applyVoicePatch が書いてしまうと「スキップするのにストアは変わる」＝画面とズレる。
  eq(s.isLocked('title'), true, 'isLocked');
  eq(s.getFieldState('title'), 'locked', 'getFieldState');
  s.applyVoicePatch({ title: '定例' }, 'x');
  eq(s.get().title, '歯医者', 'ストアの値＝画面の値（ズレない）');
});

t('lockSource と明示 lock は OR で効く', () => {
  const s = createDraftStore();
  s.setLockSource((f) => f === 'location');
  s.lock('title');
  const r = s.applyVoicePatch({ title: 'A', location: 'B', note: 'C' }, 'x');
  eq(r.written, ['note'], 'written');
  eq(r.skipped, ['title', 'location'], 'skipped');
});

// ===== fieldState =====
t('fieldState は empty → confirmed（AI は創作しない＝空は空のまま）', () => {
  const s = createDraftStore();
  eq(s.getFieldState('title'), 'empty', '初期');
  s.applyVoicePatch({ title: '歯医者' }, 'x');
  eq(s.getFieldState('title'), 'confirmed', '音声で確定');
  eq(s.getFieldState('endTime'), 'empty', '言っていない欄は empty のまま');
  s.setByHuman('title', '');
  eq(s.getFieldState('title'), 'empty', '空にしたら empty へ戻る');
});

// ===== 来歴（SPEC §5-①: note に流し込まない） =====
t('転写は来歴として貯まり、note には流し込まれない', () => {
  const s = createDraftStore();
  s.applyVoicePatch({ title: '歯医者' }, '明日15時に歯医者');
  eq(s.get().note, '', 'note は空のまま');
  eq(s.getTranscripts().length, 1, '来歴は1件');
  eq(s.getTranscripts()[0].text, '明日15時に歯医者', '生テキストが残る');
});

// ===== reset =====
t('reset で state もロックも初期化される', () => {
  const s = createDraftStore();
  s.setByHuman('title', 'A');
  s.lock('title');
  s.reset();
  eq(s.get().title, '', 'value');
  eq(s.isLocked('title'), false, 'ロック解除');
  eq(s.getFieldState('title'), 'empty', 'fieldState');
});

// ===== 購読 =====
t('subscribe に written / skipped が通知される', () => {
  const s = createDraftStore();
  s.lock('title');
  let got = null;
  s.subscribe((c) => { if (c.type === 'voice') got = c; });
  s.applyVoicePatch({ title: 'A', startTime: '15:00' }, 'x');
  eq(got.fields, ['startTime'], 'fields');
  eq(got.skipped, ['title'], 'skipped');
});

console.log(`\nschema.test: ${pass} passed, ${fail} failed`);
if (failures.length) { console.log('\n' + failures.join('\n\n')); process.exit(1); }
