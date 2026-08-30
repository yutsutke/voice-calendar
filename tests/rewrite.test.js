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

// ===== 5. v84: 推敲画面（長文はフォームの前に一度手元で直せる） =====
t('推敲画面を挟む敷居は「整えるボタン」より高い（割り込みは提案より重い）', () => {
  ok(R.REVIEW_MIN_CHARS > R.MIN_CHARS,
    '画面を挟む長さがボタンを出す長さ以下＝普段の一本道に割り込む');
  ok(!R.needsReview('明日15時に歯医者'), '1件の予定で画面が挟まる＝ノールックが死ぬ');
  ok(!R.needsReview('あ'.repeat(R.REVIEW_MIN_CHARS - 1)), '境目の1文字手前で挟まる');
  ok(R.needsReview('あ'.repeat(R.REVIEW_MIN_CHARS)), '境目ちょうどで挟まらない');
  ok(!R.needsReview(''), '空で挟まる');
  ok(!R.needsReview(null), 'null で落ちる／挟まる');
});

t('要約の指示文が創作を禁じている（いちばん緊張する操作）', () => {
  const p = R.buildPrompt('summarize');
  for (const must of ['足さない', '推測で補わない', '事実', '結論・評価・助言']) {
    ok(p.includes(must), `要約の指示文に「${must}」が無い＝AI が書き足す余地が残る`);
  }
  ok(/予定や約束/.test(p), '要約で日時・場所・相手が落ちうる（この製品でいちばん失ってはいけない情報）');
  ok(/要約した本文だけを返す/.test(p), '出力の形を指定していない＝前置きが混ざる');
});

// 🚨 実測で気づいた: ラベルは辞書形（「整える」）なので、そのまま「ました」を足すと
//    「整えるました」になる。**画面に出る日本語はテストで固定する**（コードは動くので誰も落ちない）。
t('モードごとに「押すラベル」と「終わった時の言い方」を別に持つ', () => {
  for (const k of Object.keys(R.MODES)) {
    const m = R.MODES[k];
    ok(m.label && m.done, `${k}: label / done が揃っていない`);
    ok(/ました$/.test(m.done), `${k}: 終わった時の言い方が過去形でない（${m.done}）`);
    ok(!/(する|える|む|く)ました/.test(m.done + 'X'.slice(0, 0) + m.done), `${k}: 「${m.done}」が壊れた日本語`);
  }
  ok(R.MODES.tidy.done === '整えました' && R.MODES.summarize.done === '要約しました', '文言が変わった（意図的なら直す）');
});

t('モードを指定しなければ従来どおり「整える」（v80 の呼び出しを壊さない）', () => {
  ok(R.buildPrompt() === R.buildPrompt('tidy'), '既定が整えるでない');
  ok(R.buildPrompt() === R.buildPrompt('存在しないモード'), '未知のモードで落ちる／別物になる');
});

t('要約は「短くなる」のが正しい＝整えると受け入れ幅が違う', () => {
  const before = 'あ'.repeat(200);
  const short = 'い'.repeat(40); // 0.2倍
  ok(!R.check(before, short, 'tidy').ok, '整えるで 0.2倍を通している＝要約が黙って通る');
  ok(R.check(before, short, 'summarize').ok, '要約で 0.2倍を落としている＝要約が成立しない');
  // 逆に、要約なのに伸びたら異常
  ok(!R.check(before, 'い'.repeat(190), 'summarize').ok, '要約なのに 0.95倍を通している');
  ok(R.check(before, 'い'.repeat(180), 'summarize').ok, '要約の上限ちょうど(0.9)を落としている');
});

t('落とす理由はモードごとに言い方が変わる（そのまま画面に出せる）', () => {
  const before = 'あ'.repeat(200);
  const r = R.check(before, 'い'.repeat(5), 'summarize');
  ok(!r.ok && /要点まで落ちている/.test(r.problem), `要約の理由になっていない: ${r.problem}`);
  const r2 = R.check(before, 'い'.repeat(199), 'summarize');
  ok(!r2.ok && /要約なのに長く/.test(r2.problem), `要約の理由になっていない: ${r2.problem}`);
});

// ===== v94: 続きを声で足す／たまったら自動で要約（ゆう要求 2026-08-30）=====

t('続きは改行で区切って足す（句点を創作しない）', () => {
  ok(R.appendSpoken('明日は歯医者', '三時から') === '明日は歯医者\n三時から', '改行で足していない');
  ok(!/。/.test(R.appendSpoken('明日は歯医者', '三時から')), '言っていない句点を足している（創作＝SPEC §7）');
});

t('空は足さない（余計な改行だけ増やさない）', () => {
  ok(R.appendSpoken('本文', '') === '本文', '空を足して形が変わった');
  ok(R.appendSpoken('本文', '   ') === '本文', '空白だけの続きを足している');
  ok(R.appendSpoken('', '続き') === '続き', '白紙に足すと先頭に改行が入っている');
  ok(R.appendSpoken(null, null) === '', 'null で壊れる');
});

t('元の末尾の空白・改行は畳んでから足す（改行が二重にならない）', () => {
  ok(R.appendSpoken('本文\n\n  ', ' 続き ') === '本文\n続き', `畳めていない: ${JSON.stringify(R.appendSpoken('本文\n\n  ', ' 続き '))}`);
});

t('自動要約の境目ちょうどは走る（数字は engine が持つ）', () => {
  ok(R.AUTO_SUMMARY_CHARS === 100, '境目の数字が変わった（変えるならこのテストも直す＝仕様書。100 はゆうの実機体感 2026-08-30）');
  ok(!R.shouldAutoSummarize(R.AUTO_SUMMARY_CHARS - 1), '境目の1つ手前で走っている');
  ok(R.shouldAutoSummarize(R.AUTO_SUMMARY_CHARS), '境目ちょうどで走らない');
  ok(R.shouldAutoSummarize(9999), 'たっぷり超えても走らない');
});

t('数えられない値では走らない（黙って AI を呼ばない）', () => {
  for (const v of [undefined, null, NaN, 'たくさん', {}, -1]) {
    ok(!R.shouldAutoSummarize(v), `${String(v)} で走っている`);
  }
});

t('自動要約の境目は「整えるを出す境目」より上（下書きの最初の発話は数えないので比較先はこちら）', () => {
  // 最初の発話は openReview が 0 に数え直す＝境目が効くのは**続き**だけ。それでも数語で走らないよう
  // MIN_CHARS(40) の倍より上に置く（当初の 300 はゆうの実機体感で 100 へ・2026-08-30）
  ok(R.AUTO_SUMMARY_CHARS > R.MIN_CHARS * 2, '境目が低すぎる＝ひと言の続きで自動要約が走る');
});
console.log(`\nrewrite.test: ${pass} passed, ${failures.length} failed`);
if (failures.length) { console.log('\n' + failures.join('\n\n')); process.exit(1); }
