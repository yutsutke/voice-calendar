// engine/dictionary.js — 辞書（言い換え展開・v37）
//
// 「僕のメールアドレス」と話すと登録した実アドレスに置き換わる＝**声で言いにくい文字列**
// （メールアドレス・住所・定型句）を言い回しで呼び出す。ユーザー明示要求（実機FB・2026-07-19）。
//
// 設計:
//   - **展開は解釈（parser）より前**に生テキストへ適用＝欄指定（「メモ 僕のメールアドレス」）でも効くし、
//     「僕の誕生日」→「3月5日」のような登録なら**日付としても解釈される**（展開結果を parser が普通に読む）。
//   - **これは AI の創作ではない**（SPEC §7 と矛盾しない）: ユーザーが自分で登録した確定変換＝
//     決め打ちルールと同じ「本人が教えた語彙」。何を展開したかは来歴に 🔤 で出す（黙って置換しない＝v16）。
//   - **最長一致優先**: 「僕のメール」と「僕のメールアドレス」が両方登録されていたら長い方が勝つ
//     （正規表現の選択肢を長い順に並べる＝同じ開始位置では先の選択肢が勝つ JS の仕様を使う）。
//   - **値は再展開しない**: {A→B, B→C} で「A」は B のまま（replace の1パス＝置換結果は再走査されない）。
//   - **キーは2文字以上**: 日本語は語境界が無く、1文字キー（「今」）は他の語の中に必ず現れて誤爆する
//     （v22「メモリアルホール」・v27「今井さん」で確立した罠）。2文字でも「メモ」等は危険なので
//     UI のヒントで「長い言い回しほど安全」と案内する（登録は本人の選択＝展開は 🔤 で見える）。
//
// DOM も宿主も知らない（settings.js / records.js と同じ流儀）。Node からも require 可（テスト対象）。
// 保存は localStorage のみ（端末内・外部送信しない＝ローカル完結 SPEC §2）。
// メールアドレス等の個人情報を持つ場所だが、**この端末の localStorage から一歩も出ない**。
(function (global) {
  'use strict';

  const KEY = 'vc_dict_v1';
  const MIN_KEY_LEN = 2;

  function load() {
    try {
      const v = JSON.parse(global.localStorage.getItem(KEY));
      if (!Array.isArray(v)) return [];
      // 壊れた行（キー欠損・短すぎ・値なし）は読み飛ばして生きている行だけで動く（settings と同じ）
      return v
        .filter((e) => e && typeof e.k === 'string' && e.k.length >= MIN_KEY_LEN && typeof e.v === 'string' && e.v.length > 0)
        .map((e) => ({ k: e.k, v: e.v }));
    } catch { return []; }
  }

  // 書き込み失敗は**握らず投げる**（「登録したつもり」を作らない＝records.js と同じ・v16）
  function persist(entries) {
    global.localStorage.setItem(KEY, JSON.stringify(entries));
  }

  function add(k, v) {
    k = String(k == null ? '' : k).trim();
    v = String(v == null ? '' : v).trim();
    if (k.length < MIN_KEY_LEN) throw new Error(`言い回しは${MIN_KEY_LEN}文字以上にしてください（短いと他の言葉の中に現れて誤変換します）`);
    if (!v) throw new Error('置き換え先が空です');
    const entries = load().filter((e) => e.k !== k); // 同じ言い回しの再登録は上書き
    entries.push({ k, v });
    persist(entries);
    return { k, v };
  }

  function remove(k) {
    persist(load().filter((e) => e.k !== String(k)));
  }

  function list() { return load(); }

  function clear() { try { global.localStorage.removeItem(KEY); } catch {} }

  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // 純関数: text 中の登録済み言い回しを置き換える。
  // 戻り値 { text, hits: [{k, v}] } — hits が空なら text は入力のまま。
  // hits は「何が展開されたか」を来歴（🔤）に出すための材料＝展開は必ずユーザーに見える。
  function expand(text, entries) {
    const t = String(text == null ? '' : text);
    const valid = (entries || []).filter(
      (e) => e && typeof e.k === 'string' && e.k.length >= MIN_KEY_LEN && typeof e.v === 'string' && e.v.length > 0
    );
    if (!t || !valid.length) return { text: t, hits: [] };
    const sorted = [...valid].sort((a, b) => b.k.length - a.k.length); // 最長一致優先
    const map = new Map();
    for (const e of sorted) if (!map.has(e.k)) map.set(e.k, e.v); // 重複キーは先勝ち（load 済みなら通常無い）
    const re = new RegExp([...map.keys()].map(escRe).join('|'), 'g');
    const hitKeys = new Set();
    const out = t.replace(re, (m) => { hitKeys.add(m); return map.get(m); });
    return { text: out, hits: [...hitKeys].map((k) => ({ k, v: map.get(k) })) };
  }

  const api = { expand, add, remove, list, clear, KEY, MIN_KEY_LEN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.VCDict = api;
})(typeof window !== 'undefined' ? window : globalThis);
