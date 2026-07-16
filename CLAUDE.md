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
local-plugins/           # ローカル Capacitor プラグイン（SPM）。命名規約: npm名 kebab → PascalCase 一致必須
  calendar-events/       #   EventKit 保存（iOS17+ 書き込み専用アクセス・openSettings 復帰導線）
  speech-recognition/    #   SFSpeechRecognizer 転写（on-device 優先・無音1.8s自動確定/6s打ち切り）
ios/                     # cap add ios の生成物をコミット（spike と同流儀）。Info.plist に権限4つ
codemagic.yaml           # Mac なしビルド → TestFlight（あの日の実績ワークフロー）
tests/parser.test.js     # パーサ単体テスト — 決め打ちルールはテストが仕様
tests/schema.test.js     # 共有状態＋欄ロックのテスト（v3 の実バグの回帰込み）
tests/version.test.js    # BUILD と script の ?v= の一致を強制（v10 の罠の再発防止）。`npm test` で全部走る
.claude/launch.json      # dev サーバ (port 5275。5273=spike / 5274=madeleine / 8123=terrain-game と衝突回避)
```

- バンドラ無し運用（あの日と同流儀）。各層は `<script>` 直読み・`window.VC*` 名前空間・Node からも require 可。
- **native の検証は Codemagic**（Windows に Xcode なし＝Swift はローカルでコンパイルできない）。⚠️ **Windows で `npx cap sync ios` を実行すると CapApp-SPM/Package.swift のプラグインパスがバックスラッシュになる**（Swift として不正）→ CI の macOS 再 sync で直るが、コミット前に気づいたらスラッシュへ手修正。
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
- **発話＝言い直し（v6・実発話FBで確定）**：新しい発話が触れなかった欄のうち**前回の音声が書いた欄は空に掃除**（origin='voice' のみ）。**手入力（origin='human'）と編集中ロックは保護**。掃除は `cleared` として来歴に 🧹 表示（黙って消さない）。断片発話での追加・修正は v1 差分パッチ。
- **過去日も一級市民**（v5・実発話FBで確定）：「昨日の11時半暇**だった**」＝実績も声で入れる用途が実在。昨日/一昨日/先週◯曜/過去の今週◯曜も埋める。
- **言った年には必ず従う**（v9・実発話FBで確定）：「2027年11月5日」「来年の3月1日」「去年の6月30日」。**推測は「言っていない時だけ」の権限**——v9 で推測が明示指定を上書きする実バグを踏んだ。AI は創作しないだけでなく、**人の指定を上書きしない**。
- **言っていない上位単位は「今日に最も近い」を選ぶ**（v8・実発話FBで確定）：年を言わない「6月30日」＝最も近い6月30日（過去可）。月を言わない「20日」＝最も近い20日。**「過去なら未来へ倒す」は使わない**——上の「過去も一級市民」と矛盾するため（v8 で実際に矛盾が露呈した）。存在しない日付（2月30日）は blocked スパンにして素通し＝後続パターンの再解釈も禁止（言っていない日付を創作しない）。
- **素通しの痕跡（タイトルに残る断片）はデバッグ可能性そのもの**：v7「7月の」・v9「2027年」と、**残骸が2度バグを告発した**。語彙が無い＝穏やかに素通しに見えるが、裏で推測が走ると間違った値が入る。**新パターン追加時は「残骸が出ていないか」を必ず見る**。
- 詳細な決め打ちルール一覧は parser.js 冒頭コメント + テスト。

## 運用ルール（あの日と同じ）

- **commit → `git push` まで基本やる**（明示依頼を待たない）。コミットメッセージは日本語、`feat(scope): ...` / `fix(...)` / `docs(...)` / `change(...)`。
  - ※ GitHub リモートは未作成（新規リポ作成・公開設定は外向き操作＝ユーザー確認要）。リモートが出来るまではローカル commit まで。
- `git add` は個別ファイル指定（`-A` を避ける）。
- **例外（要確認）**: force push / `reset --hard` / ブランチ削除 / `--no-verify` / 新規 GitHub リポ作成・公開設定。
- **セッションを閉じる前に TODO.md（現在地）と CHANGELOG.md（vN 追記・最新が上）を必ず更新**。CHANGELOG の型は photo-memory-spike と同じ（背景 / 設計判断 / ハマったところ / 結果・観察 / 教訓 / 残課題）。
- **`index.html` 冒頭の `const BUILD` を commit ごとに上げ、同時に script の `?v=N` も同じ数字にする**（`npm test` の version.test.js が一致を強制＝忘れると落ちる）。
  - ⚠️ **なぜ両方必要か（v10 で踏んだ罠）**: BUILD は index.html にしか無いが、ロジックは engine/ input/ adapters/ の**別ファイル＝別キャッシュ**。`?v=` が無いと「index.html は新しいのに parser.js は古い」＝**フッタが新版だと嘘をつくのに挙動は旧版**になる。あの日は単一 index.html なのでこの罠が無い＝**運用を移植する時は前提ごと確認する**。
- **実機 FB を受けたら、まず切り分け**: ①フッタの BUILD 版 ②それでも怪しければ**オリジンを直接叩く**（`Invoke-WebRequest https://yutsutke.github.io/voice-calendar/engine/parser.js` で該当コードの有無）。「キャッシュでしょう」と決めつけない——v10 は自分の設計欠陥だった。Pages CDN は `max-age=600`（push 後10分は旧版が出る）。

## スコープを膨らませない歯止め（SPEC §3「v0 で作らない」）

道2（Siri 内完結）/ 仮置き UI / 既存予定の読み取り / 音声差分パッチ / 繰り返し・参加者 / LLM 解釈 / 複数予定一括 / Android — **v0 では着手しない**。ユーザーの明示要求 + 検証が当たってから un-park（あの日の地図ビューと同じ運び）。

## 計測（SPEC §10）

見るのは**ノールック完走率**（話しただけで正しく入り、直しに戻らなかった割合）。低いときの切り分け＝①音声認識 ②日時解釈 ③そもそも画面を見てしまう。
