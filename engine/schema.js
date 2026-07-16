// engine/schema.js — 共有状態層（SPEC §5-③）
//
// DraftEvent = single source of truth。音声（構造化パッチ）と手（直接操作）の
// 2つの入口がこの1つの state を更新し、描画は1つ（index.html の render）。
// 欄ロック＝衝突ポリシー（SPEC §8）はここに宿る：
//   - 人が編集中（フォーカス中）の欄は locked → 音声はその欄に書かない
//   - フォーカスが外れたらロック解除
//   - 「最後に触った経路が勝つ」ではなく「編集中の経路を保護する」
//
// ⚠️ ロックは「宿主に今この欄を人が編集中か聞く」述語（setLockSource）を正とする。
// v1 で focus/blur イベント頼みの Set だけにしていたら実バグを踏んだ:
// イベントが発火しない経路があると lock が外れたまま音声が書き込む一方、描画は
// activeElement をスキップして人の入力を守る → **ストアと画面がズレて、画面と違う値が保存される**。
// ＝ロック（イベント基準）と描画スキップ（activeElement 基準）の二重管理が原因。
// 述語で「編集中か」を一箇所から導出し、構造的にズレを不可能にする。
// 明示 lock()/unlock() も残す（DOM を持たない宿主・テスト用）。判定は両者の OR。
//
// 実装メモ（v0 の具体化）: SPEC §6 の start/end: Date|null を、date/time の
// 部分フィールドに分けて保持する。「日付だけ確定・時刻は空」（例:「明日 歯医者」）を
// 創作なしに表現するため。Date への実体化は保存アダプタ（adapters/calendar.js）で行う。
(function (global) {
  'use strict';

  const FIELDS = ['title', 'startDate', 'startTime', 'endDate', 'endTime', 'location', 'note', 'allDay'];

  function createDraftStore() {
    const emptyDraft = () => ({
      title: '', startDate: '', startTime: '', endDate: '', endTime: '',
      location: '', note: '', allDay: false,
    });
    let draft = emptyDraft();
    // FieldState: 'empty' | 'confirmed'（'guessed' は v1、'locked' は isLocked で導出）
    let fieldState = Object.fromEntries(FIELDS.map((f) => [f, 'empty']));
    // 誰が書いたか: 'voice' | 'human' | null。音声の再描画（下記）で「音声の残りだけ掃除」に使う
    let origin = Object.fromEntries(FIELDS.map((f) => [f, null]));
    const locks = new Set();
    let lockSource = null; // (field) => boolean : 宿主に「今この欄を人が編集中か」を聞く述語
    const transcripts = []; // 来歴（SPEC §5-①）: note には流し込まない。端末内に留める
    const listeners = new Set();

    const isEmptyVal = (f, v) => (f === 'allDay' ? v === false : !v);
    const emit = (change) => listeners.forEach((fn) => fn(change));
    const isLocked = (f) => locks.has(f) || !!(lockSource && lockSource(f));

    return {
      get: () => ({ ...draft }),
      getFieldState: (f) => (isLocked(f) ? 'locked' : fieldState[f]),
      getFieldOrigin: (f) => origin[f],
      isLocked,
      getTranscripts: () => transcripts.slice(),
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

      // 宿主（UI）が「編集中か」の正を注入する。DOM なら activeElement 基準＝描画スキップと同じ根拠。
      setLockSource(fn) { lockSource = typeof fn === 'function' ? fn : null; },

      // 入口A: 人間の直接操作
      setByHuman(field, value) {
        if (!FIELDS.includes(field)) return;
        draft[field] = value;
        const empty = isEmptyVal(field, value);
        fieldState[field] = empty ? 'empty' : 'confirmed';
        origin[field] = empty ? null : 'human';
        emit({ type: 'human', fields: [field] });
      },

      // 欄ロック（focus で lock / blur で unlock）
      lock(field) { if (FIELDS.includes(field)) { locks.add(field); emit({ type: 'lock', field }); } },
      unlock(field) { if (locks.delete(field)) emit({ type: 'unlock', field }); },

      // 入口B: 音声＝型付きの構造化パッチ。locked の欄はスキップ（上書きしない）。
      //
      // v0 の発話セマンティクス = 「1発話 = 1つの予定の言い直し（再描画）」:
      // 発話が触れなかった欄のうち **前回の音声が書いた欄は空に掃除する**（実発話FB:
      // 「時間が読み取れなかったのに前回の時間が残って混乱」→ --:-- に戻る方が分かる）。
      // 人が手で入れた欄（origin='human'）と編集中ロックの欄は消さない＝人の入力の保護（§8 の精神）。
      //
      // 例外 = 欄指定発話（opts.targeted・v17）: 「終了22時」「場所 立川」はその欄だけの差分。
      // 掃除すると直前に組み立てた予定が消えて本末転倒なので、言及した欄以外に触れない
      // （SPEC §0「任意項目は声か手で足す」の声版。自由文の差分パッチは v1 の主戦場のまま）。
      applyVoicePatch(patch, transcriptText, opts) {
        const targeted = !!(opts && opts.targeted);
        const transcript = { id: 't' + Date.now() + '-' + transcripts.length, text: transcriptText, createdAt: new Date() };
        transcripts.push(transcript);
        const written = [], skipped = [], cleared = [];
        for (const f of FIELDS) {
          const mentioned = patch && Object.prototype.hasOwnProperty.call(patch, f);
          if (mentioned) {
            if (isLocked(f)) { skipped.push(f); continue; }
            draft[f] = patch[f];
            fieldState[f] = 'confirmed';
            origin[f] = 'voice';
            written.push(f);
          } else if (!targeted && origin[f] === 'voice' && !isLocked(f)) {
            draft[f] = f === 'allDay' ? false : '';
            fieldState[f] = 'empty';
            origin[f] = null;
            cleared.push(f);
          }
        }
        emit({ type: 'voice', fields: written, skipped, cleared, transcript });
        return { written, skipped, cleared, transcript };
      },

      // 巻き戻し（v18・実機FB「意図せず新規になるときがある」）:
      // 発話を**やり直す**のではなく、その発話の**直前の状態を復元する**。
      // 古い発話を再解釈すると now が変わって日付がズレる（「明日」は明日には別の日）＝
      // 来歴に積むのは「解釈結果」ではなく「状態のスナップショット」でなければならない。
      // origin/fieldState も一緒に戻す＝復元後の言い直し掃除（v6）が正しく効き続ける。
      snapshot: () => ({ draft: { ...draft }, fieldState: { ...fieldState }, origin: { ...origin } }),
      restore(snap) {
        if (!snap || !snap.draft) return false;
        draft = { ...emptyDraft(), ...snap.draft };
        fieldState = { ...Object.fromEntries(FIELDS.map((f) => [f, 'empty'])), ...(snap.fieldState || {}) };
        origin = { ...Object.fromEntries(FIELDS.map((f) => [f, null])), ...(snap.origin || {}) };
        emit({ type: 'restore', fields: FIELDS.slice() });
        return true;
      },

      reset() {
        draft = emptyDraft();
        fieldState = Object.fromEntries(FIELDS.map((f) => [f, 'empty']));
        origin = Object.fromEntries(FIELDS.map((f) => [f, null]));
        locks.clear();
        emit({ type: 'reset', fields: FIELDS.slice() });
      },
    };
  }

  const api = { FIELDS, createDraftStore };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.VCStore = api;
})(typeof window !== 'undefined' ? window : globalThis);
