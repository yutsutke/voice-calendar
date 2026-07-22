// tests/parser.test.js — 確定的日本語日時パーサの単体テスト（node tests/parser.test.js）
// now を固定して純関数 interpret() の入出力だけを検証する（端末 TZ に依存しない
// よう、期待値もローカル構成の文字列で書く）。
'use strict';
const { interpret, isFillerOnly } = require('../engine/parser.js');

// 固定の現在時刻: 2026-07-16 (木) 13:43
const NOW = new Date(2026, 6, 16, 13, 43);

let pass = 0, fail = 0;
const failures = [];

function check(text, expected, opts = {}) {
  const { patch, notes } = interpret(text, opts.now || NOW);
  const problems = [];
  for (const [k, v] of Object.entries(expected)) {
    if (v === undefined) {
      if (k in patch) problems.push(`${k}: 入らないはずが ${JSON.stringify(patch[k])}`);
    } else if (patch[k] !== v) {
      problems.push(`${k}: 期待 ${JSON.stringify(v)} / 実際 ${JSON.stringify(patch[k])}`);
    }
  }
  for (const k of Object.keys(patch)) {
    if (!(k in expected)) problems.push(`${k}: 予期しないキー (${JSON.stringify(patch[k])})`);
  }
  if (problems.length) {
    fail++;
    failures.push(`✗ 「${text}」\n    ${problems.join('\n    ')}\n    notes: ${notes.join(' / ') || '(なし)'}`);
  } else {
    pass++;
  }
}

// ===== 本命ユースケース（SPEC §4-1） =====
check('明日15時に歯医者', { title: '歯医者', startDate: '2026-07-17', startTime: '15:00' });
check('明日の15時に歯医者の予定を入れて', { title: '歯医者', startDate: '2026-07-17', startTime: '15:00' });

// ===== 相対日 =====
check('今日18時半 打ち合わせ', { title: '打ち合わせ', startDate: '2026-07-16', startTime: '18:30' });
check('明後日の午後3時 美容院', { title: '美容院', startDate: '2026-07-18', startTime: '15:00' });
check('しあさって ランチ', { title: 'ランチ', startDate: '2026-07-19' });

// ===== 絶対日付（年・月を言っていない → 今日に最も近いものを選ぶ。v8） =====
check('7月20日10時 ランチ', { title: 'ランチ', startDate: '2026-07-20', startTime: '10:00' });
check('20日に美容院', { title: '美容院', startDate: '2026-07-20' }); // 最も近い20日 = 今月（+4日）
check('15日 請求書', { title: '請求書', startDate: '2026-07-15' }); // 最も近い15日 = 昨日（-1日 < 来月の+30日）
check('5日 支払い', { title: '支払い', startDate: '2026-08-05' }, { now: new Date(2026, 6, 28, 10, 0) }); // 7/28 なら来月5日（+8日 < 今月5日の-23日）
check('31日 締め', { title: '締め', startDate: '2026-07-31' }); // 6月に31日は無い → 候補から除外
check('2月30日 テスト', { title: '2月30日 テスト', startDate: undefined }); // 存在しない日付 → 素通し（創作しない）
check('来月5日 契約更新', { title: '契約更新', startDate: '2026-08-05' });
check('月末 締め切り', { title: '締め切り', startDate: '2026-07-31' });
check('来月末 家賃', { title: '家賃', startDate: '2026-08-31' });

// ===== 曜日（now = 木曜 2026-07-16） =====
check('来週火曜の10時から11時までチームミーティング', { title: 'チームミーティング', startDate: '2026-07-21', startTime: '10:00', endDate: '2026-07-21', endTime: '11:00' });
check('金曜 飲み会', { title: '飲み会', startDate: '2026-07-17' }); // 素の曜日 = 直近未来
check('月曜日の朝9時 ゴミ出し', { title: 'ゴミ出し', startDate: '2026-07-20', startTime: '09:00' });
check('今週金曜15時 面談', { title: '面談', startDate: '2026-07-17', startTime: '15:00' });
check('再来週水曜 出社', { title: '出社', startDate: '2026-07-29' });
check('今週月曜 レビュー', { title: 'レビュー', startDate: '2026-07-13' }); // 過去でも埋める（実績記録の用途が実在＝実発話FB）
check('先週の金曜日 飲み会だった', { title: '飲み会だった', startDate: '2026-07-10' });

// ===== 実発話FB 第1回（2026-07-16 iPhone）から追加 =====
check('昨日の11時半暇だった', { title: '暇だった', startDate: '2026-07-15', startTime: '11:30' }); // FB①: 昨日が無く「明日」になっていた
check('一昨日ジム', { title: 'ジム', startDate: '2026-07-14' }); // FB②
check('来週の月曜日旅行', { title: '旅行', startDate: '2026-07-20' }); // FB③: 「の」未対応で素の月曜として解釈されていた
check('来週の金曜旅行', { title: '旅行', startDate: '2026-07-24' }); // 「の」対応の本丸: 素の金曜(7/17)と1週間違う
check('一か月後旅行', { title: '旅行', startDate: '2026-08-16' }); // FB④: 相対日＋漢数字が無く素通しだった
check('1ヶ月後 契約更新', { title: '契約更新', startDate: '2026-08-16' });
check('2週間後 検診', { title: '検診', startDate: '2026-07-30' });
check('三日後 打ち合わせ', { title: '打ち合わせ', startDate: '2026-07-19' });
check('十日後 締め切り', { title: '締め切り', startDate: '2026-07-26' });
check('1ヶ月後 家賃', { title: '家賃', startDate: '2026-02-28' }, { now: new Date(2026, 0, 31, 10, 0) }); // 月末越えは月末に丸める

// ===== 実発話FB 第2回（2026-07-16 iPhone・来歴パネルより）から追加 =====
check('今月の末仕事', { title: '仕事', startDate: '2026-07-31' }); // FB: 「の」未対応で素通しだった
check('来月の末 支払い', { title: '支払い', startDate: '2026-08-31' });
check('7月の末 帰省', { title: '帰省', startDate: '2026-07-31' });
check('9月末 出張', { title: '出張', startDate: '2026-09-30' }); // 最も近い9月末 = 今年（+76日）
check('2月末 決算', { title: '決算', startDate: '2026-02-28' }); // 最も近い2月末 = 今年（-138日 < 来年の+227日）
check('1ヵ月後の今日暇', { title: '暇', startDate: '2026-08-16' }); // FB: 「の今日」を別日付と誤判定していた
check('週末 キャンプ', { title: '週末 キャンプ', startDate: undefined }); // 「週末」を月末と誤読しないガード

// ===== 実発話FB 第3回（2026-07-16 iPhone・スクショより）: 「N月のN日」の「の」 =====
check('7月の28日移動', { title: '移動', startDate: '2026-07-28' }); // FB: 「7月の」がタイトルに残り月が無視されていた
check('7月の21日の10時移動', { title: '移動', startDate: '2026-07-21', startTime: '10:00' }); // FB: タイトルが「7月のの移動」になっていた
check('12月の5日 忘年会', { title: '忘年会', startDate: '2026-12-05' }); // 月無視の事故ケース: 素の5日なら 8/5 に化けていた

// ===== 実発話FB 第4回（2026-07-16）: 年は「最も近い」を選ぶ（過去も一級市民） =====
check('6月の30日 移動', { title: '移動', startDate: '2026-06-30' }); // FB: 2027-06-30（11か月先）になっていた
check('6月30日 打ち上げだった', { title: '打ち上げだった', startDate: '2026-06-30' }); // -16日 < 来年の+349日
check('1月5日 新年会', { title: '新年会', startDate: '2027-01-05' }); // +173日 < 今年1/5の-192日 → 来年（従来と同じ）
check('3月1日 記念日', { title: '記念日', startDate: '2026-03-01' }); // 中間帯: -137日 < +228日 → 今年（v1 の「仮」表示の第一候補）

// ===== 実発話FB 第5回（2026-07-16）: 言った年には必ず従う（推測で上書きしない） =====
check('2027年11月5日誕生日', { title: '誕生日', startDate: '2027-11-05' }); // FB: 2026-11-05 になり「2027年」がタイトルに残っていた
check('2027年の11月5日 誕生日', { title: '誕生日', startDate: '2027-11-05' });
check('来年の3月1日 引っ越し', { title: '引っ越し', startDate: '2027-03-01' }); // 中間帯の曖昧を人が自分で解消できる逃げ道
check('今年の12月5日 忘年会', { title: '忘年会', startDate: '2026-12-05' });
check('去年の6月30日だった', { title: 'だった', startDate: '2025-06-30' });
check('一昨年11月5日 結婚式', { title: '結婚式', startDate: '2024-11-05' });
check('再来年の1月5日 計画', { title: '計画', startDate: '2028-01-05' });
check('来年2月末 決算', { title: '決算', startDate: '2027-02-28' });
check('2028年2月29日 うるう日', { title: 'うるう日', startDate: '2028-02-29' }); // 年の明示で「最も近い」では届かない日に行ける
check('2027年2月30日 テスト', { title: '2027年2月30日 テスト', startDate: undefined }); // 年を言っても存在しない日は素通し

// ===== 「今」「現在」= 今の日時（v27・実機FB第19回「メモアプリとしても使えそう」） =====
// now = 2026-07-16 (木) 13:43
check('今 牛乳を買う', { title: '牛乳を買う', startDate: '2026-07-16', startTime: '13:43' });
check('今、頭痛', { title: '頭痛', startDate: '2026-07-16', startTime: '13:43' });
check('現在 会議中', { title: '会議中', startDate: '2026-07-16', startTime: '13:43' });
check('今から散歩', { title: '散歩', startDate: '2026-07-16', startTime: '13:43' });
check('今すぐ電話', { title: '電話', startDate: '2026-07-16', startTime: '13:43' });
check('たった今 帰宅', { title: '帰宅', startDate: '2026-07-16', startTime: '13:43' });
check('ただいま到着', { title: '到着', startDate: '2026-07-16', startTime: '13:43' });
// ※「今から15時まで」は v34 で範囲として対応した（下の v34 セクション）。

// 🔴 「今」の誤爆ガード（v27）: 日本語は語境界が無く「今」は語の中に自然に現れる。
// ここが壊れると「今井さんと会議」が「井さんと会議」に化ける＝v22 で複数欄分割を却下したのと
// 同じ silent wrong answer。**素通し（タイトルに残る）が正しい**。
check('今井さんと会議', { title: '今井さんと会議' });
check('今川さんに連絡', { title: '今川さんに連絡' });
// 「今度」は「今」に食われず素通し（残るのが正しい）。「の金曜」は既存の曜日パターンが拾う＝
// 時刻が入らないことが「今」を拾っていない証拠（拾っていれば startTime も入ってしまう）
check('今度の金曜 飲み会', { title: '今度 飲み会', startDate: '2026-07-17' });
// 既存語彙は「今」に食われない
check('今日18時 会議', { title: '会議', startDate: '2026-07-16', startTime: '18:00' });
check('今週の金曜 提出', { title: '提出', startDate: '2026-07-17' });
check('今月の末 棚卸し', { title: '棚卸し', startDate: '2026-07-31' });
check('今年の12月25日 パーティー', { title: 'パーティー', startDate: '2026-12-25' });

// ===== 時刻の形 =====
check('明日15時半 カフェ', { title: 'カフェ', startDate: '2026-07-17', startTime: '15:30' });
check('明日15時30分 カフェ', { title: 'カフェ', startDate: '2026-07-17', startTime: '15:30' });
check('明日１５時 全角', { title: '全角', startDate: '2026-07-17', startTime: '15:00' });
check('明日15:30 コロン', { title: 'コロン', startDate: '2026-07-17', startTime: '15:30' });
check('正午 ランチ', { title: 'ランチ', startDate: '2026-07-17', startTime: '12:00' }); // 12:00 は 13:43 に過ぎている → 明日

// ===== 時刻だけ（日付なし）→ まだ来ていなければ今日、過ぎていれば明日 =====
check('夜8時 ジム', { title: 'ジム', startDate: '2026-07-16', startTime: '20:00' }); // 20:00 > 13:43 → 今日
check('朝9時 ゴミ出し', { title: 'ゴミ出し', startDate: '2026-07-17', startTime: '09:00' }); // 9:00 < 13:43 → 明日
check('15時から17時 会議', { title: '会議', startDate: '2026-07-16', startTime: '15:00', endDate: '2026-07-16', endTime: '17:00' });

// ===== 範囲・継続時間 =====
check('明日13時から2時間 ワークショップ', { title: 'ワークショップ', startDate: '2026-07-17', startTime: '13:00', endDate: '2026-07-17', endTime: '15:00' });
check('22時から2時まで 夜勤', { title: '夜勤', startDate: '2026-07-16', startTime: '22:00', endDate: '2026-07-17', endTime: '02:00' }); // 日またぎ
check('明日10時〜11時半 定例', { title: '定例', startDate: '2026-07-17', startTime: '10:00', endDate: '2026-07-17', endTime: '11:30' });

// ===== 曖昧 → 素通し（SPEC §7: 無理に解釈しない） =====
check('明日3時 打ち合わせ', { title: '3時 打ち合わせ', startDate: '2026-07-17', startTime: undefined }); // 1〜6時は午前/午後が曖昧
check('明日午後3時 打ち合わせ', { title: '打ち合わせ', startDate: '2026-07-17', startTime: '15:00' }); // 修飾があれば確定
check('明日か明後日 飲み会', { title: '明日か明後日 飲み会', startDate: undefined }); // 日付が複数 → 素通し
check('9時から3時 バイト', { title: '3時 バイト', startDate: '2026-07-17', startTime: '09:00', endTime: undefined }); // 終了3時は曖昧 → 開始のみ。「3時」はタイトルに残って見える

// ===== 不可視文字（v14）: iOS の音声認識が数字の前後に混ぜてくる＝「見えているのに入らない」 =====
check('7月⁨14⁩日学校', { title: '学校', startDate: '2026-07-14' }); // 双方向分離子 FSI/PDI（\u エスケープで記述＝エディタで消えない）
check('⁦7月14日⁩学校', { title: '学校', startDate: '2026-07-14' });
check('明日 15時 歯医者', { title: '歯医者', startDate: '2026-07-17', startTime: '15:00' }); // NBSP・狭い NBSP
check('7月14日​学校', { title: '学校', startDate: '2026-07-14' }); // ゼロ幅スペース
check('昨日⁨10⁩時美術館', { title: '美術館', startDate: '2026-07-15', startTime: '10:00' }); // 実機FBの形

// ===== 終日 =====
check('明日は終日 出張', { title: '出張', startDate: '2026-07-17', allDay: true });

// ===== タイトルなし =====
check('明日15時', { title: undefined, startDate: '2026-07-17', startTime: '15:00' });

// ===== 欄指定発話（v17・実機FB第9回: 「終了22時」と言うと開始に入ってしまう） =====
check('終了22時', { endTime: '22:00' });
check('終了は22時', { endTime: '22:00' });
check('終了 22時半', { endTime: '22:30' });
check('終了22時まで', { endTime: '22:00' }); // 値の後ろの言い回しは無視
check('開始9時半', { startTime: '09:30' });
check('開始は午後3時', { startTime: '15:00' });
check('場所 立川', { location: '立川' });
check('場所は立川駅前', { location: '立川駅前' });
check('メモ 持ち物はタオル', { note: '持ち物はタオル' });
check('タイトル 打ち上げ', { title: '打ち上げ' });
// 誤爆ガード: 欄名で始まっても値に時刻が無ければ通常解釈へフォールバック
check('終了式の打ち合わせ 明日', { title: '終了式の打ち合わせ', startDate: '2026-07-17' });
// 曖昧時刻（3時）は欄指定でも埋めない → 通常解釈へ（素通しでタイトルに残る）
check('終了3時', { title: '終了3時', startTime: undefined, endTime: undefined });
// 欄名が文中にあるだけなら通常解釈（「始まる」発話だけが欄指定）
check('明日15時 プロジェクト終了の打ち上げ', { title: 'プロジェクト終了の打ち上げ', startDate: '2026-07-17', startTime: '15:00' });

// ===== パーサ補強 v34（TODO の実データ由来の宿題: 漢数字の時刻・「半」・相対時刻・「今から◯時まで」） =====
// 漢数字の時刻は算用数字と同じ決め打ちルールに従う（1〜6時の曖昧素通しも同じ＝挙動を分けない）
check('午後三時に歯医者', { title: '歯医者', startDate: '2026-07-16', startTime: '15:00' }); // 15:00 > 13:43 → 今日
check('明日七時ジョギング', { title: 'ジョギング', startDate: '2026-07-17', startTime: '07:00' });
check('十九時 打ち合わせ', { title: '打ち合わせ', startDate: '2026-07-16', startTime: '19:00' });
check('明日十時半 美容院', { title: '美容院', startDate: '2026-07-17', startTime: '10:30' });
check('午後三時十五分 面談', { title: '面談', startDate: '2026-07-16', startTime: '15:15' });
check('明日三時 打ち合わせ', { title: '三時 打ち合わせ', startDate: '2026-07-17', startTime: undefined }); // 「明日3時」と同じ曖昧素通し
// 誤爆ガード: 語中の「一時」（一時的/一時停止）は 1〜6時の曖昧扱い＝埋めない・タイトルを壊さない
check('一時的に保留', { title: '一時的に保留' });
check('一時停止して確認', { title: '一時停止して確認' });
// 「半」が時刻から離れても拾う（認識が切り離すことがある）。「半分」は 30分と誤読しない
check('明日10時 半 カフェ', { title: 'カフェ', startDate: '2026-07-17', startTime: '10:30' });
check('明日10時 半分残す', { title: '半分残す', startDate: '2026-07-17', startTime: '10:00' });
// 相対時刻（now = 13:43）: 開始 = 今 + Δ。日付もその時点の日になる
check('30分後に会議', { title: '会議', startDate: '2026-07-16', startTime: '14:13' });
check('三十分後 休憩', { title: '休憩', startDate: '2026-07-16', startTime: '14:13' });
check('2時間後 出発', { title: '出発', startDate: '2026-07-16', startTime: '15:43' });
check('1時間半後 薬を飲む', { title: '薬を飲む', startDate: '2026-07-16', startTime: '15:13' });
check('1時間30分後 チェック', { title: 'チェック', startDate: '2026-07-16', startTime: '15:13' });
check('12時間後 服薬', { title: '服薬', startDate: '2026-07-17', startTime: '01:43' }); // 日またぎは翌日の日付になる
check('30分後ろ倒し', { title: '30分後ろ倒し' }); // 🚨 差分修正の言い回し（v1 の主戦場）を相対時刻と誤読しない
check('明日 30分後 会議', { title: '明日 30分後 会議', startDate: undefined }); // 矛盾は素通し（創作しない）
check('15時30分後に出る', { title: '後に出る', startDate: '2026-07-16', startTime: '15:30' }); // 「30分」は 15時30分の一部（相対と誤読しない）
// 「今からX時まで」= 開始が今・終了が X時（従来は開始が X時 に化けていた＝TODO の実測）
check('今から15時まで作業', { title: '作業', startDate: '2026-07-16', startTime: '13:43', endDate: '2026-07-16', endTime: '15:00' });
check('現在から15時まで作業', { title: '作業', startDate: '2026-07-16', startTime: '13:43', endDate: '2026-07-16', endTime: '15:00' }); // 「から」の食べ残しがタイトルを汚さない
check('今から0時まで 仕込み', { title: '仕込み', startDate: '2026-07-16', startTime: '13:43', endDate: '2026-07-17', endTime: '00:00' }); // 終了が今より前 = 翌日
check('今から1時間 集中', { title: '集中', startDate: '2026-07-16', startTime: '13:43', endDate: '2026-07-16', endTime: '14:43' }); // 既存の継続時間と合流
// 欄指定も漢数字を受ける（TIME_VALUE_RE は本文と同じ意味論＝v17 の約束）
check('開始 十時半', { startTime: '10:30' });
check('終了 午後三時', { endTime: '15:00' });

// ===== 言い淀みだけの発話（v47・isFillerOnly） =====
// これは **interpret には影響しない**（発話は今までどおり素通しでタイトルに残る）。
// 使い道は自動保存の門だけ＝v47 で「日時を言わなくても自動保存」を解禁した穴（v28 で塞いだもの）を受け直す。
// 🚨 **完全一致だけ**が仕様: 部分一致にすると「あの店」「はいチーズ」まで殺す
//    ＝v22「場所 メモリアルホール」・v27「今井さん」と同じ silent wrong answer。
function filler(text, expected, why) {
  const got = isFillerOnly(text);
  if (got === expected) { pass++; return; }
  fail++;
  failures.push(`✗ isFillerOnly(${JSON.stringify(text)})\n    期待 ${expected} / 実際 ${got}${why ? `\n    ${why}` : ''}`);
}

// 弾く: 言い淀み・相づちそのもの
filler('えーっと', true);
filler('えっと', true);
filler('ええと', true);
filler('あのー', true);
filler('あの', true);
filler('うーん', true);
filler('んー', true);
filler('えー', true);
filler('まあ', true);
filler('はい', true);
filler('その', true);
filler('えーーーっと', true, '長音の伸びは畳んで同一視する（認識器は伸ばし方を揺らす）');
filler('えーっと。', true, '句読点は中身ではない');
filler('  あの　', true, '前後の空白・全角空白は中身ではない');
filler('あー、', true);
filler('えｰっと', true, '半角長音 ｰ でも同じ（認識器・IME で混ざる）');
filler('', true, '空＝確定させるものが無い');

// 通す: 中身のある発話（**ここを1つでも落とすと「言ったのに保存されない」になる**）
filler('あの店で待ち合わせ', false, '🚨 フィラー語で始まる正当な発話を殺さない');
filler('はいチーズ', false, '🚨 部分一致にしていない証拠');
filler('まあまあの結果', false);
filler('うんどう会', false);
filler('その本を返す', false);
filler('新宿駅に着いた', false, 'v47 の主役＝日時なしでも自動保存される発話');
filler('明日15時に歯医者', false);
filler('えーっと 明日15時 歯医者', false, '言い淀んでから本題を言った発話は通す');
filler('会議', false);

// ===== v55: 出所（prov・スパン出所追跡 A'） =====
// 境界の仕様: nearestBy（年・月の最近接補完 v8）や now 比較（時刻だけ→今日/明日・日またぎ）で
// **実在する複数候補から1つを選んだら inferred**。定義的に1つへ解決する語は transcript。
// span がある prov は必ず quote === normalizedText.slice(a,b)（AI 経路 v56 の quote 検証と鏡の不変条件）。
function checkProv(text, field, expected, opts = {}) {
  const r = interpret(text, opts.now || NOW);
  const p = (r.prov || {})[field];
  const problems = [];
  if (!expected) {
    if (p) problems.push(`prov.${field}: 無いはずが ${JSON.stringify(p)}`);
  } else if (!p) {
    problems.push(`prov.${field}: 期待 ${JSON.stringify(expected)} / 実際 なし`);
  } else {
    if (p.source !== expected.source) problems.push(`source: 期待 ${expected.source} / 実際 ${p.source}`);
    if ('quote' in expected) {
      const q = p.span && p.span.quote;
      if (q !== expected.quote) problems.push(`quote: 期待 ${JSON.stringify(expected.quote)} / 実際 ${JSON.stringify(q)}`);
    }
    if ('whyIncludes' in expected && (!p.why || !p.why.includes(expected.whyIncludes))) {
      problems.push(`why: 「${expected.whyIncludes}」を含まない / 実際 ${JSON.stringify(p.why)}`);
    }
    if (p.span && r.normalizedText.slice(p.span.a, p.span.b) !== p.span.quote) {
      problems.push(`span/quote 不一致: slice=${JSON.stringify(r.normalizedText.slice(p.span.a, p.span.b))} / quote=${JSON.stringify(p.span.quote)}`);
    }
  }
  if (problems.length) {
    fail++;
    failures.push(`✗ prov 「${text}」.${field}\n    ${problems.join('\n    ')}`);
  } else {
    pass++;
  }
}

// 定義的に1つへ解決する語 = transcript（span がその言葉を指す）
checkProv('明日15時に歯医者', 'startDate', { source: 'transcript', quote: '明日' });
checkProv('明日15時に歯医者', 'startTime', { source: 'transcript', quote: '15時' });
checkProv('明日15時に歯医者', 'title', { source: 'transcript' }); // title は素通しの寄せ集め＝span なし
checkProv('来週火曜の10時から11時までチームミーティング', 'startDate', { source: 'transcript', quote: '来週火曜' });
checkProv('来週火曜の10時から11時までチームミーティング', 'endTime', { source: 'transcript', quote: '11時' });
checkProv('来週火曜の10時から11時までチームミーティング', 'endDate', { source: 'transcript', quote: '来週火曜' }); // 終了日は開始日の出所を引き継ぐ
checkProv('明後日の午後3時 美容院', 'startTime', { source: 'transcript', quote: '午後3時' });

// 年を言っていない絶対日付 = 最近接の年を「選んだ」（v8）→ inferred・why に理由
checkProv('6月30日 面談', 'startDate', { source: 'inferred', quote: '6月30日', whyIncludes: '年は言っていない' });
// 年を言ったら transcript（v9: 明示指定を推測扱いしない）
checkProv('2027年11月5日 手術', 'startDate', { source: 'transcript', quote: '2027年11月5日' });
checkProv('来年の3月1日 契約', 'startDate', { source: 'transcript', quote: '来年の3月1日' });
// 月を言っていない「N日」= 最近接の月 → inferred
checkProv('20日に美容院', 'startDate', { source: 'inferred', quote: '20日', whyIncludes: '月は言っていない' });

// 時刻だけ（日付なし）→ 今日/明日を now 比較で選択 = inferred（span は根拠になった時刻の言葉を指す）
checkProv('15時 買い物', 'startDate', { source: 'inferred', quote: '15時', whyIncludes: '日付は言っていない' });
checkProv('15時 買い物', 'startTime', { source: 'transcript', quote: '15時' });

// 日またぎ（22時から2時）: 終了日は「翌日」を選択 = inferred。終了時刻そのものは発話どおり = transcript
checkProv('明日22時から2時まで 飲み会', 'endTime', { source: 'transcript', quote: '2時' });
checkProv('明日22時から2時まで 飲み会', 'endDate', { source: 'inferred', whyIncludes: '翌日' });

// 継続時間: 終了時刻は「2時間」の断片から定義的に計算 = transcript
checkProv('明日13時から2時間 ワークショップ', 'endTime', { source: 'transcript', quote: '2時間' });
// 相対時刻（30分後）= 今からの定義的計算 = transcript（日付・時刻とも）
checkProv('30分後に会議', 'startTime', { source: 'transcript', quote: '30分後' });
checkProv('30分後に会議', 'startDate', { source: 'transcript', quote: '30分後' });
// 「今」「現在」（v27）= 現在時刻へ定義的に解決 = transcript
checkProv('現在 東京駅についた', 'startTime', { source: 'transcript', quote: '現在' });
checkProv('現在 東京駅についた', 'startDate', { source: 'transcript', quote: '現在' });
// 同じ日を2つの言い方で言った時は選択の無かった方（transcript）が代表（「今日」と「16日」）
checkProv('今日16日 打ち合わせ', 'startDate', { source: 'transcript', quote: '今日' });

// 終日
checkProv('明日は終日 出張', 'allDay', { source: 'transcript', quote: '終日' });

// 欄指定発話（v17）にも出所が付く（値は発話にそのまま在る＝transcript）
checkProv('場所 立川', 'location', { source: 'transcript', quote: '立川' });
checkProv('終了 22時', 'endTime', { source: 'transcript', quote: '22時' });

// 曖昧で埋めなかった欄には prov も付かない（素通し＝従来どおり・創作しない）
checkProv('明日3時 打ち合わせ', 'startTime', null);
checkProv('2月30日 テスト', 'startDate', null);

// ===== 結果 =====
console.log(`\nparser.test: ${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log('\n' + failures.join('\n\n'));
  process.exit(1);
}
