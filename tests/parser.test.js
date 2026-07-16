// tests/parser.test.js — 確定的日本語日時パーサの単体テスト（node tests/parser.test.js）
// now を固定して純関数 interpret() の入出力だけを検証する（端末 TZ に依存しない
// よう、期待値もローカル構成の文字列で書く）。
'use strict';
const { interpret } = require('../engine/parser.js');

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

// ===== 終日 =====
check('明日は終日 出張', { title: '出張', startDate: '2026-07-17', allDay: true });

// ===== タイトルなし =====
check('明日15時', { title: undefined, startDate: '2026-07-17', startTime: '15:00' });

// ===== 結果 =====
console.log(`\nparser.test: ${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log('\n' + failures.join('\n\n'));
  process.exit(1);
}
