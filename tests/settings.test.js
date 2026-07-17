// tests/settings.test.js — 詳細設定（v19）の単体テスト
//
// 守る不変条件:
//   1. **既定＝これまでの実挙動**（設定を触らない人の体験は1ミリも変わらない）
//   2. 壊れた保存値でも既定で動く（黙って壊れない）
//   3. 保存は端末内 localStorage のみ（ローカル完結 SPEC §2）
'use strict';

// localStorage のミニ実装（Node には無い）
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const { createSettings, DEFS, KEY } = require('../engine/settings.js');

let pass = 0, fail = 0;
const failures = [];
function t(name, fn) {
  mem.clear();
  try { fn(); pass++; }
  catch (e) { fail++; failures.push(`✗ ${name}\n    ${e.message}`); }
}
function eq(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label || ''} 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`);
  }
}
function ok(cond, label) { if (!cond) throw new Error(label || 'false だった'); }

// ===== 不変条件1: 既定 = これまでの実挙動 =====
t('既定値がこれまでの実挙動と一致する（触らない人の体験は変わらない）', () => {
  const s = createSettings();
  eq(s.get('plainUtteranceIsNew'), true, '欄名なし発話=新規（v6）');
  eq(s.get('protectManualEdits'), true, '手入力は保護（v6）');
  eq(s.get('lockEditingField'), true, '編集中はロック（SPEC §8）');
  eq(s.get('autoOpenOptional'), true, '任意欄は自動オープン（v1）');
  eq(s.get('defaultDurationMin'), 60, '終了なし→+1時間（v1 の決め打ち）');
  eq(s.get('silenceMs'), 1800, '無音1.8秒（v15/v16 の決め打ち）');
  eq(s.get('targetCalendarId'), '', '保存先=空=OS の既定カレンダー（v22 までの決め打ちと同じ挙動）');
});

t('全ての設定に label / hint / why がある（なぜ設定にしたかを残す）', () => {
  for (const d of DEFS) {
    ok(d.label && d.hint && d.why, `${d.key}: label/hint/why が揃っている`);
    ok(d.def !== undefined, `${d.key}: 既定値がある`);
  }
});

// ===== 保存と読込 =====
t('set した値が保存され、次回の起動で復元される', () => {
  const s1 = createSettings();
  s1.set('plainUtteranceIsNew', false);
  s1.set('silenceMs', 2500);
  s1.set('targetCalendarId', 'CAL-ABC-123');
  const s2 = createSettings(); // 再起動相当
  eq(s2.get('plainUtteranceIsNew'), false, 'boolean が復元');
  eq(s2.get('silenceMs'), 2500, 'number が復元');
  eq(s2.get('targetCalendarId'), 'CAL-ABC-123', 'text（保存先の識別子）が復元');
  eq(s2.get('protectManualEdits'), true, '触っていない設定は既定のまま');
});

// 保存先を選んだ状態から「既定に戻す」で OS の既定カレンダーへ戻れること
// （選択が復元できない端末に持ち込んだ時の逃げ道＝設定から抜け出せなくならない）
t('resetAll で保存先も既定（OS の既定カレンダー）に戻る', () => {
  const s = createSettings();
  s.set('targetCalendarId', 'CAL-XYZ');
  s.resetAll();
  eq(s.get('targetCalendarId'), '', '空＝OS の既定カレンダーへ');
  eq(createSettings().get('targetCalendarId'), '', '再起動しても既定');
});

t('resetAll で既定に戻り、保存も消える', () => {
  const s = createSettings();
  s.set('silenceMs', 4000);
  s.resetAll();
  eq(s.get('silenceMs'), 1800, '既定に戻る');
  eq(localStorage.getItem(KEY), null, '保存が消える');
  eq(createSettings().get('silenceMs'), 1800, '再起動しても既定');
});

// ===== 不変条件2: 壊れた保存値でも既定で動く =====
t('壊れた JSON でも既定で動く（黙って壊れない）', () => {
  localStorage.setItem(KEY, '{壊れた');
  const s = createSettings();
  eq(s.get('silenceMs'), 1800, '既定にフォールバック');
});

t('型が違う保存値は無視して既定を使う', () => {
  localStorage.setItem(KEY, JSON.stringify({ silenceMs: 'あああ', plainUtteranceIsNew: 'yes', targetCalendarId: 42 }));
  const s = createSettings();
  eq(s.get('silenceMs'), 1800, 'number でない → 既定');
  eq(s.get('plainUtteranceIsNew'), true, 'boolean でない → 既定');
  eq(s.get('targetCalendarId'), '', 'string でない → 既定＝OS の既定カレンダーへ倒れる');
});

t('未知のキーを set しても壊れない', () => {
  const s = createSettings();
  s.set('存在しないキー', 123);
  eq(s.get('存在しないキー'), undefined, '無視される');
  eq(s.get('silenceMs'), 1800, '他は無傷');
});

// ===== 購読 =====
t('subscribe で変更が通知される', () => {
  const s = createSettings();
  let got = null;
  s.subscribe((k, v) => { got = [k, v]; });
  s.set('autoOpenOptional', false);
  eq(got, ['autoOpenOptional', false], '通知される');
});

console.log(`\nsettings.test: ${pass} passed, ${fail} failed`);
if (failures.length) { console.log('\n' + failures.join('\n\n')); process.exit(1); }
