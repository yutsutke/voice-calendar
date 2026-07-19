// engine/settings.js — 詳細設定（v19）
//
// **設定を足す基準**（SPEC §12「多様性が出る前に可変機構を作らない」の運用）:
//   実機FBで **実際に迷い・事故が起きた決定** だけを設定にする。「あると便利そう」は入れない。
//   既定値は必ず **これまでの実挙動**（＝設定を触らない人の体験は1ミリも変わらない）。
//
// 保存は localStorage（端末内・外部送信しない＝ローカル完結 SPEC §2）。
// engine 層に置くが DOM も宿主も知らない（純粋な値の入れ物）＝ライフログ移植時もそのまま持てる。
(function (global) {
  'use strict';

  const KEY = 'vc_settings_v1';

  // 各設定: 既定値・ラベル・説明・根拠（なぜ設定になったか＝将来「これ要る？」の判断材料）
  const DEFS = [
    {
      key: 'recordDest',
      label: '保存先',
      hint: 'カレンダー: OS の既定カレンダーへ（今までの動き）。リスト: カレンダーには入れず、アプリ内の「リスト」に時系列で残す（この端末の中だけ・同期なし）。両方: 両方へ入れる＝記録（開始が今〜過去）はカレンダー側に 📝 が付く。※アプリはカレンダーを読めないため、カレンダーに入れた分を消すのはカレンダーアプリで。',
      why: 'v32 ユーザー明示要求（2026-07-18）: v27 でメモ用途が成立した先の実問題＝記録が増えるとカレンダーが予定でいっぱいになる。メモ的な記録をカレンダーに入れずリストへ逃がす道（SPEC §12「用途が2つに割れてから可変機構を作る」の“割れた”局面）',
      def: 'calendar',
      type: 'enum',
      options: [
        { value: 'calendar', label: 'カレンダーのみ' },
        { value: 'list', label: 'リストのみ' },
        { value: 'both', label: '両方' },
      ],
    },
    {
      key: 'captureLocation',
      label: '保存時に位置情報も記録する',
      hint: 'オン: 保存した時にいた場所（緯度経度）をリストの行に残し、🗺地図 で開ける。取得は保存を待たせない（取れた時だけ後から行に付く）。リスト/両方で保存した行だけが対象（カレンダーのみの保存には付かない＝アプリはカレンダーを読めないため）。位置はこの端末の中にだけ保存され、外部送信されない。オフ: 何もしない（今までの動き）。',
      why: 'v38 ユーザー明示要求（2026-07-19）「データ保存の際に現在の位置情報を取得。アップルマップや、グーグルマップと連携して、記録した地点で表示できるようにしたい」。位置情報は敏感＝黙って取らない＝既定オフ（オンにした人だけ動く。v19 の既定不変原則＋プライバシーの opt-in）',
      def: false,
    },
    {
      key: 'plainUtteranceIsNew',
      label: '欄名なしの発話は「新規」にする',
      hint: 'オン: 前の音声入力を消して新しい予定として入れ直す（今までの動き）。オフ: 消さずに足すだけ。',
      why: 'v18 FB「意図せず新規になるときがある」。人によって・場面によって望む挙動が違うと分かった',
      def: true,
    },
    {
      key: 'protectManualEdits',
      label: '手入力した欄は音声で消さない',
      hint: 'オン: 手で打った場所やメモは、新規の発話でも残る（今までの動き）。オフ: 音声の欄と同じように消える。',
      why: 'v6 で「手入力は労力なので保護」と決めた判断。FB で明示的に選択したいと要求された',
      def: true,
    },
    {
      key: 'lockEditingField',
      label: '編集中の欄には音声を書き込まない',
      hint: 'オン: 打っている最中の欄は音声から守る（今までの動き）。オフ: 音声が上書きする。',
      why: 'SPEC §8 の核。オフにする人はまず居ないが、v3 の実バグの温床だった箇所なので切り分け用に露出',
      def: true,
    },
    {
      key: 'autoOpenOptional',
      label: '任意の項目に入ったら自動で開く',
      hint: 'オン: 音声が終了・場所・メモに書いたら畳みを開いて見せる（今までの動き）。オフ: 畳んだまま。',
      why: 'SPEC §12「フォームのプレッシャー」＝常に見えると全部埋めたくなる。ノールック派は閉じたままが良い',
      def: true,
    },
    {
      key: 'autoSaveAfterUtterance',
      label: '話し終わったら自動で保存する',
      hint: 'オン: 日時が確定した発話（「明日15時に歯医者」「今 牛乳買う」）は、保存を押さなくても入る。オフ: 保存を押す（今までの動き）。※ 日時を言わなかった発話・曖昧な発話・欄名で始まる発話は自動保存しない（フォームに残るので保存を押す）。',
      why: 'v28 FB「記録後、保存を自動にできる設定」＝メモ用途（v27）だと「話す→保存を押す」の1タップが冗長＝ノールックの究極形。既定はオフ: **保存は不可逆**（アプリに読み取り権限が無い＝入った予定はカレンダー側で手で消すしかない）＝誤認識がそのまま残る。だから「曖昧さゼロで黙って1個に確定できる時だけ」（SPEC §2-4）に限る。**日時を言った発話だけに限るのは v28 の検証で「えーっと」が自動保存された穴を見つけたため**（パーサは意味を判定しない＝雑音もタイトルになり v27 の「日時なし→今」で確定する。v24 の起動＝即録音と重なると開くだけで環境音が予定になる）',
      def: false, // ← 既定オフ＝今までの動き（触らない人の体験は変わらない）
    },
    {
      key: 'defaultDurationMin',
      label: '終了を言わなかった時の長さ',
      hint: '開始だけ言った予定に、この長さの終了時刻を付けて保存する。',
      why: 'v1 でアダプタに +1時間を決め打ちした（SPEC §7「AIは創作しない」との緊張点）。人により 30分/2時間',
      def: 60,
      type: 'number',
      options: [15, 30, 60, 90, 120],
      fmt: (v) => `${v}分`,
    },
    {
      key: 'silenceMs',
      label: '話し終わってから確定するまで',
      hint: '無音がこの長さ続いたら録音を止めて確定する。短い＝速いが言い淀むと切れる。長い＝待たされる。',
      why: 'v15/v16 で 1.8 秒と決め打ち。「長すぎ＝待たされる／短すぎ＝切られる」は実機でしか分からないと明言していた',
      def: 1800,
      type: 'number',
      options: [1200, 1800, 2500, 4000],
      fmt: (v) => `${(v / 1000).toFixed(1)}秒`,
      native: true, // native の音声プラグインに渡す（web では効かない）
    },
  ];
  // 🚫 targetCalendarId（保存先の選択）は **v26 で撤去**した。write-only では選択を次の起動へ
  // 持ち越せず（実機FB第17回）、設定に残しても「選べるのに効かない」嘘になるため。
  // 保存先を変える正しい道は **OS 設定 → カレンダー → デフォルトカレンダー**（実機で成立済み）。
  // 「今どこへ入るか」の表示は設定ではなく事実＝詳細設定の情報行と診断に出す（index.html）。

  function load() {
    const out = {};
    for (const d of DEFS) out[d.key] = d.def;
    try {
      const saved = JSON.parse(global.localStorage.getItem(KEY));
      if (saved && typeof saved === 'object') {
        for (const d of DEFS) {
          const v = saved[d.key];
          if (v === undefined) continue;
          if (d.type === 'number' && typeof v === 'number') out[d.key] = v;
          else if (d.type === 'enum' && (d.options || []).some((o) => o.value === v)) out[d.key] = v; // 選択肢に無い値は既定のまま
          else if (!d.type && typeof v === 'boolean') out[d.key] = v;
        }
      }
    } catch { /* 壊れた保存値は既定にフォールバック（黙って壊れない＝既定で動く） */ }
    return out;
  }

  function createSettings() {
    let values = load();
    const listeners = new Set();
    return {
      DEFS,
      get: (key) => values[key],
      all: () => ({ ...values }),
      set(key, value) {
        const d = DEFS.find((x) => x.key === key);
        if (!d) return;
        if (d.type === 'enum' && !(d.options || []).some((o) => o.value === value)) return; // 未知の値で壊さない
        values[key] = value;
        try { global.localStorage.setItem(KEY, JSON.stringify(values)); } catch {}
        listeners.forEach((fn) => fn(key, value));
      },
      resetAll() {
        values = {};
        for (const d of DEFS) values[d.key] = d.def;
        try { global.localStorage.removeItem(KEY); } catch {}
        listeners.forEach((fn) => fn(null, null));
      },
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    };
  }

  const api = { createSettings, DEFS, KEY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.VCSettings = api;
})(typeof window !== 'undefined' ? window : globalThis);
