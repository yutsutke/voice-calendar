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

// ===== 絶対日付 =====
check('7月20日10時 ランチ', { title: 'ランチ', startDate: '2026-07-20', startTime: '10:00' });
check('3月1日 確定申告', { title: '確定申告', startDate: '2027-03-01' }); // 過去 → 来年
check('20日に美容院', { title: '美容院', startDate: '2026-07-20' });
check('15日 請求書', { title: '請求書', startDate: '2026-08-15' }); // 15 < 16 → 来月
check('来月5日 契約更新', { title: '契約更新', startDate: '2026-08-05' });
check('月末 締め切り', { title: '締め切り', startDate: '2026-07-31' });
check('来月末 家賃', { title: '家賃', startDate: '2026-08-31' });

// ===== 曜日（now = 木曜 2026-07-16） =====
check('来週火曜の10時から11時までチームミーティング', { title: 'チームミーティング', startDate: '2026-07-21', startTime: '10:00', endDate: '2026-07-21', endTime: '11:00' });
check('金曜 飲み会', { title: '飲み会', startDate: '2026-07-17' }); // 素の曜日 = 直近未来
check('月曜日の朝9時 ゴミ出し', { title: 'ゴミ出し', startDate: '2026-07-20', startTime: '09:00' });
check('今週金曜15時 面談', { title: '面談', startDate: '2026-07-17', startTime: '15:00' });
check('再来週水曜 出社', { title: '出社', startDate: '2026-07-29' });
check('今週月曜 レビュー', { title: '今週月曜 レビュー', startDate: undefined }); // 過去 → 素通し（発話は見えるまま）

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
