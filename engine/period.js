// engine/period.js — 期間の窓（v91・ゆう要求「アイコンを開くと期間を選べる。今日の午前／今日の午後／
//   今日／三日／一週間／全期間／任意の期間」）
//
// なぜ engine に置くか（SPEC §6）: 「今日の午前とは何時から何時までか」は**宿主も DOM も知らなくてよい
//   純粋な計算**。ここが純粋なら、境目（0:00 ちょうど・12:00 ちょうど・3日の端）を**テストで固定できる**。
//   宿主は返ってきた窓に開始日時が入るかを聞くだけ＝表示の都合が規則に混ざらない。
//
// 決めたこと（実装判断）:
//  ・窓は **[from, to) の半開区間**。境目をどちらに入れるか毎回悩まないため＝「12:00 は午後」に固定される。
//  ・判定は**開始日時**（startMs）で行う。終了で判定すると「またぐ予定」がどちらにも出て数が合わない。
//  ・「三日」「一週間」は**今日を含む**直近 N 日（3日＝一昨日 0:00 から明日 0:00 まで）。
//    日本語の「三日」は 72 時間ではなく**日の数**＝日付境界で切る（「今日」と地続きの数え方にする）。
//  ・**全期間 = null**（窓が無い）＝ 既定。触らない人の体験は1ミリも変わらない（v19）。
//  ・任意の期間は**片側だけでも成立**（開始だけ＝それ以降／終了だけ＝それ以前）。
//    🚫 開始が終了より後でも**黙って入れ替えない**（v9「人の指定を上書きしない」）＝ 0 件になる理由を
//       problemOf() が言葉で返し、宿主がそのまま画面に出す（黙って直さない・黙って捨てない）。
(function (global) {
  'use strict';

  // 並びはゆうが挙げた順そのまま（画面の並び＝この配列＝「表の順番」を2箇所に持たない）
  const PRESETS = [
    { id: 'am', label: '今日の午前' },
    { id: 'pm', label: '今日の午後' },
    { id: 'today', label: '今日' },
    { id: 'd3', label: '3日' },
    { id: 'w1', label: '1週間' },
    { id: 'all', label: '全期間' },
    { id: 'custom', label: '任意の期間' },
  ];
  const DEFAULT_ID = 'all';

  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayAfter = (ms, n) => {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
  };
  const isId = (id) => PRESETS.some((p) => p.id === id);

  // 'YYYY-MM-DD'（<input type="date"> の値）→ その日の 0:00。壊れた値は null（既定へ倒す）
  function dayStartOf(text) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || '').trim());
    if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const t = new Date(y, mo - 1, d);
    // 2月30日のような存在しない日は Date が翌月へ送る＝**言っていない日付を作らない**（parser と同じ線）
    if (t.getFullYear() !== y || t.getMonth() !== mo - 1 || t.getDate() !== d) return null;
    return t.getTime();
  }

  // 選んだ期間 → 窓 { from, to }（ms・[from, to)）。全期間や、任意で両側とも空なら null＝窓なし。
  // from / to は片方だけ null もあり得る（無制限の側）。
  function windowFor(sel, now) {
    const id = sel && isId(sel.id) ? sel.id : DEFAULT_ID;
    const base = now instanceof Date ? now : new Date(now || Date.now());
    const day0 = startOfDay(base);
    switch (id) {
      case 'am': return { from: day0, to: day0 + 12 * 3600 * 1000 };
      case 'pm': return { from: day0 + 12 * 3600 * 1000, to: dayAfter(day0, 1) };
      case 'today': return { from: day0, to: dayAfter(day0, 1) };
      case 'd3': return { from: dayAfter(day0, -2), to: dayAfter(day0, 1) };   // 今日を含む3日
      case 'w1': return { from: dayAfter(day0, -6), to: dayAfter(day0, 1) };   // 今日を含む7日
      case 'custom': {
        const from = dayStartOf(sel && sel.from);
        const to = dayStartOf(sel && sel.to);
        if (from == null && to == null) return null;                            // 何も入れていない＝絞らない
        return { from, to: to == null ? null : dayAfter(to, 1) };               // 終了日は**その日を含む**
      }
      default: return null;                                                     // all
    }
  }

  // その開始日時は窓の中か（窓が null＝全部通す）
  function inWindow(startMs, win) {
    if (!win) return true;
    const t = Number(startMs);
    if (!Number.isFinite(t)) return false;   // 日時が読めない行は「入る」と嘘をつかない
    if (win.from != null && t < win.from) return false;
    if (win.to != null && t >= win.to) return false;
    return true;
  }

  // 画面に出す名前（絞っていることを常に見せる＝黙って隠さない）
  function labelOf(sel) {
    const id = sel && isId(sel.id) ? sel.id : DEFAULT_ID;
    if (id !== 'custom') return (PRESETS.find((p) => p.id === id) || {}).label;
    const f = dayStartOf(sel && sel.from), t = dayStartOf(sel && sel.to);
    const fmt = (ms) => { const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()}`; };
    if (f == null && t == null) return '任意の期間（未指定）';
    if (f != null && t == null) return `${fmt(f)} 以降`;
    if (f == null && t != null) return `${fmt(t)} 以前`;
    return `${fmt(f)}〜${fmt(t)}`;
  }

  // 0 件になる理由を言葉で返す（黙って 0 件にしない）。問題が無ければ ''
  function problemOf(sel) {
    if (!sel || sel.id !== 'custom') return '';
    const f = dayStartOf(sel.from), t = dayStartOf(sel.to);
    if ((sel.from && f == null) || (sel.to && t == null)) return '日付の指定が読めません（年-月-日で入れてください）';
    if (f != null && t != null && f > t) return '開始が終了より後です（入れ替えずにそのまま扱います）';
    return '';
  }

  // 保存値（localStorage）を安全に読む＝壊れていても既定で動く（v19 の流儀）
  function normalize(saved) {
    const s = saved && typeof saved === 'object' ? saved : {};
    const id = isId(s.id) ? s.id : DEFAULT_ID;
    return {
      id,
      from: typeof s.from === 'string' ? s.from : '',
      to: typeof s.to === 'string' ? s.to : '',
    };
  }

  const api = { PRESETS, DEFAULT_ID, windowFor, inWindow, labelOf, problemOf, normalize, dayStartOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.VCPeriod = api;
})(typeof window !== 'undefined' ? window : globalThis);
