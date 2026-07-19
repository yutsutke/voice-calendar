// tests/dictionary.test.js — 辞書（言い換え展開・v37）の単体テスト
//
// 守る不変条件:
//   1. 展開は**最長一致優先**（「僕のメール」より「僕のメールアドレス」が勝つ）
//   2. **値は再展開しない**（{A→B, B→C} で A は B のまま＝連鎖・無限ループを作らない）
//   3. hits に「何が展開されたか」が必ず出る＝来歴 🔤 の材料（黙って置換しない＝v16）
//   4. キー2文字未満は登録も適用もしない（1文字キーは日本語で必ず誤爆する＝v22/v27 の罠）
//   5. 壊れた保存値は読める行だけで動く・書き込み失敗は投げる（settings/records と同じ）
'use strict';

const mem = new Map();
let failNextSet = false;
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => {
    if (failNextSet) { failNextSet = false; throw new Error('容量超過（模擬）'); }
    mem.set(k, String(v));
  },
  removeItem: (k) => mem.delete(k),
};

const Dict = require('../engine/dictionary.js');

let pass = 0, fail = 0;
const failures = [];
function t(name, fn) {
  mem.clear();
  failNextSet = false;
  try { fn(); pass++; }
  catch (e) { fail++; failures.push(`✗ ${name}\n    ${e.message}`); }
}
function eq(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label || ''} 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`);
  }
}
function ok(cond, label) { if (!cond) throw new Error(label || 'false だった'); }

// ===== expand（純関数）=====
t('基本: 言い回しが置き換わり hits に出る', () => {
  const r = Dict.expand('メモ 僕のメールアドレス', [{ k: '僕のメールアドレス', v: 'a@example.com' }]);
  eq(r.text, 'メモ a@example.com');
  eq(r.hits, [{ k: '僕のメールアドレス', v: 'a@example.com' }]);
});

t('ヒットなしなら text は入力のまま・hits は空', () => {
  const r = Dict.expand('明日15時に歯医者', [{ k: '僕のメールアドレス', v: 'a@example.com' }]);
  eq(r.text, '明日15時に歯医者');
  eq(r.hits, []);
});

t('最長一致優先: 短いキーは長いキーの内側を食わない', () => {
  const entries = [
    { k: '僕のメール', v: 'MAIL' },
    { k: '僕のメールアドレス', v: 'a@example.com' },
  ];
  const r = Dict.expand('僕のメールアドレスを送って', entries);
  eq(r.text, 'a@example.comを送って', '長い方が勝つ（MAILアドレス に化けない）');
  eq(r.hits.length, 1);
  eq(r.hits[0].k, '僕のメールアドレス');
});

t('値は再展開しない（連鎖・ループを作らない）', () => {
  const entries = [{ k: 'AA', v: 'BB' }, { k: 'BB', v: 'CC' }];
  const r = Dict.expand('AA', entries);
  eq(r.text, 'BB', 'AA→BB で止まる（CC まで行かない）');
});

t('同じキーが複数回出ても全部置き換わる・hits は1回', () => {
  const r = Dict.expand('会社の住所と会社の住所', [{ k: '会社の住所', v: '東京都X区1-2-3' }]);
  eq(r.text, '東京都X区1-2-3と東京都X区1-2-3');
  eq(r.hits.length, 1, 'hits はキー単位');
});

t('複数キーの同時ヒット', () => {
  const entries = [{ k: '僕のメールアドレス', v: 'a@b.c' }, { k: '会社の住所', v: '丸の内1-1' }];
  const r = Dict.expand('メモ 僕のメールアドレスと会社の住所', entries);
  eq(r.text, 'メモ a@b.cと丸の内1-1');
  eq(r.hits.length, 2);
});

t('正規表現のメタ文字を含むキーでも安全（エスケープ）', () => {
  const r = Dict.expand('A+B の件', [{ k: 'A+B', v: '合同案件' }]);
  eq(r.text, '合同案件 の件');
});

t('展開結果はパーサがそのまま読める（「僕の誕生日」→日付になる統合例）', () => {
  const r = Dict.expand('僕の誕生日に飲み会', [{ k: '僕の誕生日', v: '3月5日' }]);
  eq(r.text, '3月5日に飲み会', 'parser にこの文字列が渡る＝日付として解釈される');
});

t('2文字未満のキーは適用されない（1文字は日本語で必ず誤爆する）', () => {
  const r = Dict.expand('今から会議', [{ k: '今', v: 'NOW' }]);
  eq(r.text, '今から会議', '1文字キーは無視');
  eq(r.hits, []);
});

t('壊れたエントリ（値なし・キー欠損）は無視して生きた行だけ適用', () => {
  const entries = [
    { k: '僕のメールアドレス' },        // 値なし
    { v: 'x@y.z' },                     // キーなし
    'ただの文字列',
    { k: '会社の住所', v: '丸の内1-1' }, // 生きている
  ];
  const r = Dict.expand('会社の住所で', entries);
  eq(r.text, '丸の内1-1で');
});

t('空テキスト・空辞書はそのまま返す', () => {
  eq(Dict.expand('', [{ k: 'ああ', v: 'X' }]).text, '');
  eq(Dict.expand('ああ', []).text, 'ああ');
  eq(Dict.expand('ああ', null).text, 'ああ');
});

// ===== add / remove / list（永続化）=====
t('add → list → expand の統合', () => {
  Dict.add('僕のメールアドレス', 'a@example.com');
  const r = Dict.expand('メモ 僕のメールアドレス', Dict.list());
  eq(r.text, 'メモ a@example.com');
});

t('add は前後の空白を落とす・同じ言い回しの再登録は上書き', () => {
  Dict.add('  会社の住所  ', ' 丸の内1-1 ');
  eq(Dict.list(), [{ k: '会社の住所', v: '丸の内1-1' }]);
  Dict.add('会社の住所', '大手町2-2');
  eq(Dict.list(), [{ k: '会社の住所', v: '大手町2-2' }], '上書きで1件のまま');
});

t('add: 2文字未満・空の値は投げる（登録段階で弾く）', () => {
  let threw = 0;
  try { Dict.add('今', 'NOW'); } catch { threw++; }
  try { Dict.add('会社の住所', '  '); } catch { threw++; }
  eq(threw, 2);
  eq(Dict.list(), [], '弾かれた登録は残らない');
});

t('remove は指定キーだけ消す', () => {
  Dict.add('ああああ', 'A');
  Dict.add('いいいい', 'B');
  Dict.remove('ああああ');
  eq(Dict.list(), [{ k: 'いいいい', v: 'B' }]);
});

t('壊れた保存 JSON は空として動き、追加で復旧する', () => {
  localStorage.setItem(Dict.KEY, '{壊れた');
  eq(Dict.list(), []);
  Dict.add('会社の住所', '丸の内1-1');
  eq(Dict.list().length, 1);
});

t('保存値に壊れた行が混ざっていても読める行だけで動く', () => {
  localStorage.setItem(Dict.KEY, JSON.stringify([
    { k: 'x', v: 'short-key' },  // 1文字＝無効
    { k: '会社の住所', v: '丸の内1-1' },
    null,
  ]));
  eq(Dict.list(), [{ k: '会社の住所', v: '丸の内1-1' }]);
});

t('書き込み失敗は黙らず投げる（「登録したつもり」を作らない＝v16）', () => {
  failNextSet = true;
  let threw = false;
  try { Dict.add('会社の住所', '丸の内1-1'); } catch { threw = true; }
  ok(threw, 'add が例外を投げる');
  eq(Dict.list(), [], '「登録したフリ」の行が残らない');
});

console.log(`\ndictionary.test: ${pass} passed, ${fail} failed`);
if (failures.length) { console.log('\n' + failures.join('\n\n')); process.exit(1); }
