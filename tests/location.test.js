// tests/location.test.js — 位置情報アダプタの契約テスト（node tests/location.test.js）
//
// なぜ必要か（実機FB第33回・2026-07-22）:
// v49 は「アプリに戻った時に許可を確かめ直す」配線を足したのに実機で直らなかった。真因は
// **聞く相手**＝ WKWebView（WebContent プロセス）が位置情報の許可状態をプロセス内に握っていて、
// OS 設定で許可に変えても**アプリを開き直すまで**古い答えを返し続ける。JS からは何度聞いても
// 同じ嘘が返るので、**native（CLLocationManager）から読む以外に手が無い**。
// Swift は Windows でコンパイルできない＝ JS ⇄ Swift の契約は実機まで誰も検証しない（calendar と同じ）。
//
// 守る不変条件:
//   1. プラグイン取得は Plugins.X が本命（v13 の実バグ: registerPlugin は native に存在しない）
//   2. 🚫 **native では navigator.geolocation を触らない**＝ v52 そのもの。ここが緩むと
//      「OS でオンにしたのに開き直すまで反映されない」がそのまま戻る（回帰防止の本丸）
//   3. **prompt（まだ答えていない）と denied（拒否）を区別する**＝まだ聞いていない人に
//      拒否バナーを出さない（web の code 1 は両者を潰す。native なら区別できる）
//   4. maximumAge は 0（v50: キャッシュを許すと「オフにしたのに 60 秒は記録され続ける」）
//   5. 何があっても throw しない（v13: 補助機能の失敗が本体＝フォームと保存を殺さない）
//   6. 黙って捨てない（v16: 値が読めなければ成功にせずエラーとして表に出す）
'use strict';
const VCLocation = require('../adapters/location.js');

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
async function rejectsWith(fn, check, label) {
  try { await fn(); } catch (e) { check(e); return; }
  throw new Error(`${label || ''} reject を期待したのに成功した（黙って成功にするのが最悪 v16）`);
}

// --- 環境のダミー ---------------------------------------------------------
const nativeCap = (plugin) => ({ isNativePlatform: () => true, Plugins: { DeviceLocation: plugin } });
// 実機の bridge には registerPlugin が無い。あっても使えるのは保険（v13）
const legacyCap = (plugin) => ({ isNativePlatform: () => true, registerPlugin: (n) => (n === 'DeviceLocation' ? plugin : null) });
const webNav = (impl, perms) => ({ geolocation: impl || {}, permissions: perms });
const okPlugin = (over) => Object.assign({
  getPermission: async () => ({ state: 'granted', raw: 4 }),
  getCurrent: async () => ({ lat: 35.1, lng: 139.2 }),
  requestPermission: async () => ({ state: 'granted' }),
  addListener: () => {},
}, over || {});
// Swift の call.reject(message, code) が JS 側に見える形
const nativeReject = (code, message) => { const e = new Error(message || 'ng'); e.code = code; return e; };

// --- 1. エンジンの選び方 ---------------------------------------------------
t('native の Plugins.DeviceLocation が本命（v13）', () => {
  const loc = VCLocation.create({ capacitor: nativeCap(okPlugin()), navigator: webNav() });
  eq(loc.engine, 'native');
  eq(loc.nativeFailure(), null, 'native が取れたので失敗理由は無い');
});

t('registerPlugin しか無い環境でも保険で取れる', () => {
  const loc = VCLocation.create({ capacitor: legacyCap(okPlugin()), navigator: webNav() });
  eq(loc.engine, 'native');
});

t('native なのにプラグイン未登録 → web へ落ちるが理由は残す（黙って落ちない v16）', () => {
  const loc = VCLocation.create({
    capacitor: { isNativePlatform: () => true, Plugins: {} },
    navigator: webNav({ getCurrentPosition: () => {} }),
  });
  eq(loc.engine, 'web');
  ok(/登録されていません/.test(loc.nativeFailure() || ''), `理由が残る / 実際 ${loc.nativeFailure()}`);
});

t('プラグイン取得が throw しても create は throw しない（v13）', () => {
  const loc = VCLocation.create({
    capacitor: { isNativePlatform: () => true, registerPlugin: () => { throw new Error('proxy 爆発'); } },
    navigator: webNav({ getCurrentPosition: () => {} }),
  });
  eq(loc.engine, 'web');
  ok(/proxy 爆発/.test(loc.nativeFailure() || ''), '失敗理由が読める');
});

t('web だけの環境は web / 何も無ければ none（throw しない）', () => {
  eq(VCLocation.create({ capacitor: null, navigator: webNav({ getCurrentPosition: () => {} }) }).engine, 'web');
  eq(VCLocation.create({ capacitor: null, navigator: {} }).engine, 'none');
  eq(VCLocation.create({ capacitor: null, navigator: null }).engine, 'none');
});

// --- 2. 🚫 native では navigator.geolocation を触らない（v52 の本丸）---------
t('🚫 native 経路は navigator.geolocation を一度も呼ばない', async () => {
  let webCalls = 0;
  const loc = VCLocation.create({
    capacitor: nativeCap(okPlugin()),
    navigator: webNav({ getCurrentPosition: () => { webCalls++; } }, { query: async () => ({ state: 'denied' }) }),
  });
  await loc.getPermission();
  await loc.getCurrent();
  await loc.requestPermission();
  eq(webCalls, 0, 'WKWebView の geolocation は古い許可状態を握っている＝触ってはいけない');
});

t('🚫 native 経路は navigator.permissions も見ない（そちらも古い）', async () => {
  let queries = 0;
  const loc = VCLocation.create({
    capacitor: nativeCap(okPlugin({ getPermission: async () => ({ state: 'denied', raw: 2 }) })),
    navigator: webNav({}, { query: async () => { queries++; return { state: 'granted' }; } }),
  });
  eq(await loc.getPermission(), 'denied', 'native の答えが正');
  eq(queries, 0, 'web の Permissions API は参照しない');
});

// --- 3. prompt と denied の区別 -------------------------------------------
t('native の未許可は state をそのまま返す（prompt を denied にしない）', async () => {
  const loc = VCLocation.create({
    capacitor: nativeCap(okPlugin({ getCurrent: async () => { throw nativeReject('prompt', 'まだ許可されていません'); } })),
    navigator: webNav(),
  });
  await rejectsWith(() => loc.getCurrent(), (e) => {
    eq(e.permission, 'prompt', 'まだ答えていない人を拒否扱いしない＝バナーを出さない');
    eq(e.code, 1);
  });
});

t('native の拒否は permission=denied（バナーを出す唯一の条件）', async () => {
  const loc = VCLocation.create({
    capacitor: nativeCap(okPlugin({ getCurrent: async () => { throw nativeReject('denied', '許可されていません'); } })),
    navigator: webNav(),
  });
  await rejectsWith(() => loc.getCurrent(), (e) => { eq(e.permission, 'denied'); eq(e.code, 1); });
});

t('native の時間切れ・不能は permission を付けない（表示を変えない）', async () => {
  const timeout = VCLocation.create({
    capacitor: nativeCap(okPlugin({ getCurrent: async () => { throw nativeReject('timeout', '時間切れ'); } })),
    navigator: webNav(),
  });
  await rejectsWith(() => timeout.getCurrent(), (e) => { eq(e.code, 3); eq(e.permission, undefined); });
  const gone = VCLocation.create({
    capacitor: nativeCap(okPlugin({ getCurrent: async () => { throw nativeReject('unavailable', '取れない'); } })),
    navigator: webNav(),
  });
  await rejectsWith(() => gone.getCurrent(), (e) => { eq(e.code, 2); eq(e.permission, undefined); });
});

t('web の code 1 は denied 扱い（web では区別できない＝従来どおり）', async () => {
  const loc = VCLocation.create({
    capacitor: null,
    navigator: webNav({ getCurrentPosition: (_ok, ng) => ng({ code: 1, message: 'User denied' }) }),
  });
  await rejectsWith(() => loc.getCurrent(), (e) => { eq(e.code, 1); eq(e.permission, 'denied'); });
});

t('web の code 2/3 は permission を付けない', async () => {
  for (const code of [2, 3]) {
    const loc = VCLocation.create({
      capacitor: null,
      navigator: webNav({ getCurrentPosition: (_ok, ng) => ng({ code, message: 'x' }) }),
    });
    await rejectsWith(() => loc.getCurrent(), (e) => { eq(e.code, code); eq(e.permission, undefined); });
  }
});

// --- 4. v50 の回帰防止（キャッシュを許さない）-------------------------------
t('GEO_OPTS の maximumAge は 0（v50: 切ったのに 60 秒記録され続けた）', () => {
  eq(VCLocation.GEO_OPTS.maximumAge, 0);
  eq(VCLocation.GEO_OPTS.enableHighAccuracy, false, '用途は街区レベル（v38）');
  ok(VCLocation.GEO_OPTS.timeout > 0, 'timeout は必ず入れる（永久に待たない）');
});

t('web の取得には必ず GEO_OPTS がそのまま渡る', async () => {
  let seen = null;
  const loc = VCLocation.create({
    capacitor: null,
    navigator: webNav({ getCurrentPosition: (okCb, _ng, opts) => { seen = opts; okCb({ coords: { latitude: 1, longitude: 2 } }); } }),
  });
  eq(await loc.getCurrent(), { lat: 1, lng: 2 });
  eq(seen, VCLocation.GEO_OPTS, '3経路が同じ定数を使う＝二度とズレない');
});

// --- 5. 許可状態の読み取り -------------------------------------------------
t('native の未知の state は unknown に丸める（勝手に denied にしない）', async () => {
  const loc = VCLocation.create({
    capacitor: nativeCap(okPlugin({ getPermission: async () => ({ state: 'なんだこれ', raw: 9 }) })),
    navigator: webNav(),
  });
  eq(await loc.getPermission(), 'unknown');
});

t('native の getPermission が失敗しても unknown で返す（throw しない）', async () => {
  const loc = VCLocation.create({
    capacitor: nativeCap(okPlugin({ getPermission: async () => { throw new Error('bridge 死亡'); } })),
    navigator: webNav(),
  });
  eq(await loc.getPermission(), 'unknown');
  ok(/bridge 死亡/.test(loc.detail() || ''), '理由は診断に残る');
});

t('native の raw を診断に出す（v16「数字を診断に出す」）', async () => {
  const loc = VCLocation.create({ capacitor: nativeCap(okPlugin()), navigator: webNav() });
  await loc.getPermission();
  eq(loc.detail(), 'native raw=4');
});

t('web で Permissions API が無い / geolocation 名に未対応 → unknown', async () => {
  const noPerms = VCLocation.create({ capacitor: null, navigator: webNav({ getCurrentPosition: () => {} }) });
  eq(await noPerms.getPermission(), 'unknown');
  const rejecting = VCLocation.create({
    capacitor: null,
    navigator: webNav({ getCurrentPosition: () => {} }, { query: async () => { throw new TypeError('geolocation 未対応'); } }),
  });
  eq(await rejecting.getPermission(), 'unknown', 'Safari/WKWebView はここに来る＝呼び出し側が実測へ落とす');
});

t('web の Permissions API が読めればその値を使う', async () => {
  const loc = VCLocation.create({
    capacitor: null,
    navigator: webNav({ getCurrentPosition: () => {} }, { query: async () => ({ state: 'prompt' }) }),
  });
  eq(await loc.getPermission(), 'prompt');
});

// --- 6. 許可を求める -------------------------------------------------------
t('native の requestPermission は state をそのまま返す', async () => {
  const loc = VCLocation.create({
    capacitor: nativeCap(okPlugin({ requestPermission: async () => ({ state: 'denied' }) })),
    navigator: webNav(),
  });
  eq(await loc.requestPermission(), 'denied');
});

t('web の requestPermission は取得成功=granted / code1=denied / その他=unknown', async () => {
  const mk = (impl) => VCLocation.create({ capacitor: null, navigator: webNav(impl) });
  eq(await mk({ getCurrentPosition: (okCb) => okCb({ coords: { latitude: 0, longitude: 0 } }) }).requestPermission(), 'granted');
  eq(await mk({ getCurrentPosition: (_o, ng) => ng({ code: 1 }) }).requestPermission(), 'denied');
  eq(await mk({ getCurrentPosition: (_o, ng) => ng({ code: 3 }) }).requestPermission(), 'unknown');
});

// --- 7. 変化の通知 ---------------------------------------------------------
t('native は permissionChange を購読する（OS 設定から戻った瞬間に効く道）', () => {
  const seen = [];
  let listened = null;
  const loc = VCLocation.create({
    capacitor: nativeCap(okPlugin({ addListener: (name, cb) => { listened = name; cb({ state: 'granted' }); } })),
    navigator: webNav(),
  });
  loc.onPermissionChange((s) => seen.push(s));
  eq(listened, 'permissionChange', 'Swift の notifyListeners と同じ名前（ズレると黙って届かない）');
  eq(seen, ['granted']);
});

t('addListener が同期 throw しても本体は死なない（v13 の実バグの形）', () => {
  const loc = VCLocation.create({
    capacitor: nativeCap(okPlugin({ addListener: () => { throw new TypeError('not a function'); } })),
    navigator: webNav(),
  });
  loc.onPermissionChange(() => {});          // ここで throw したら音声も保存も巻き込んで死ぬ
  ok(/not a function/.test(loc.nativeFailure() || ''), '理由は診断に残る');
});

t('web は PermissionStatus.onchange を張り、参照を保持する（GC で消えない v49）', async () => {
  const st = { state: 'prompt', onchange: null };
  const loc = VCLocation.create({
    capacitor: null,
    navigator: webNav({ getCurrentPosition: () => {} }, { query: async () => st }),
  });
  const seen = [];
  loc.onPermissionChange((s) => seen.push(s));
  await new Promise((r) => setTimeout(r, 0));   // query は非同期＝張られるのは次の tick
  ok(typeof st.onchange === 'function', 'onchange が張られている');
  st.state = 'granted'; st.onchange();
  eq(seen, ['granted']);
  eq(loc._webPermStatus(), st, '参照を持ち続ける（捨てると通知が来なくなる）');
});

t('コールバックが関数でなくても throw しない', () => {
  const loc = VCLocation.create({ capacitor: nativeCap(okPlugin()), navigator: webNav() });
  loc.onPermissionChange(null);
});

// --- 8. 黙って捨てない -----------------------------------------------------
// 🚨 実装の初版はここで落ちた: Number(null) も Number('') も **0** ＝ native が空を返すと
//    緯度経度 (0,0)＝ギニア湾 が「取れた位置」として黙って行に記録されていた。
t('native が数値でない座標を返したら成功にしない（v16 / 0,0 を創作しない）', async () => {
  for (const bad of [{ lat: 'あ', lng: 1 }, { lat: 1 }, {}, null,
                     { lat: null, lng: null }, { lat: '', lng: '' }, { lat: true, lng: true }]) {
    const loc = VCLocation.create({
      capacitor: nativeCap(okPlugin({ getCurrent: async () => bad })),
      navigator: webNav(),
    });
    await rejectsWith(() => loc.getCurrent(), (e) => eq(e.code, 2), JSON.stringify(bad));
  }
});

t('engine=none の getCurrent は理由の分かる reject（黙って何もしない、にしない）', async () => {
  const loc = VCLocation.create({ capacitor: null, navigator: {} });
  await rejectsWith(() => loc.getCurrent(), (e) => ok(/使えません/.test(e.message), e.message));
  eq(await loc.getPermission(), 'unknown');
  eq(await loc.requestPermission(), 'unknown');
});

t('native の座標が文字列の数字なら数値化して通す（bridge の型ゆらぎ）', async () => {
  const loc = VCLocation.create({
    capacitor: nativeCap(okPlugin({ getCurrent: async () => ({ lat: '35.5', lng: '139.5' }) })),
    navigator: webNav(),
  });
  eq(await loc.getCurrent(), { lat: 35.5, lng: 139.5 });
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); pass++; }
    catch (e) { fail++; failures.push(`✗ ${name}\n    ${e.message}`); }
  }
  console.log(`\nlocation.test: ${pass} passed, ${fail} failed`);
  if (failures.length) { console.log('\n' + failures.join('\n\n')); process.exit(1); }
})();
