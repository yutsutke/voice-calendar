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
'use strict';
const { materialize, eventKitAdapter, pickAdapter, icsAdapter } = require('../adapters/calendar.js');

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

// ===== materialize が保存先の追加で壊れていないこと（v23 の無退行） =====
t('materialize は保存先に関係なく従来どおり（時刻なし→終日 / 終了なし→+既定）', () => {
  const now = new Date(2026, 6, 17, 9, 0);
  const allDay = materialize({ title: '旅行', startDate: '2026-07-20' }, now);
  eq(allDay.event.allDay, true, '時刻なし→終日');
  const oneHour = materialize({ title: '歯医者', startDate: '2026-07-18', startTime: '15:00' }, now);
  eq(oneHour.event.end.getHours(), 16, '終了なし→開始+60分（既定）');
  const half = materialize({ title: '歯医者', startDate: '2026-07-18', startTime: '15:00' }, now, { defaultDurationMin: 30 });
  eq(half.event.end.getHours() * 60 + half.event.end.getMinutes(), 15 * 60 + 30, '設定した長さが効く');
  const noStart = materialize({ title: 'x' }, now);
  eq(noStart.ok, false, '開始が無ければ保存しない（創作しない）');
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); pass++; }
    catch (e) { fail++; failures.push(`✗ ${name}\n    ${e.message}`); }
  }
  console.log(`\ncalendar.test: ${pass} passed, ${fail} failed`);
  if (failures.length) { console.log('\n' + failures.join('\n\n')); process.exit(1); }
})();
