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

### リリースノート（What's New・v1.1＝公開 1.0 → v32-v62）
> 公開版 1.0(12)≈v31 からの差分。**位置情報は公開版に無かった**ので「削除」とは書かない（公開ユーザーには存在しない機能）。AI は任意・既定オフを明記＝ポリシー/審査メモと揃える。
```
バージョン1.1では、日常使いの機能を大きく増やしました。

■ 記録を残す・見返す
・保存した予定／記録を時系列リストで表示。CSV で書き出せます。
・話した履歴からワンタップで前の状態に戻せます。

■ もっと自由に入力
・「まとめて入力」＝メールや議事録などの長文から、複数の予定をまとめて取り込み。
・辞書＝よく使う言い回しや、認識を間違えやすい固有名詞を覚えさせられます。

■ 自分の AI で解釈（任意・既定オフ）
・自分の API キー（Anthropic / Google）を入れると、あいまいな長文も AI で下書きにできます。
・キーが無ければ一切通信しません。キーはこの端末内にのみ保存され、開発者は受け取りません。取り込む前に必ず内容を確認できます。

■ 使い勝手
・自動保存を「オフ／日時がある時だけ／いつでも」から選べます。
・保存した予定を、あとからフォームで編集できます。
・録音中に「やめる」「この録音だけ自動登録しない」を選べます。
・メモ欄を広げ、話した内容を全文で残せます。

引き続き、声だけ・画面を見ずに予定を入れられます。ご要望をお待ちしています。
```

### リリースノート（What's New・v1.2＝公開 1.1 → v63-v78）
> 公開版 1.1（≈v62）からの差分。**iOS で見えるものだけ**（v65-v69・v73 は Android 専用なので書かない）。
> ⚠ **位置情報は「復活」と書かない**＝公開ユーザーの 1.1 には**存在しなかった**機能なので、彼らにとっては新機能（v62 で消したのは開発側の事情）。
```
バージョン1.2では、話している最中の画面を作り直しました。

■ 録音中は専用画面に
・話し始めると画面いっぱいの録音画面になり、認識中の文字が大きく表示されます。長く話しても、続きを追いながら話せます。
・その場で「やめる（入力しない）」「この録音だけ 自動登録しない」「この録音だけ AIで解釈」を選べます。
・話し終われば自動で閉じて、いつものフォームに戻ります。

■ 画面まわりの整理
・各パネルをカードにまとめました。下の方を見ている時も、画面下のマイクからそのまま話せます。
・長いタイトルが3行まで見えるようになり、文字を大きく設定している端末でも横にはみ出さなくなりました。
・発話中に見える認識文字を大きくしました。

■ 記録まわり
・「来歴」からも、保存済みの予定・記録をその場で直せるようになりました。
・記録（📝）の印が、保存先の設定にかかわらず付くようになりました。
・ホーム画面のアイコンを長押しして「リスト」を直接開けます。

■ 位置情報（任意・既定はオフ）
・設定でオンにすると、保存した時にいた場所をアプリ内のリストに残し、地図で開けます。位置情報は端末の中だけに保存され、外部へは送信しません。

■ 修正
・手直しした内容を「辞書に登録して保存」した時に、編集中の予定が新規保存になってしまう問題を修正しました。

ご意見・ご要望をお待ちしています。
```

### 4-b. 説明（1.2 で差し替える案・§4 は 1.0 のまま＝リスト/辞書/まとめて入力/AI/位置に触れていない）
> 📌 1.2 の素材をまとめておくため、§4 の直後ではなく**ここ**に置いてある。
> §4 の本文の **■ こんなアプリです の後ろ**にこの3ブロックを足し、末尾はそのまま。文字数は上限 4000 に余裕あり。
```
■ 残す・見返す
保存した予定と記録は、アプリ内の時系列リストにも残せます（保存先は「カレンダー／リスト／両方」から選べます）。CSV で書き出せます。

■ 長い文章からまとめて
メールや議事録のような長文から、複数の予定をまとめて取り込めます。取り込んだ内容は保存する前に必ず確認できます。

■ 自分の AI で解釈（任意・既定はオフ）
自分の API キー（Anthropic / Google）を設定すると、あいまいな言い方や長文も AI が下書きにします。キーが無ければ一切通信しません。キーは端末内にのみ保存され、開発者は受け取りません。
```

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

### 8-b. App Review メモ（v1.1・AI 入り＋位置削除）＝ 今回の提出はこちらを貼る

> v1.0 との違い: ① **任意の AI 機能（BYOK）が実際に入った**（前回は「将来入る」と説明した機能）→ 先回りで開示＋**上限付きテストキーを添える** ② **位置情報はこの版で削除**（Info.plist の位置キー・CoreLocation を外した）＝審査面を減らした。
> 🔑 **キーの貼り場所は2つ**: (A) 下の `[PASTE ...]` に実キー → この英文まるごとを ASC「App Review Information → Notes（メモ）」へ。(B) 審査官はアプリ内 **詳細設定 →「AI 設定」→「API キー」** に貼る（下の手順が案内する）。

```
This app adds calendar events from Japanese voice input. No account or login is required. The developer has no server and collects no data by default.

CORE FEATURE (works with NO API key):
- Tap the mic (the app may also auto-start recording on launch) and speak a schedule in Japanese, e.g. "明日15時に歯医者" (= dentist tomorrow at 3pm). On-device Japanese speech recognition (SFSpeechRecognizer) fills a form. Tap Save to add the event to the device's default calendar via EventKit.

HOW TO TEST WITHOUT SPEAKING JAPANESE:
1. Launch the app; grant Microphone, Speech Recognition, and Calendar (write-only) when prompted.
2. At the bottom of the screen there is a text field that simulates an utterance. Type: 明日15時に歯医者  and press send.
3. The form fills (date/time/title). Tap Save. The event is added to the default calendar.
(If you can speak Japanese, tap the microphone button and say the same phrase.)

PERMISSIONS:
- Microphone + Speech Recognition: to capture and transcribe the spoken schedule (on-device where supported).
- Calendars (write-only, iOS 17 write-only access): to ADD events only. The app does NOT read existing calendar data.
- Location: NOT used. This version does not request or use location.

SIRI: "Hey Siri, ボイカレ開いて" simply opens the app (standard launch via INAlternativeAppNames). There is no custom Siri intent.

OPTIONAL AI FEATURE (off by default, "bring your own key"):
This version adds an optional feature that parses long free text into draft events using a third-party AI service (Anthropic Claude or Google Gemini). It is OFF by default and does nothing unless the user enters their OWN API key in the app's settings. Without a key, no AI request is ever made and nothing the user types or speaks leaves the device (aside from Apple's own OS speech service and EventKit, described above). The developer operates no server and receives nothing; the API key is stored only on the device. The AI result is always shown to the user for review before anything is saved. We disclose this in the App Privacy answers and here, as promised in our response to the previous review (Submission ID 12b4cfec-5349-4508-83f9-2536402ddc86).

HOW TO TEST THE OPTIONAL AI (a spend-capped test key is provided below):
1. Scroll to the "詳細設定" (Settings) section at the bottom and expand it; find "AI 設定".
2. プロバイダ (Provider): select "Anthropic（Claude）".
3. API キー (API key): paste the test key below, then tap 保存 (Save), then テスト送信 (Test send). It should report a successful connection.
4. Open the "まとめて入力" (Batch input) panel, paste any text containing a schedule, and tap the AI interpret button. Draft events appear for you to review before saving.

TEST API KEY (Anthropic, monthly spend limited to about US$1 - please do not share):
[PASTE YOUR sk-ant-... KEY HERE]

This key is capped for review use only and will be revoked after review.
```
- **デモアカウント: 不要**（Sign-in は OFF のまま・キーは Notes に書く）。

---

### 8-c. App Review メモ（v1.2・位置情報あり＋録音中の専用画面）＝ 今回の提出はこちらを貼る

> 8-b（1.1）との違いは3つ。**どれも「聞かれる前に言う」**（Guideline 2.1 は**事前に開示していなかったこと**が引き金だった＝1.1 は先回りで通った）:
> ① 🚨 **位置情報が在る**。1.1 のメモには `Location: NOT used` と書いた＝**その一文が 1.2 では嘘になる**。前回の記述を自分から取り消して説明する。
> ② 🚨 **起動すると全画面の録音画面が出る**（v24 の自動録音＋v78 の専用画面）＝審査担当が「画面が固まった／何も押せない」と誤解しうる**新しい面**。閉じ方を先に書く。
> ③ ホーム画面長押しの Quick Action（v64）＝ Siri インテントではないことを明記。
> 🔑 **キーの貼り場所は2つ**: (A) 下の `[PASTE ...]` に実キー → 英文まるごとを ASC「App Review Information → メモ」へ。(B) 審査官はアプリ内 **⚙️ 詳細設定 →「AI 設定」→「API キー」** に貼る（手順は本文が案内する）。

```
This app adds calendar events from Japanese voice input. No account or login is required. The developer has no server and collects no data.

WHAT CHANGED SINCE VERSION 1.1 (disclosed up front):
1) Optional location capture exists again in this version. Our review notes for 1.1 stated "Location: NOT used" - that sentence is no longer accurate for 1.2. Please see the LOCATION section below. It is OFF by default and the data never leaves the device.
2) While the microphone is active, the app now shows a full-screen "listening" view. Because the app can start recording automatically on launch, you may see this view immediately after opening the app. It closes by itself; see the next section.

IF A FULL-SCREEN RECORDING VIEW APPEARS ON LAUNCH:
The app starts recording automatically when it is opened with an empty form (this is the core "no-look" use case). The full-screen view shows what is being heard. It closes by itself after about 6 seconds of silence, or you can tap the red microphone (stop) or "やめる（入力しない）" (= cancel, discard). Nothing is saved by this view.

CORE FEATURE (works with NO API key):
- Tap the microphone and speak a schedule in Japanese, e.g. "明日15時に歯医者" (= dentist tomorrow at 3pm). On-device Japanese speech recognition (SFSpeechRecognizer) fills a form. Tap "カレンダーに保存" (Save) to add the event to the device's default calendar via EventKit.

HOW TO TEST WITHOUT SPEAKING JAPANESE:
1. Launch the app; grant Microphone, Speech Recognition, and Calendar (write-only) when prompted. If the full-screen recording view appears, wait ~6 seconds or tap "やめる（入力しない）" to return to the form.
2. On the main screen there is a text field that simulates an utterance. Type: 明日15時に歯医者  then tap the button below it ("発話として送る" = send as utterance).
3. The form fills (date / time / title). Tap "カレンダーに保存" (Save). The event is added to the device's default calendar.
(If you can speak Japanese, tap the microphone button and say the same phrase.)

PERMISSIONS:
- Microphone + Speech Recognition: to capture and transcribe the spoken schedule (on-device where supported).
- Calendars (write-only, iOS 17 write-only access): to ADD events only. The app does NOT read existing calendar data.
- Location (When In Use): OPTIONAL and OFF BY DEFAULT - see below.

LOCATION (optional, off by default, never transmitted):
The app can record where an entry was saved, so the user can later see the place in the app's own local list and open it in Maps. Nothing is requested or captured unless the user turns on "保存時に位置情報も記録する" in ⚙️詳細設定 (Settings). The coordinates are stored only on the device (local storage) alongside that entry, are never sent anywhere, and the developer operates no server and receives nothing. Turning the setting off stops capture immediately. For this reason our App Privacy answers remain "Data Not Collected".

SIRI: "Hey Siri, ボイカレ開いて" simply opens the app (standard launch via INAlternativeAppNames). There is no custom Siri intent.

HOME SCREEN QUICK ACTION: Long-pressing the app icon offers "リスト" (list), which opens the app and expands its local list of saved entries. This is a standard UIApplicationShortcutItem, not a Siri intent.

OPTIONAL AI FEATURE (off by default, "bring your own key"):
The app can parse long free text into draft events using a third-party AI service (Anthropic Claude or Google Gemini). It is OFF by default and does nothing unless the user enters their OWN API key in the app's settings. Without a key, no AI request is ever made and nothing the user types or speaks leaves the device (aside from Apple's own OS speech service and EventKit, described above). The developer operates no server and receives nothing; the API key is stored only on the device. The AI result is always shown to the user for review before anything is saved. This was first shipped in version 1.1 and is unchanged in behavior.

HOW TO TEST THE OPTIONAL AI (a spend-capped test key is provided below):
1. Scroll to "⚙️ 詳細設定" (Settings) and expand it; find "AI 設定".
2. プロバイダ (Provider): select "Anthropic（Claude）".
3. API キー (API key): paste the test key below, tap 保存 (Save), then テスト送信 (Test send). It should report a successful connection.
4. Open the "📥 まとめて入力" (Batch input) panel, paste any text containing a schedule, and tap the AI interpret button. Draft events appear for you to review before saving.

TEST API KEY (Anthropic, monthly spend limited to about US$1 - please do not share):
[PASTE YOUR sk-ant-... KEY HERE]

This key is capped for review use only and will be revoked after review.
```
- **デモアカウント: 不要**（Sign-in は OFF のまま・キーは Notes に書く）。

---

## 9. スクリーンショット構成案

**必須サイズ（現行 App Store・2025 時点）**
> ⚠️ **この app の ASC が実際に要求したサイズ（2026-07-18 実機確認）**。想定した「6.9型」ではなく旧サイズ体系だった＝**ASC が画面に出す数字が正**:
- **iPhone 6.5型**: **1242 × 2688 px**（縦）← ASC が明示（横向き 2688×1242、または 1284×2778 / 2778×1284 も可）
- **iPad 12.9型**: **2048 × 2732 px**（縦）← iPad タブの要求。※タブで数字を要確認（2064×2752 の可能性も）
- スクショは**透過なし・PNG**。インストールシートに出るのは**最初の3枚**＝1枚目に一番良いものを置く。
- App アイコン 1024² は build から取得。端末フレーム＋キャプション重ねは任意。

> 🚨 **1.2 でスクショは古くなった**（2026-08-06）。掲載中のスクショは **1.0 提出時（≈v31）の画面**で、その後 **v77（各パネルがカード＋下の固定マイクバー）と v78（録音中は全画面の専用画面）で見た目が変わった**＝**今のアプリと違う絵が出ている**。差し替え推奨（審査で落ちる類ではないが、「実物と違う」は指摘されうるし、何より**新しい録音画面が一番の売り**）。
> - 差し替えるなら**最低1枚目だけでも**＝一覧に出るのは先頭3枚。**1枚目を「録音中の専用画面（大きな認識文字）」**にすると、このアプリの主張がそのまま絵になる。
> - サイズは前回と同じ **iPhone 6.5型 1242×2688 / iPad 12.9型 2048×2732**（ASC が画面に出す数字が正）。

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

---

### 11-2. 1.1 提出（AI 入り・位置削除）＝✅ 提出済み・審査待ち（2026-07-23・v62）

> **🟡 2026-07-23 12:45 提出完了＝審査待ち（Waiting for Review）**。バージョン **1.1(20)**・提出ID `7b9b7dc3-d7b3-4450-9e65-52f6059d637c`・提出者 tanaka yusuke。Codemagic の 1.1(20) ビルドは **DeviceLocation を外した Package.swift が通過**（native 除去の初検証 OK）。TestFlight で位置がもう出ないこと・AI がキーで動くことを実機確認済み。App プライバシー=「データを収集していません」／Sign-in OFF／年齢 4+ 据え置き。**次＝Apple の審査結果待ち**（最大48h）。

**この版で審査に効く2つの手当て**
1. **位置情報を削除**（v62）＝ Info.plist の `NSLocationWhenInUseUsageDescription`・package.json の `device-location`・Package.swift の `DeviceLocation` を外した。App のプライバシーで**位置の申告は不要**に。
2. **AI（BYOK）は実際に入った**＝前回「将来入る」と約束した機能。**先回りで開示**（What's New・§8-b 審査メモ・App プライバシー）＋**上限付きテストキーを添える**（審査官が実際に試せる＝「見せてから通す」）。

**🔑 上限 US$1 の Anthropic テストキーの作り方**（[console.anthropic.com](https://console.anthropic.com)）
> 目的＝万一メモのキーが漏れても損失を $1 に閉じ込める。既定モデルは `claude-haiku-4-5`（1リクエスト ≈ 0.1円以下）＝$1 で数百回テストできる＝審査には十分。
1. Console にサインイン。**課金（Billing）が有効**なこと（プリペイドのクレジット or カード）。無ければ少額（$5 など）だけ入れる。※ ゆうは BYOK を実機で使えている＝既に有効なはず。
2. **専用の Workspace を作り、そこに上限をかける**（自分の普段使いと分ける）:
   - Settings → **Workspaces** → Create workspace → 名前「App Review」。
   - その Workspace の設定で **Spend limit（支出上限・月）= $1**（または少額）に設定。
3. **その Workspace の中で API キーを発行**:
   - Settings → **API keys** → Create key → **Workspace = 「App Review」**を選ぶ → 名前「app-review」→ 作成。
   - 表示された `sk-ant-...` を**その場でコピー**（後から見えない）。
4. （代替＝Workspace を作らないなら）組織全体の月次上限を下げる手もあるが、**自分の普段使いも止まる**ので Workspace 分離を推奨。
5. **審査に通ったらこのキーを削除/無効化**（Settings → API keys → 該当キー → Delete）。Workspace ごと消してもよい。

**🔑 キーをどこに貼るか（2箇所）**
- **(A) ASC の審査メモ**: App Store Connect → 対象アプリ → **1.1 バージョン** → 「App Review Information（審査に関する情報）」→ **Notes（メモ）** 欄に、**§8-b の英文まるごと**（`[PASTE ...]` を実キーに置換して）貼る。「Sign-in required（サインイン必須）」は**OFF のまま**。
- **(B) アプリ内（審査官が貼る先）**: **詳細設定 →「AI 設定」→「API キー」** に貼る → **保存 → テスト送信**。§8-b の手順がこれを案内する。

**提出前チェックリスト**（§11-1 の宿題を今回で回収・2026-07-23 進捗）
- [x] §8-b の審査メモ（実キー入り）を Notes へ（ゆう完了・1,061字）。
- [x] What's New（§5 の v1.1）を貼る（ゆう完了）。
- [x] Codemagic で 1.1(N) をビルド → TestFlight で**位置がもう出ない**ことと**AI がキーで動く**ことを実機確認 → ASC で 1.1 に添付（ゆう完了・位置は想定どおり出なかった）。
- [x] $1 上限 Workspace「App Review」＋テストキー発行（ゆう完了・$0.00/$1.00）。
- [x] privacy.html / support.html＝デプロイ済み・1.1 の内容として正（位置記述は v62 で除去済み・AI 節あり）。
- [ ] **App プライバシー＝「Data Not Collected（データを収集していません）」を選ぶ**（推奨）。
  - **理由**: 栄養表示は「**開発者**が収集するか」を問う。BYOK は**利用者自身のキー/アカウント**で、利用者が選んだ AI 社へ端末から直接送る＝**開発者は SDK を入れておらず・サーバも無く・何も受け取らない**（＝メールアプリで利用者が自分のアカウントを入れて送るのと同型）。よって開発者の収集は No。
  - **AI の透明性**（Apple が 1.0 で聞いた「何を誰に送るか」）は**審査メモ（§8-b）とプライバシーポリシーで開示済み**＝栄養表示の「収集なし」と両立する（矛盾しない）。
  - 保守的に「Other User Content を第三者へ送信」と申告する道もあるが、**開発者が収集しないのに収集と申告する**方が設問が増える＝非推奨。まず「収集なし」＋メモ/ポリシー開示で出す。
  - ASC 手順: 「App のプライバシー」→ 編集 → 「**いいえ、このアプリからデータを収集していません**」→ 公開。
- [ ] **Sign-in required（サインイン必須）= OFF**（キーは Notes に記載・ログイン不要アプリ）。
- [x] 輸出コンプライアンス＝Info.plist `ITSAppUsesNonExemptEncryption=false`（HTTPS は適用除外）＝提出ごとの質問は出ない。
- [ ] 年齢レーティング 4+ が 1.0 から引き継がれているか一応確認。
- [ ] すべて揃ったら **「審査用に追加（Add for Review）」→ Submit**。
- [ ] 前回 Apple に「次で開示する」と**約束済み**＝この開示（メモ＋ポリシー＋テストキー）で果たす。

**⚠️ 見張り事項（今すぐ直さない・却下されたら対応）＝ Guideline 5.1.2（AI への送信同意）**
- 現状の同意の担保＝**既定オフ＋利用者が自分のキーを入れる（明示的な有効化）＋設定に「文章は選んだ AI 社へ直接送信される」と明記＋取り込み前に必ず内容確認**。これは十分に強い opt-in と考えられる。
- ただし 5.1.2 は 2025 後半に AI を明記する形へ更新＝**厳しい審査官は「送信直前の1文の同意」を求める可能性**。要求されたら**送信前に一度だけ確認を出す**小改修（＝新ビルド）で対応。**今回は現状のまま出して様子を見る**のが妥当（すでにビルド添付済み・同意の筋も通っている）。

---

### 11-3. 1.2 提出（v63-v78・位置情報あり）＝ 準備中（2026-08-06）

**この版に載るもの**（公開版 1.1 ≈ v62 からの差分・**iOS で見えるものだけ**）
| | 内容 | 審査への影響 |
|---|---|---|
| v63 | 録音中の一時オーバーライドのボタン寸法を揃えた | なし |
| v64 | **ホーム画面長押し（Quick Action）→「リスト」** | メモに1行（Siri インテントではない） |
| v70 | 発話中に見える認識文字を大きく | なし |
| v71 | 記録📝を保存先によらず付ける | なし |
| **v72** | 🚨 **位置情報の復活**（任意・既定オフ・端末内のみ） | **メモの書き換えが必須**（1.1 で `Location: NOT used` と書いた） |
| v74 | 「辞書に登録して保存」が更新経路を通る（不具合修正） | なし |
| v75 | 来歴からも保存済みを直せる | なし |
| v76 | タイトル3行・横スクロール解消 | なし |
| v77 | 各パネルをカードに＋下の固定マイクバー | **スクショが古くなる** |
| **v78** | 🚨 **録音中は全画面の専用画面** | **メモに閉じ方を書く**（起動＝即録音と重なり、開いた直後に全画面が出る） |
> v65-v69・v73 は **Android 専用**＝ iOS のリリースノートには書かない（Play 側 versionCode 9 で配信済み）。

**ASC で触る場所（この順で）**
1. **バージョン 1.2 を作成** → TestFlight の **1.2(N)** ビルドを添付（`MARKETING_VERSION = 1.2`・repo は既に 1.2）。
2. **このバージョンの新機能** ← §5 の「What's New・v1.2」を貼る。
3. **App Review Information → メモ** ← **§8-c**（8-b ではない）。`[PASTE ...]` に $1 上限のテストキー。**Sign-in required = OFF**。
4. **スクリーンショット** ← v77/v78 で画面が変わった＝差し替え推奨（§9 の注記）。**1枚目を録音中の専用画面に**。
5. **説明** ← 任意。1.0 のままなのでリスト/まとめて入力/AI に触れていない → §4-b の3ブロックを足せる。
6. **プロモーションテキスト** ← 審査不要でいつでも変更可（今回は据え置きで可）。

**変えなくてよい場所（確認済み・2026-08-06）**
- **App プライバシー＝「データを収集していません」のまま**。位置情報は**端末の外に出ない**＝ Apple の「収集（collect）」の定義（端末外へ送信し開発者/提携先が参照できる状態）に当たらない。§8-c にも同じ理由を書いてある。
- **プライバシーポリシー URL / サポート URL** ＝ 変更不要。`privacy.html` には位置情報の記述が **JP/EN とも在る**（v62 で消し v72 で戻した＝**実物と一致**）。
- **輸出コンプライアンス** ＝ Info.plist で恒久回答済み（質問は出ない）。
- **カテゴリ・年齢レーティング 4+・価格** ＝ 変更なし。

**⚠️ 見張り事項（据え置き）**
- **Guideline 5.1.2（AI 送信の同意）** ＝ 11-2 の記述のまま。1.1 は通った＝現状の担保（既定オフ＋自分のキー＋設定に明記＋取り込み前の確認）で出す。
- **今回の新しい面 = 起動時の全画面録音**。審査担当が「開いた瞬間に全画面が出て操作できない」と読む可能性がある（実際は6秒で閉じる／✕で閉じる）＝ §8-c の冒頭で先に説明してある。もし 2.1 が来たら**この点**を疑う。
