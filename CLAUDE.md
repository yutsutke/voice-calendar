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
engine/settings.js       # 詳細設定（v19）: 値の入れ物のみ・DOM も宿主も知らない。既定=従来挙動
engine/contract.js       # AI 連携の契約（v39）: バッチ封筒の JSON Schema。日本語 description がそのままプロンプト＝二重管理ゼロ。FIELDS と鏡合わせ（テスト強制）
engine/batch.js          # まとめて入力（v39）: parseBatch 検証ゲート（AI の出力を信用しない・不正は落として明記）＋取り込みリスト台帳＋buildPrompt。音声経路と独立
engine/ai.js             # BYOK（v40）: プロバイダアダプタ（Anthropic/Gemini・OpenAI は CORS 非対応で入れない）。キーは端末内のみ・エラー文にキーを出さない・fetch 注入でテスト
                         #   v42: 音声もこの経路で解釈できる（設定 voiceAI・既定オフ・AI 経路は自動保存しない・失敗はルールへ自動フォールバック）
engine/rewrite.js        # 長文の「整え」（v80）: 指示文＋検証ゲートの純関数。AI は創作しない（直すのは①誤変換②句読点③言い淀み④言い直しの重複だけ）。
                         #   散文は中身を機械検証できない＝守りは人の側（黙って書き換えない・↩ で戻せる・自動保存しない）
input/transcriber.js     # 転写層: WebSpeech(web) / native プラグイン（iOS=SFSpeech・Android=SpeechRecognizer 同一契約）。simulate() でテキスト注入。native 判定は `.native` フラグ（engine 名でゲートしない・v65）
adapters/calendar.js     # 永続層: materialize(保存時既定値はここに集約) + ics(web) / eventKitAdapter（native 共通・iOS=EventKit / Android=CalendarContract・保存先は既定1本）
adapters/records.js      # ローカル記録台帳（v32）: 保存先「リスト/両方」の控えを端末内に保持（write-only でカレンダーは読めない→リスト表示の土台）
scripts/sync-web.mjs     # root の web 本体 → www/（Capacitor webDir）を生成。cap の前に必ず実行（npm run cap:sync）
www/                     # 生成物（gitignore）。手で編集しない
local-plugins/           # ローカル Capacitor プラグイン（iOS=SPM / Android=gradle・v65）。命名規約: npm名 kebab → PascalCase 一致必須
  calendar-events/       #   カレンダー保存: iOS=EventKit（17+ 書込専用・OS 既定へ） / Android=CalendarContract 直書き（主カレンダーへ・READ+WRITE 権限＝write-only が無い OS の正直な形）
  speech-recognition/    #   転写: iOS=SFSpeechRecognizer / Android=SpeechRecognizer（同じ jsName・同じイベント契約・無音1.8s確定/6s打ち切り・v15/v16 の保険も両 OS 同構造）
ios/                     # cap add ios の生成物をコミット（spike と同流儀）。Info.plist に権限4つ
android/                 # cap add android の生成物をコミット（v65）。🔑 iOS と違い Windows ローカルでビルド完結（Codemagic 不要）:
                         #   $env:JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"; ./android/gradlew.bat -p android assembleDebug
                         #   APK: android/app/build/outputs/apk/debug/app-debug.apk。web 変更後は sync:web → npx cap copy android
codemagic.yaml           # Mac なしビルド → TestFlight（あの日の実績ワークフロー）
tests/parser.test.js     # パーサ単体テスト — 決め打ちルールはテストが仕様
tests/schema.test.js     # 共有状態＋欄ロック＋設定注入のテスト（v3 の実バグの回帰込み）
tests/settings.test.js   # 詳細設定（既定=従来挙動を固定・壊れた保存値でも動く）
tests/transcriber.test.js# 転写層の「壊れ方」（v13: registerPlugin 無し native で throw しない・Plugins.X 優先）
tests/calendar.test.js   # 保存の native 契約（v23: 引数名がズレると黙って既定カレンダーに入る＝実機まで気づけない）
tests/records.test.js    # 記録台帳（v32: 書込失敗は黙らない・kind=予定/記録は保存時に確定・破損は読める行だけで動く）
tests/batch.test.js      # まとめて入力（v39: 契約と FIELDS の鏡合わせ・AI 出力の検証＝落とすなら明記・staging・不可視文字は parser と鏡）
tests/rewrite.test.js    # 長文の整え（v80: 指示文は仕様＝文言をテストで固定・前置きの剥がし・伸縮の門は境目ちょうどを通す）
tests/ai.test.js         # BYOK（v40: リクエスト形の契約・切れた応答の検出・キー漏れ無し・openai 復活禁止）
tests/version.test.js    # BUILD と script の ?v= の一致を強制（v10 の罠の再発防止）。`npm test` で全部走る
.claude/launch.json      # dev サーバ (port 5275。5273=spike / 5274=madeleine / 8123=terrain-game と衝突回避)
```

- バンドラ無し運用（あの日と同流儀）。各層は `<script>` 直読み・`window.VC*` 名前空間・Node からも require 可。
- **native の検証は Codemagic**（Windows に Xcode なし＝Swift はローカルでコンパイルできない）。⚠️ **Windows で `npx cap sync ios` を実行すると CapApp-SPM/Package.swift のプラグインパスがバックスラッシュになる**（Swift として不正）→ CI の macOS 再 sync で直るが、コミット前に気づいたらスラッシュへ手修正。
- **iOS ビルド運用（v12 で確立）**: Codemagic の `ios-testflight` ワークフローを**手動で Start new build**（`triggering:` 無し＝あの日と同流儀。push では走らない）。署名鍵はリポ外 `Documents/voice-calendar-signing/cert_key`（Codemagic の Secure env `CERTIFICATE_PRIVATE_KEY`・group `signing` に登録済み）。ASC キー `MadeleineASC`・Team `25TM5C27YT`・bundle id `io.github.yutsutke.voicecalendar`。輸出コンプライアンスは Info.plist の `ITSAppUsesNonExemptEncryption=false` で回答済み（毎ビルドのダイアログは出ない）。
- **BUILD は native 専用の変更でも上げる**: web が 1 バイトも変わらなくても、**フッタの BUILD が「実機に届いた TestFlight ビルドの識別子」**として機能するため（版表示に嘘をつかせない＝v10 の教訓）。
- **web 実機確認 = GitHub Pages**: https://yutsutke.github.io/voice-calendar/ （main の root を配信）。push が実機確認の前提＝ワークフローの一部（あの日と同じ）。iPhone Safari の webkitSpeechRecognition で実発話を試す（PC にマイクが無いため実発話検証は iPhone が主戦場）。
- **パーサの決め打ちルールを変えるときは tests/parser.test.js を必ず同時に更新**（テストがルールの仕様書）。

## 🚨 詳細設定を足す基準（v19）

**「あると便利そう」で設定を足さない**（SPEC §12「多様性が出る前に可変機構を作らない」）。足してよいのは **実機FBで実際に迷い・事故が起きた決定** だけ。

- **各設定に `why`（なぜ設定になったか）を engine/settings.js に必ず書く** ＝ 将来「これ要る？」を判断できる。設定は足すより**消す方が難しい**。
- **既定は必ず「これまでの実挙動」**＝触らない人の体験は1ミリも変わらない（tests/settings.test.js で固定）。
- **engine に設定の保存先も UI も持ち込まない**: `store.setPolicySource(fn)` で述語を注入（`setLockSource` と同じ）＝中立スキーマの原則（SPEC §6）を守る。未注入なら既定で動く。
- 壊れた保存値・未知のキーは**既定にフォールバック**して動く（黙って壊れない）。
- native にしか効かない設定は UI に「アプリのみ」バッジを出す（web=Pages で触っても効かないため）。

## 🚨 黙って捨てない（v16 で実機が沈黙した場所）

**空・null・想定外を silent drop するコードを書かない。** v16 の真犯人は Swift のこの1行だった:
`if !text.isEmpty { notifyListeners("final", data: data) }` ＝ **確定テキストが空なら何も言わず握り潰す**（iOS は endAudio 後に空の確定を返すことがある）。症状「来歴が空」と原因が完全に一致していたのに、v15 では外側（「isFinal が来ない」）を疑って的外れな保険を足した。

- 捨てる代わりに **①代替で補う（例: 空の確定 → 最後の途中結果）→ ②それも無ければエラーとして表に出す**（診断・来歴・toast）。
- **数字を診断に出す**（`確定 len=N partial=M`）＝次に同じ疑いが出た時、推測でなく数字で判定できる。
- 仮説が外れた時は**ログが正しく、仮説が間違っている**。診断ログ（🎙 行）は Mac なし環境で最速のデバッガ＝投資を惜しまない。

## 🚨 native プラグインの取り方（v13 で実機が全滅した場所）

**`Capacitor.registerPlugin` は native に存在しない。** native が注入するのは `Capacitor.Plugins.<jsName>`（`JSExport.swift` が登録済みプラグインごとに document-start で生やす）。`registerPlugin` は npm `@capacitor/core` の API ＝**バンドラ前提**で、バンドラ無し運用の本リポには無い → 呼ぶと TypeError。

```js
// 正（あの日 index.html と同じ形）: Plugins.X が本命・registerPlugin は「あれば使う」保険
function nativePlugin(C, name) {
  if (!C) return null;
  if (C.Plugins && C.Plugins[name]) return C.Plugins[name];
  if (typeof C.registerPlugin === 'function') return C.registerPlugin(name);
  return null;
}
```

- JS から呼べるメソッドは Swift の `pluginMethods` に宣言したものだけ（＋ `addListener` / `removeAllListeners`）。
- **補助機能（音声）の失敗が本体（フォーム）を殺さないこと**: v13 では `registerPlugin` の TypeError がインラインスクリプトを止め、**音声と無関係な「保存」「クリア」まで死んだ**（背骨①の違反）。転写層は**何があっても throw しない**（`createTranscriber` は必ずオブジェクトを返し、失敗理由は `.nativeFailure`）。テキスト送信は転写層に依存させない。
- **実機の確認は「診断」パネル**（画面下の `<details>`）: 環境・エンジン・native 失敗理由・4層の読込・**初期化が完走したか**・捕捉エラー。head の自己完結コードなので**本体が全滅しても出る**。iPhone にコンソールは無く Mac も無い＝**画面に出す以外に見る手段が無い**（1回の確認に Codemagic 15分）。

## 🚨 JS ⇄ native は「型」でも壊れる（v66 で Android が全滅した場所）

**引数名が合っていても、型で黙って落ちる。**しかも**片側の OS だけ**で壊れるので、動いている側が「正しさの証拠」に見える。

- **Android の `PluginCall#getDouble` は Double / Float / Integer しか通さず、それ以外は既定値（null）を返す**。org.json は整数を Integer に収まらなければ **Long** で持つ ⇒ **ms エポック（13桁）は必ず Long ⇒ 必ず null**。iOS の `CAPPluginCall.getDouble` は NSNumber 経由で通るため、**同じ契約・同じ引数名のまま Android でだけ 100% 失敗**した（v66: カレンダー保存が一度も成功しない）。
- ✅ **Android で数値を受けるときは `Object` で取って `instanceof Number` → `longValue()`**（`CalendarEventsPlugin.msOf()` が手本）。**どの subtype で来るかに賭けない。**
- ✅ **必須チェックのエラー文に「項目の列挙」を書かない**。**どれが欠けたか＋実際に来た値と型**を出す（`startMs=Long:1784812680000`）。v65 の一括文言「title / startMs / endMs は必須です」のせいで、実機の1行から原因へ降りられなかった。
- ✅ **null のまま unbox しない**（NPE でアプリごと落ちる＝「黙って捨てない」の裏＝**黙って落ちない**）。権限ダイアログを挟んで戻る経路があるので、値を読む場所ごとに門を置く。
- **JS のテストは名前しか見られない**（`tests/calendar.test.js` の不変条件2）。だから不変条件6で **Java のソースを読んで構造を縛った**。**プラグインを増やしたら、同じガードをその新しいソースにも足す**。

## 🚨 欄ロックの鉄則（v3 で実バグを踏んだ場所）

**「編集中か」を二重に持たない。** ロックの正は `store.setLockSource(fn)` に注入された述語（UI では `activeElement` 基準）だけ。`render()` の描画スキップも `applyVoicePatch` のスキップも `store.isLocked()` から導出する。

- ❌ やってはいけない: focus/blur イベントで Set を維持し、描画は activeElement で判定する（＝二重管理）。イベントが発火しない経路でズレ、**音声は書く・画面は隠す＝画面と違う値がサイレントに保存される**（背骨①の違反）。
- 検証では **値が正しいか だけでなく `store.get()[f] === inputEl(f).value`（ストアと画面の一致）をアサートする**。画面だけ見ていると通ってしまう。
- schema.js は DOM 非依存を維持（述語は宿主が注入する関数＝中立）。engine に `document` を持ち込まない。

## v0 実装の具体化判断（SPEC からの差分・2026-07-16）

- **start/end は date/time の部分フィールドに分割保持**（`startDate/startTime/endDate/endTime`）。「日付だけ確定・時刻は空」を創作なしに表現するため。Date への実体化は保存アダプタで。
- **保存時の既定値はアダプタに集約**：**日時を何も言わない→今の日時**（v27） / 時刻なし（日付だけ）→終日 / 終了なし→開始+1h / タイトルなし→「予定」（warning 表示）。解釈層は埋めない。
- **メモとしても使う（v27・実機FB第19回「メモアプリとしても使えそう」）**：**日時を何も言わなかった発話は「今」として記録**＝思いついたことを話すだけで時系列に残る（v26 までは「開始が未入力」で保存すらできなかった）。**日付だけ言った時は終日のまま**＝「明日 歯医者」に 22:45 を創作しない（SPEC §7）。**空のフォームでは保存しない**＝「今の空予定」を作らない（誤タップ・クリア忘れ）。
- 🚨 **「今」を素で拾わない（v27）**：日本語は語境界が無く「今」は語の中に自然に現れる（**今井/今川/今泉**・今日/今週/今月/今年/今度…）→ 素で拾うと「今井さんと会議」が「井さんと会議」に化ける＝**v22 で「場所 メモリアルホール」を理由に複数欄分割を却下したのと同じ silent wrong answer**。→ **後ろが区切り（空白・読点・文末）の「今」**と、**それ自体で完結した語**（現在/たった今/ただいま/今すぐ/今から）だけを拾う。拾えなかった「今牛乳買う」は**保存側の「日時なし→今」が結果的に救う**＝2つの仕組みが補い合う（タイトルに「今」が残るのは素通しの痕跡＝v7）。
- **保存先は OS の既定カレンダー1本（v26 で確定・実機で成立）**：`defaultCalendarForNewEvents` は write-only で確実に動く（WWDC23 のコード例／実機FB第18回「デフォルトカレンダーに書き込み成功」）。**Google に入れたい人は iOS 設定 → カレンダー → デフォルトカレンダーを Google に**（アプリは Google と直接通信しない＝OS が同期する＝SPEC §1-6）。「今どこへ入るか」は詳細設定の情報行と診断に出す（設定ではなく**事実**の表示＝「保存できたのに見つからない」を防ぐ）。
- 🚫 **アプリ内カレンダー選択を作り直さない（v23→v25 で作り、v26 で撤去した）**：iOS17 の write-only では**アプリはカレンダー一覧を読めない**＝自前 UI は不可能。`EKCalendarChooser` は write-only でも開くが、**選択を次の起動へ持ち越せない**——保存できるのは識別子だけで `calendar(withIdentifier:)` が write-only で機能しない（実機FB第17回「選んだカレンダーになっているのに iOS のカレンダーに保存される」）。チューザーが渡す EKCalendar の現物をプロセス内で保持すれば当座は書けるが（v25）、**再起動のたび選び直し＝実用に耐えない**。作り直すなら full access への格上げが要る＝「追加のみ」の軽さ（v0 の売り・SPEC §3）とのトレードオフ。**理由の全文は CalendarEventsPlugin.swift 冒頭**。tests/calendar.test.js が復活を機械的に禁止している。
- **Siri 起動は Info.plist の別名登録で完結（v29・道1完成）**：`INAlternativeAppNames` に「ボイカレ」「ボイスカレンダー」（発音ヒントひらがな）。**App Intent / App Shortcuts は書かない**——「Siri で開く」は OS 標準のアプリ起動＋別名で足り、「開いたら即録音」は v24 が担う。un-park は動詞フレーズ（「ボイカレで予定入れて」）が欲しくなった時だけ。表示名（VoiceCalendar・英字）への音の照合はゆらぐことがある＝カタカナ名の明示登録が保険。
- **起動＝即録音（v24・実機FBの要求）**：起動/復帰（visibilitychange）で自動録音。**native のみ**（web はブラウザの権限モデルでタップ必須のまま）・**白紙の時だけ**（自動録音が拾う環境音が「言い直し」(v6) で下書きを消すのを防ぐ）・**start であって toggle でない**（自動起動が録音を止める事故の排除）。無音6秒打ち切り (v11) が自動停止を保証＝「止まる保証」が先にあるから足せた。Phase 3（Siri→開く→即話す）の「即話す」側はこれで完成済み。
- **自動保存は「日時を言った発話」だけ（v28・設定・既定オフ）**：条件は SPEC §2-4「曖昧さゼロで黙って1個に確定できる時だけ」をそのまま＝設定オン＋フォームが変わった＋欄指定でない（組み立て中）＋notes が空＋**日時を明示した**。最後の条件は **E2E で「えーっと」が自動保存された穴**への対処＝パーサは意味を判定しない（LLM なし）ため雑音もタイトルになり、v27「日時なし→今」で確定し、v24「起動＝即録音」と重なると**開くだけで環境音が予定になる**。**保存は不可逆**（書込専用＝読めない＝消せない＝カレンダー側で手で消すしかない）＝迷ったら保存しない（失うのは1タップ）。**黙って保存しない**（toast に「自動保存しました → ◯◯」）。
- 🚨 **個々に正しい判断の積が事故になる（v28 の教訓）**：「意味を判定しない」「日時が無ければ今」「曖昧でなければ自動保存」はどれも単体では正しくテストも通っていたが、**3つの交点**が「雑音が自動でカレンダーに入る」を生んだ。**新機能は単体の正しさではなく既存の決定との積で見る**。この穴はユニットテストでは出ず、**E2E で実際に喋らせて初めて出た**。
- **曖昧素通しの実挙動**：埋めなかった断片はタイトルに残る＝ユーザーに見える（例:「明日3時」→ 日付だけ入り、タイトルに「3時」が残る）。notes に理由を出す。
- **発話＝言い直し（v6・実発話FBで確定）**：新しい発話が触れなかった欄のうち**前回の音声が書いた欄は空に掃除**（origin='voice' のみ）。**手入力（origin='human'）と編集中ロックは保護**。掃除は `cleared` として来歴に 🧹 表示（黙って消さない）。自由文での差分修正（「1時間後ろ倒し」）は v1 の主戦場のまま。
- **例外＝欄指定発話（v17・実機で要求）**：**欄名で始まる**発話（タイトル/件名・場所・メモ・開始・終了）はその欄だけの差分＝`applyVoicePatch(patch, text, {targeted:true})` で**掃除しない**（「場所 立川」で直前の予定が消えたら本末転倒）。誤爆ガード2枚＝①欄名で*始まる*時だけ ②値が解釈できなければ通常解釈へフォールバック（発話を捨てない）。
- 🚫 **1発話1欄を崩さない（v22 で確定）**：「場所 立川 メモ 保険証」のような**複数欄の分割は実装しない**。実測で壊れ方を確認済み＝「**場所 メモリアルホール**」が `メモ` に反応して「場所=空・メモ=リアルホール」に化ける（日本語は語境界が無く、欄名は値の中に自然に現れる: メモリアル/開始式/終了式…）＝ SPEC §7「創作しない」に反する silent wrong answer。**1発話1欄が正しい**理由: (a) 分割は上記のとおり危険 (b) 短い発話ほど認識精度が高い (c) 1発話＝1つの ↩ 復元点＝来歴の粒度が細かく戻しやすい。
- **欄名は認識器にも教える**（v22）：`contextualStrings = ["場所","メモ","終了","開始","タイトル","件名"]`。欄指定の成否は**先頭の欄名**だけに懸かっているため。欄名を増やしたら parser の `FIELD_KEYS` と Swift の `fieldHints` の**両方**を更新する。
- **巻き戻しは状態スナップショット（v18）**：来歴の ↩ は**発話を再解釈しない**（`now` が変わると「明日」がズレる）。`store.snapshot()/restore()` で draft＋fieldState＋origin を戻す。**復元前に `activeElement.blur()`**＝ロック欄を描画がスキップして store と画面がズレる事故（v3）を構造的に回避。
- **来歴＝「これまで居た状態の一覧」（v20 で修正）**：各行に積むのは**その発話を適用した「後」の状態**（`after`）＝**行に表示している内容と ↩ の結果が一致する**（WYSIWYG）。v18 は「前」の状態を積み、行に「飲み会」と出ているのに ↩ で「会議」に戻る食い違いを作った。**表示と操作結果が食い違うなら、ラベルで説明せず設計を直す**（説明が要る時点で噛み合っていない）。
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
- 🚨 **push しただけで「Pages に出た」と言わない（v19 で嘘をついた）**: **必ずビルド完了と配信内容を確認する**。
  ```powershell
  gh api repos/yutsutke/voice-calendar/pages/builds/latest | ConvertFrom-Json | Select status, duration, @{n='e';e={$_.error.message}}
  ```
  `status=built` かつ配信 HTML の BUILD 文字列が新版であることまで見る。**v18 は Pages ビルドが errored で v17 が配信され続けていたのに、検証を省いて「Pages は既に v18」と報告した**＝ユーザーが「何回更新してもv17」と気づくまで嘘が残った。**検証を省くと報告は嘘になる。**
- **Pages は `.nojekyll` で Jekyll を止めてある**（純粋な静的サイトで Jekyll は不要）。legacy ビルドの Jekyll が原因不明の `Page build failed`（duration 0）を起こしていた。ビルドも 40秒 → 17秒に短縮。**Pages が errored になったらまず `.nojekyll` の有無を疑う**。

## スコープを膨らませない歯止め（SPEC §3「v0 で作らない」）

道2（Siri 内完結）/ 仮置き UI / 既存予定の読み取り / 音声差分パッチ / 繰り返し・参加者 / LLM 解釈 / 複数予定一括 / Android — **v0 では着手しない**。ユーザーの明示要求 + 検証が当たってから un-park（あの日の地図ビューと同じ運び）。

## 計測（SPEC §10）

見るのは**ノールック完走率**（話しただけで正しく入り、直しに戻らなかった割合）。低いときの切り分け＝①音声認識 ②日時解釈 ③そもそも画面を見てしまう。
