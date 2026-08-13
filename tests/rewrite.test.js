// tests/rewrite.test.js — 長文の「整え」（v80）
//
// 守る不変条件:
//   1. **指示文が創作を禁じている**（SPEC §7）＝プロンプトは仕様の一部（契約 v39 と同じ考え）
//   2. **AI の出力を信用しない**＝前置き・``` を剥がし、極端な伸縮は当てずに理由を返す（v39 の検証ゲート）
//   3. **落とすなら明記する**（v16 黙って捨てない）＝ problem は必ずそのまま人に見せられる日本語
//   4. **短い文には出さない**＝判定の数字は engine が持つ（宿主に書くと二重管理・v3）
'use strict';

const R = require('../engine/rewrite.js');

let pass = 0;
const failures = [];
function t(name, fn) {
  try { fn(); pass++; }
  catch (e) { failures.push(`✗ ${name}\n    ${e.message}`); }
}
function ok(cond, label) { if (!cond) throw new Error(label || 'false だった'); }
function eq(a, b, label) { if (a !== b) throw new Error(`${label || ''} 期待 ${JSON.stringify(b)} / 実際 ${JSON.stringify(a)}`); }

// ===== 1. 指示文（＝仕様。ここが緩むと AI が創作を始める） =====
t('指示文が「創作しない」を明示している', () => {
  const p = R.buildPrompt();
  for (const must of ['要約しない', '内容を足さない', '事実', '文体を変えない', '順番を入れ替えない']) {
    ok(p.includes(must), `指示文に「${must}」が無い＝AI が勝手に書き換える余地が残る`);
  }
});
t('指示文が「直してよいこと」を4つに限っている', () => {
  const p = R.buildPrompt();
  for (const must of ['同音異義語', '句読点', '言い淀み', '言い直し']) {
    ok(p.includes(must), `直してよいこと「${must}」が指示文に無い`);
  }
  ok(/直した本文だけを返す/.test(p), '出力の形を指定していない＝前置きが混ざる');
});

// ===== 2. AI の出力の「壊れ方」を剥がす =====
t('``` で囲まれた応答から中身だけ取る', () => {
  eq(R.clean('```\nこんにちは。\n```'), 'こんにちは。');
  eq(R.clean('```text\nこんにちは。\n```'), 'こんにちは。');
});
t('前置きの1行だけを落とす（本文は落とさない）', () => {
  eq(R.clean('以下が整えた文章です：\n今日は会議に出た。'), '今日は会議に出た。');
  // 本文が「です：」で終わることは普通に有り得る＝**本文しかない時は落とさない**
  eq(R.clean('結論はこうです：'), '結論はこうです：');
});
t('前後の空白・改行コードを揃える', () => {
  eq(R.clean('  あ\r\nい  '), 'あ\nい');
  eq(R.clean(null), '');
});

// ===== 3. 検証ゲート（落とすなら理由を言う） =====
const LONG = 'えーっと今日は課長と面談してきたんですけどまあ来期の話が中心でえー特に人員の話が長かったです';
t('普通に整った文章は通る', () => {
  const r = R.check(LONG, '今日は課長と面談してきた。来期の話が中心で、特に人員の話が長かった。');
  ok(r.ok, `通らなかった: ${r.problem}`);
  ok(r.text.includes('課長'), '本文が返っていない');
});
t('空の応答は落とす（理由つき）', () => {
  const r = R.check(LONG, '   ');
  ok(!r.ok && /空/.test(r.problem), '空を落としていない／理由が無い');
});
t('要約されたら当てない（縮みすぎ）', () => {
  const r = R.check(LONG, '課長と面談した。');
  ok(!r.ok, '要約が通ってしまう＝話した中身が黙って消える');
  ok(/短くなりすぎ/.test(r.problem) && /字/.test(r.problem), '理由に何が起きたかと数字が無い');
});
t('書き足されたら当てない（伸びすぎ）', () => {
  const r = R.check(LONG, LONG + LONG);
  ok(!r.ok && /長くなりすぎ/.test(r.problem), '書き足しが通ってしまう＝AI が創作した文が欄に入る');
});
t('同じ文章が返ったら「直すところが無い」と言う（黙って何もしない、にしない）', () => {
  const r = R.check(LONG, LONG);
  ok(!r.ok && r.same === true, '同一を見分けていない');
  ok(/直すところ/.test(r.problem), '人に見せられる言い方になっていない');
});
t('元が空なら当てない', () => {
  const r = R.check('', 'なにか');
  ok(!r.ok && /元の文章/.test(r.problem), '元が空でも当ててしまう');
});
t('境目そのもの（比率ちょうど）は通す＝落とすのは「外」だけ', () => {
  const before = 'あ'.repeat(100);
  ok(R.check(before, 'い'.repeat(50)).ok, '0.5 ちょうどを落としている');
  ok(R.check(before, 'い'.repeat(150)).ok, '1.5 ちょうどを落としている');
  ok(!R.check(before, 'い'.repeat(49)).ok, '0.5 未満を通している');
  ok(!R.check(before, 'い'.repeat(151)).ok, '1.5 超を通している');
});

// ===== 4. 出す条件（数字は engine が持つ） =====
t('短い文にはボタンを出さない（判定は engine 側）', () => {
  ok(!R.isLongEnough('歯医者'), '短い発話でボタンが出る');
  ok(!R.isLongEnough('あ'.repeat(R.MIN_CHARS - 1)), '境目の1文字手前で出てしまう');
  ok(R.isLongEnough('あ'.repeat(R.MIN_CHARS)), '境目ちょうどで出ない');
  ok(!R.isLongEnough(''), '空でボタンが出る');
  ok(!R.isLongEnough(null), 'null で落ちる／出てしまう');
});

console.log(`\nrewrite.test: ${pass} passed, ${failures.length} failed`);
if (failures.length) { console.log('\n' + failures.join('\n\n')); process.exit(1); }
