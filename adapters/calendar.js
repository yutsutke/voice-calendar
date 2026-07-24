// adapters/calendar.js — 永続層＝薄いアダプタ（SPEC §5 前後の層 / §6）
//
// materialize(draft, now): 中立スキーマ（date/time 部分フィールド）→ 具体イベントに実体化。
// 保存時の既定値はここ（アダプタ境界）に集約する＝解釈層は創作しない（SPEC §7「空」）:
//   - **日時を何も言わない**      → 今の日時（v27・メモ用途＝思いついたことを時系列に置く）
//   - 時刻なし（日付のみ）        → 終日イベントとして保存（「明日 歯医者」に 22:45 を創作しない）
//   - 終了なし（時刻あり）        → 開始 + 1時間
//   - タイトルなし                → 「予定」（warning を出して見せる）
//
// 宛先アダプタ:
//   - icsAdapter      : web/開発用。.ics を生成してダウンロード（OS のカレンダーが開ける）
//   - eventKitAdapter : iOS native（ローカルプラグイン calendar-events）＝ v11 実装・v23 実機で成立。
//                       fieldState / 来歴は宛先へ渡さず端末内に留める（ローカル完結）。
//                       ※ getTarget（今どこへ入るかを見る）は native のみ。web には「保存先」という
//                          概念が無い（.ics を落とすだけ）＝ icsAdapter は持たない。
//                          宿主は `typeof adapter.getTarget === 'function'` で見分ける。
//                       🚫 保存先は **OS の既定カレンダー1本**（v26 でアプリ内選択を撤去。理由は
//                          CalendarEventsPlugin.swift の冒頭コメント＝write-only では選択を次の起動へ
//                          持ち越せない。変えたい人は OS 設定のデフォルトカレンダーを変える）。
(function (global) {
  'use strict';

  // 🔴 バンドラ無し運用でのプラグイン取得（v13 の実バグ・詳細は input/transcriber.js 冒頭）:
  // native が注入する window.Capacitor に registerPlugin は無い（Plugins だけ）。
  // Plugins.X が本命・registerPlugin は「あれば使う」保険（あの日 index.html と同じ形）。
  function nativePlugin(C, name) {
    if (!C) return null;
    if (C.Plugins && C.Plugins[name]) return C.Plugins[name];
    if (typeof C.registerPlugin === 'function') return C.registerPlugin(name);
    return null;
  }

  function requireCalendarPlugin() {
    const C = global.Capacitor;
    if (!C || !C.isNativePlatform || !C.isNativePlatform()) throw new Error('native 環境ではありません');
    const plugin = nativePlugin(C, 'CalendarEvents');
    if (!plugin) throw new Error('CalendarEvents プラグインが native に登録されていません');
    return plugin;
  }

  const pad2 = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const hm = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

  // opts.defaultDurationMin: 終了を言わなかった時に付ける長さ（既定 60分 = v1 の決め打ち。v19 で設定可能に）
  function materialize(draft, now, opts) {
    const durMin = (opts && typeof opts.defaultDurationMin === 'number' && opts.defaultDurationMin > 0)
      ? opts.defaultDurationMin : 60;
    const problems = [];
    const warnings = [];

    // v27（実機FB第19回「メモアプリとしても使えそう」）:
    // **日時を何も言わなかった発話は「今」として記録する**＝思いついたことを話すだけで時系列に残る。
    // 日付だけ言った時（「明日 歯医者」）は従来どおり終日＝**言っていない時刻を創作しない**（SPEC §7）。
    const noWhen = !draft.startDate && !draft.startTime;
    if (noWhen && !draft.title && !draft.location && !draft.note) {
      // 空のフォームでの保存＝事故（誤タップ・クリア忘れ）。「今の空予定」を作らない
      problems.push('何も入力されていません');
      return { ok: false, problems, warnings };
    }

    let dateStr = draft.startDate;
    let timeStr = draft.startTime;
    if (noWhen) {
      dateStr = ymd(now);
      // 「終日」を自分でチェックした人には時刻を足さない（明示の指定が推測に勝つ＝v9）
      if (draft.allDay) warnings.push('日付が未入力のため今日にしました');
      else { timeStr = hm(now); warnings.push('日時が未入力のため今の日時にしました'); }
    } else if (!dateStr) {
      dateStr = ymd(now);
      warnings.push('日付が未入力のため今日にしました');
    }
    const [y, mo, da] = dateStr.split('-').map(Number);
    const title = draft.title || '予定';
    if (!draft.title) warnings.push('タイトルが未入力のため「予定」にしました');

    const allDay = draft.allDay || !timeStr;
    if (!draft.allDay && !timeStr) warnings.push('時刻が未入力のため終日の予定にしました');

    let start, end;
    if (allDay) {
      start = new Date(y, mo - 1, da);
      if (draft.endDate) {
        const [ey, em, ed] = draft.endDate.split('-').map(Number);
        end = new Date(ey, em - 1, ed);
        if (end < start) { end = start; warnings.push('終了日が開始日より前だったため同日にしました'); }
      } else end = start;
    } else {
      const [sh, sm] = timeStr.split(':').map(Number);
      start = new Date(y, mo - 1, da, sh, sm);
      if (draft.endTime) {
        const [eh, em] = draft.endTime.split(':').map(Number);
        if (draft.endDate) {
          const [ey, emo, eda] = draft.endDate.split('-').map(Number);
          end = new Date(ey, emo - 1, eda, eh, em);
        } else end = new Date(y, mo - 1, da, eh, em);
        if (end <= start) { end = new Date(start.getTime() + durMin * 60000); warnings.push(`終了が開始以前だったため開始+${durMin}分にしました`); }
      } else {
        end = new Date(start.getTime() + durMin * 60000); // 既定の長さ（設定 defaultDurationMin）
      }
    }

    return {
      ok: true, problems, warnings,
      event: { title, start, end, allDay, location: draft.location || '', note: draft.note || '' },
    };
  }

  // ---------- ICS（web/開発用アダプタ） ----------
  const icsEscape = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const icsLocal = (d) => `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}T${pad2(d.getHours())}${pad2(d.getMinutes())}00`;
  const icsDate = (d) => `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
  const icsUtc = (d) => `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`;

  // 単一イベント or 配列（v39: まとめて入力）。配列なら **1つの VCALENDAR に VEVENT を N 個**束ねる
  // ＝「すべて保存」が web で20連ダウンロードにならない。単一時の出力は従来と同一。
  // UID は VEVENT ごとにユニークが必須（RFC 5545）＝2件目以降に -i を付ける（1件目は従来形のまま）。
  function buildIcs(evOrArray, uidSeed) {
    const evs = Array.isArray(evOrArray) ? evOrArray : [evOrArray];
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//voice-calendar//v0//JA'];
    evs.forEach((ev, i) => {
      const uid = i === 0 ? `${uidSeed}@voice-calendar` : `${uidSeed}-${i}@voice-calendar`;
      lines.push('BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${icsUtc(new Date())}`);
      if (ev.allDay) {
        const endEx = new Date(ev.end.getFullYear(), ev.end.getMonth(), ev.end.getDate() + 1); // DTEND は排他的
        lines.push(`DTSTART;VALUE=DATE:${icsDate(ev.start)}`, `DTEND;VALUE=DATE:${icsDate(endEx)}`);
      } else {
        lines.push(`DTSTART:${icsLocal(ev.start)}`, `DTEND:${icsLocal(ev.end)}`);
      }
      lines.push(`SUMMARY:${icsEscape(ev.title)}`);
      if (ev.location) lines.push(`LOCATION:${icsEscape(ev.location)}`);
      if (ev.note) lines.push(`DESCRIPTION:${icsEscape(ev.note)}`);
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  const icsAdapter = {
    name: 'ics',
    label: '.ics ダウンロード（開発用）',
    async save(ev) {
      const ics = buildIcs(ev, Date.now());
      const blob = new Blob([ics], { type: 'text/calendar' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `voice-calendar-${icsDate(ev.start)}.ics`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      return { ok: true, method: 'ics' };
    },

    // v39（まとめて入力）: 複数イベントを **1つの .ics（1ダウンロード）** に束ねる。
    // save() をループすると1保存=1ダウンロード＝20件で20連発になるための専用口。
    // eventKitAdapter には作らない（native は1件ずつ save が正＝Swift 契約を増やさない）。
    // 宿主は `typeof adapter.saveMany === 'function'` で見分ける（getTarget と同じ流儀）。
    async saveMany(evs) {
      const ics = buildIcs(evs, Date.now());
      const blob = new Blob([ics], { type: 'text/calendar' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `voice-calendar-batch-${icsDate(new Date())}.ics`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      return { ok: true, method: 'ics', count: evs.length };
    },
  };

  // ---------- EventKit（iOS native） ----------
  const eventKitAdapter = {
    name: 'eventkit',
    label: 'カレンダーに保存',

    // 保存先は OS の既定カレンダー（native 側が決める）。
    // 戻り値の calendarTitle/calendarSource は「どこに入れたか」＝保存 toast に出す（v23）
    // ＝「保存できたのに見つからない」を防ぐ。
    // opts.calendarId（v68・Android）: 保存先の指定。**空なら鍵ごと渡さない**＝ iOS へ行く
    // ペイロードは v67 までと1バイトも変わらない（設定を触らない人の体験は不変・v19）。
    async save(ev, opts) {
      const plugin = requireCalendarPlugin();
      const payload = {
        title: ev.title,
        startMs: ev.start.getTime(),
        endMs: ev.end.getTime(),
        allDay: ev.allDay,
        location: ev.location,
        note: ev.note,
      };
      const wanted = opts && opts.calendarId;
      if (wanted) payload.calendarId = String(wanted);
      const res = await plugin.save(payload) || {};
      return {
        ok: true,
        method: 'eventkit',
        id: res.id,
        calendarTitle: res.calendarTitle || '',
        calendarSource: res.calendarSource || '',
        // v67: native が「書いた行を読み返した結果」（Android のみ。iOS は返さない＝空）。
        // **保存の成否には使わない**＝あくまで診断へ流す文字列（「入ったのに見えない」の計器）。
        verify: res.verify || '',
      };
    },

    // 今どこへ入るか（権限は要求しない＝設定を開いただけでダイアログを出さない）。
    // authorized:false = まだ許可を聞いていない／拒否された。
    async getTarget(opts) {
      const plugin = requireCalendarPlugin();
      const wanted = opts && opts.calendarId;
      // save と同じ規則: 指定が無ければ**引数ごと渡さない**（iOS の呼び出しは従来のまま）
      const res = (wanted ? await plugin.getTarget({ calendarId: String(wanted) }) : await plugin.getTarget()) || {};
      return {
        authorized: !!res.authorized,
        found: !!res.found,
        id: res.id || '',
        title: res.title || '',
        source: res.source || '',
        sourceType: res.sourceType || '',
        warning: res.warning || '',
        // v67: 端末に在る暦の一覧（**選ばれなかったものも含む**・Android のみ）。
        // 「なぜそこに入ったのか」を実機の画面だけで辿る材料＋ v68 の選択 UI の材料。
        // 🚨 **表示の文言は宿主が作る**＝native はデータだけ返す（SPEC §6 の境界）。
        candidates: Array.isArray(res.candidates) ? res.candidates.map((c) => ({
          id: String((c && c.id) || ''),
          title: String((c && c.title) || ''),
          account: String((c && c.account) || ''),
          sourceType: String((c && c.sourceType) || ''),
          writable: !!(c && c.writable),
          visible: !!(c && c.visible),
          syncEvents: !!(c && c.syncEvents),
          primary: !!(c && c.primary),
        })) : [],
        // v68: 書き込み可の暦が2本以上＝自動選択が恣意的になる（＝選んでもらう必要がある）
        ambiguous: !!res.ambiguous,
        // 今の行き先が「自動で決まった」のか「選ばれたもの」なのか（表示に嘘をつかせない）
        auto: res.auto === undefined ? true : !!res.auto,
        // v69: **保存できること と Google に届くことは別**（実機FB第38回）。
        // sync=同期設定の素性 / pending=まだ上がっていない件数（-1＝不明。0 と混ぜない）
        // syncBlocked=「何をしても上がらない」と言い切れる時だけ true（不明は false＝嘘の警告を出さない）
        sync: res.sync || '',
        pending: typeof res.pending === 'number' ? res.pending : -1,
        syncBlocked: !!res.syncBlocked,
      };
    },

    // 拒否済み権限からの復帰導線（設定アプリを開く）
    async openSettings() {
      const plugin = requireCalendarPlugin();
      await plugin.openSettings();
    },
  };

  function pickAdapter() {
    const C = global.Capacitor;
    if (C && C.isNativePlatform && C.isNativePlatform()) return eventKitAdapter;
    return icsAdapter;
  }

  const api = { materialize, buildIcs, icsAdapter, eventKitAdapter, pickAdapter };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.VCAdapter = api;
})(typeof window !== 'undefined' ? window : globalThis);
