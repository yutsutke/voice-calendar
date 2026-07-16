// engine/schema.js — 共有状態層（SPEC §5-③）
//
// DraftEvent = single source of truth。音声（構造化パッチ）と手（直接操作）の
// 2つの入口がこの1つの state を更新し、描画は1つ（index.html の render）。
// 欄ロック＝衝突ポリシー（SPEC §8）はここに宿る：
//   - 人が編集中（フォーカス中）の欄は locked → 音声はその欄に書かない
//   - フォーカスが外れたらロック解除
//   - 「最後に触った経路が勝つ」ではなく「編集中の経路を保護する」
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
    // FieldState: 'empty' | 'confirmed'（'guessed' は v1、'locked' は locks で別管理）
    let fieldState = Object.fromEntries(FIELDS.map((f) => [f, 'empty']));
    const locks = new Set();
    const transcripts = []; // 来歴（SPEC §5-①）: note には流し込まない。端末内に留める
    const listeners = new Set();

    const isEmptyVal = (f, v) => (f === 'allDay' ? v === false : !v);
    const emit = (change) => listeners.forEach((fn) => fn(change));

    return {
      get: () => ({ ...draft }),
      getFieldState: (f) => (locks.has(f) ? 'locked' : fieldState[f]),
      getTranscripts: () => transcripts.slice(),
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

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
          if (locks.has(k)) { skipped.push(k); continue; }
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
