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

t('上限 CAP を超えたら最古（savedAt 昇順）から落とし、dropped で告げる（黙って捨てない）', () => {
  let last = null;
  for (let i = 0; i < R.CAP + 5; i++) last = R.add(ev(`E${i}`, 1000 + i), 'list', D(1000 + i));
  const l = R.list();
  eq(l.length, R.CAP, 'CAP 件に収まる');
  ok(!l.some((r) => r.title === 'E0'), '最古の E0 は落ちた');
  ok(l.some((r) => r.title === `E${R.CAP + 4}`), '最新は残る');
  eq(last.dropped, 1, '超過時の add は dropped を返す＝呼び出し側が toast で告げる');
  const fresh = R.add(ev('X', 1), 'list', D(R.CAP * 10)); // 追加でまた1件超過
  eq(fresh.dropped, 1, '以後も1件ずつ告げる');
});

t('書き込み失敗は黙らず投げる（「入ったつもり」を作らない＝v16）', () => {
  failNextSet = true;
  let threw = false;
  try { R.add(ev('A', 1000), 'list', D(1)); } catch { threw = true; }
  ok(threw, 'add が例外を投げる');
  eq(R.list(), [], '台帳に「入ったフリ」の行が残らない');
});

// ===== CSV 書き出し（v36）=====
// ローカル時刻でセルを組む＝テストも Date コンストラクタで組んで TZ 非依存にする
const MS = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h || 0, mi || 0).getTime();
const CRLF = String.fromCharCode(13, 10);

t('toCsv: BOM で始まり CRLF 区切り・ヘッダ行がある', () => {
  const csv = R.toCsv([]);
  eq(csv.charCodeAt(0), 0xFEFF, '先頭が BOM（無いと Excel で日本語が化ける）');
  const lines = csv.slice(1).split(CRLF);
  eq(lines[0], '種類,タイトル,開始日,開始時刻,終了日,終了時刻,終日,場所,メモ,保存先,保存日時,緯度,経度,改訂,出所,訂正,生テキスト,認識信頼度,経路,扱い,保存操作,辞書,補完確定,解釈注記,解釈エラー');
  eq(lines[1], '', '末尾は CRLF で終わる（RFC4180）');
});

t('toCsv: 1行の全列（予定・時刻あり・リスト・位置なし＝末尾列は空）', () => {
  const csv = R.toCsv([{
    kind: 'plan', title: '歯医者', startMs: MS(2026, 7, 20, 15, 0), endMs: MS(2026, 7, 20, 16, 30),
    allDay: false, location: '駅前', note: '保険証', dest: 'list', savedAt: MS(2026, 7, 19, 9, 5),
  }]);
  eq(csv.slice(1).split(CRLF)[1],
    '予定,歯医者,2026-07-20,15:00,2026-07-20,16:30,,駅前,保険証,リスト,2026-07-19 09:05,,,,,,,,,,,,,,'); // v59: 発話メタ9列は空（手作りの行＝utter/auto なし）
});

t('toCsv: 終日は時刻列が空・終日列に○（言っていない時刻を列でも創作しない）', () => {
  const csv = R.toCsv([{
    kind: 'record', title: '休み', startMs: MS(2026, 7, 19), endMs: MS(2026, 7, 19),
    allDay: true, location: '', note: '', dest: 'both', savedAt: MS(2026, 7, 19, 8, 0),
  }]);
  eq(csv.slice(1).split(CRLF)[1],
    '記録,休み,2026-07-19,,2026-07-19,,○,,,両方,2026-07-19 08:00,,,,,,,,,,,,,,'); // v59: 発話メタ9列は空
});

t('toCsv: 位置情報のある行は緯度・経度列に出る（v38）', () => {
  const csv = R.toCsv([{
    kind: 'record', title: '着いた', startMs: MS(2026, 7, 19, 12, 0), endMs: MS(2026, 7, 19, 12, 0),
    allDay: false, location: '', note: '', dest: 'list', savedAt: MS(2026, 7, 19, 12, 0),
    lat: 35.68123, lng: 139.76712,
  }]);
  ok(csv.includes(',35.68123,139.76712'), '緯度経度が末尾列に出る');
});

t('toCsv: カンマ・引用符・改行を含むセルは RFC4180 で引用される', () => {
  const csv = R.toCsv([{
    kind: 'record', title: 'A,B', startMs: MS(2026, 1, 1, 0, 0), endMs: MS(2026, 1, 1, 0, 0),
    allDay: false, location: 'say "hi"', note: '1行目\n2行目', dest: 'list', savedAt: MS(2026, 1, 1, 0, 0),
  }]);
  const body = csv.slice(1).split(CRLF).slice(1).join(CRLF); // メモ内の改行で行が割れるので残り全部を見る
  ok(body.includes('"A,B"'), `カンマ入りは引用（実際: ${body}）`);
  ok(body.includes('"say ""hi"""'), '引用符は二重化して引用');
  ok(body.includes('"1行目\n2行目"'), '改行入りセルは引用の中に収まる');
});

t('toCsv: 行の順序は渡された順のまま（並べ替えは呼び出し側＝list() の責務）', () => {
  const row = (title, h) => ({ kind: 'record', title, startMs: MS(2026, 7, 19, h, 0), endMs: MS(2026, 7, 19, h, 0), allDay: false, location: '', note: '', dest: 'list', savedAt: MS(2026, 7, 19, h, 0) });
  const csv = R.toCsv([row('B', 10), row('A', 9)]);
  const lines = csv.slice(1).split(CRLF);
  ok(lines[1].startsWith('記録,B,'), '1行目=B（渡した順）');
  ok(lines[2].startsWith('記録,A,'), '2行目=A');
});

t('toCsv: list() の実データがそのまま書ける（add → list → toCsv の統合）', () => {
  R.add(ev('会議', MS(2026, 7, 20, 10, 0), { location: '丸の内' }), 'both', D(MS(2026, 7, 19, 9, 0)));
  const csv = R.toCsv(R.list());
  const line = csv.slice(1).split(CRLF)[1];
  ok(line.startsWith('予定,会議,2026-07-20,10:00,'), `list() の行が出る（実際: ${line}）`);
  ok(line.includes(',丸の内,'), '場所が出る');
  ok(line.endsWith(',両方,2026-07-19 09:00,,,,,,,,,,,,,,'), '保存先と保存日時が出る（位置なし＝末尾空・出所/訂正・発話メタ9列も空）');
});

// ===== 位置情報（v38）=====
t('attachGeo: 保存済みの行に緯度経度が付き、リロード相当でも残る', () => {
  const rec = R.add(ev('着いた', 5000), 'list', D(5000));
  const updated = R.attachGeo(rec.id, 35.681236789, 139.767125456);
  eq(updated.lat, 35.68124, '5桁（約1m）に丸め');
  eq(updated.lng, 139.76713);
  const l = R.list();
  eq(l[0].lat, 35.68124, '永続化されて list で読める');
  eq(l[0].lng, 139.76713);
});

t('attachGeo: 無い id は null（上限で消えた行など＝呼び出し側が診断に出す）', () => {
  eq(R.attachGeo('r-nothing', 35, 139), null);
});

t('attachGeo: 数値でない座標は付けずに null（壊れた値を書き込まない）', () => {
  const rec = R.add(ev('A', 5000), 'list', D(5000));
  eq(R.attachGeo(rec.id, 'abc', 139), null);
  ok(!('lat' in R.list()[0]), '行は無傷（lat が生えない）');
});

t('位置情報の片方だけ・壊れた保存値は無かったことに（読み側フォールバック）', () => {
  localStorage.setItem(R.KEY, JSON.stringify([
    { id: 'a', title: 'A', startMs: 5000, savedAt: 4000, lat: 35.6 },              // lng 欠損
    { id: 'b', title: 'B', startMs: 6000, savedAt: 4000, lat: 'x', lng: 'y' },     // 壊れた値
    { id: 'c', title: 'C', startMs: 7000, savedAt: 4000, lat: 35.6, lng: 139.7 },  // 正常
  ]));
  const byTitle = Object.fromEntries(R.list().map((r) => [r.title, r]));
  ok(!('lat' in byTitle['A']), '片方欠損は持たない');
  ok(!('lat' in byTitle['B']), '壊れた値は持たない');
  eq(byTitle['C'].lat, 35.6, '正常な行は残る');
});

// ===== v54: 保存済みの行を直す（update / revTitle）=====
// カレンダーは読めない＝古い予定を書き換えられない。だからリストは差し替え、カレンダーへは
// 「改正vol{rev}」を付けて**別の予定として追加**する（ゆう決定）。rev を数えるのはここだけ。
t('v54: update で行が差し替わり rev が上がる（id は変わらない）', () => {
  const rec = R.add(ev('会議', 20000), 'both', D(10000));
  eq(rec.rev, 1, '初回保存は 1');
  const up = R.update(rec.id, ev('経営会議', 30000), D(15000));
  eq(up.id, rec.id, '同じ行を差し替える（新しい行を作らない）');
  eq(up.rev, 2);
  eq(R.list().length, 1, 'リストは1行のまま');
  eq(R.list()[0].title, '経営会議');
  eq(R.list()[0].startMs, 30000);
  eq(R.list()[0].savedAt, 15000, '直した時刻に更新される（いつの版か）');
});

t('v54: 何度直しても rev は 1 ずつ増える', () => {
  const rec = R.add(ev('会議', 20000), 'both', D(10000));
  eq(R.update(rec.id, ev('a', 20000), D(11000)).rev, 2);
  eq(R.update(rec.id, ev('b', 20000), D(12000)).rev, 3);
  eq(R.update(rec.id, ev('c', 20000), D(13000)).rev, 4);
});

t('🚨 v54: dest は**元の行**を引き継ぐ（今の設定で化けない）', () => {
  const both = R.add(ev('両方で保存', 20000), 'both', D(10000));
  const only = R.add(ev('リストだけ', 20000), 'list', D(10001));
  eq(R.update(both.id, ev('両方で保存2', 20000), D(15000)).dest, 'both', '元がカレンダーにも入った行＝入れ直す');
  eq(R.update(only.id, ev('リストだけ2', 20000), D(15000)).dest, 'list', '元がリストだけ＝カレンダーには触らない');
});

t('v54: 開始を直すと kind（予定/記録）も付け直す（add と同じ規則）', () => {
  const rec = R.add(ev('未来の予定', 90000), 'list', D(10000));
  eq(rec.kind, 'plan');
  eq(R.update(rec.id, ev('過去へ移した', 5000), D(50000)).kind, 'record', '開始が過去になったら記録');
  eq(R.update(rec.id, ev('未来へ戻した', 99000), D(50000)).kind, 'plan');
});

t('v54: 位置情報は引き継ぐ（保存した時にいた場所＝直しても変わらない）', () => {
  const rec = R.add(ev('現地', 20000), 'list', D(10000));
  R.attachGeo(rec.id, 35.681236, 139.767125);
  const up = R.update(rec.id, ev('現地（直した）', 20000), D(15000));
  eq(up.lat, 35.68124);
  eq(up.lng, 139.76713);
});

t('v54: 行が無い id の update は null（黙って新規を作らない）', () => {
  R.add(ev('ある行', 20000), 'list', D(10000));
  eq(R.update('no-such-id', ev('幽霊', 20000), D(15000)), null);
  eq(R.list().length, 1, '台帳は増えない');
});

t('v54: 旧レコード（rev 欠損・壊れた値）は 1 として読める', () => {
  mem.set('vc_records_v1', JSON.stringify([
    { id: 'a', title: '旧', startMs: 20000, endMs: 20000, savedAt: 10000, dest: 'list' },
    { id: 'b', title: '壊れ', startMs: 20000, endMs: 20000, savedAt: 10000, dest: 'list', rev: 'あ' },
    { id: 'c', title: '負', startMs: 20000, endMs: 20000, savedAt: 10000, dest: 'list', rev: -5 },
  ]));
  eq(R.list().map((r) => r.rev), [1, 1, 1]);
  eq(R.update('a', ev('旧を直す', 20000), D(15000)).rev, 2, '欠損からでも 2 になる');
});

t('🚨 v54: revTitle は台帳の title を汚さない（版マークが積み重ならない）', () => {
  eq(R.revTitle('会議', 1), '会議', '初回はマークを付けない');
  eq(R.revTitle('会議', 2), '会議（改正vol2）', '末尾＝月表示でも予定名の先頭が読める（ゆう決定）');
  eq(R.revTitle('会議', 3), '会議（改正vol3）');
  const rec = R.add(ev('会議', 20000), 'both', D(10000));
  const up = R.update(rec.id, ev('会議', 20000), D(15000));
  eq(up.title, '会議', '台帳の title にマークは入らない＝次に直しても二重にならない');
  eq(R.revTitle(R.revTitle(up.title, up.rev), up.rev + 1), '会議（改正vol2）（改正vol3）',
    '※二重に掛ければ当然二重になる＝だから台帳に書き戻さない、が不変条件');
});

t('v54: revTitle は壊れた rev でも素の title を返す（throw しない）', () => {
  eq(R.revTitle('会議', undefined), '会議');
  eq(R.revTitle('会議', 'あ'), '会議');
  eq(R.revTitle(null, 3), '（改正vol3）', 'タイトル無しは保存側で「予定」が入る＝ここは素直に');
});

t('v54: CSV の「改訂」列は直した行だけ数字が入る', () => {
  const a = R.add(ev('直した', 20000), 'list', D(10000));
  R.add(ev('直してない', 21000), 'list', D(10001));
  R.update(a.id, ev('直した', 20000), D(15000));
  const rows = R.list();
  const lines = R.toCsv(rows).replace(/^﻿/, '').trim().split('\r\n');
  const revIdx = lines[0].split(',').indexOf('改訂'); // v57 で末尾に「出所」「訂正」が足された＝位置でなく見出しで探す
  ok(revIdx >= 0, '改訂列がある');
  const byTitle = {};
  for (const l of lines.slice(1)) { const c = l.split(','); byTitle[c[1]] = c[revIdx]; }
  eq(byTitle['直した'], '2');
  eq(byTitle['直してない'], '', '直していない行は空＝1 で埋めない');
});

// ===== v57: 出所内訳と訂正の焼き込み（スパン出所追跡 B） =====
t('v57: add が info の prov/fix を焼き・list で読める', () => {
  R.add(ev('会議', 20000), 'list', D(10000), { prov: { title: 'transcript', startDate: 'inferred' }, fix: { startDate: 'inferred' } });
  const r = R.list()[0];
  eq(r.prov, { title: 'transcript', startDate: 'inferred' });
  eq(r.fix, { startDate: 'inferred' });
});

t('v57: info 無し・空の info は何も焼かない（出所を創作しない＝旧挙動のまま）', () => {
  R.add(ev('a', 20000), 'list', D(10000));
  R.add(ev('b', 21000), 'list', D(10001), { prov: {}, fix: {} });
  const rows = R.list();
  ok(!('prov' in rows[0]) && !('fix' in rows[0]), 'info なし');
  ok(!('prov' in rows[1]) && !('fix' in rows[1]), '空 info');
});

t('v57: 壊れた出所値は読める分だけ残す（黙って壊れない）', () => {
  R.add(ev('a', 20000), 'list', D(10000), { prov: { title: 'transcript', startDate: '謎', startTime: 42 }, fix: '文字列' });
  const r = R.list()[0];
  eq(r.prov, { title: 'transcript' }, '知らない値は捨てる');
  ok(!('fix' in r), 'オブジェクトでない fix は持たない');
});

t('v57: update はこの版の info を焼く・古い版の出所を引き継がない（昔の出所で今の値を偽らない）', () => {
  const a = R.add(ev('会議', 20000), 'list', D(10000), { prov: { title: 'transcript' } });
  R.update(a.id, ev('会議2', 20000), D(15000)); // info なし
  ok(!('prov' in R.list()[0]), '引き継がない＝不明は不明のまま');
  R.update(a.id, ev('会議3', 20000), D(16000), { prov: { title: 'human' }, fix: { title: 'transcript' } });
  eq(R.list()[0].prov, { title: 'human' });
  eq(R.list()[0].fix, { title: 'transcript' });
});

t('v57: CSV に「出所」「訂正」列（末尾・無い行は空・確/推/手の記法）', () => {
  R.add(ev('あり', 20000), 'list', D(10000), { prov: { title: 'transcript', startDate: 'inferred', startTime: 'human' }, fix: { startDate: 'inferred' } });
  R.add(ev('なし', 21000), 'list', D(10001));
  const lines = R.toCsv(R.list()).replace(/^﻿/, '').trim().split('\r\n');
  const heads = lines[0].split(',');
  const provIdx = heads.indexOf('出所');
  eq(heads[provIdx + 1], '訂正', '出所の隣が訂正（v59 で発話メタ列が後ろに足された＝位置でなく見出しで探す）');
  const byTitle = {};
  for (const l of lines.slice(1)) { const c = l.split(','); byTitle[c[1]] = { p: c[provIdx], f: c[provIdx + 1] }; }
  eq(byTitle['あり'].p, 'title=確 startDate=推 startTime=手');
  eq(byTitle['あり'].f, 'startDate=推');
  eq(byTitle['なし'].p, '', '無い行は空＝創作しない');
  eq(byTitle['なし'].f, '');
});

t('v57: 「?」（出所情報なし）も保てる＝不明を不明のまま数えられる', () => {
  R.add(ev('a', 20000), 'list', D(10000), { prov: { title: '?' } });
  eq(R.list()[0].prov, { title: '?' });
  const lines = R.toCsv(R.list()).replace(/^﻿/, '').trim().split('\r\n');
  ok(lines[1].includes('title=?'), 'CSV でも ? のまま');
});

// ===== v59: 発話メタ（計測 CSV の検証スキーマ）=====
// ゆう方針「リストは必要な情報だけ／検証用（CSV）はできるだけ細かく」。来歴が持っていた情報を保存レコードにも載せる。
t('v59: 発話メタと保存操作を info から焼く（無効な形は捨てる・黙って壊れない）', () => {
  R.add(ev('会議', 20000), 'list', D(10000), {
    utter: { text: '10時会議', conf: 0.97, path: 'rule', isNew: true, fallback: true, dict: [{ k: '僕', v: 'ゆう' }], notes: ['⚠夕方あたり'], err: '' },
    save: { auto: true },
  });
  const r = R.list()[0];
  eq(r.utter.text, '10時会議');
  eq(r.utter.conf, 0.97);
  eq(r.utter.path, 'rule');
  eq(r.utter.isNew, true);
  eq(r.utter.fallback, true);
  eq(r.utter.dict, [{ k: '僕', v: 'ゆう' }]);
  eq(r.utter.notes, ['⚠夕方あたり']);
  eq(r.auto, true);
  ok(!('err' in r.utter), '空の err は焼かない（無かったことを創作しない）');
  ok(!('targeted' in r.utter), '偽の扱いは持たない');
});

t('v59: 未知の経路・壊れた値・空の発話メタは持たない（旧レコードもそのまま読める）', () => {
  R.add(ev('a', 20000), 'list', D(10000), { utter: { path: 'nope', conf: 'x', dict: 'bad', text: '' } });
  ok(!('utter' in R.list()[0]), '中身が全部無効＝utter を持たない');
  R.add(ev('b', 21000), 'list', D(10001), { utter: 'not-an-object' });
  ok(!('utter' in R.list().find((x) => x.title === 'b')), '非オブジェクトは無視');
  R.add(ev('c', 22000), 'list', D(10002)); // info 無し
  ok(!('utter' in R.list().find((x) => x.title === 'c')) && !('auto' in R.list().find((x) => x.title === 'c')), 'info 無しは utter も auto も持たない（旧挙動不変）');
});

t('v59: 発話メタは localStorage 往復で保たれる（stage/records と同じ・再読込で落ちない）', () => {
  R.add(ev('会議', 20000), 'list', D(10000), { utter: { text: 'A', path: 'ai', conf: 0.8 }, save: { auto: false } });
  const again = require('../adapters/records.js').list()[0]; // 同じ localStorage を読み直す
  eq(again.utter.text, 'A');
  eq(again.utter.path, 'ai');
  eq(again.auto, false);
});

t('v59: update はこの版の発話メタ/保存操作を焼く（声で直せば付く・喋らなければ付かない）', () => {
  const rec = R.add(ev('会議', 20000), 'list', D(10000), { utter: { text: 'A', path: 'rule' }, save: { auto: true } });
  R.update(rec.id, ev('会議', 20000), D(11000), { utter: { text: '場所 丸の内', path: 'rule' }, save: { auto: false } });
  const r = R.list()[0];
  eq(r.utter.text, '場所 丸の内', '新しい版の発話メタ（古い版を引き継がない）');
  eq(r.auto, false, '更新して保存＝手動');
});

t('v59: CSV に発話メタ列が出る（経路ラベル/信頼度%/扱い/保存操作/辞書/補完確定/解釈注記/解釈エラー）', () => {
  R.add(ev('会議', MS(2026, 7, 20, 10, 0)), 'list', D(MS(2026, 7, 19, 9, 0)), {
    utter: { text: '10時会議', conf: 0.97, path: 'ai-multi', targeted: true, fallback: true, dict: [{ k: '僕の番号', v: '090' }], notes: ['⚠曖昧'], err: 'timeout' },
    save: { auto: true },
  });
  const lines = R.toCsv(R.list()).replace(/^﻿/, '').trim().split('\r\n');
  const h = lines[0].split(','), c = lines[1].split(','); // 値にカンマを含めていないので位置で読める
  const at = (name) => c[h.indexOf(name)];
  eq(at('生テキスト'), '10時会議');
  eq(at('認識信頼度'), '97%');
  eq(at('経路'), 'AI（複数）');
  eq(at('扱い'), '欄指定', 'targeted が isNew より優先');
  eq(at('保存操作'), '自動');
  eq(at('辞書'), '「僕の番号」→「090」');
  eq(at('補完確定'), '○');
  eq(at('解釈注記'), '⚠曖昧');
  eq(at('解釈エラー'), 'timeout');
});

t('v59: 保存操作は自動/手動を書き分ける（ノールックの直接の信号）', () => {
  R.add(ev('a', 20000), 'list', D(10000), { save: { auto: false } });
  const lines = R.toCsv(R.list()).replace(/^﻿/, '').trim().split('\r\n');
  const h = lines[0].split(','), c = lines[1].split(',');
  eq(c[h.indexOf('保存操作')], '手動');
});

// ===== v75: find(id) ＝来歴からも保存済みを直せるようにしたので「行を名指しで取る」道が要る =====
// 🚨 ここが null を返すべき時に何かを返すと、**来歴の ✏️ が別の記録を直してしまう**（黙って作らない）。
t('v75: find は id で1行だけ返す', () => {
  const a = R.add(ev('会議', 20000), 'list', D(10000));
  const b = R.add(ev('歯医者', 30000), 'list', D(10000));
  eq(R.find(a.id).title, '会議');
  eq(R.find(b.id).title, '歯医者');
});

t('v75: 消えた行の find は null（来歴の ✏️ が幽霊を直さない）', () => {
  const a = R.add(ev('会議', 20000), 'list', D(10000));
  R.remove(a.id);
  eq(R.find(a.id), null);
});

t('v75: 空・null・未知の id は null（先頭行に落とさない）', () => {
  R.add(ev('会議', 20000), 'list', D(10000));
  eq(R.find(''), null);
  eq(R.find(null), null);
  eq(R.find(undefined), null);
  eq(R.find('r-存在しない'), null);
});

t('v75: 直した後も同じ id で引ける（rev が上がってもタイトルは最新）', () => {
  const a = R.add(ev('会議', 20000), 'both', D(10000));
  R.update(a.id, ev('打ち合わせ', 20000), D(11000));
  const got = R.find(a.id);
  eq(got.title, '打ち合わせ', '来歴の ✏️ のラベルは常に台帳の今の値');
  eq(got.rev, 2);
});

t('v75: 台帳が壊れていても find は落ちない（読める行だけで答える）', () => {
  const a = R.add(ev('会議', 20000), 'list', D(10000));
  const raw = JSON.parse(mem.get(R.KEY));
  raw.push(null, 'ゴミ', { title: 'id なし' });
  mem.set(R.KEY, JSON.stringify(raw));
  eq(R.find(a.id).title, '会議');
});

console.log(`\nrecords.test: ${pass} passed, ${fail} failed`);
if (failures.length) { console.log('\n' + failures.join('\n\n')); process.exit(1); }
