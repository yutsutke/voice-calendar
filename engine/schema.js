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
      isLocked,
      getTranscripts: () => transcripts.slice(),
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

      // 宿主（UI）が「編集中か」の正を注入する。DOM なら activeElement 基準＝描画スキップと同じ根拠。
      setLockSource(fn) { lockSource = typeof fn === 'function' ? fn : null; },

      // 入口A: 人間の直接操作
      setByHuman(field, value) {
        if (!FIELDS.includes(field)) return;
        draft[field] = value;
        fieldState[field] = isEmptyVal(field, value) ? 'empty' : 'confirmed';
        emit({ type: 'human', fields: [field] });
      },

      // 欄ロック（focus で lock / blur で unlock）
      lock(field) { if (FIELDS.includes(field)) { locks.add(field); emit({ type: 'lock', field }); } },
      unlock(field) { if (locks.delete(field)) emit({ type: 'unlock', field }); },

      // 入口B: 音声＝型付きの構造化パッチ。locked の欄はスキップ（上書きしない）
      applyVoicePatch(patch, transcriptText) {
        const transcript = { id: 't' + Date.now() + '-' + transcripts.length, text: transcriptText, createdAt: new Date() };
        transcripts.push(transcript);
        const written = [], skipped = [];
        for (const [k, v] of Object.entries(patch || {})) {
          if (!FIELDS.includes(k)) continue;
          if (isLocked(k)) { skipped.push(k); continue; }
          draft[k] = v;
          fieldState[k] = 'confirmed';
          written.push(k);
        }
        emit({ type: 'voice', fields: written, skipped, transcript });
        return { written, skipped, transcript };
      },

      reset() {
        draft = emptyDraft();
        fieldState = Object.fromEntries(FIELDS.map((f) => [f, 'empty']));
        locks.clear();
        emit({ type: 'reset', fields: FIELDS.slice() });
      },
    };
  }

  const api = { FIELDS, createDraftStore };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.VCStore = api;
})(typeof window !== 'undefined' ? window : globalThis);
