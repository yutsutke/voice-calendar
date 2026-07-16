// adapters/calendar.js — 永続層＝薄いアダプタ（SPEC §5 前後の層 / §6）
//
// materialize(draft, now): 中立スキーマ（date/time 部分フィールド）→ 具体イベントに実体化。
// 保存時の既定値はここ（アダプタ境界）に集約する＝解釈層は創作しない（SPEC §7「空」）:
//   - 時刻なし（日付のみ）        → 終日イベントとして保存
//   - 終了なし（時刻あり）        → 開始 + 1時間
//   - タイトルなし                → 「予定」（warning を出して見せる）
//
// 宛先アダプタ:
//   - icsAdapter      : web/開発用。.ics を生成してダウンロード（OS のカレンダーが開ける）
//   - eventKitAdapter : iOS native（ローカルプラグイン calendar-events）— v0 後半で実装。
//                       fieldState / 来歴は宛先へ渡さず端末内に留める（ローカル完結）。
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

  const pad2 = (n) => String(n).padStart(2, '0');

  function materialize(draft, now) {
    const problems = [];
    const warnings = [];
    if (!draft.startDate && !draft.startTime) {
      problems.push('開始（日付か時刻）が未入力です');
      return { ok: false, problems, warnings };
    }
    let dateStr = draft.startDate;
    if (!dateStr) {
      dateStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
      warnings.push('日付が未入力のため今日にしました');
    }
    const [y, mo, da] = dateStr.split('-').map(Number);
    const title = draft.title || '予定';
    if (!draft.title) warnings.push('タイトルが未入力のため「予定」にしました');

    const allDay = draft.allDay || !draft.startTime;
    if (!draft.allDay && !draft.startTime) warnings.push('時刻が未入力のため終日の予定にしました');

    let start, end;
    if (allDay) {
      start = new Date(y, mo - 1, da);
      if (draft.endDate) {
        const [ey, em, ed] = draft.endDate.split('-').map(Number);
        end = new Date(ey, em - 1, ed);
        if (end < start) { end = start; warnings.push('終了日が開始日より前だったため同日にしました'); }
      } else end = start;
    } else {
      const [sh, sm] = draft.startTime.split(':').map(Number);
      start = new Date(y, mo - 1, da, sh, sm);
      if (draft.endTime) {
        const [eh, em] = draft.endTime.split(':').map(Number);
        if (draft.endDate) {
          const [ey, emo, eda] = draft.endDate.split('-').map(Number);
          end = new Date(ey, emo - 1, eda, eh, em);
        } else end = new Date(y, mo - 1, da, eh, em);
        if (end <= start) { end = new Date(start.getTime() + 60 * 60 * 1000); warnings.push('終了が開始以前だったため開始+1時間にしました'); }
      } else {
        end = new Date(start.getTime() + 60 * 60 * 1000); // 既定: +1時間
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

  // ---------- EventKit（iOS native）— プラグイン実装後に有効化 ----------
  const eventKitAdapter = {
    name: 'eventkit',
    label: 'カレンダーに保存',
    async save(ev) {
      const C = global.Capacitor;
      if (!C || !C.isNativePlatform || !C.isNativePlatform()) throw new Error('native 環境ではありません');
      const plugin = nativePlugin(C, 'CalendarEvents');
      if (!plugin) throw new Error('CalendarEvents プラグインが native に登録されていません');
      const res = await plugin.save({
        title: ev.title,
        startMs: ev.start.getTime(),
        endMs: ev.end.getTime(),
        allDay: ev.allDay,
        location: ev.location,
        note: ev.note,
      });
      return { ok: true, method: 'eventkit', id: res && res.id };
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
