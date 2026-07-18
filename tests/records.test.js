// tests/records.test.js — ローカル記録台帳（v32）の単体テスト
//
// 守る不変条件:
//   1. 台帳は端末内 localStorage のみ（ローカル完結 SPEC §2）
//   2. 壊れた保存値は読める行だけで動く（黙って壊れない＝settings.js と同じ読み側フォールバック）
//   3. **書き込み失敗は黙らない**（「リストに記録しました」の後に実は消えていた、が台帳の最悪＝v16）
//   4. kind（予定/記録）は保存時に確定して焼き込む＝時間が経っても分類が動かない。明示 kind は導出に勝つ（v9 の原則）
'use strict';

// localStorage のミニ実装（Node には無い）＋書き込み失敗の注入口
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

const R = require('../adapters/records.js');

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

// adapters/calendar.js の materialize が返す形（{ title, start:Date, end:Date, allDay, location, note }）
function ev(title, startMs, extra) {
  return Object.assign(
    { title, start: new Date(startMs), end: new Date(startMs + 3600000), allDay: false, location: '', note: '' },
    extra
  );
}
const D = (ms) => new Date(ms);

// ===== 基本: add → list =====
t('add した記録が list で読める（全フィールド）', () => {
  const rec = R.add(ev('歯医者', 20000, { location: '駅前', note: '保険証' }), 'list', D(10000));
  const l = R.list();
  eq(l.length, 1, '1件');
  eq(l[0].title, '歯医者');
  eq(l[0].startMs, 20000);
  eq(l[0].endMs, 20000 + 3600000);
  eq(l[0].allDay, false);
  eq(l[0].location, '駅前');
  eq(l[0].note, '保険証');
  eq(l[0].savedAt, 10000);
  eq(l[0].dest, 'list');
  eq(l[0].id, rec.id, 'add の戻り値と同じ id');
});

t('list は開始時刻の昇順（過去→未来）・同時刻は保存順', () => {
  R.add(ev('C', 30000), 'list', D(3));
  R.add(ev('A', 10000), 'list', D(1));
  R.add(ev('B', 20000), 'list', D(2));
  R.add(ev('B2', 20000), 'list', D(5)); // 同 startMs → savedAt の順
  eq(R.list().map((r) => r.title), ['A', 'B', 'B2', 'C']);
});

t('remove は指定 id だけ消す', () => {
  const a = R.add(ev('A', 1000), 'list', D(1));
  const b = R.add(ev('B', 2000), 'list', D(2));
  R.remove(a.id);
  eq(R.list().map((r) => r.title), ['B']);
  eq(R.list()[0].id, b.id, '残った方は無傷');
});

t('clear で全部消える', () => {
  R.add(ev('A', 1000), 'list', D(1));
  R.clear();
  eq(R.list(), []);
});

t('dest: both はそのまま・未知値は list に正規化', () => {
  R.add(ev('A', 1000), 'both', D(1));
  R.add(ev('B', 2000), 'なにか', D(2));
  eq(R.list().map((r) => r.dest), ['both', 'list']);
});

// ===== 種類（kind・軸B）=====
t('kind: 開始が未来なら予定・今ちょうど/過去なら記録（保存時に確定）', () => {
  const now = D(10000);
  R.add(ev('未来', 20000), 'list', now);
  R.add(ev('過去', 5000), 'list', now);
  R.add(ev('同時', 10000), 'list', now);
  const byTitle = Object.fromEntries(R.list().map((r) => [r.title, r.kind]));
  eq(byTitle['未来'], 'plan', '未来=予定');
  eq(byTitle['過去'], 'record', '過去=記録');
  eq(byTitle['同時'], 'record', 'ちょうど今=記録（今は未来ではない）');
});

t('kind は保存値を復元・欠損は開始と保存時刻から導出・明示 kind が導出に勝つ（v9）', () => {
  localStorage.setItem(R.KEY, JSON.stringify([
    { id: 'a', title: 'A', startMs: 20000, savedAt: 10000 },              // kind 欠損・未来
    { id: 'b', title: 'B', startMs: 5000, savedAt: 10000 },               // kind 欠損・過去
    { id: 'c', title: 'C', startMs: 5000, savedAt: 10000, kind: 'plan' }, // 明示（時刻と矛盾しても従う）
  ]));
  const byTitle = Object.fromEntries(R.list().map((r) => [r.title, r.kind]));
  eq(byTitle['A'], 'plan', '欠損・未来→plan');
  eq(byTitle['B'], 'record', '欠損・過去→record');
  eq(byTitle['C'], 'plan', '明示 kind を上書きしない');
});

// ===== 読み側フォールバック（黙って壊れない）=====
t('壊れた JSON は空として動き、上から追加もできる', () => {
  localStorage.setItem(R.KEY, '{壊れた');
  eq(R.list(), [], '読みは空にフォールバック');
  R.add(ev('A', 1000), 'list', D(1));
  eq(R.list().map((r) => r.title), ['A'], '追加で復旧する');
});

t('配列でない保存値は空として動く', () => {
  localStorage.setItem(R.KEY, JSON.stringify({ not: 'array' }));
  eq(R.list(), []);
});

t('startMs の無い行だけ捨て、他の行は生かす', () => {
  localStorage.setItem(R.KEY, JSON.stringify([
    { id: 'x', title: '時系列の軸なし' },
    { id: 'y', title: '生きる', startMs: 5000, savedAt: 4000 },
    'ただの文字列',
  ]));
  eq(R.list().map((r) => r.title), ['生きる']);
});

t('id 欠損の行にも導出 id が付き remove できる', () => {
  localStorage.setItem(R.KEY, JSON.stringify([{ title: 'A', startMs: 5000, savedAt: 4000 }]));
  const l = R.list();
  ok(l[0].id, '導出 id が付く');
  R.remove(l[0].id);
  eq(R.list(), []);
});

// ===== id・上限・書き込み失敗 =====
t('同時刻・同内容の連続 add でも id が衝突しない', () => {
  const a = R.add(ev('A', 1000), 'list', D(500));
  const b = R.add(ev('A', 1000), 'list', D(500));
  ok(a.id !== b.id, `id が別（${a.id} / ${b.id}）`);
  R.remove(a.id);
  eq(R.list().length, 1, '片方だけ消える');
});

t('now を渡し忘れても現在時刻で動く（0=1970 に化けて最古扱い→CAP で消える罠の回帰）', () => {
  const rec = R.add(ev('A', Date.now() + 60000), 'list');
  ok(rec.savedAt > 1000000000000, `savedAt が現実の現在時刻（実際 ${rec.savedAt}）`);
  eq(rec.kind, 'plan', '1分後開始=予定');
});

t('上限 CAP を超えたら最古（savedAt 昇順）から落とす', () => {
  for (let i = 0; i < R.CAP + 5; i++) R.add(ev(`E${i}`, 1000 + i), 'list', D(1000 + i));
  const l = R.list();
  eq(l.length, R.CAP, 'CAP 件に収まる');
  ok(!l.some((r) => r.title === 'E0'), '最古の E0 は落ちた');
  ok(l.some((r) => r.title === `E${R.CAP + 4}`), '最新は残る');
});

t('書き込み失敗は黙らず投げる（「入ったつもり」を作らない＝v16）', () => {
  failNextSet = true;
  let threw = false;
  try { R.add(ev('A', 1000), 'list', D(1)); } catch { threw = true; }
  ok(threw, 'add が例外を投げる');
  eq(R.list(), [], '台帳に「入ったフリ」の行が残らない');
});

console.log(`\nrecords.test: ${pass} passed, ${fail} failed`);
if (failures.length) { console.log('\n' + failures.join('\n\n')); process.exit(1); }
