# voice-calendar / 声で入れるカレンダー（仮称）— Claude 向けプロジェクト指示

## 🧭 セッション開始時にまず読む

- **設計の正 = [SPEC.md](SPEC.md)（要件定義 v0）**。実装判断で迷ったら SPEC §2「設計思想（背骨・変更不可）」に戻る。
- **実行チェックリスト・現在地 = [TODO.md](TODO.md)**。**build log = [CHANGELOG.md](CHANGELOG.md)**（実装したら追記）。
- 兄弟プロジェクト「あの日」= `photo-memory-spike` リポ（Capacitor 実務のノウハウ・Codemagic 署名・local-plugins 資産はそこにある）。

## プロダクトの核（壊してはいけないもの＝SPEC §2 の要約）

1. **フォームが単一の真実**。音声と手は同じ1つの state への2経路。解釈結果を別に持たない。
2. **仲介者を消す**。確認ダイアログを出さない。
3. **聞き返さない**。曖昧は「仮置き＋直せる」（v0 は仮置きせず素通し）。
4. **ノールックの条件**：曖昧さゼロで黙って1個に確定できる時だけ。**AI は創作しない**。
5. **ローカル完結**：転写・解釈はオンデバイス。LLM は v0 で入れない。
6. **入力エンジンは宿主非依存**：中立スキーマ → 薄いアダプタの境界を守る（→ライフログ `plans.stops` へ移植する資産）。

> エンジン（engine/）に宿主固有（EventKit / ics / plans）の知識を混ぜる変更は、この境界を壊す。アダプタ（adapters/）へ。

## ファイル構成

```
SPEC.md                  # 要件定義 v0（設計の正・背骨）
index.html               # UI = フォーム描画 + 2入口の配線だけ（ロジックは持たない）。root が本体＝Pages 配信元
engine/parser.js         # 解釈層: interpret(text, now) 純関数。確定的日本語日時パーサ（LLMなし）
engine/schema.js         # 共有状態層: DraftEvent ストア + fieldState + 欄ロック（衝突ポリシー §8）
input/transcriber.js     # 転写層: WebSpeech(web/iOS Safari) / 将来 SFSpeechRecognizer プラグイン。simulate() でテキスト注入
adapters/calendar.js     # 永続層: materialize(保存時既定値はここに集約) + ics(web) / eventkit(iOS,未実装)
scripts/sync-web.mjs     # root の web 本体 → www/（Capacitor webDir）を生成。cap の前に必ず実行（npm run cap:sync）
www/                     # 生成物（gitignore）。手で編集しない
tests/parser.test.js     # パーサ単体テスト — 決め打ちルールはテストが仕様
tests/schema.test.js     # 共有状態＋欄ロックのテスト（v3 の実バグの回帰込み）。`npm test` で両方走る
.claude/launch.json      # dev サーバ (port 5275。5273=spike / 5274=madeleine / 8123=terrain-game と衝突回避)
```

- バンドラ無し運用（あの日と同流儀）。各層は `<script>` 直読み・`window.VC*` 名前空間・Node からも require 可。
- **web 実機確認 = GitHub Pages**: https://yutsutke.github.io/voice-calendar/ （main の root を配信）。push が実機確認の前提＝ワークフローの一部（あの日と同じ）。iPhone Safari の webkitSpeechRecognition で実発話を試す（PC にマイクが無いため実発話検証は iPhone が主戦場）。
- **パーサの決め打ちルールを変えるときは tests/parser.test.js を必ず同時に更新**（テストがルールの仕様書）。

## 🚨 欄ロックの鉄則（v3 で実バグを踏んだ場所）

**「編集中か」を二重に持たない。** ロックの正は `store.setLockSource(fn)` に注入された述語（UI では `activeElement` 基準）だけ。`render()` の描画スキップも `applyVoicePatch` のスキップも `store.isLocked()` から導出する。

- ❌ やってはいけない: focus/blur イベントで Set を維持し、描画は activeElement で判定する（＝二重管理）。イベントが発火しない経路でズレ、**音声は書く・画面は隠す＝画面と違う値がサイレントに保存される**（背骨①の違反）。
- 検証では **値が正しいか だけでなく `store.get()[f] === inputEl(f).value`（ストアと画面の一致）をアサートする**。画面だけ見ていると通ってしまう。
- schema.js は DOM 非依存を維持（述語は宿主が注入する関数＝中立）。engine に `document` を持ち込まない。

## v0 実装の具体化判断（SPEC からの差分・2026-07-16）

- **start/end は date/time の部分フィールドに分割保持**（`startDate/startTime/endDate/endTime`）。「日付だけ確定・時刻は空」を創作なしに表現するため。Date への実体化は保存アダプタで。
- **保存時の既定値はアダプタに集約**：時刻なし→終日 / 終了なし→開始+1h / タイトルなし→「予定」（warning 表示）。解釈層は埋めない。
- **曖昧素通しの実挙動**：埋めなかった断片はタイトルに残る＝ユーザーに見える（例:「明日3時」→ 日付だけ入り、タイトルに「3時」が残る）。notes に理由を出す。
- 詳細な決め打ちルール一覧は parser.js 冒頭コメント + テスト。

## 運用ルール（あの日と同じ）

- **commit → `git push` まで基本やる**（明示依頼を待たない）。コミットメッセージは日本語、`feat(scope): ...` / `fix(...)` / `docs(...)` / `change(...)`。
  - ※ GitHub リモートは未作成（新規リポ作成・公開設定は外向き操作＝ユーザー確認要）。リモートが出来るまではローカル commit まで。
- `git add` は個別ファイル指定（`-A` を避ける）。
- **例外（要確認）**: force push / `reset --hard` / ブランチ削除 / `--no-verify` / 新規 GitHub リポ作成・公開設定。
- **セッションを閉じる前に TODO.md（現在地）と CHANGELOG.md（vN 追記・最新が上）を必ず更新**。CHANGELOG の型は photo-memory-spike と同じ（背景 / 設計判断 / ハマったところ / 結果・観察 / 教訓 / 残課題）。
- `www/index.html` 冒頭の `const BUILD` を commit ごとに上げる（キャッシュ切り分け用。コンソールとフッタに出る）。

## スコープを膨らませない歯止め（SPEC §3「v0 で作らない」）

道2（Siri 内完結）/ 仮置き UI / 既存予定の読み取り / 音声差分パッチ / 繰り返し・参加者 / LLM 解釈 / 複数予定一括 / Android — **v0 では着手しない**。ユーザーの明示要求 + 検証が当たってから un-park（あの日の地図ビューと同じ運び）。

## 計測（SPEC §10）

見るのは**ノールック完走率**（話しただけで正しく入り、直しに戻らなかった割合）。低いときの切り分け＝①音声認識 ②日時解釈 ③そもそも画面を見てしまう。
