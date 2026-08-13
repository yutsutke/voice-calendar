// engine/rewrite.js — 長文を「読める文章」に整える（v80・ゆう要求）
//
// 背景（ゆう要求 2026-08-13）: 「**長文になると、文章が不正確になりがち**、AIボタンで文章をリライト
// する機能も加えたい」。長く話すほど音声認識は崩れる（同音異義・句読点なし・言い淀みが混じる）。
// v58 で「タイトルは簡素・全文はメモ」にしたので、**崩れた全文はメモ欄に居る**＝直す対象はそこ。
//
// なぜ engine に置くか: 指示文も検証も**宿主（DOM）も特定の AI も知らない純関数**にする。
//   ai.js は「文字列を投げて文字列を受ける」だけ（契約を知らない）＝この層を差し替えれば用途が変わる。
//   ライフログ `plans` へ移す時もそのまま動く（SPEC §6 中立スキーマ）。
//
// 🚫 **AI は創作しない**（SPEC §7）＝ここでの「整える」は次の4つだけに縛る:
//    ①文脈から明らかな変換ミスの訂正 ②句読点・改行 ③言い淀みの削除 ④言い直しの重複整理
//    足す・要約する・文体を変える・順番を変えるのは**させない**（指示文と検証の両方で縛る）。
//
// 🔑 **AI の出力を信用しない**（v39 の検証ゲートと同じ姿勢）。ただし相手が散文なので、
//    機械が確かめられるのは「**壊れ方**」だけ＝空・前置き付き・極端な伸縮。**中身の正しさは人が見る**。
//    だから宿主側は必ず ①黙って書き換えない（来歴に痕跡） ②1タップで戻せる ③自動保存しない、を守る。
(function (global) {
  'use strict';

  // これ未満は出さない。短い発話は認識がよく当たる（v22 の観察）＝整える価値がなく、
  // ボタンだけが増える。40 は v58 が「区切りが無くても長い」と判断する境目と同じ数字。
  const MIN_CHARS = 40;

  // 縮みすぎ＝要約された／伸びすぎ＝足された。どちらも「整える」ではない＝落として理由を言う。
  // 言い淀みを消すと 2〜3割は縮むので下限は緩め、句読点を足すと少し伸びるので上限は 1.5。
  const MIN_RATIO = 0.5;
  const MAX_RATIO = 1.5;

  function buildPrompt() {
    return [
      'あなたは日本語の音声認識の結果を「読める文章」に直す校正者です。',
      '',
      '【必ず守ること】',
      '- 内容を足さない・減らさない。要約しない。見出しや感想を付けない。',
      '- 事実（人名・地名・数字・日付・時刻・金額）を変えない。読みが同じでも、確信が無ければそのままにする。',
      '- 文体を変えない。話し言葉は話し言葉のまま。敬語に直さない。',
      '- 文の順番を入れ替えない。',
      '',
      '【直してよいこと（これだけ）】',
      '1. 音声認識の変換ミス（同音異義語）を、前後の文脈から明らかな場合だけ直す',
      '2. 句読点（、。）を入れて文を区切る。長ければ改行を入れる',
      '3. 言い淀み（えー、あの、えっと、まあ）を消す',
      '4. 同じことを言い直している箇所は、後の言い方を残して重複を消す',
      '',
      '【出力】',
      '直した本文だけを返す。前置き・説明・引用記号（```）を付けない。',
      '直すところが無ければ、受け取った本文をそのまま返す。',
    ].join('\n');
  }

  // AI は指示しても前置きや ``` を付けてくることがある＝**捨てずに剥がす**（v16: 黙って捨てない／
  // ここで剥がさないと本文の頭に「以下が整えた文章です：」が混ざったまま欄へ入る）。
  function clean(raw) {
    let t = String(raw == null ? '' : raw).replace(/\r\n/g, '\n').trim();
    // ```／```text で囲まれている場合は中身だけ取る
    const fence = t.match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/);
    if (fence) t = fence[1].trim();
    // 1行目が前置きだけ（本文が続く）なら落とす。**本文らしい行は落とさない**ため、
    // 「〜です：」「〜します：」で終わる短い行だけを対象にする。
    const lines = t.split('\n');
    if (lines.length > 1 && /^.{0,30}(です|ます|した)[:：]$/.test(lines[0].trim())) {
      t = lines.slice(1).join('\n').trim();
    }
    return t;
  }

  // before → after が「整え」として受け入れられるか。落とす時は**必ず理由を返す**（v16）。
  // 返り値: { ok, text, problem }（problem は ok=false の時だけ・そのまま画面に出せる日本語）
  function check(before, after) {
    const b = String(before == null ? '' : before).trim();
    const t = clean(after);
    if (!t) return { ok: false, text: '', problem: 'AI が空の文章を返しました' };
    if (!b) return { ok: false, text: '', problem: '整える元の文章がありません' };
    if (t === b) return { ok: false, text: t, problem: '直すところはありませんでした', same: true };
    const ratio = t.length / b.length;
    if (ratio < MIN_RATIO) {
      return { ok: false, text: t, problem: `短くなりすぎました（${b.length}字→${t.length}字）＝要約された可能性があるので当てません` };
    }
    if (ratio > MAX_RATIO) {
      return { ok: false, text: t, problem: `長くなりすぎました（${b.length}字→${t.length}字）＝書き足された可能性があるので当てません` };
    }
    return { ok: true, text: t };
  }

  // 「整えるボタンを出すか」＝長い時だけ。判定を宿主に書かない（宿主が数字を持つと二重管理になる）。
  function isLongEnough(text) {
    return String(text == null ? '' : text).trim().length >= MIN_CHARS;
  }

  const api = { MIN_CHARS, MIN_RATIO, MAX_RATIO, buildPrompt, clean, check, isLongEnough };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.VCRewrite = api;
})(typeof window !== 'undefined' ? window : globalThis);
