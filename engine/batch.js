// engine/batch.js — まとめて入力: 検証ゲート＋取り込みリスト台帳（v39）
//
// 長文/外部 AI の JSON から**複数の予定を一括で**取り込む道の中核。入口が何であれ
// （JSON 貼り付け / BYOK AI(v40) / WebMCP(v41)）、必ずこの parseBatch を通ってから
// 取り込みリスト（staging）に積まれ、人が確認してから保存される（**直接保存しない**）。
//
// 設計:
//   - **AI の出力を信用しない**: 契約（engine/contract.js）に照らして手書き検証。
//     不正値は落として problems に明記＝**黙って捨てない**（v16）。不正な日付・時刻を
//     「それらしく直す」ことはしない（創作しない SPEC §7）。整形（ゼロ埋め・全角→半角）は
//     **値の意味を変えない範囲**だけ・やったら明記する。
//   - **音声経路とは独立**: onUtterance / 自動保存(v28) / 来歴 には一切触れない。
//     短文の音声はルールベース（parser.js）が正のまま＝エンジンは統合しない。
//   - draft は engine/schema.js の FIELDS と同じ形（'' / false 既定）＝
//     store.restore / materialize にそのまま渡せる。
//   - staging は localStorage（モバイル Safari はタブ復帰でリロードされ得る＝AI の応答を
//     取り込み直させない）。読みは縮退・**書きは throw**（records/dict と同じ・v16）。
//
// DOM も net も知らない（Node からも require 可＝テスト対象）。
// 契約スキーマは持たない＝buildPrompt({schema}) で**注入**する（setLockSource と同じ流儀。
// engine 内の相互 require を作らない）。
(function (global) {
  'use strict';

  const KEY = 'vc_batch_v1';
  const MAX_EVENTS = 20; // contract.js の events.maxItems と鏡合わせ（tests が強制）
  const FIELDS = ['title', 'startDate', 'startTime', 'endDate', 'endTime', 'location', 'note', 'allDay'];

  // 不可視文字（v14: iOS が混ぜる双方向分離子等。parser.normalize と同じ集合＝tests が鏡合わせ）。
  // JSON の構造位置に混ざると JSON.parse が落ち、内容として意味を持つことは無い＝無条件除去が安全。
  const INVISIBLE_RE = /[\u200B-\u200F\u2060-\u2064\u2066-\u2069\uFEFF]/g;

  const emptyDraft = () => ({
    title: '', startDate: '', startTime: '', endDate: '', endTime: '',
    location: '', note: '', allDay: false,
  });

  // 全角数字・記号→半角。**日付/時刻の値だけ**に使う（title/note は人・AI が書いた内容＝改変しない）
  const toHankaku = (s) => String(s)
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/：/g, ':')
    .replace(/－/g, '-');

  // ---------- JSON の緩い読み取り（チャット AI の応答は散文やフェンスが付きがち） ----------
  function parseJsonLoose(text) {
    let t = String(text).replace(INVISIBLE_RE, '').trim();
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/); // ```json … ``` があれば中身
    if (fence) t = fence[1].trim();
    const tryParse = (s) => { try { return { ok: true, data: JSON.parse(s) }; } catch (e) { return { ok: false, err: e }; } };
    let r = tryParse(t);
    if (!r.ok) {
      // 前後に散文 → 最初の { / [ から最後の } / ] までを試す
      const iObj = t.indexOf('{'), iArr = t.indexOf('[');
      const start = (iObj < 0) ? iArr : (iArr < 0) ? iObj : Math.min(iObj, iArr);
      if (start >= 0) {
        const close = t[start] === '{' ? '}' : ']';
        const end = t.lastIndexOf(close);
        if (end > start) r = tryParse(t.slice(start, end + 1));
      }
    }
    if (!r.ok) {
      return {
        ok: false,
        error: `JSON として読めませんでした（${(r.err && r.err.message) || r.err}）。応答が途中で切れていないか・全体をコピーできているか確認してください`,
      };
    }
    return { ok: true, data: r.data };
  }

  // ---------- 1イベントの検証: 既知キーだけ・不正値は落として明記 ----------
  const DATE_KEYS = ['startDate', 'endDate'];
  const TIME_KEYS = ['startTime', 'endTime'];

  function readDate(key, raw, problems) {
    if (typeof raw !== 'string') { problems.push(`${key} が文字列でないため空にしました`); return ''; }
    const t = toHankaku(raw.trim());
    const m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!m) { problems.push(`${key}「${raw}」が YYYY-MM-DD として読めないため空にしました`); return ''; }
    const y = Number(m[1]), mo = Number(m[2]), da = Number(m[3]);
    const dt = new Date(y, mo - 1, da);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== da) {
      problems.push(`${key}「${raw}」は存在しない日付のため空にしました`); // 2/30 等（創作しない）
      return '';
    }
    const norm = `${m[1]}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
    if (norm !== raw) problems.push(`${key}「${raw}」を「${norm}」として読みました`);
    return norm;
  }

  function readTime(key, raw, problems) {
    if (typeof raw !== 'string') { problems.push(`${key} が文字列でないため空にしました`); return ''; }
    const t = toHankaku(raw.trim());
    const m = t.match(/^(\d{1,2}):(\d{1,2})$/);
    if (!m) { problems.push(`${key}「${raw}」が HH:MM として読めないため空にしました`); return ''; }
    const h = Number(m[1]), mi = Number(m[2]);
    if (h > 23 || mi > 59) { problems.push(`${key}「${raw}」は時刻の範囲外のため空にしました`); return ''; }
    const norm = `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
    if (norm !== raw) problems.push(`${key}「${raw}」を「${norm}」として読みました`);
    return norm;
  }

  // 戻り: { draft, ambiguities, problems } — draft=null はイベントごと除外（理由は problems）
  function validateEvent(raw) {
    const problems = [];
    let ambiguities = [];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { draft: null, ambiguities, problems: ['オブジェクトでないため除外しました'] };
    }
    const draft = emptyDraft();
    for (const key of Object.keys(raw)) {
      const v = raw[key];
      if (key === 'ambiguities') {
        if (Array.isArray(v)) ambiguities = v.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim());
        else if (v != null) problems.push('ambiguities が一覧でないため無視しました');
        continue;
      }
      if (key === 'sourceText') continue; // 封筒の欄がイベントに紛れても黙って無視はしない…が実害ゼロなので素通し
      if (!FIELDS.includes(key)) { problems.push(`未知の項目「${key}」を無視しました`); continue; }
      if (key === 'allDay') {
        if (typeof v === 'boolean') draft.allDay = v;
        else problems.push('allDay が true/false でないため無視しました');
      } else if (DATE_KEYS.includes(key)) {
        draft[key] = readDate(key, v, problems);
      } else if (TIME_KEYS.includes(key)) {
        draft[key] = readTime(key, v, problems);
      } else { // title / location / note
        if (typeof v === 'string') draft[key] = v.trim();
        else problems.push(`${key} が文字列でないため空にしました`);
      }
    }
    const hasAny = FIELDS.some((f) => (f === 'allDay' ? draft.allDay === true : draft[f] !== ''));
    if (!hasAny) return { draft: null, ambiguities, problems: ['内容が空のため除外しました'] };
    return { draft, ambiguities, problems };
  }

  // ---------- 封筒の検証 ----------
  // 入力: JSON 文字列（フェンス・散文・不可視文字に耐える） or パース済みオブジェクト。
  // 戻り: { ok, events: [{draft, ambiguities, problems}], errors, warnings, dropped }
  //   - errors   … 全体が取り込めない理由（ok:false のとき）
  //   - warnings … 取り込めたが知らせるべきこと（20件超の切り捨て・除外したイベントの理由）
  function parseBatch(input) {
    const warnings = [];
    let data = input;
    if (typeof input === 'string') {
      const p = parseJsonLoose(input);
      if (!p.ok) return { ok: false, events: [], errors: [p.error], warnings: [], dropped: 0 };
      data = p.data;
    }
    if (data === null || typeof data !== 'object') {
      return { ok: false, events: [], errors: ['JSON の中身がオブジェクトではありません'], warnings: [], dropped: 0 };
    }
    // 封筒 {events:[…]} が正だが、素の配列 […] も受ける（チャット AI は封筒を省くことがある）
    let rawEvents = Array.isArray(data) ? data : data.events;
    if (!Array.isArray(rawEvents)) {
      return { ok: false, events: [], errors: ['events（予定の一覧）が見つかりません。スキーマどおりの JSON か確認してください'], warnings: [], dropped: 0 };
    }
    if (!rawEvents.length) {
      return { ok: false, events: [], errors: ['予定が1件も入っていません'], warnings: [], dropped: 0 };
    }
    let dropped = 0;
    if (rawEvents.length > MAX_EVENTS) {
      dropped = rawEvents.length - MAX_EVENTS;
      warnings.push(`${MAX_EVENTS + 1}件目以降の${dropped}件は取り込みません（一度に${MAX_EVENTS}件まで）`);
      rawEvents = rawEvents.slice(0, MAX_EVENTS);
    }
    const events = [];
    rawEvents.forEach((raw, i) => {
      const v = validateEvent(raw);
      if (!v.draft) { warnings.push(`${i + 1}件目: ${v.problems.join('・')}`); return; } // カードが無い＝封筒側で知らせる
      events.push({ draft: v.draft, ambiguities: v.ambiguities, problems: v.problems });
    });
    if (!events.length) {
      return { ok: false, events: [], errors: ['取り込める予定がありませんでした'].concat(warnings), warnings: [], dropped };
    }
    return { ok: true, events, errors: [], warnings, dropped };
  }

  // ---------- store.restore へ渡すスナップショット ----------
  // 非空欄だけ confirmed / origin='voice'（音声で入れたのと同じ扱い＝次の素の発話で言い直し掃除(v6)が効く）。
  // ⚠️ allDay は `=== true` の時だけ「入っている」扱い（schema.js の isEmptyVal と鏡）。
  //    false に origin を付けると、次の発話が「前回の終日を空に」という無内容の掃除を来歴に出す。
  function toSnapshot(draft) {
    const d = Object.assign(emptyDraft(), draft || {});
    const fieldState = {}, origin = {};
    for (const f of FIELDS) {
      const filled = f === 'allDay' ? d.allDay === true : d[f] !== '' && d[f] != null;
      fieldState[f] = filled ? 'confirmed' : 'empty';
      origin[f] = filled ? 'voice' : null;
    }
    return { draft: d, fieldState, origin };
  }

  // ---------- 音声AI経路（v42）: 1件の draft → applyVoicePatch の patch ----------
  // patch は「言及した欄だけキーを持つ」意味論＝非空欄（allDay は ===true）だけを載せる
  // （toSnapshot と同じ判定＝schema.js の isEmptyVal と鏡。空欄をキーごと省く＝言っていない欄に触れない）。
  function draftToPatch(draft) {
    const d = Object.assign(emptyDraft(), draft || {});
    const patch = {};
    for (const f of FIELDS) {
      const filled = f === 'allDay' ? d.allDay === true : d[f] !== '' && d[f] != null;
      if (filled) patch[f] = d[f];
    }
    return patch;
  }

  // ---------- 取り込みリスト（staging）＝保存前の一時台帳 ----------
  function loadStage() {
    try {
      const v = JSON.parse(global.localStorage.getItem(KEY));
      if (!Array.isArray(v)) return [];
      // 壊れた行は読み飛ばして生きている行だけで動く（records/dict と同じ）
      return v
        .filter((e) => e && typeof e.id === 'string' && e.draft && typeof e.draft === 'object')
        .map((e) => ({
          id: e.id,
          draft: Object.assign(emptyDraft(), e.draft),
          ambiguities: Array.isArray(e.ambiguities) ? e.ambiguities.filter((s) => typeof s === 'string') : [],
          problems: Array.isArray(e.problems) ? e.problems.filter((s) => typeof s === 'string') : [],
          addedAt: typeof e.addedAt === 'number' ? e.addedAt : 0,
        }));
    } catch { return []; }
  }

  // 書き込み失敗は**握らず投げる**（「取り込んだつもり」を作らない＝records/dict と同じ・v16）
  function persistStage(entries) {
    global.localStorage.setItem(KEY, JSON.stringify(entries));
  }

  let seq = 0; // 同一ミリ秒の追加でも id が衝突しない通し番号
  function stageAdd(events, now) {
    const t = now instanceof Date ? now.getTime() : typeof now === 'number' ? now : Date.now();
    const cur = loadStage();
    const added = (events || []).map((e) => ({
      id: `b${t}-${seq++}`,
      draft: Object.assign(emptyDraft(), e.draft),
      ambiguities: Array.isArray(e.ambiguities) ? e.ambiguities : [],
      problems: Array.isArray(e.problems) ? e.problems : [],
      addedAt: t,
    }));
    persistStage(cur.concat(added));
    return added;
  }

  function stageList() { return loadStage(); }
  function stageRemove(id) { persistStage(loadStage().filter((e) => e.id !== id)); }
  function stageClear() { try { global.localStorage.removeItem(KEY); } catch {} }

  // ---------- AI への指示文（プロバイダ非依存） ----------
  // スキーマは**注入**（contract.js の SCHEMA を宿主が渡す）＝description の日本語が仕様書として
  // そのまま AI に届く（契約とプロンプトの二重管理ゼロ）。現在日時は相対表現の解決基準（曜日も渡す）。
  function buildPrompt(opts) {
    const now = opts && opts.now instanceof Date ? opts.now : new Date();
    const schema = (opts && opts.schema) || {};
    const pad2 = (n) => String(n).padStart(2, '0');
    const wd = '日月火水木金土'[now.getDay()];
    const tzMin = -now.getTimezoneOffset();
    const tz = `${tzMin >= 0 ? '+' : '-'}${pad2(Math.floor(Math.abs(tzMin) / 60))}:${pad2(Math.abs(tzMin) % 60)}`;
    const nowStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}（${wd}曜日） ${pad2(now.getHours())}:${pad2(now.getMinutes())} (UTC${tz})`;
    return [
      'あなたは予定入力アプリの解釈エンジンです。この後に貼る本文から予定・記録を読み取り、下のスキーマに従った JSON だけを返してください。',
      '',
      `現在日時: ${nowStr}`,
      '',
      '守ること:',
      '- 出力は JSON のみ。説明文やコードフェンス（```）を付けない。',
      '- 本文に書かれていない項目は入れない（推測で補わない・創作しない）。',
      '- 相対的な日時（明日・来週金曜 など）は上の現在日時を基準に具体的な日付へ直す。',
      '- 読み取りに確信が持てない項目は、最も自然な解釈を入れた上で、その予定の ambiguities に理由を日本語で書く。',
      `- 予定は本文に書かれた順に events に並べる（最大${MAX_EVENTS}件）。`,
      '',
      'スキーマ（JSON Schema）:',
      JSON.stringify(schema, null, 2),
    ].join('\n');
  }

  // ---------- WebMCP（v41）: ブラウザエージェントへの窓口 ----------
  // navigator.modelContext（提案段階の API）に create_events を登録する。
  //   - feature detection: 無ければ 'unsupported' を返すだけ＝**絶対に throw しない**
  //     （補助機能の失敗が本体を殺さない v13。未対応ブラウザではコストゼロ）。
  //   - execute は parseBatch（検証ゲート）→ onEvents（取り込みリストへ積む）**だけ＝保存しない**。
  //     外のエージェントが何を渡しても、人が確認してから保存する原則（背骨②）は破れない。
  //   - schema / onEvents は注入（contract を知らない・DOM を知らない＝テスト可能）。
  function registerWebMcp(navigatorLike, opts) {
    const schema = opts && opts.schema;
    const onEvents = opts && opts.onEvents;
    try {
      const mc = navigatorLike && navigatorLike.modelContext;
      if (!mc || typeof mc.registerTool !== 'function') return 'unsupported';
      mc.registerTool({
        name: 'create_events',
        description: 'カレンダー入力アプリ「ボイスカレンダー」へ予定・記録を渡す。渡した予定は直接保存されず、アプリ内の取り込みリストに入り、人が確認してから保存される。',
        inputSchema: schema,
        execute: (input) => {
          const r = parseBatch(input);
          if (!r.ok) {
            return { content: [{ type: 'text', text: `取り込めませんでした: ${r.errors.join('／')}` }], isError: true };
          }
          const added = onEvents ? onEvents(r.events) : stageAdd(r.events);
          const n = Array.isArray(added) ? added.length : r.events.length;
          const extra = r.warnings.length ? `（${r.warnings.join('／')}）` : '';
          return { content: [{ type: 'text', text: `${n}件を取り込みリストに入れました。保存はアプリ内で人が確認してから行われます${extra}` }] };
        },
      });
      return 'registered';
    } catch (e) {
      return `error: ${(e && e.message) || e}`; // 登録の失敗も本体を殺さない（診断に出すのは宿主）
    }
  }

  const api = { parseBatch, buildPrompt, toSnapshot, draftToPatch, stageAdd, stageList, stageRemove, stageClear, registerWebMcp, KEY, MAX_EVENTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.VCBatch = api;
})(typeof window !== 'undefined' ? window : globalThis);
