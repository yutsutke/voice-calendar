# voice-calendar — 声で入れるカレンダー（仮称）

「明日15時に歯医者」と話すと、カレンダーのフォームが即座に埋まる。意図が明確なら**画面を見ずに保存まで完走**（ノールック）。任意項目を詰めたい時だけ画面を見て、**声か手で**足す——音声と手入力は**同じ一つのフォーム**を同時に編集する。

- 確定的な日本語日時パーサ（LLM なし・オンデバイス）
- フォームが単一の真実。編集中の欄は音声から保護（欄ロック）
- 保存は薄いアダプタ経由（web: .ics / iOS: EventKit — OS が iCloud/Google へ同期）
- Capacitor / iOS 先行

設計の正は [SPEC.md](SPEC.md)（要件定義 v0）。現在地は [TODO.md](TODO.md)、経緯は [CHANGELOG.md](CHANGELOG.md)。

## 開発

```
npm run serve   # http://localhost:5275 （マイクは Edge/Chrome。テキスト欄でも試せる）
npm test        # パーサ単体テスト（node）
```
