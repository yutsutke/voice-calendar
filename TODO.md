# voice-calendar — TODO

> **これは何か**: 「明日15時に歯医者」と話すとフォームが埋まり、画面を見ずに保存まで完走できる（ノールック）入力補助カレンダー。音声と手は**同じ一つのフォーム**を同時に編集する。設計の正は [SPEC.md](SPEC.md)。
> 資産は「アプリ」ではなく「入力エンジン」＝後でライフログ `plans` へ移植する。

---

## 🔒 スコープの境界（最初に必ず読む）

- **v0 で作るのは SPEC §3 の9項目だけ**（道1・確定入力・2経路＋欄ロック・EventKit 保存・iOS）。
- **今は作らない**（→ 末尾リスト）: 道2 / 仮置きUI / 既存予定の読み取り / 音声差分パッチ / LLM / Android。
- 迷ったら SPEC §2「背骨」6点に照らす。

---

## 現在地

> **🔧 セッション1（2026-07-16）＝リポ bootstrap ＋ 一本道(web) 貫通。**
> テキスト/音声（WebSpeech）→ 確定パーサ → フォーム反映 → 欄ロック → .ics 保存まで、Windows のブラウザで動く。パーサ単体テスト 35/35 ✅。preview E2E ✅（発話反映・編集中タイトル保護・曖昧素通し・ics 生成）。
>
> **▶▶ 次回はここから**: ① ブラウザ（Edge/Chrome で `npm run serve` → http://localhost:5275）で**マイク発話**を自分の口で試す＝実発話の素通し率・言い回しの実データ集め（パーサに足すべきパターンが見えてくる）② 集まった実発話をテストに足してパーサ補強 ③ その後 Phase 2（iOS native の足回り）へ。

---

## Phase 1 — 一本道 (web)：録音 → 確定パーサ → フォーム → 保存 ✅（bootstrap で貫通）

- [x] 中立スキーマ + 共有状態ストア（fieldState / 欄ロック）＝ engine/schema.js
- [x] 確定的日本語日時パーサ（純関数・now 注入・LLMなし）＝ engine/parser.js + テスト35本
- [x] 単一フォーム（必須/任意の段差・任意は畳む）＋2経路配線 ＝ index.html
- [x] 編集中フィールドのロック（focus=lock / blur=unlock・スキップ通知）
- [x] 転写層（WebSpeech + simulate 注入口）＝ input/transcriber.js
- [x] 保存アダプタ境界（materialize + ics アダプタ）＝ adapters/calendar.js
- [ ] **実発話での手触り検証**（マイクで10件入れてみる→素通し率と外し方を記録）← 次の一手
- [ ] パーサ補強（実データ駆動）: 漢数字（「三時」）/「半」単独 /「夕方」だけ（時刻なし）/ 「今度の金曜」等、出てきたものから

## Phase 2 — iOS native 足回り

- [ ] `npm install` → `npx cap add ios`（ios/ をコミット、spike と同流儀）
- [ ] **転写のネイティブ化**: local-plugins/speech-recognition（SFSpeechRecognizer, on-device 優先）
      権限: NSSpeechRecognitionUsageDescription + NSMicrophoneUsageDescription。拒否時はテキスト入力にフォールバック
- [ ] **保存のネイティブ化**: local-plugins/calendar-events（EventKit）。adapters/calendar.js の eventKitAdapter が呼ぶ契約は定義済み（title/startMs/endMs/allDay/location/note）
      権限: iOS17+ の **書き込み専用アクセス**（NSCalendarsWriteOnlyAccessUsageDescription）が軽くて本命 → 要検証
- [ ] Codemagic ビルド（spike の codemagic.yaml を流用）→ TestFlight で実機
- [ ] 実機でノールック完走率を測り始める（SPEC §10）

## Phase 3 — Siri 起動（道1）

- [ ] App Intent 1つ（`openAppWhenRun = true`）→ 起動と同時に録音開始
- [ ] App Shortcuts で Siri フレーズを設定なし露出（例:「予定入れて」）
- [ ] spike の local-plugins/app-shortcuts の「UserDefaults バッファ＋drain」パターンを流用
      （コールド起動: JS が getPending() で drain ／ 温かい起動: notifyListeners）
      ※ Quick Action 用プラグインなので App Intents 版に書き換えは必要。パターンだけ移植

## Phase 4 — 計測・磨き

- [ ] ノールック完走率のローカル記録（保存後に「直しに戻ったか」を端末内でカウント）
- [ ] 曖昧パターン頻度の記録（notes の内容別カウント）→ v1 仮置き UI の投資判断材料

---

## 観察メモ（v0 検証で見る点）

- **連続発話の混在状態**: 保存せずに2回別の予定を話すと、前の発話の終了日時が残る（パッチモデルの帰結。E2E で確認済み）。実使用で困るか観察 → 困るなら「新しい日付が来たら古い end を捨てる」ルールか、v1 差分パッチで解決。
- **1〜6時の素通し**（「3時」→ 埋めない）が実際どのくらい起きるか。頻出なら v1 仮置き（15時と仮置き＋淡色）の最有力候補。
- Web Speech API は Chrome だとクラウド転写の可能性（開発用と割り切る。本命は SFSpeechRecognizer の on-device）。

## 今は作らない（SPEC §3 / un-park は検証◯＋明示要求が揃ってから）

- 道2（Siri 内完結）／確定・曖昧の自動振り分け
- 曖昧の仮置き UI（guessed 状態は schema に予約済み）
- 既存予定の読み取り・一覧・衝突検知
- 音声差分パッチ（「1時間後ろ倒し」）← v1 の主戦場
- 繰り返し / 参加者 / 添付・リッチ項目
- LLM 解釈・複数予定一括
- Android（CalendarContract アダプタの席だけ用意してある）
