// tests/calendar.test.js — 永続層アダプタの native 契約テスト（node tests/calendar.test.js）
//
// なぜ必要か:
// Swift は Windows でコンパイルできない＝**JS ⇄ Swift の契約は実機に届くまで誰も検証しない**。
// 引数名が1つズレるだけで「選んだ保存先が効かず、黙って既定のカレンダーに入る」＝
// 保存は成功したように見えて中身が違う（v22 で「場所 メモリアルホール」を理由に却下したのと
// 同じ種類の silent wrong answer）。**実機まで気づけない事故ほど、JS 側で先に縛る。**
//
// 守る不変条件:
//   1. プラグイン取得は Plugins.X が本命（v13 の実バグ: registerPlugin は native に存在しない）
//   2. 契約の引数名（startMs / endMs …）がそのまま Swift へ渡る
//   3. native の戻りが欠けても壊れない・**どこに入れたかは落とさない**（v16「黙って捨てない」）
//   4. 使えない環境では理由の分かる throw（黙って何もしない、にしない）
//   5. 🚫 **保存先の選択を復活させない**（v26 で撤去）＝ write-only では選択を次の起動へ持ち越せず、
//      「選べるのに効かない」嘘になる。この判断は実機2往復（v23→v25）で得たもので、
//      忘れて作り直すのが一番の損失＝テストで縛る。理由は CalendarEventsPlugin.swift 冒頭。
//   6. 🚨 **ms エポックを native が Long として受け取れる読み方をしている**（v66 の実バグ）＝
//      Android の Capacitor は getDouble が Long を落とす。JS からは型が見えないため
//      1〜5 を全て満たしていても実機で全滅しうる＝**ソースを読んで構造で縛る**。
'use strict';
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { materialize, eventKitAdapter, pickAdapter, icsAdapter, buildIcs } = require('../adapters/calendar.js');

let pass = 0, fail = 0;
const failures = [];
const tests = [];
function t(name, fn) { tests.push([name, fn]); }
function eq(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label || ''} 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`);
  }
}
function ok(cond, label) { if (!cond) throw new Error(label || 'false だった'); }
async function rejects(fn, needle) {
  try { await fn(); } catch (e) {
    if (!String(e.message).includes(needle)) throw new Error(`エラー文に "${needle}" を期待 / 実際 "${e.message}"`);
    return;
  }
  throw new Error(`throw を期待したのに成功した（黙って何もしないのが最悪）`);
}

const withCapacitor = async (cap, fn) => {
  const prev = globalThis.Capacitor;
  globalThis.Capacitor = cap;
  try { return await fn(); } finally { globalThis.Capacitor = prev; }
};
// native が注入する形（Plugins だけ・registerPlugin は無い＝実機の bridge と同じ）
const nativeCap = (plugin) => ({ isNativePlatform: () => true, Plugins: { CalendarEvents: plugin } });

const EV = {
  title: '歯医者',
  start: new Date(2026, 6, 18, 15, 0),
  end: new Date(2026, 6, 18, 16, 0),
  allDay: false,
  location: '立川',
  note: '保険証',
};

// ===== 不変条件1: Plugins.X が本命（v13 の罠） =====
t('【v13 回帰】Plugins.CalendarEvents を使う（registerPlugin は呼ばない）', async () => {
  let used = null;
  await withCapacitor({
    isNativePlatform: () => true,
    Plugins: { CalendarEvents: { save: async () => { used = 'Plugins'; return { id: 'E1' }; } } },
    // 実機には無い API。保険として残してあるが、Plugins があるならこちらは呼ばれてはいけない
    registerPlugin: () => { throw new Error('registerPlugin が呼ばれた＝v13 の罠に戻っている'); },
  }, async () => {
    await eventKitAdapter.save(EV);
  });
  eq(used, 'Plugins', 'Plugins 経由で取れている');
});

// ===== 不変条件2: 契約の引数名がそのまま渡る =====
t('save に契約どおりの引数が渡る（startMs / endMs …）', async () => {
  let got = null;
  await withCapacitor(nativeCap({ save: async (a) => { got = a; return { id: 'E1' }; } }), async () => {
    await eventKitAdapter.save(EV);
  });
  eq(got.title, '歯医者');
  eq(got.startMs, EV.start.getTime(), 'Date ではなく ms で渡す（Swift 側の契約）');
  eq(got.endMs, EV.end.getTime());
  eq(got.allDay, false);
  eq(got.location, '立川');
  eq(got.note, '保険証');
});

// ===== 不変条件5: 撤去した「保存先の選択」を復活させない（v26） =====
t('🚫 保存先の選択 API を持たない（write-only では効かない＝作り直さない）', async () => {
  await withCapacitor(nativeCap({}), async () => {
    const a = pickAdapter();
    ok(typeof a.chooseCalendar !== 'function', 'chooseCalendar は撤去済み（復活させるなら Swift 冒頭の理由を読むこと）');
    ok(typeof a.getTarget === 'function', '「今どこへ入るか」を見る道は残す');
  });
});

t('🚫 save は保存先を指定しない（OS の既定カレンダー1本＝native が決める）', async () => {
  let got = null;
  await withCapacitor(nativeCap({ save: async (a) => { got = a; return { id: 'E1' }; } }), async () => {
    await eventKitAdapter.save(EV);
  });
  ok(!('calendarId' in got), 'calendarId を渡さない＝選択の残骸が復活していない');
});

t('getTarget は引数を取らない（今どこへ入るかを聞くだけ）', async () => {
  let called = 0, gotArgs;
  await withCapacitor(nativeCap({ getTarget: async (...a) => { called++; gotArgs = a; return { authorized: true, found: true, title: '個人' }; } }), async () => {
    const t2 = await eventKitAdapter.getTarget();
    eq(t2.title, '個人');
  });
  eq(called, 1);
  eq(gotArgs.length, 0, 'native へ余計な引数を渡さない');
});

// ===== 不変条件3: 戻りが欠けても壊れない・どこに入れたかは落とさない =====
t('native の戻りが空でも壊れない（欠けた値は空で埋まる）', async () => {
  await withCapacitor(nativeCap({ save: async () => ({}) }), async () => {
    const r = await eventKitAdapter.save(EV);
    eq(r.ok, true);
    eq(r.method, 'eventkit');
    eq(r.calendarTitle, '');
  });
});

t('native が何も返さなくても throw しない（undefined の戻り）', async () => {
  await withCapacitor(nativeCap({ save: async () => undefined }), async () => {
    const r = await eventKitAdapter.save(EV);
    eq(r.ok, true, '保存自体は成功扱い（Swift が resolve した＝保存はできている）');
  });
});

t('どこへ保存したかが返る（保存 toast に出す＝「入ったのに見つからない」を防ぐ）', async () => {
  await withCapacitor(nativeCap({
    save: async () => ({ id: 'E1', calendarTitle: '仕事', calendarSource: 'Gmail' }),
  }), async () => {
    const r = await eventKitAdapter.save(EV);
    eq(r.calendarTitle, '仕事', 'OS の既定カレンダーの名前');
    eq(r.calendarSource, 'Gmail', 'アカウント名＝Google に出たかの証拠（SPEC §1-6）');
  });
});

t('getTarget: 未許可は authorized:false で返る（権限を要求しない経路）', async () => {
  await withCapacitor(nativeCap({ getTarget: async () => ({ authorized: false, found: false }) }), async () => {
    const t2 = await eventKitAdapter.getTarget();
    eq(t2.authorized, false);
    eq(t2.found, false);
    eq(t2.title, '', '欠けた値は空');
  });
});

t('getTarget: 既定カレンダーが無い時は warning を落とさない', async () => {
  await withCapacitor(nativeCap({
    getTarget: async () => ({ authorized: true, found: false, warning: '書き込み先のカレンダーが見つかりません（OS のカレンダー設定を確認）' }),
  }), async () => {
    const t2 = await eventKitAdapter.getTarget();
    eq(t2.found, false);
    eq(t2.warning, '書き込み先のカレンダーが見つかりません（OS のカレンダー設定を確認）');
  });
});

// ===== 不変条件4: 使えない環境では理由の分かる throw =====
t('web では pickAdapter が ics を返す（native は選ばれない）', async () => {
  await withCapacitor(undefined, async () => {
    eq(pickAdapter().name, 'ics');
    ok(typeof pickAdapter().getTarget !== 'function', 'web に「保存先」は無い＝宿主はこれで見分ける');
  });
});

t('native では pickAdapter が eventkit を返す（保存先を見る＋復帰導線）', async () => {
  await withCapacitor(nativeCap({}), async () => {
    eq(pickAdapter().name, 'eventkit');
    ok(typeof pickAdapter().getTarget === 'function', '今どこへ入るかを聞ける');
    ok(typeof pickAdapter().openSettings === 'function', '拒否からの復帰導線がある');
  });
});

t('native でないのに eventKitAdapter を呼んだら理由の分かる throw', async () => {
  await withCapacitor(undefined, async () => {
    await rejects(() => eventKitAdapter.save(EV), 'native 環境ではありません');
  });
});

t('【v13 の症状】プラグイン未登録なら理由の分かる throw（黙って失敗しない）', async () => {
  await withCapacitor({ isNativePlatform: () => true, Plugins: {} }, async () => {
    await rejects(() => eventKitAdapter.save(EV), 'CalendarEvents プラグインが native に登録されていません');
    await rejects(() => eventKitAdapter.getTarget(), 'CalendarEvents プラグインが native に登録されていません');
  });
});

// ===== 不変条件6: ms エポックの受け取り方（v66 で Android が全滅した罠） =====
//
// 症状: Android 実機で「カレンダーに保存」が **必ず**「title / startMs / endMs は必須です」で失敗。
//       タイトルも開始も画面に入っているのに落ちる。iOS では起きない。
// 真因: Capacitor 8 の PluginCall#getDouble は Double / Float / Integer しか通さず
//       それ以外は既定値（null）を返す。bridge は org.json でパースし、org.json は整数リテラルを
//       Integer に収まらなければ **Long** で持つ。ms エポックは常に Long → 常に null → 常に reject。
//       Swift の getDouble は NSNumber 経由なので同じコードが通る＝**Android だけ**壊れる。
// なぜ 476/476 が通っていたのに実機で全滅したか: JS 側から native の**型**は見えない。
//       上の不変条件2（引数名）は名前しか見ていない。→ Java のソースを読んで構造で縛る。
const ANDROID_CAL_JAVA = join(
  __dirname, '..', 'local-plugins', 'calendar-events', 'android', 'src', 'main',
  'java', 'io', 'github', 'yutsutke', 'voicecalendar', 'calendar', 'CalendarEventsPlugin.java'
);

t('🚨【v66 回帰】ms エポックは Integer に収まらない（このバグの前提を数字で残す）', () => {
  const INT_MAX = 2147483647;
  ok(EV.start.getTime() > INT_MAX, `ms エポック ${EV.start.getTime()} は Integer.MAX_VALUE(${INT_MAX}) を超える＝org.json は Long で持つ`);
  ok(EV.end.getTime() > INT_MAX);
});

t('🚨【v66 回帰】Android native は startMs/endMs を getDouble で読まない（Long が落ちる）', () => {
  const src = readFileSync(ANDROID_CAL_JAVA, 'utf8');
  const bad = src.match(/getDouble\s*\(\s*"(?:startMs|endMs)"/g) || [];
  eq(bad, [], 'getDouble("startMs"/"endMs") は Capacitor が Long を通さない＝実機で必ず null になる');
  ok(/private static Long msOf\(/.test(src), 'Number 経由で longValue() に落とすヘルパ msOf を通す');
  ok(/instanceof Number/.test(src), 'Integer / Long / Double のどれで来ても同じ値になる読み方であること');
});

t('🚨【v66】保存の必須チェックは「どれが欠けたか」を出す（3項目の一括にしない）', () => {
  const src = readFileSync(ANDROID_CAL_JAVA, 'utf8');
  // 「文中に出てくるか」ではなく「reject に渡しているか」を見る（コメントは歴史として残すため）
  ok(!/call\.reject\s*\(\s*"title \/ startMs \/ endMs/.test(src), '一括の文言だと「タイトルが空」と「型で落ちた」が区別できない（v66 の診断が詰まった原因）');
  ok(/タイトルが空です/.test(src) && /開始が未入力です/.test(src) && /終了を作れませんでした/.test(src), '3つを別々の言葉で出す');
  ok(/startMs=/.test(src), '実際に来た値と型を添える（v15/v16「数字を診断に出す」）');
});

// ===== buildIcs（v39 で複数 VEVENT 対応・単一の回帰を先に固定） =====
const EV2 = {
  title: '旅行',
  start: new Date(2026, 6, 20),
  end: new Date(2026, 6, 20),
  allDay: true,
  location: '',
  note: '',
};

t('buildIcs 単一: 従来の構造のまま（VCALENDAR 1・VEVENT 1・UID は従来形）', () => {
  const lines = buildIcs(EV, 'seed1').split('\r\n');
  eq(lines[0], 'BEGIN:VCALENDAR');
  eq(lines[1], 'VERSION:2.0');
  eq(lines[2], 'PRODID:-//voice-calendar//v0//JA');
  eq(lines[3], 'BEGIN:VEVENT');
  eq(lines[4], 'UID:seed1@voice-calendar', '単一時の UID は v38 までと同じ形（-0 を付けない）');
  ok(lines[5].startsWith('DTSTAMP:'));
  eq(lines[6], 'DTSTART:20260718T150000');
  eq(lines[7], 'DTEND:20260718T160000');
  eq(lines[8], 'SUMMARY:歯医者');
  eq(lines[9], 'LOCATION:立川');
  eq(lines[10], 'DESCRIPTION:保険証');
  eq(lines[11], 'END:VEVENT');
  eq(lines[12], 'END:VCALENDAR');
  eq(lines.length, 13);
});

t('buildIcs 配列: 1つの VCALENDAR に VEVENT が N 個・UID は全てユニーク', () => {
  const ics = buildIcs([EV, EV2], 'seed2');
  eq((ics.match(/BEGIN:VCALENDAR/g) || []).length, 1, 'VCALENDAR は1つ（束ねる＝v39）');
  eq((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
  eq((ics.match(/END:VEVENT/g) || []).length, 2);
  ok(ics.includes('UID:seed2@voice-calendar'), '1件目は従来形');
  ok(ics.includes('UID:seed2-1@voice-calendar'), '2件目以降は -i でユニーク（RFC 5545）');
  ok(ics.includes('DTSTART:20260718T150000'), '時刻あり');
  ok(ics.includes('DTSTART;VALUE=DATE:20260720'), '終日（混在できる）');
  ok(ics.includes('DTEND;VALUE=DATE:20260721'), '終日の DTEND は排他（翌日）');
  ok(ics.trim().endsWith('END:VCALENDAR'));
});

t('icsAdapter.saveMany がある・eventKitAdapter には無い（native は1件ずつが正）', () => {
  ok(typeof icsAdapter.saveMany === 'function', 'web は束ね口を持つ（20連ダウンロードにしない）');
  ok(typeof eventKitAdapter.saveMany !== 'function', 'Swift 契約を増やさない＝native は save をループ');
});

// ===== materialize の既定値（保存時の創作はここに集約） =====
t('materialize は従来どおり（時刻なし→終日 / 終了なし→+既定）', () => {
  const now = new Date(2026, 6, 17, 9, 0);
  const allDay = materialize({ title: '旅行', startDate: '2026-07-20' }, now);
  eq(allDay.event.allDay, true, '日付だけ→終日（言っていない時刻を創作しない）');
  const oneHour = materialize({ title: '歯医者', startDate: '2026-07-18', startTime: '15:00' }, now);
  eq(oneHour.event.end.getHours(), 16, '終了なし→開始+60分（既定）');
  const half = materialize({ title: '歯医者', startDate: '2026-07-18', startTime: '15:00' }, now, { defaultDurationMin: 30 });
  eq(half.event.end.getHours() * 60 + half.event.end.getMinutes(), 15 * 60 + 30, '設定した長さが効く');
});

// v27（実機FB第19回「メモアプリとしても使えそう」）: 日時を何も言わなければ「今」として記録する
t('🔴 日時を何も言わない → 今の日時で保存（メモ用途）', () => {
  const now = new Date(2026, 6, 17, 22, 45);
  const r = materialize({ title: '牛乳を買う' }, now);
  eq(r.ok, true, '弾かれない（v26 までは「開始が未入力」で保存できなかった）');
  eq(r.event.allDay, false, '終日ではなく時刻付き＝メモが時系列に並ぶ');
  eq(r.event.start.getFullYear() * 10000 + (r.event.start.getMonth() + 1) * 100 + r.event.start.getDate(), 20260717, '今日');
  eq(r.event.start.getHours() * 60 + r.event.start.getMinutes(), 22 * 60 + 45, '今の時刻');
  eq(r.event.end.getHours(), 23, '終了は +60分（既定）');
  ok(r.warnings.some((w) => w.includes('今の日時')), '黙って今にしない＝warning で見せる');
});

t('🔴 日付だけ言った時は今の時刻を創作しない（終日のまま）', () => {
  const now = new Date(2026, 6, 17, 22, 45);
  const r = materialize({ title: '歯医者', startDate: '2026-07-18' }, now);
  eq(r.event.allDay, true, '「明日 歯医者」が明日の 22:45 になってはいけない（SPEC §7）');
});

t('🔴 空のフォームでは保存しない（「今の空予定」を作らない＝誤タップ・クリア忘れ）', () => {
  const now = new Date(2026, 6, 17, 22, 45);
  const r = materialize({}, now);
  eq(r.ok, false, '何も入っていなければ保存しない');
  ok(r.problems.length > 0, '理由を出す');
});

t('タイトルが無くても場所やメモがあれば「今」として保存できる', () => {
  const now = new Date(2026, 6, 17, 22, 45);
  const r = materialize({ note: '思いついたこと' }, now);
  eq(r.ok, true, 'メモだけの記録も残せる');
  eq(r.event.title, '予定', 'タイトルは既定');
  eq(r.event.start.getHours(), 22, '今の時刻');
});

t('「終日」を自分でチェックしていれば、日時なしでも時刻を足さない（明示が推測に勝つ＝v9）', () => {
  const now = new Date(2026, 6, 17, 22, 45);
  const r = materialize({ title: '記念日', allDay: true }, now);
  eq(r.ok, true);
  eq(r.event.allDay, true, '終日のまま');
  eq(r.event.start.getDate(), 17, '日付は今日');
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); pass++; }
    catch (e) { fail++; failures.push(`✗ ${name}\n    ${e.message}`); }
  }
  console.log(`\ncalendar.test: ${pass} passed, ${fail} failed`);
  if (failures.length) { console.log('\n' + failures.join('\n\n')); process.exit(1); }
})();
