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

  function buildIcs(ev, uidSeed) {
    const uid = `${uidSeed}@voice-calendar`;
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//voice-calendar//v0//JA', 'BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${icsUtc(new Date())}`];
    if (ev.allDay) {
      const endEx = new Date(ev.end.getFullYear(), ev.end.getMonth(), ev.end.getDate() + 1); // DTEND は排他的
      lines.push(`DTSTART;VALUE=DATE:${icsDate(ev.start)}`, `DTEND;VALUE=DATE:${icsDate(endEx)}`);
    } else {
      lines.push(`DTSTART:${icsLocal(ev.start)}`, `DTEND:${icsLocal(ev.end)}`);
    }
    lines.push(`SUMMARY:${icsEscape(ev.title)}`);
    if (ev.location) lines.push(`LOCATION:${icsEscape(ev.location)}`);
    if (ev.note) lines.push(`DESCRIPTION:${icsEscape(ev.note)}`);
    lines.push('END:VEVENT', 'END:VCALENDAR');
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
  };

  // ---------- EventKit（iOS native） ----------
  const eventKitAdapter = {
    name: 'eventkit',
    label: 'カレンダーに保存',

    // 保存先は OS の既定カレンダー（native 側が決める）。
    // 戻り値の calendarTitle/calendarSource は「どこに入れたか」＝保存 toast に出す（v23）
    // ＝「保存できたのに見つからない」を防ぐ。
    async save(ev) {
      const plugin = requireCalendarPlugin();
      const res = await plugin.save({
        title: ev.title,
        startMs: ev.start.getTime(),
        endMs: ev.end.getTime(),
        allDay: ev.allDay,
        location: ev.location,
        note: ev.note,
      }) || {};
      return {
        ok: true,
        method: 'eventkit',
        id: res.id,
        calendarTitle: res.calendarTitle || '',
        calendarSource: res.calendarSource || '',
      };
    },

    // 今どこへ入るか（権限は要求しない＝設定を開いただけでダイアログを出さない）。
    // authorized:false = まだ許可を聞いていない／拒否された。
    async getTarget() {
      const plugin = requireCalendarPlugin();
      const res = await plugin.getTarget() || {};
      return {
        authorized: !!res.authorized,
        found: !!res.found,
        id: res.id || '',
        title: res.title || '',
        source: res.source || '',
        sourceType: res.sourceType || '',
        warning: res.warning || '',
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
