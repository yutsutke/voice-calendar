// engine/parser.js — スキーマ拘束・解釈層（SPEC §5-②）
//
// interpret(text, now) : (転写テキスト, 現在時刻) → DraftEvent への patch。
// **副作用のない純関数**。同じ転写から何度でも再導出できる（now を注入するのはそのため）。
//
// v0 の方針（SPEC §7）: 「確定」だけを埋める。曖昧は埋めない＝素通し（notes に理由を残す）。
// LLM なし・確定的ルールのみ。埋めなかった発話の断片はタイトルに残る＝ユーザーに見える。
//
// 確定として扱う決め打ちルール（テストで固定。変えるときはテストも変える）:
//   - 素の曜日「金曜」= 直近の未来のその曜日（今日を含む）
//   - 「来週(の)X曜」= 次の月曜始まりの週の X 曜。「の」は挟んでよい（実発話FBより）
//   - 「今週X曜」「先週X曜」「昨日」「一昨日」= 過去の日付も埋める
//     （実発話FBで「昨日の11時半暇だった」＝過去の実績を記録する用途が実在した）
//   - 「N日」= 今月の N 日（今日より前なら来月）／「N月N日」= 今年（過去なら来年）
//   - 「N日後/N週間後/Nか月後/N年後」= 相対日。数は算用数字と漢数字（一〜九十九）
//     か月後の月末越えは月末に丸める（1/31 の1か月後 = 2/28）
//   - 時刻だけで日付がない場合 = その時刻がまだ来ていなければ今日、過ぎていれば明日
//   - 修飾なしの 1〜6 時（「3時」）= 午前/午後が曖昧 → 埋めない（素通し）。7〜24時は文字どおり
//   - 「XからYまで」で Y ≤ X かつ X が18時以降 = 日またぎとして翌日扱い。それ以外は end を埋めない
//
// patch のキーは共有状態層（schema.js）の粒度に合わせる:
//   { title?, startDate?('YYYY-MM-DD'), startTime?('HH:mm'), endDate?, endTime?, allDay? }
(function (global) {
  'use strict';

  // ---------- 正規化 ----------
  function normalize(raw) {
    let t = String(raw || '');
    // 全角数字・記号 → 半角（1文字→1文字なのでインデックスは保たれる）
    t = t.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
    t = t.replace(/：/g, ':').replace(/[~～]/g, '〜');
    return t;
  }

  // ---------- 日付ヘルパ（すべて端末ローカル時刻） ----------
  const pad2 = (n) => String(n).padStart(2, '0');
  const fmtDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const fmtTime = (h, m) => `${pad2(h)}:${pad2(m)}`;
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  // 月曜=0 … 日曜=6（日本の週感覚。「来週」= 次の月曜始まりの週）
  const weekIdxMon = (d) => (d.getDay() + 6) % 7;
  const JP_WEEKDAY = { 月: 0, 火: 1, 水: 2, 木: 3, 金: 4, 土: 5, 日: 6 };
  // 月単位の加算は月末に丸める（1/31 の1か月後 = 2/28。JS Date の自然なオーバーフロー 3/3 は使わない）
  const addMonthsClamped = (d, n) => {
    const y = d.getFullYear(), m = d.getMonth() + n;
    const last = new Date(y, m + 1, 0).getDate();
    return new Date(y, m, Math.min(d.getDate(), last));
  };
  // 漢数字（一〜九十九）→ 整数。算用数字はそのまま
  const jpNum = (s) => {
    if (/^\d+$/.test(s)) return +s;
    const D = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    const i = s.indexOf('十');
    if (i < 0) return D[s] || null;
    const tens = i === 0 ? 1 : D[s.slice(0, i)];
    const rest = s.slice(i + 1);
    const ones = rest ? D[rest] : 0;
    if (tens == null || ones == null) return null;
    return tens * 10 + ones;
  };

  // ---------- 本体 ----------
  function interpret(rawText, now) {
    const text = normalize(rawText);
    const today = startOfDay(now);
    const consumed = new Array(text.length).fill(false);
    const notes = []; // 素通しの理由（UI で見せる／将来の仮置き v1 の種）

    const isFree = (a, b) => {
      for (let i = a; i < b; i++) if (consumed[i]) return false;
      return true;
    };
    const consume = (a, b) => {
      for (let i = a; i < b; i++) consumed[i] = true;
    };
    const findAll = (re) => {
      const out = [];
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        out.push({ m, a: m.index, b: m.index + m[0].length });
        if (m.index === re.lastIndex) re.lastIndex++;
      }
      return out;
    };

    // ===== 終日 =====
    let allDay = false;
    for (const { m, a, b } of findAll(/終日|一日中|丸一日|まる一日/g)) {
      if (!isFree(a, b)) continue;
      allDay = true;
      consume(a, b);
    }

    // ===== 日付候補の収集（優先順。span 重複は先勝ち） =====
    // 候補 = { date: Date, a, b }。複数候補が「別の日」を指したら曖昧 → 日付は埋めない。
    const dateCands = [];
    const overlapsCand = (a, b) => dateCands.some((c) => a < c.b && c.a < b);
    const pushCand = (date, a, b) => {
      if (!isFree(a, b) || overlapsCand(a, b)) return;
      dateCands.push({ date, a, b });
    };

    // 1) N月N日（過去なら来年）
    for (const { m, a, b } of findAll(/(\d{1,2})月(\d{1,2})日/g)) {
      const mo = +m[1], da = +m[2];
      if (mo < 1 || mo > 12 || da < 1 || da > 31) continue;
      let d = new Date(today.getFullYear(), mo - 1, da);
      if (d < today) d = new Date(today.getFullYear() + 1, mo - 1, da);
      pushCand(d, a, b);
    }
    // 2) 来月N日 / 今月N日
    for (const { m, a, b } of findAll(/(来月|今月)(\d{1,2})日/g)) {
      const shift = m[1] === '来月' ? 1 : 0;
      const da = +m[2];
      if (da < 1 || da > 31) continue;
      pushCand(new Date(today.getFullYear(), today.getMonth() + shift, da), a, b);
    }
    // 3) N月の末（「7月の末」「9月末」。過去なら来年）
    for (const { m, a, b } of findAll(/(\d{1,2})月の?末/g)) {
      const mo = +m[1];
      if (mo < 1 || mo > 12) continue;
      let d = new Date(today.getFullYear(), mo, 0); // = mo 月の最終日
      if (d < today) d = new Date(today.getFullYear() + 1, mo, 0);
      pushCand(d, a, b);
    }
    // 3.5) 月末（来月の末 / 今月の末 / 来月末 / 今月末 / 月末。「の」を許す＝実発話FB。
    //      素の「末」は拾わない＝「週末」を月末と誤読しないため）
    for (const { m, a, b } of findAll(/(来月|今月)の?末|月末/g)) {
      const shift = m[1] === '来月' ? 1 : 0;
      // new Date(y, m+1, 0) = その月の最終日
      pushCand(new Date(today.getFullYear(), today.getMonth() + shift + 1, 0), a, b);
    }
    // 4) N{日|週間|か月|年}後（相対。実発話FB「一か月後旅行」から。素のN日より先に拾う）
    //    「1ヵ月後の今日」の「の今日」も同じ日付なので一緒に消費（実発話FB: 複数日付と誤判定していた）
    for (const { m, a, b } of findAll(/([0-9]+|[一二三四五六七八九]?十[一二三四五六七八九]?|[一二三四五六七八九])(日|週間|[かヶヵカケ箇]月|年)後(?:の(?:今日|きょう))?/g)) {
      const n = jpNum(m[1]);
      if (n == null || n === 0) continue;
      const unit = m[2];
      let d;
      if (unit === '日') d = addDays(today, n);
      else if (unit === '週間') d = addDays(today, n * 7);
      else if (unit === '年') d = addMonthsClamped(today, n * 12);
      else d = addMonthsClamped(today, n); // ◯か月
      pushCand(d, a, b);
    }
    // 5) 相対日（長いものから。一昨日は昨日を、明々後日は明後日/明日を含むので順序が大事）
    //    過去（昨日/一昨日）も埋める＝実績の記録という用途が実在（実発話FB）
    const REL = [
      [/一昨日|おととい/g, -2],
      [/明々後日|明明後日|しあさって/g, 3],
      [/明後日|あさって/g, 2],
      [/昨日|きのう/g, -1],
      [/明日|あした|あす/g, 1],
      [/今日|きょう|本日/g, 0],
    ];
    for (const [re, days] of REL) {
      for (const { a, b } of findAll(re)) pushCand(addDays(today, days), a, b);
    }
    // 6) 曜日（再来週/来週/今週/先週/素。「来週の月曜」の「の」も許す＝実発話FB）
    for (const { m, a, b } of findAll(/(再来週|来週|今週|先週)?の?(月|火|水|木|金|土|日)曜日?/g)) {
      const scope = m[1] || '';
      const wd = JP_WEEKDAY[m[2]];
      const thisMonday = addDays(today, -weekIdxMon(today));
      let d;
      if (scope === '来週') d = addDays(thisMonday, 7 + wd);
      else if (scope === '再来週') d = addDays(thisMonday, 14 + wd);
      else if (scope === '先週') d = addDays(thisMonday, -7 + wd);
      else if (scope === '今週') d = addDays(thisMonday, wd); // 過去でも埋める（実績記録の用途）
      else {
        // 素の曜日 = 直近の未来（今日を含む）
        d = addDays(today, (wd - weekIdxMon(today) + 7) % 7);
      }
      pushCand(d, a, b);
    }
    // 7) 素のN日（今月、過ぎていれば来月）。「N日間」「7月N日」「N日後」等は除外/消費済み
    for (const { m, a, b } of findAll(/(\d{1,2})日(?![間時分月])/g)) {
      const da = +m[1];
      if (da < 1 || da > 31) continue;
      const shift = da < today.getDate() ? 1 : 0;
      pushCand(new Date(today.getFullYear(), today.getMonth() + shift, da), a, b);
    }

    // 日付の確定判定：ユニークな日が1つだけなら採用（同じ日を2回言うのは OK）
    let dateStr = null;
    const uniqueDays = [...new Set(dateCands.map((c) => fmtDate(c.date)))];
    if (uniqueDays.length === 1) {
      dateStr = uniqueDays[0];
      for (const c of dateCands) consume(c.a, c.b);
    } else if (uniqueDays.length > 1) {
      notes.push(`日付らしき言葉が複数あるため（${uniqueDays.join(' / ')}）日付は入れていません`);
      // consume しない＝全部タイトルに残る
    }

    // ===== 時刻の収集 =====
    // 時刻表現: (午前|午後|朝|昼|夜|夕方|晩)? H時[半|M分] ／ 正午 ／ H:MM
    const TIME_RE = /(午前|午後|朝|昼|夜|夕方|晩)?(?:(\d{1,2})時(?!間)(半|(\d{1,2})分)?|正午|(\d{1,2}):(\d{2}))/g;
    // → {h, min, ambiguous, a, b}
    function resolveTime(m) {
      if (m[0].includes('正午')) return { h: 12, min: 0, ambiguous: false };
      const qual = m[1] || '';
      let h, min = 0;
      if (m[5] !== undefined) { h = +m[5]; min = +m[6]; } // H:MM
      else {
        h = +m[2];
        if (m[3] === '半') min = 30;
        else if (m[4] !== undefined) min = +m[4];
      }
      if (h > 24 || min > 59) return null;
      let ambiguous = false;
      if (qual === '午後') h = h < 12 ? h + 12 : h;
      else if (qual === '午前' || qual === '朝') { /* そのまま */ }
      else if (qual === '夜' || qual === '夕方' || qual === '晩' || qual === '昼') h = h < 12 ? (h === 12 ? 12 : h + 12) : h;
      else if (h >= 1 && h <= 6) ambiguous = true; // 修飾なし 1〜6時 = 午前/午後が決められない
      if (qual === '昼' && h === 24) return null;
      if (h === 24) h = 0; // 「24時」= 翌 0:00 として扱う（日またぎは範囲側で処理）
      return { h, min, ambiguous };
    }
    const timeCands = [];
    for (const { m, a, b } of findAll(TIME_RE)) {
      if (!isFree(a, b)) continue;
      const t = resolveTime(m);
      if (t) timeCands.push({ ...t, a, b, raw: m[0] });
    }

    // 範囲ペアリング：隣接する2つの時刻の間が「から/〜」なら start–end
    let startT = null, endT = null, dayCross = false;
    if (timeCands.length >= 2) {
      const t1 = timeCands[0], t2 = timeCands[1];
      const between = text.slice(t1.b, t2.a);
      if (/^(から|〜)$/.test(between)) {
        if (t1.ambiguous) {
          notes.push(`時刻「${t1.raw}」は午前/午後が曖昧なので入れていません`);
        } else {
          startT = t1;
          consume(t1.a, t2.a); // t1 + 「から/〜」
          const endsBeforeStart = t2.h * 60 + t2.min <= t1.h * 60 + t1.min;
          if (t2.ambiguous && !(endsBeforeStart && t1.h >= 18)) {
            notes.push(`終了時刻「${t2.raw}」は午前/午後が曖昧なので入れていません`);
          } else {
            endT = t2;
            if (endsBeforeStart) dayCross = true; // 22時から2時 → 翌日 2:00
            consume(t2.a, t2.b);
            const after = text.slice(t2.b);
            if (after.startsWith('まで')) consume(t2.b, t2.b + 2);
          }
        }
      }
    }
    // 単独時刻（範囲が成立しなかった場合）
    if (!startT) {
      const clear = timeCands.filter((t) => !t.ambiguous);
      const amb = timeCands.filter((t) => t.ambiguous);
      if (clear.length === 1) {
        startT = clear[0];
        consume(startT.a, startT.b);
        const after = text.slice(startT.b);
        if (after.startsWith('から')) consume(startT.b, startT.b + 2);
      } else if (clear.length > 1) {
        notes.push('時刻らしき言葉が複数あるため時刻は入れていません');
      }
      for (const t of amb) notes.push(`時刻「${t.raw}」は午前/午後が曖昧なので入れていません`);
    }

    // 継続時間：「(から)N時間(半)」があれば end = start + N時間
    if (startT && !endT) {
      for (const { m, a, b } of findAll(/(\d{1,2})時間(半)?/g)) {
        if (!isFree(a, b)) continue;
        const durMin = +m[1] * 60 + (m[2] ? 30 : 0);
        const total = startT.h * 60 + startT.min + durMin;
        endT = { h: Math.floor(total / 60) % 24, min: total % 60 };
        if (total >= 24 * 60) dayCross = true;
        consume(a, b);
        if (a >= 2 && text.slice(a - 2, a) === 'から' && isFree(a - 2, a)) consume(a - 2, a);
        break;
      }
    }

    // ===== patch 合成 =====
    const patch = {};
    if (allDay) {
      if (startT) notes.push('「終日」と時刻が両方あるため、時刻を優先しています');
      else patch.allDay = true;
    }
    // 時刻だけで日付がない → まだ来ていなければ今日、過ぎていれば明日（決め打ちルール）
    let effDateStr = dateStr;
    if (!effDateStr && startT) {
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const tMin = startT.h * 60 + startT.min;
      effDateStr = fmtDate(tMin > nowMin ? today : addDays(today, 1));
    }
    if (effDateStr) patch.startDate = effDateStr;
    if (startT) patch.startTime = fmtTime(startT.h, startT.min);
    if (endT) {
      patch.endTime = fmtTime(endT.h, endT.min);
      if (effDateStr) {
        const [y, mo, da] = effDateStr.split('-').map(Number);
        patch.endDate = fmtDate(addDays(new Date(y, mo - 1, da), dayCross ? 1 : 0));
      }
    }

    // ===== タイトル（消費されなかった残り） =====
    let leftover = '';
    for (let i = 0; i < text.length; i++) if (!consumed[i]) leftover += text[i];
    // 依頼の言い回し（「〜の予定を入れて」等）を尾から剥がす
    leftover = leftover.replace(/(の)?(予定|よてい)?(を|も)?(入れて|いれて|追加して|追加|登録して|登録|お願いします|お願い)(ください)?[。．\s]*$/u, '');
    // 端に残った助詞・句読点を落とす（内部の「と」「の」は保持）
    leftover = leftover.replace(/^[にへでをはがのとかも、。．\s]+/u, '').replace(/[にへでをはがの、。．\s]+$/u, '');
    leftover = leftover.replace(/\s+/g, ' ').trim();
    if (leftover) patch.title = leftover;

    return { patch, notes, normalizedText: text };
  }

  const api = { interpret, normalize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.VCParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
