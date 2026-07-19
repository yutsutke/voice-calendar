// adapters/records.js — ローカル記録台帳（v32）
//
// 「ボイカレで登録した予定」を端末内に時系列で残す＝リストビューの土台。
//
// なぜアプリが自前で持つのか（この層の存在理由）:
//   iOS17 の書き込み専用アクセスでは **カレンダーを読めない**（v23-v26 で確立）＝
//   「登録した予定を見返す」はカレンダーからは原理的に不可能 → アプリが保存時に自分の控えを残すしかない。
//   これは SPEC §6「fieldState / Transcript は EventKit へ渡さず端末内に留める（ローカル完結）」の延長で、
//   §3 が禁じる「既存予定の読み取り・一覧」（＝他アプリの予定を full access で読む）とは **別物**＝
//   write-only の軽さ（v0 の売り＝SPEC §3）を保ったまま実現できる。
//
// 記録先（設定 recordDest・engine/settings.js）:
//   calendar → カレンダー(EventKit)のみ・ここには残さない（従来挙動）
//   list     → ここにだけ残す（カレンダーに実体を作らない＝OS 同期しない＝カレンダーを汚さない）
//   both     → 両方
//   リストビューに出るのは list / both で入れた記録（calendar のみはカレンダーアプリで見る＝役割分担）。
//
// 種類（kind・軸B）: 保存時に開始日時で自動判定し、レコードに焼き込む（表示時に now がズレても不変＝v18 の教訓）:
//   plan   （予定）= 開始が未来（保存時点より後）  例「明日15時に歯医者」
//   record （記録）= 開始が今〜過去               例「今 牛乳買う」「昨日暇だった」
//   タイムラインは kind でフィルタ（予定だけ / 記録だけ / 両方）。カレンダーへ書き出す時は記録に 📝 を付けて区別。
//
// DOM も宿主も知らない純粋な永続層（engine/settings.js と同じ流儀）。Node からも require 可（テスト対象）。
// 保存は localStorage のみ（端末内・外部送信しない＝ローカル完結 SPEC §2）。
(function (global) {
  'use strict';

  const KEY = 'vc_records_v1';
  // 台帳の上限。来歴（30件）と違い「消えると困る記録」なので緩め。超過時のみ最古（savedAt 昇順）を落とす。
  const CAP = 500;

  function loadRaw() {
    try {
      const v = JSON.parse(global.localStorage.getItem(KEY));
      return Array.isArray(v) ? v : [];
    } catch { return []; } // 壊れた保存値は空に（黙って壊れない＝settings.js と同じ）
  }

  // 1件を正規化（欠損・未知形は既定で埋める／時系列の軸が無いものだけ捨てる）。
  function normalize(r) {
    if (!r || typeof r !== 'object') return null;
    const startMs = Number(r.startMs);
    if (!Number.isFinite(startMs)) return null; // startMs 無し＝時系列に並べられない＝台帳の意味を成さない
    const num = (x, fb) => (Number.isFinite(Number(x)) ? Number(x) : fb);
    const savedAt = num(r.savedAt, startMs);
    const out = {
      id: String(r.id || `r${savedAt}-${startMs}`), // id 欠損（外部破損）でも remove できる id を導出
      title: String(r.title || ''),
      startMs,
      endMs: num(r.endMs, startMs),
      allDay: !!r.allDay,
      location: String(r.location || ''),
      note: String(r.note || ''),
      savedAt,
      // 予定(plan)=開始が未来 / 記録(record)=今〜過去。旧レコード（kind 欠損）は startMs>savedAt から導出（安全側は record）
      kind: (r.kind === 'plan' || r.kind === 'record') ? r.kind : (startMs > savedAt ? 'plan' : 'record'),
      dest: r.dest === 'both' ? 'both' : 'list', // 台帳に載る＝list か both（calendar はそもそも add しない）
    };
    // 位置情報（v38・任意）: 両方が有限数の時だけ持つ（片方だけ・壊れた値は無かったことに）
    if (Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lng))) {
      out.lat = Number(r.lat);
      out.lng = Number(r.lng);
    }
    return out;
  }

  function loadAll() { return loadRaw().map(normalize).filter(Boolean); }

  // 書き込み失敗（容量超過など）は**握らず投げる**: 「リストに記録しました」と言った後に実は
  // 消えていた、が台帳の最悪（v16「黙って捨てない」）。呼び出し側（doSave）が catch して表に出す。
  // 読み側の破損フォールバック（loadRaw）とは役割が違う＝読めないのは救えるが、書けたフリは嘘になる。
  function persist(arr) {
    global.localStorage.setItem(KEY, JSON.stringify(arr));
  }

  // event = adapters/calendar.js の materialize が返す { title, start:Date, end:Date, allDay, location, note }
  // dest  = 'list' | 'both'（呼び出し側 doSave が list/both の時だけ呼ぶ）
  // now   = new Date()（保存時刻＝savedAt と id の種。テストは固定 Date を渡す＝決定的。
  //         渡し忘れは現在時刻＝旧実装は 0(1970) に化け、savedAt 最古扱い→CAP 淘汰で真っ先に消える罠だった）
  function add(event, dest, now) {
    const t = (now && now.getTime) ? now.getTime() : (Number.isFinite(now) ? now : Date.now());
    const startMs = (event && event.start && event.start.getTime) ? event.start.getTime() : t;
    const endMs = (event && event.end && event.end.getTime) ? event.end.getTime() : startMs;
    const all = loadAll();
    // id は savedAt＋開始由来。同一内容を同時刻に複数回でも決定的に別 id にする（乱数を使わない＝テスト可能）
    const existing = new Set(all.map((r) => r.id));
    const base = `r${t}-${startMs}`;
    let id = base, n = 1;
    while (existing.has(id)) id = `${base}-${n++}`;
    const rec = {
      id,
      title: (event && event.title) || '',
      startMs, endMs,
      allDay: !!(event && event.allDay),
      location: (event && event.location) || '',
      note: (event && event.note) || '',
      savedAt: t,
      // 開始が未来=予定 / 今ちょうど・過去=記録。**保存時に確定して焼き込む**＝あとで見る時に
      // now が進んで「未来だった予定」が過去になっても分類は動かない（v18: 表示のたびに再解釈しない）。
      // 終日の開始は 0:00 → 「明日 休み」=予定・「今日 休み」=記録（今日は未来ではなく“今”の側）。
      kind: startMs > t ? 'plan' : 'record',
      dest: dest === 'both' ? 'both' : 'list',
    };
    all.push(rec);
    all.sort((a, b) => a.savedAt - b.savedAt); // 上限で落とすのは「最も古く保存したもの」
    const dropped = Math.max(0, all.length - CAP);
    persist(all.slice(-CAP));
    if (dropped) rec.dropped = dropped; // 黙って捨てない（v16）: 呼び出し側が toast で告げる。persist 後の付与＝保存 JSON には入らない
    return rec;
  }

  // 時系列（開始 startMs 昇順＝過去→未来）。リストビューが現在位置へスクロールする前提の並び。
  function list() {
    return loadAll().sort((a, b) => (a.startMs - b.startMs) || (a.savedAt - b.savedAt));
  }

  function remove(id) {
    const all = loadAll().filter((r) => r.id !== String(id));
    persist(all);
    return all;
  }

  // v38: 保存の後から位置情報を行へ付ける（設定オン時のみ呼ばれる・保存自体はブロックしない設計）。
  // 座標は5桁（約1m）に丸め＝それ以上の精度は「どこで保存したか」に不要な個人情報。
  // 行が無い（上限で消えた等）は null を返す＝呼び出し側が診断に出す（黙って消えない v16）。
  function attachGeo(id, lat, lng) {
    lat = Number(lat);
    lng = Number(lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const all = loadAll();
    const rec = all.find((r) => r.id === String(id));
    if (!rec) return null;
    rec.lat = Math.round(lat * 1e5) / 1e5;
    rec.lng = Math.round(lng * 1e5) / 1e5;
    persist(all);
    return rec;
  }

  function clear() { try { global.localStorage.removeItem(KEY); } catch {} }

  // ===== CSV 書き出し（v36・ユーザー明示要求で un-park。v33「テキスト・CSV書き出し→ライフログへの道」）=====
  // rows = list()（呼び出し側が表示中のトグルで絞ってから渡す＝**見えているものが出る** WYSIWYG・v20）。
  // 純関数＝DOM も配信手段も知らない（ダウンロード/共有は宿主 index.html の仕事）。
  // 日付と時刻を別列にするのはフォーム自身の分割保持（startDate/startTime）と同じ思想＝
  // 「日付だけ確定・時刻は空」を列でも表現できる（終日は時刻列が空）。
  function toCsv(rows) {
    const pad = (n) => String(n).padStart(2, '0');
    const dateS = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
    const timeS = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
    // RFC4180: カンマ・引用符・改行を含むセルだけ引用し、引用符は二重に（Excel/Numbers/Sheets が正しく読む形）
    const cell = (s) => {
      const v = String(s == null ? '' : s);
      return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    };
    const header = ['種類', 'タイトル', '開始日', '開始時刻', '終了日', '終了時刻', '終日', '場所', 'メモ', '保存先', '保存日時', '緯度', '経度'];
    const lines = [header.map(cell).join(',')];
    for (const r of rows || []) {
      lines.push([
        r.kind === 'plan' ? '予定' : '記録',
        r.title,
        dateS(r.startMs),
        r.allDay ? '' : timeS(r.startMs), // 終日は時刻を空に＝言っていない時刻を列でも創作しない（SPEC §7）
        dateS(r.endMs),
        r.allDay ? '' : timeS(r.endMs),
        r.allDay ? '○' : '',
        r.location,
        r.note,
        r.dest === 'both' ? '両方' : 'リスト',
        `${dateS(r.savedAt)} ${timeS(r.savedAt)}`,
        Number.isFinite(r.lat) ? r.lat : '', // 位置情報（v38）: 無い行は空＝創作しない
        Number.isFinite(r.lng) ? r.lng : '',
      ].map(cell).join(','));
    }
    // BOM: Excel が UTF-8 と認識するため（無いと日本語が化ける）。改行は CRLF（RFC4180）。
    // \uFEFF は必ずエスケープで書く（生の不可視文字はエディタ・diff・Edit を壊す＝v14 の実害）
    return '\uFEFF' + lines.join('\r\n') + '\r\n';
  }

  const api = { add, list, remove, clear, attachGeo, toCsv, KEY, CAP };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.VCRecords = api;
})(typeof window !== 'undefined' ? window : globalThis);
