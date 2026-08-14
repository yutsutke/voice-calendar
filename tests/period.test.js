// tests/period.test.js — 期間の窓（v91・node tests/period.test.js）
//
// なぜ厚めに縛るか: 期間は**境目で間違えても画面は普通に動く**（1件多い/少ないだけ）＝目では気づけない。
//   「12:00 ちょうどは午前か午後か」「3日は今日を含むか」は決めの問題で、**決めをテストが仕様書にする**
//   （parser の決め打ちルールと同じ扱い）。
//
// 守る不変条件:
//   1. 窓は [from, to) の半開区間＝境目が二重に入らない・落ちない
//   2. 「三日」「一週間」は**今日を含む**日数（72時間ではない）
//   3. 全期間 = 窓なし（既定）＝ 絞らない人の見え方は変わらない
//   4. 任意の期間は片側だけでも効く／**終了日はその日を含む**
//   5. 🚫 逆順（開始 > 終了）を**黙って入れ替えない**＝理由を言葉で返す
//   6. 壊れた保存値・存在しない日付は既定へ倒れる（黙って壊れない・言っていない日付を作らない）
'use strict';

const P = require('../engine/period.js');

let pass = 0;
const failures = [];
function t(name, fn) {
  try { fn(); pass++; }
  catch (e) { failures.push(`✗ ${name}\n    ${e.message}`); }
}
function ok(cond, label) { if (!cond) throw new Error(label || 'false だった'); }
function eq(a, b, label) { if (a !== b) throw new Error(`${label || ''} 期待 ${b} / 実際 ${a}`); }

const NOW = new Date(2026, 7, 14, 15, 30);          // 2026-08-14（金）15:30
const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const win = (id, extra) => P.windowFor(Object.assign({ id }, extra || {}), NOW);

// ===== 1. 選択肢の並びと既定 =====
t('選択肢はゆうが挙げた順（画面の並びをここ1箇所に持つ）', () => {
  eq(P.PRESETS.map((p) => p.id).join(','), 'am,pm,today,d3,w1,all,custom');
  eq(P.PRESETS.map((p) => p.label).join(','), '今日の午前,今日の午後,今日,3日,1週間,全期間,任意の期間');
});
t('既定は全期間＝窓なし（触らない人の見え方は変わらない）', () => {
  eq(P.DEFAULT_ID, 'all');
  eq(P.windowFor(null, NOW), null);
  eq(P.windowFor({ id: 'all' }, NOW), null);
  eq(P.windowFor({ id: '知らない値' }, NOW), null);   // 未知は既定へ
});

// ===== 2. 今日の午前／午後／今日 =====
t('今日の午前 = 0:00〜12:00', () => {
  const w = win('am');
  eq(w.from, at(2026, 8, 14, 0, 0), 'from');
  eq(w.to, at(2026, 8, 14, 12, 0), 'to');
});
t('今日の午後 = 12:00〜翌0:00', () => {
  const w = win('pm');
  eq(w.from, at(2026, 8, 14, 12, 0), 'from');
  eq(w.to, at(2026, 8, 15, 0, 0), 'to');
});
t('12:00 ちょうどは午後（半開区間＝境目は下に入る）', () => {
  const noon = at(2026, 8, 14, 12, 0);
  eq(P.inWindow(noon, win('am')), false, '午前に入ってしまう');
  eq(P.inWindow(noon, win('pm')), true, '午後に入らない');
});
t('0:00 ちょうどは今日（前日の窓には入らない）', () => {
  const zero = at(2026, 8, 14, 0, 0);
  eq(P.inWindow(zero, win('today')), true);
  eq(P.inWindow(zero, win('am')), true);
  eq(P.inWindow(at(2026, 8, 13, 23, 59), win('today')), false, '昨日の23:59が今日に入る');
});
t('今日 = 0:00〜翌0:00（午前と午後の合併）', () => {
  const w = win('today');
  eq(w.from, win('am').from);
  eq(w.to, win('pm').to);
});

// ===== 3. 三日・一週間は「今日を含む日数」 =====
t('3日 = 一昨日0:00〜明日0:00（今日を含む3日ぶん）', () => {
  const w = win('d3');
  eq(w.from, at(2026, 8, 12, 0, 0), 'from');
  eq(w.to, at(2026, 8, 15, 0, 0), 'to');
  eq((w.to - w.from) / 86400000, 3, '3日ぶんになっていない');
});
t('1週間 = 6日前0:00〜明日0:00（今日を含む7日ぶん）', () => {
  const w = win('w1');
  eq(w.from, at(2026, 8, 8, 0, 0), 'from');
  eq((w.to - w.from) / 86400000, 7, '7日ぶんになっていない');
});
t('3日は「72時間前」ではない（日付境界で切る）', () => {
  // 15:30 に「3日」を選んだ時、一昨日の朝 8:00 は**入る**（72時間前は一昨日 15:30 なので落ちてしまう）
  eq(P.inWindow(at(2026, 8, 12, 8, 0), win('d3')), true);
  eq(P.inWindow(at(2026, 8, 11, 23, 59), win('d3')), false, '3日より前が入っている');
});
t('月をまたいでも数え間違えない', () => {
  const w = P.windowFor({ id: 'd3' }, new Date(2026, 8, 1, 10, 0)); // 9/1
  eq(w.from, at(2026, 8, 30, 0, 0), 'from（8/30）');
  eq(w.to, at(2026, 9, 2, 0, 0), 'to（9/2）');
});

// ===== 4. 未来の予定の扱い（決めを固定する） =====
t('未来の予定は「今日」「3日」には入らない（窓は今日までで閉じる）', () => {
  eq(P.inWindow(at(2026, 8, 20, 10, 0), win('today')), false);
  eq(P.inWindow(at(2026, 8, 20, 10, 0), win('d3')), false);
  eq(P.inWindow(at(2026, 8, 20, 10, 0), null), true, '全期間なら出る');
});
t('今日の予定は「今日」に入る（未来でも今日のうちなら出る）', () => {
  eq(P.inWindow(at(2026, 8, 14, 23, 0), win('today')), true);
});

// ===== 5. 任意の期間 =====
t('任意の期間は終了日を含む（その日の 23:59 まで）', () => {
  const w = win('custom', { from: '2026-08-10', to: '2026-08-12' });
  eq(w.from, at(2026, 8, 10, 0, 0), 'from');
  eq(w.to, at(2026, 8, 13, 0, 0), 'to（終了日の翌0:00）');
  eq(P.inWindow(at(2026, 8, 12, 23, 59), w), true, '終了日が落ちている');
  eq(P.inWindow(at(2026, 8, 13, 0, 0), w), false, '翌日が入っている');
});
t('片側だけでも効く（開始だけ＝以降 / 終了だけ＝以前）', () => {
  const a = win('custom', { from: '2026-08-10', to: '' });
  eq(a.to, null, '終了が無制限になっていない');
  eq(P.inWindow(at(2030, 1, 1), a), true);
  eq(P.inWindow(at(2026, 8, 9, 23, 59), a), false);
  const b = win('custom', { from: '', to: '2026-08-10' });
  eq(b.from, null, '開始が無制限になっていない');
  eq(P.inWindow(at(2000, 1, 1), b), true);
});
t('両方とも空なら絞らない（窓なし）', () => {
  eq(win('custom', { from: '', to: '' }), null);
});
t('🚫 逆順は黙って入れ替えない（0件になる理由を言葉で返す）', () => {
  const sel = { id: 'custom', from: '2026-08-20', to: '2026-08-10' };
  const w = P.windowFor(sel, NOW);
  eq(w.from, at(2026, 8, 20, 0, 0), 'from を勝手に入れ替えている');
  eq(P.inWindow(at(2026, 8, 15), w), false, '入れ替えた結果 0 件になっていない');
  ok(/開始が終了より後/.test(P.problemOf(sel)), '理由を言っていない');
});
t('存在しない日付・壊れた文字は読まない（言っていない日付を作らない）', () => {
  eq(P.dayStartOf('2026-02-30'), null, '2/30 を翌月へ送っている');
  eq(P.dayStartOf('2026-13-01'), null);
  eq(P.dayStartOf('きょう'), null);
  eq(P.dayStartOf(''), null);
  eq(P.dayStartOf('2026-02-28') !== null, true, '普通の日付が読めない');
  ok(/読めません/.test(P.problemOf({ id: 'custom', from: '2026-02-30', to: '' })), '読めない指定を黙って無視している');
});

// ===== 6. 判定そのもの =====
t('窓が無ければ全部通す／日時が読めない行は通さない', () => {
  eq(P.inWindow(at(1999, 1, 1), null), true);
  eq(P.inWindow(null, win('today')), false, '日時の無い行が「入る」と嘘をついている');
  eq(P.inWindow(NaN, win('today')), false);
  eq(P.inWindow(undefined, null), true, '窓なしは何も落とさない');
});

// ===== 7. 表示名（絞っていることを常に見せる） =====
t('選んでいる期間の名前が出る', () => {
  eq(P.labelOf({ id: 'am' }), '今日の午前');
  eq(P.labelOf({ id: 'all' }), '全期間');
  eq(P.labelOf(null), '全期間');
  eq(P.labelOf({ id: 'custom', from: '2026-08-10', to: '2026-08-12' }), '8/10〜8/12');
  eq(P.labelOf({ id: 'custom', from: '2026-08-10', to: '' }), '8/10 以降');
  eq(P.labelOf({ id: 'custom', from: '', to: '2026-08-12' }), '8/12 以前');
  eq(P.labelOf({ id: 'custom', from: '', to: '' }), '任意の期間（未指定）');
});

// ===== 8. 保存値の読み直し（壊れていても動く） =====
t('壊れた保存値は既定へ倒れる', () => {
  eq(P.normalize(null).id, 'all');
  eq(P.normalize('こわれた').id, 'all');
  eq(P.normalize({ id: 'なにか' }).id, 'all');
  eq(P.normalize({ id: 'd3' }).id, 'd3');
  eq(P.normalize({ id: 'custom', from: 12345 }).from, '', '数値が混じっても文字列で返す');
  eq(P.normalize({ id: 'custom', from: '2026-08-10', to: '2026-08-12' }).to, '2026-08-12');
});

console.log(`\nperiod.test: ${pass} passed, ${failures.length} failed`);
if (failures.length) { console.log('\n' + failures.join('\n')); process.exit(1); }
