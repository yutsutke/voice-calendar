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
//   2. 契約の引数名（calendarId / startMs …）がそのまま Swift へ渡る
//   3. native の戻りが欠けても壊れない・**warning は絶対に落とさない**（v16「黙って捨てない」の保存版）
//   4. 使えない環境では理由の分かる throw（黙って何もしない、にしない）
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
    await eventKitAdapter.save(EV, {});
  });
  eq(used, 'Plugins', 'Plugins 経由で取れている');
});

// ===== 不変条件2: 契約の引数名がそのまま渡る =====
t('save に契約どおりの引数が渡る（calendarId / startMs / endMs …）', async () => {
  let got = null;
  await withCapacitor(nativeCap({ save: async (a) => { got = a; return { id: 'E1' }; } }), async () => {
    await eventKitAdapter.save(EV, { calendarId: 'CAL-1' });
  });
  eq(got.calendarId, 'CAL-1', '選んだ保存先が渡る（ここがズレると黙って既定に入る）');
  eq(got.title, '歯医者');
  eq(got.startMs, EV.start.getTime(), 'Date ではなく ms で渡す（Swift 側の契約）');
  eq(got.endMs, EV.end.getTime());
  eq(got.allDay, false);
  eq(got.location, '立川');
  eq(got.note, '保険証');
});

t('保存先を選んでいない時は空文字で渡す（＝OS の既定カレンダー・v22 までの挙動）', async () => {
  let got = null;
  await withCapacitor(nativeCap({ save: async (a) => { got = a; return { id: 'E1' }; } }), async () => {
    await eventKitAdapter.save(EV, {});           // opts に calendarId 無し
    eq(got.calendarId, '', 'undefined を渡さない（Swift 側で nil 判定が要らない形）');
    await eventKitAdapter.save(EV, undefined);    // opts ごと無し
    eq(got.calendarId, '', 'opts 自体が無くても壊れない');
  });
});

t('getTarget に現在の選択が渡る', async () => {
  let got = null;
  await withCapacitor(nativeCap({ getTarget: async (a) => { got = a; return { authorized: true, found: true, title: '仕事' }; } }), async () => {
    await eventKitAdapter.getTarget('CAL-9');
  });
  eq(got.calendarId, 'CAL-9');
});

// ===== 不変条件3: 戻りが欠けても壊れない・warning は落とさない =====
t('native の戻りが空でも壊れない（欠けた値は空で埋まる）', async () => {
  await withCapacitor(nativeCap({ save: async () => ({}) }), async () => {
    const r = await eventKitAdapter.save(EV, {});
    eq(r.ok, true);
    eq(r.method, 'eventkit');
    eq(r.calendarTitle, '');
    eq(r.warning, '');
    eq(r.resolvedById, false);
  });
});

t('native が何も返さなくても throw しない（undefined の戻り）', async () => {
  await withCapacitor(nativeCap({ save: async () => undefined }), async () => {
    const r = await eventKitAdapter.save(EV, {});
    eq(r.ok, true, '保存自体は成功扱い（Swift が resolve した＝保存はできている）');
  });
});

t('🔴「既定に倒れた」警告を落とさない（黙って別のカレンダーに保存しない）', async () => {
  await withCapacitor(nativeCap({
    save: async () => ({ id: 'E1', calendarTitle: '個人', calendarSource: 'iCloud', resolvedById: false, warning: '選んだカレンダーが見つからないため、既定のカレンダーに保存しました' }),
  }), async () => {
    const r = await eventKitAdapter.save(EV, { calendarId: 'GONE' });
    eq(r.warning, '選んだカレンダーが見つからないため、既定のカレンダーに保存しました', '警告がそのまま画面まで届く');
    eq(r.resolvedById, false, '識別子で復元できなかったことが分かる（診断に出す）');
    eq(r.calendarTitle, '個人', '実際にどこへ入れたかが分かる');
  });
});

t('どこへ保存したかが返る（保存 toast に出す＝「入ったのに見つからない」を防ぐ）', async () => {
  await withCapacitor(nativeCap({
    save: async () => ({ id: 'E1', calendarTitle: '仕事', calendarSource: 'Gmail', resolvedById: true }),
  }), async () => {
    const r = await eventKitAdapter.save(EV, { calendarId: 'CAL-1' });
    eq(r.calendarTitle, '仕事');
    eq(r.calendarSource, 'Gmail', 'アカウント名＝Google に出たかの証拠（SPEC §1-6）');
    eq(r.resolvedById, true);
  });
});

t('getTarget: 未許可は authorized:false で返る（権限を要求しない経路）', async () => {
  await withCapacitor(nativeCap({ getTarget: async () => ({ authorized: false, found: false }) }), async () => {
    const t2 = await eventKitAdapter.getTarget('');
    eq(t2.authorized, false);
    eq(t2.found, false);
    eq(t2.title, '', '欠けた値は空');
  });
});

t('chooseCalendar: キャンセルは cancelled:true（保存先を変えない）', async () => {
  await withCapacitor(nativeCap({ chooseCalendar: async () => ({ cancelled: true }) }), async () => {
    const r = await eventKitAdapter.chooseCalendar();
    eq(r.cancelled, true);
    eq(r.id, '', '識別子は空＝呼び出し側が settings を空で上書きしない前提（index.html は cancelled で return）');
  });
});

t('chooseCalendar: 選択結果が正規化される', async () => {
  await withCapacitor(nativeCap({ chooseCalendar: async () => ({ cancelled: false, id: 'CAL-7', title: '仕事', source: 'Gmail', sourceType: 'CalDAV（Google / iCloud など）' }) }), async () => {
    const r = await eventKitAdapter.chooseCalendar();
    eq(r.cancelled, false);
    eq(r.id, 'CAL-7');
    eq(r.title, '仕事');
  });
});

// ===== 不変条件4: 使えない環境では理由の分かる throw =====
t('web では pickAdapter が ics を返す（native は選ばれない）', async () => {
  await withCapacitor(undefined, async () => {
    eq(pickAdapter().name, 'ics');
    ok(typeof pickAdapter().getTarget !== 'function', 'web に「保存先」は無い＝宿主はこれで見分ける');
  });
});

t('native では pickAdapter が eventkit を返す（保存先 API を持つ）', async () => {
  await withCapacitor(nativeCap({}), async () => {
    eq(pickAdapter().name, 'eventkit');
    ok(typeof pickAdapter().getTarget === 'function', '保存先を聞ける');
    ok(typeof pickAdapter().chooseCalendar === 'function', '保存先を選べる');
    ok(typeof pickAdapter().openSettings === 'function', '拒否からの復帰導線がある');
  });
});

t('native でないのに eventKitAdapter を呼んだら理由の分かる throw', async () => {
  await withCapacitor(undefined, async () => {
    await rejects(() => eventKitAdapter.save(EV, {}), 'native 環境ではありません');
  });
});

t('【v13 の症状】プラグイン未登録なら理由の分かる throw（黙って失敗しない）', async () => {
  await withCapacitor({ isNativePlatform: () => true, Plugins: {} }, async () => {
    await rejects(() => eventKitAdapter.save(EV, {}), 'CalendarEvents プラグインが native に登録されていません');
    await rejects(() => eventKitAdapter.getTarget(''), 'CalendarEvents プラグインが native に登録されていません');
    await rejects(() => eventKitAdapter.chooseCalendar(), 'CalendarEvents プラグインが native に登録されていません');
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
