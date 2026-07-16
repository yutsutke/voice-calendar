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

> **🎉 セッション1（2026-07-16）＝bootstrap → 一本道(web)貫通 → GitHub Pages 公開 → iPhone 実発話テスト第1回 →「基本いける」**
> v1-v3: エンジン＋フォーム＋欄ロック（v3 で core バグ修正）。v4: root 本体化＋ Pages 配信。**v5: 実発話FB第1回を反映**——昨日/一昨日（**過去の実績も声で入れる用途が判明**）・「来週**の**◯曜」・N日後/N週間後/Nか月後（漢数字対応）・**来歴パネル**（生テキスト＋認識信頼度＋解釈結果を30件記録＝認識と解釈の切り分け用）。
> **テスト 56/56 ✅**（parser 46 + schema 10）・preview E2E ✅・console 0。リポ = https://github.com/yutsutke/voice-calendar （public・Pages 配信中）。
>
> **👀 未再現 watch: 「来週の月曜日旅行」で時間が勝手に8時になった件**——現パーサはこのテキストから 8:00 を作れない＝認識テキストが違った可能性が高い。**次に起きたら「来歴」パネルを開いて 🗣 行をそのまま報告してもらう**（そのために来歴を作った）。※ v6 の「発話=言い直し」で前回の残り時刻は消えるようになったため、正体が「前回の残り」だったなら再発しない。
>
> **🔧 v6（実発話FB第2回・スクショの来歴パネルより）**: ①ユーザー指摘「時刻が読めなかった発話で前回の時刻が残って混乱」→ **発話=言い直しセマンティクス**（前回の音声欄は --:-- に掃除・手入力とロック欄は保護・🧹 を来歴に記録）②「今月の末」「N月の末」「1ヵ月後の今日」を追加。**テスト 67/67 ✅**（parser 53 + schema 14）。認識信頼度 95-99% ＝ 外れは解釈側と切り分け成功（来歴パネルが初回から機能）。
>
> **▶▶ 次回はここから**: ① **iPhone Safari で https://yutsutke.github.io/voice-calendar/ を開き、マイク発話を10件試す**＝実発話の素通し率・言い回しの実データ集め（🎤タップ→マイク許可。認識されない時は 設定→Siriと検索→「"Hey Siri"を聞き取る」等で音声認識が有効か確認）② 外れた言い回しをそのまま報告してもらう→テストに足してパーサ補強 ③ その後 Phase 2（iOS native の足回り）へ。
>
> **🖥 dev サーバの運用メモ（セッション1でハマった）**: PC にはマイク無し＝**実発話検証は iPhone（GitHub Pages）が主戦場**。PC ではテキスト欄（発話シミュレート）で試す。Claude の preview_start で起動したサーバは**ターン間で落ちる**（python プロセスごと消える→ブラウザは「接続できません」）。自分で触るときは自分のターミナルで `npm run serve`（root 配信・http://localhost:5275）。
>
> **✅ GitHub Pages 化（GO 済み・実施済み 2026-07-16）**: あの日と同じ「root に本体 → `scripts/sync-web.mjs` で www/ 生成（gitignore）」に組み替え。**web の編集は root の index.html / engine/ / input/ / adapters/**（www/ は生成物・手で触らない）。Capacitor へは `npm run cap:sync`（sync-web が先に走る）。

---

## Phase 1 — 一本道 (web)：録音 → 確定パーサ → フォーム → 保存 ✅（bootstrap で貫通）

- [x] 中立スキーマ + 共有状態ストア（fieldState / 欄ロック）＝ engine/schema.js
- [x] 確定的日本語日時パーサ（純関数・now 注入・LLMなし）＝ engine/parser.js + テスト35本
- [x] 単一フォーム（必須/任意の段差・任意は畳む）＋2経路配線 ＝ index.html
- [x] 編集中フィールドのロック（activeElement 由来の述語に一本化・スキップ通知）＋ テスト10本
      ※ v3 で実バグ修正済み（イベント基準と描画スキップの二重管理→ストアと画面がズレ、画面と違う値が保存され得た）。鉄則は CLAUDE.md 参照
- [x] 転写層（WebSpeech + simulate 注入口）＝ input/transcriber.js
- [x] 保存アダプタ境界（materialize + ics アダプタ）＝ adapters/calendar.js
- [x] GitHub Pages 配信（root 本体 + sync-web.mjs → www/ 生成）＝ iPhone Safari で実発話できる場
- [x] 実発話テスト第1回（iPhone・4発話）→「基本いける」＋外れ3系統を v5 で修正（昨日/一昨日・来週の◯曜・N後）
- [x] 来歴パネル（生テキスト・認識信頼度・解釈結果・素通し理由を端末内に30件）
- [ ] **実発話テスト第2回**（さらに10件・言い回しを変えて）← 次の一手。外れたら「来歴」の 🗣 行をそのまま報告
- [ ] パーサ補強（実データ駆動）: 漢数字の時刻（「三時」）/「半」単独 /「夕方」だけ（時刻なし）/「今度の金曜」/ 相対時刻（30分後・2時間後）等、出てきたものから

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

- ~~**連続発話の混在状態**: 前の発話の日時が残る~~ → **実使用で問題化（FB第2回）→ v6 で解決**: 発話=言い直しセマンティクス（前回の音声欄は掃除・手入力は保護）。断片発話での「追加・修正」は引き続き v1 差分パッチの主戦場。
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
