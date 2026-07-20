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

// ===== diffPair（v44）: 手直しの前後差分から (キー,値) を作る =====
// 「登録するか」は人がボタンで決める＝ここは**材料を作るだけ**。学べない時は null（ボタンを出さない）。
t('🚨 diffPair: 1文字差でも文脈を巻き込んでキーを伸ばす（人名の誤認識を学べるようにする）', () => {
  // 最小差分は「居→井」の1文字＝居酒屋・住居にも当たる。左の文脈を足して固有名詞として特定する
  eq(Dict.diffPair('今居さんと会議', '今井さんと会議'), { k: '今居', v: '今井' });
  eq(Dict.diffPair('田中さんと打合せ', '田仲さんと打合せ'), { k: '田中', v: '田仲' });
  eq(Dict.MIN_KEY_LEN, 2, 'expand/add と同じ閾値を使う');
});

t('diffPair: 語がまるごと違う時は最小範囲のまま（伸ばす必要が無い）', () => {
  eq(Dict.diffPair('ヨコハマ支店で会議', '横浜支店で会議'), { k: 'ヨコハマ', v: '横浜' });
  eq(Dict.diffPair('会議は青山支店', '会議は青山支社'), { k: '支店', v: '支社' });
});

t('🚨 diffPair: 日時になる語はキーにしない（辞書は解釈より前＝予定が静かにずれる）', () => {
  // 宿主が parser を注入する述語。ここでは「今日/明日/N時」を日時とみなすスタブ
  const rejectKey = (k) => /今日|明日|昨日|\d+時|来週|今週/.test(k);
  eq(Dict.diffPair('今日の会議', '明日の会議', { rejectKey }), null, '今日→明日 を登録したら以後ずっと日付がずれる');
  eq(Dict.diffPair('3時の打合せ', '4時の打合せ', { rejectKey }), null, '時刻も同じ');
  // 日時でない言い換えは通す（本人がボタンを押した意思表明）
  eq(Dict.diffPair('会議は青山支店', '会議は青山支社', { rejectKey }), { k: '支店', v: '支社' });
});

t('diffPair: 述語が壊れていても学習側を殺さない（迷ったら学ばない）', () => {
  const boom = () => { throw new Error('壊れた述語'); };
  eq(Dict.diffPair('今居さんと会議', '今井さんと会議', { rejectKey: boom }), null, '例外は「危険」側に倒す');
  eq(Dict.diffPair('今居さんと会議', '今井さんと会議', {}), { k: '今居', v: '今井' }, '未注入なら従来どおり');
});

t('diffPair: 学べないものは null（ボタンを出さない）', () => {
  eq(Dict.diffPair('会議', '会議'), null, '変わっていない');
  eq(Dict.diffPair('', '会議'), null, '音声が書いていない欄＝学ぶ元が無い');
  eq(Dict.diffPair('会議', ''), null, '全部消した＝置き換えではない');
  eq(Dict.diffPair(null, undefined), null);
  eq(Dict.diffPair('会議室で打合せ', '会議室で'), null, '削除だけ（値が空）は学ばない');
});

t('diffPair: 全部書き換えたらキーは丸ごと長くなる（長いキーほど誤爆しにくい＝安全側）', () => {
  const p = Dict.diffPair('えーっとなんだっけ', '歯医者の予約');
  eq(p, { k: 'えーっとなんだっけ', v: '歯医者の予約' });
  ok(p.k.length >= Dict.MIN_KEY_LEN);
});

t('diffPair: 学習した結果が expand でそのまま効く（往復が閉じている）', () => {
  const p = Dict.diffPair('今居さんと会議', '今井さんと会議');
  Dict.add(p.k, p.v);
  const r = Dict.expand('明日15時に今居さんと会議', Dict.list());
  eq(r.text, '明日15時に今井さんと会議');
  eq(r.hits, [{ k: '今居', v: '今井' }], '🔤 で見える＝黙って置換しない');
});

t('diffPair: コードポイント単位で見る（絵文字を割らない）', () => {
  const p = Dict.diffPair('打合せ🙂です', '打合せ🎉です');
  eq(p, { k: 'せ🙂', v: 'せ🎉' }, '1コードポイント差 → 文脈を1つ巻き込んで2コードポイントに');
  eq(Array.from(p.k).length, 2, 'サロゲートペアを割っていない（割れば length 2 の壊れた鍵になる）');
  ok(p.k.includes('🙂'), '絵文字が壊れていない');
});

console.log(`\ndictionary.test: ${pass} passed, ${fail} failed`);
if (failures.length) { console.log('\n' + failures.join('\n\n')); process.exit(1); }
