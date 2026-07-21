# App Store 提出物ドラフト（ボイスカレンダー / VoiceCalendar）

> ゆうが ASC に少し書き込み済み → これは**照合・追記用のドラフト**。良い方を採用してOK。
> 文字数はすべて Apple の上限に収めてある。**［　］は要記入**。

---

## 0. 基本情報（確認）

| 項目 | 値 | 備考 |
|---|---|---|
| ホーム画面名（CFBundleDisplayName） | `VoiceCalendar` | Info.plist・英字 |
| App 名（ASC・30字以内） | **ボイスカレンダー** | 日本語ストア表示名。Siri 別名とも一致 |
| Bundle ID | `io.github.yutsutke.voicecalendar` | |
| プライマリ言語 | 日本語（推奨） | 音声認識が ja-JP 専用のため。英語は任意で追加可 |
| カテゴリ | **仕事効率化（Productivity）** / 副: ユーティリティ | |
| 年齢レーティング | **4+** | 不適切コンテンツなし |
| 価格 | 無料（想定） | |

### ✅ 決定: ユニバーサル（iPhone + iPad）
`TARGETED_DEVICE_FAMILY = "1,2"` のまま。**iPad で実機テスト済み・正常動作を確認（2026-07-18）**＝審査で iPad で見られても大丈夫。
- → **iPad のスクショ（13″: 2064×2752）も必須**。iPhone（6.9″: 1320×2868）と両方用意する（§9）。
- コード変更・再ビルドは不要。

---

## 1. サブタイトル（30字以内）
候補（どれか1つ）:
1. **話すだけで予定が入る**（10字）← 推奨
2. 声で入れる、見ずに終わる（12字）
3. 声で予定、その場でメモも（12字）

## 2. プロモーションテキスト（170字以内・審査なしでいつでも更新可）
> 「明日15時に歯医者」と話すだけ。運転中や家事の合間、手が離せない時こそ声で。Siri で「ボイカレ 開いて」→ 話す → 保存まで、画面を見ずに。音声は端末内で処理し、カレンダーへは追加のみ＝プライバシー第一。

## 3. キーワード（100字以内・カンマ区切り・スペース不要・アプリ名の語は入れない）
```
音声入力,声,予定,スケジュール,メモ,音声認識,ハンズフリー,Siri,予定管理,時短,声で入力,タスク,ノールック,予定表,音声メモ,かんたん
```
※「カレンダー」はアプリ名に含まれ自動で索引されるためキーワードからは外して枠を節約。

## 4. 説明（4000字以内）
```
話すだけで、カレンダーに予定が入る。

OS の既定に設定しているカレンダーに、声で予定を書き込めます。アプリを開いて「明日10時30分 会議」と伝えるだけ——日時もタイトルもフォームに入り、そのまま保存できます。運転中、料理の途中、歩きながら。手が離せない時こそ、声で。

■ メモとしても使えます
日時を言わなければ「今」として記録します。「現在 東京駅についた」と伝えると、今の日時で「東京駅についた」がカレンダーに残ります。思いついたことを、そのまま時系列に。

■ こんなアプリです
・話す → 予定になる。キーボードを開きません。
・画面を見なくても入る「ノールック」設計。話し終われば自動で確定します。
・声と手は同じ1つのフォームを編集。違ったところだけ、その場で声か指で直せます。
・Siri で「ボイカレ 開いて」→ 開いてすぐ録音。話して、終わり。

■ プライバシーを最優先
・音声認識はできる限り端末内（オンデバイス）で行います。
・カレンダーへは「追加のみ」。既存の予定は読み取りません。
・アカウント不要。開発者はデータを一切集めません（サーバーも広告も解析もありません）。

■ 使い方
1. アプリを開く（または Siri で「ボイカレ 開いて」）
2. 「明日10時30分 会議」のように話す
3. フォームを確認して保存 → 端末のカレンダーに入ります

Google カレンダーに入れたい時は、iOS の「設定 → カレンダー → デフォルトカレンダー」を Google にするだけ。アプリは Google と直接通信せず、OS が同期します。

■ 補足
このアプリは「予定をすばやく“足す”」ことに特化しています。既存の予定の閲覧・編集は行いません（追加のみの軽い権限で動くため）。

声で、見ずに、すぐ。あなたのカレンダーを、話しかけるだけの相棒に。
```

## 5. リリースノート（What's New・v1.0）
```
初回リリースです。声で話すだけでカレンダーに予定を追加できます。
・オンデバイスの音声認識（できる限り端末内で処理）
・Siri で「ボイカレ 開いて」→ 開いてすぐ録音
・日時を言わなければ「今」＝メモとしても
ご意見・ご要望をお待ちしています。
```
> ※ 2回目以降は各 vNN の CHANGELOG から要点を日本語で。

## 6. URL 類
| フィールド | 値 |
|---|---|
| プライバシーポリシー URL | `https://yutsutke.github.io/voice-calendar/privacy.html`（作成済み・**デプロイ後に有効**） |
| サポート URL | `https://yutsutke.github.io/voice-calendar/support.html`（作成済み・**デプロイ後に有効**） |
| マーケティング URL | 任意（未設定でOK） |
| 連絡先メール | `anohiapp@gmail.com`（「あの日」と統一・privacy/support に記入済み） |

---

## 7. App プライバシー（栄養表示）＝ 回答は「データを収集していません」

ASC の「App のプライバシー」で **"Data Not Collected / データを収集していません"** を選択。理由（審査で聞かれたら）:

| データ種別 | 収集 | 説明 |
|---|---|---|
| 音声・オーディオ | ❌ なし | 音声認識のため一時的に使うのみ。開発者は受け取らない・保存/送信しない。オンデバイス優先（非対応時は Apple の音声サービス＝OS 機能） |
| カレンダー | ❌ なし | 書き込み専用（追加のみ）。既存予定を読まない。開発者は取得しない |
| 識別子・使用状況・診断 | ❌ なし | 解析 SDK なし・サーバーなし・アカウントなし |

→ トラッキングなし。サードパーティ SDK なし。**「収集なし」で正確**です。

---

## 8. App Review 向けメモ（審査担当者への注記）

> 英語で記入（審査は英語話者のことが多い）。日本語を話せない審査担当でもテストできるよう、**画面下のテキスト欄で発話をシミュレートできる**旨を必ず書く（これが審査通過の肝）。

```
This app adds calendar events from Japanese voice input. No account or login is required. The developer has no server and collects no data.

How it works:
- The user taps the mic (the app may also auto-start recording on launch) and speaks a schedule in Japanese, e.g. "明日15時に歯医者" (= "dentist tomorrow at 3pm"). On-device Japanese speech recognition (SFSpeechRecognizer, on-device preferred) fills a form. Tapping Save adds the event to the device's default calendar via EventKit.

Permissions:
- Microphone + Speech Recognition: to capture and transcribe the spoken schedule. Recognition runs on-device where supported.
- Calendars (write-only, iOS 17 write-only access): to ADD events only. The app does NOT read existing calendar data.

Siri: Saying "Hey Siri, ボイカレ開いて" (or "ボイスカレンダー開いて") simply opens the app, which then auto-starts recording. There is no custom Siri intent — this is a standard app launch via alternate app names (INAlternativeAppNames).

How to test WITHOUT speaking Japanese:
1. Launch the app and grant Microphone, Speech Recognition, and Calendar (write-only) when prompted.
2. At the bottom of the screen there is a text field that simulates an utterance. Type: 明日15時に歯医者  and press send.
3. The form fills (date/time/title). Tap Save. The event is added to the default calendar.
(If you can speak Japanese, tap the 🎤 mic button and say the same phrase instead.)

The app is designed for iPhone (on-the-go voice input).
```
- **デモアカウント: 不要**（No sign-in required にチェック）。

---

## 9. スクリーンショット構成案

**必須サイズ（現行 App Store・2025 時点）**
> ⚠️ **この app の ASC が実際に要求したサイズ（2026-07-18 実機確認）**。想定した「6.9型」ではなく旧サイズ体系だった＝**ASC が画面に出す数字が正**:
- **iPhone 6.5型**: **1242 × 2688 px**（縦）← ASC が明示（横向き 2688×1242、または 1284×2778 / 2778×1284 も可）
- **iPad 12.9型**: **2048 × 2732 px**（縦）← iPad タブの要求。※タブで数字を要確認（2064×2752 の可能性も）
- スクショは**透過なし・PNG**。インストールシートに出るのは**最初の3枚**＝1枚目に一番良いものを置く。
- App アイコン 1024² は build から取得。端末フレーム＋キャプション重ねは任意。

**各カットの狙い（5枚案）**
| # | 見せるもの | キャプション案 |
|---|---|---|
| 1 | マイク作動＋フォームに「明日 15:00 歯医者」が入った瞬間 | 話すだけで、予定になる。 |
| 2 | 保存 toast「✅ 自動保存しました」＝ノールック | 画面を見なくても、入る。 |
| 3 | 「今 牛乳買う」→ 今の日時で記録 | 思いついたことも、今すぐメモ。 |
| 4 | 「ヘイシリ ボイカレ開いて」→ 開いて録音（Siri 起動の図） | ヘイシリ、ボイカレ開いて。 |
| 5 | オンデバイス＋追加のみの図（診断/設定の一部） | 声は、端末の中だけ。 |

- 1枚目が最重要（一覧で見える）。**実機/シミュレータ（6.9″）でキャプチャ**→ Figma 等でフレーム＋文字を重ねると綺麗。
- 文言は日本語ローカライズに。英語ストアも出すなら英語版も。

---

## 10. 残TODO（ゆう側 / 私が手伝えること）
- [x] **連絡先メール** = `anohiapp@gmail.com`（「あの日」と統一）→ privacy.html / support.html に記入済み
- [x] **概要（ゆう記入分）を反映** → §4 説明に実例「明日10時30分 会議」「現在 東京駅についた」を採用
- [ ] **iPhone専用 or ユニバーサル**を決める（§0）→ スクショ要件が変わる（現在ユニバーサル）
- [ ] `privacy.html` / `support.html` をデプロイ（= commit/push。公開ページなので**ゆうの了承後**に実施）
- [ ] スクショ（構成は §9）を用意 — 私はキャプション文の英訳やレイアウト案を出せます
- [ ] ASC のサブタイトル／キーワード等、§1-3 のドラフトと照合（貼ってもらえれば差分を出します）

---

## 11. 審査対応ログ

### 11-1. 1.0 (12) — Guideline 2.1 Information Needed（2026-07-20 審査 / 07-21 対応）

**指摘（Apple・Review Device: iPad Pro 11-inch (M4)・Submission ID `12b4cfec-5349-4508-83f9-2536402ddc86`）**
> We need more information to continue the review.
> 1. Does the app use a native AI agent?
> 2. Does it rely on a third party AI service? If so what information is sent to whom?

ASC 上のステータスは「**却下済み** / 2.1.0 Performance: App Completeness」。＝**機能の欠陥ではなく情報不足**。

**引き金の推定（重要）**
- 提出済みの**プライバシーポリシー URL に「AI Integration (Optional, Off by Default)」の節がある**（v40 で追記＝BYOK で Anthropic / Google へ送る記述）。
- しかし**審査バイナリ 1.0 (12) にその機能は入っていない**（下記のとおりコードが存在しない）。
- → 審査官がポリシーを読んで矛盾に気づいた、という筋が最も自然。**返信では先回りしてこの矛盾を説明する**。

**返信前に裏取りした事実（推測で答えない）**
| 主張 | 裏取り方法と結果 |
|---|---|
| AI/LLM のコードが無い | `git log --diff-filter=A -- engine/ai.js` → 初出は **v40 (2026-07-19)** ＝提出（07-18）の**翌日**。提出時点 `89d0d13` の JS は parser / schema / settings / transcriber / calendar の**5本のみ** |
| ネットワーク通信が一切無い | `git grep -E "fetch\(\|XMLHttpRequest\|https?://" 89d0d13 -- index.html engine input adapters` → **ヒット0**。`capacitor.config.json` に `server.url` 無し＝ローカルファイルのみ |
| 音声認識は Apple の OS 機能 | `SpeechRecognitionPlugin.swift:135-138` ＝ `supportsOnDeviceRecognition` が真なら `requiresOnDeviceRecognition = true` |

**送った返信（英語・Resolution Center）**

```
Hello,

Thank you for the review. Here are detailed answers to both questions.

1) Does the app use a native AI agent?

No. Build 1.0 (12) contains no AI agent, no LLM, and no machine-learning
model of my own. It does not use Apple Intelligence or the Foundation
Models framework, and no ML model is bundled with the app.

The app performs exactly two steps, both on device:

- Speech-to-text: Apple's own SFSpeechRecognizer (Speech framework, ja-JP).
  The app sets requiresOnDeviceRecognition = true whenever
  supportsOnDeviceRecognition is true, so recognition runs on device on
  supported devices and languages. Where on-device recognition is not
  available, the standard iOS speech API may process the audio through
  Apple's own speech service. No third party is involved.
- Interpretation: a deterministic, rule-based Japanese date/time parser
  that I wrote in JavaScript (for example, "明日15時" becomes tomorrow at
  15:00). It is plain pattern matching - no model, no inference, no
  learning - and it runs entirely on device.

2) Does it rely on a third party AI service? If so what information is
sent to whom?

No. Build 1.0 (12) makes no network requests at all. There is no developer
server, no analytics or third-party SDK, no account and no login. Nothing
the user speaks or types leaves the device, except through Apple's own OS
services: the speech API fallback described above, and EventKit writing the
event into the user's own calendar. This is why the App Privacy answer is
"Data Not Collected".

Why my Privacy Policy mentions AI

I believe this is what prompted the question. My Privacy Policy at
https://yutsutke.github.io/voice-calendar/privacy.html includes a section
titled "AI Integration (Optional, Off by Default)". That section describes
a feature of a future update that is NOT part of build 1.0 (12); I
published the policy text ahead of that update. For full transparency,
here is how that future feature works:

- It is optional and inactive unless the user enters their own API key
  (Anthropic or Google Gemini) in the app's settings. Without a key the
  feature is not offered and no request is ever made.
- When the user enables and uses it, the text the user typed or dictated
  is sent directly from the user's device to the provider the user chose,
  authenticated with the user's own key, in order to parse long free text
  into draft events. The result is always shown to the user for review
  before anything is saved.
- I receive nothing. I operate no server. The API key is stored only on
  the user's device and is never transmitted to me.

When I submit the version that contains that feature, I will disclose it
in the App Privacy answers and in the App Review notes accordingly.

Please let me know if anything else would help. I am happy to provide more
detail or a walkthrough.

Best regards,
Yusuke Tanaka
```

**次バージョン（AI 入り＝v36 以降）を提出する時に必ずやること**
- [ ] **App プライバシーの回答を見直す**（現在「データを収集していません」）。BYOK は利用者の文章が第三者へ渡る＝そのままでよいか要判断。
- [ ] **第三者 AI へ送る前の明示同意**（ガイドライン 5.1.2 系が 2025 年後半に AI を明記する形へ更新）。本アプリは「自分のキーを入れる」「既定オフ」で実質同意に近いが、**送信前に一文出す**のが安全。
- [ ] 審査メモ（§8）に追記: 「BYOK＝キーが無ければ一切通信しない。審査時はキー未設定のまま全機能をテスト可能」。
- [ ] 上の返信で Apple に「次で開示する」と**約束済み**＝守らないと信用を失う。

**教訓**
- **公開ページ（プライバシーポリシー）は審査対象の一部**。バイナリに無い機能を先回りで書くと、審査官には「申告漏れ」に見える。ポリシーを先出しするなら、**審査メモにも同じことを書いておく**べきだった。
- 返信の前に**バイナリに何が入っているかを git で確定させた**（ai.js の初出日・grep でネットワーク0）。「たぶん入っていない」で答えると嘘になる。
