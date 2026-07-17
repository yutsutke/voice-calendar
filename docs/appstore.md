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
- **6.9″ iPhone**（iPhone 16 Pro Max 等）: **1320 × 2868 px**（縦）← iPhone 要件（3〜10枚）
- **13″ iPad**（必須・ユニバーサルのため）: **2064 × 2752 px**（縦）← iPad 要件（ゆうが送った iPad 実機キャプチャが素材に使える）
- 任意で 6.5″/6.7″ iPhone（1242×2688 / 1290×2796）も可。5.5″ は不要。
- App アイコン 1024²・スクショは**透過なし**。端末フレーム＋キャプション文字の重ねを推奨。

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
