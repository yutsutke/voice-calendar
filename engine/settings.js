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
    {
      key: 'targetCalendarId',
      label: '保存先のカレンダー',
      hint: '空のままなら OS の既定カレンダー（設定 → カレンダー → デフォルトカレンダー）に入る。Google カレンダーへ入れたい時は、iOS の設定でカレンダーのアカウントに Google を追加してから「変更」で選ぶ（アプリは Google と直接通信しない＝OS が同期する）。',
      why: 'v23 FB「どのカレンダーに書き出すか見れたり選べるといい」。既定が意図と違う人（Google と iCloud を併用）が居る＝保存先が見えないと「保存できたのに見つからない」事故になり、原因も分からない',
      def: '',
      type: 'text', // 値は EKCalendar の識別子＝人が読めない。UI は「現在地の表示＋システムの選択画面」（宿主側の判断）
      native: true, // web は .ics ダウンロード＝保存先という概念が無い
    },
  ];

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
          else if (d.type === 'text' && typeof v === 'string') out[d.key] = v;
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
