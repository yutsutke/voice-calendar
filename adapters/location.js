// adapters/location.js — 位置情報の許可状態と座標（v52）
//
// 🔴 なぜ native で navigator.geolocation を使ってはいけないか（実機FB第33回・2026-07-22）:
//   ゆうの観察＝「OS の位置情報をオフにしてアプリを開く → 録音 → 案内バナーが出る →
//   **OS 設定でオンに戻してアプリへ戻る** → **バナーは出たまま・位置も付かない**。
//   **アプリを開き直すと保存される**」。
//   ＝ WKWebView（WebContent プロセス）は位置情報の許可状態を**プロセス内に握っていて**、
//   OS 側の変更を見に行かない。だから JS から何度聞き直しても古い答えしか返らない。
//   v49 は visibilitychange で聞き直す配線を足したが、**聞く相手が古いままだった**
//   ＝ v50 の 60 秒キャッシュ撤去（オフ方向）と対になる、オン方向の同じ病気。
//   → **許可状態も座標も CLLocationManager（Swift）から取る**。CLLocationManager は常に今の
//     状態を返し、`locationManagerDidChangeAuthorization` で**変わった瞬間**も教えてくれる
//     ＝ v49 が web の PermissionStatus.onchange でやりたかったことが native で本当に効く。
//   ※ web（GitHub Pages）は従来どおり navigator.geolocation ＝ 挙動は1ミリも変えない。
//
// 層の位置づけ（SPEC §6）: 宿主固有（Capacitor / ブラウザ）を知ってよいのは adapters だけ。
//   engine は位置情報を知らない。index.html は「どちらの経路か」を知らずに同じ API を呼ぶ。
//
// 🚨 何があっても throw しない（v13）: 補助機能（位置）の失敗が本体（フォーム・保存）を殺さない。
//   失敗理由は nativeFailure() に残して診断に出す＝**黙って消えない**（v16）。
(function (global) {
  'use strict';

  // 🔴 バンドラ無し運用でのプラグイン取得（v13 の実バグ・詳細は input/transcriber.js 冒頭）:
  // native が注入するのは Capacitor.Plugins.<jsName>。registerPlugin は @capacitor/core の
  // API ＝バンドラ前提でここには無い。Plugins.X が本命・registerPlugin は「あれば使う」保険。
  function nativePlugin(C, name) {
    if (!C) return null;
    if (C.Plugins && C.Plugins[name]) return C.Plugins[name];
    if (typeof C.registerPlugin === 'function') return C.registerPlugin(name);
    return null;
  }

  // v50: maximumAge は **0**（キャッシュを許すと「OS でオフにしたのに 60 秒は記録され続ける」）。
  // timeout は Swift 側の打ち切りとも揃える＝どちらの経路でも待たされる上限が同じ。
  const GEO_OPTS = { enableHighAccuracy: false, timeout: 8000, maximumAge: 0 };

  const STATES = ['granted', 'denied', 'prompt'];
  function normState(s) { return STATES.indexOf(s) >= 0 ? s : 'unknown'; }

  // bridge から来た値を数にする。**Number() を素で使わない**: Number(null) も Number('') も 0 ＝
  // native が空を返した時に「緯度経度 0,0（ギニア湾）」を**創作して黙って記録**してしまう
  // （テストが実際に捕まえた。v16「黙って捨てない」の裏面＝黙って作らない）。
  function num(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v);
      return Number.isFinite(n) ? n : NaN;   // bridge が文字列で寄越す型ゆらぎだけ許す
    }
    return NaN;
  }

  function locErr(message, code, permission) {
    const e = new Error(message);
    e.code = code;              // web の GeolocationPositionError と同じ番号（1=拒否 2=不能 3=時間切れ）
    if (permission) e.permission = permission;
    return e;
  }

  // Swift が call.reject(msg, code) で付ける code → 共通の形へ。
  // 🔑 native は **prompt（まだ答えていない）と denied（拒否）を区別できる**＝web の code 1 より正確。
  //    バナーは denied の時だけ出す＝「まだ聞いていない人」を拒否扱いして脅かさない。
  const NATIVE_CODE = {
    denied: { code: 1, permission: 'denied' },
    prompt: { code: 1, permission: 'prompt' },
    timeout: { code: 3 },
    unavailable: { code: 2 },
  };

  function createLocation(env) {
    env = env || {};
    const C = ('capacitor' in env) ? env.capacitor : global.Capacitor;
    const nav = ('navigator' in env) ? env.navigator
      : (typeof navigator !== 'undefined' ? navigator : null);
    const geo = nav && nav.geolocation;
    const perms = nav && nav.permissions;

    let plugin = null;
    let failure = null;
    if (C && C.isNativePlatform && C.isNativePlatform()) {
      try {
        plugin = nativePlugin(C, 'DeviceLocation');
        if (!plugin) failure = 'DeviceLocation プラグインが native に登録されていません';
      } catch (e) {
        plugin = null;                                  // 取得で throw しても本体は生かす（v13）
        failure = (e && e.message) || String(e);
      }
    }
    // native で取れなければ web の geolocation へ落ちる（何も無いよりは動く）。
    // ただし落ちた事実は診断に出す＝「native なのに web 経路」を黙って続けない。
    const engine = plugin ? 'native' : (geo ? 'web' : 'none');

    // 診断に出す生の値（v16「数字を診断に出す」）＝次に同じ疑いが出た時、推測でなく数字で判定できる。
    // native は CLAuthorizationStatus の raw（0=未決定 2=拒否 3=常に 4=使用中）。
    let detail = null;

    function getPermission() {
      if (engine === 'native') {
        return Promise.resolve().then(() => plugin.getPermission())
          .then((r) => {
            detail = `native raw=${r && r.raw}`;
            return normState(r && r.state);
          })
          .catch((e) => { detail = `native 失敗: ${(e && e.message) || e}`; return 'unknown'; });
      }
      if (engine === 'web') {
        if (!(perms && perms.query)) { detail = 'web Permissions API 無し'; return Promise.resolve('unknown'); }
        return Promise.resolve().then(() => perms.query({ name: 'geolocation' }))
          .then((st) => { detail = 'web permissions'; return normState(st && st.state); })
          // geolocation 名に未対応の環境（Safari/WKWebView 等）＝状態は読めない
          .catch(() => { detail = 'web permissions は geolocation 非対応'; return 'unknown'; });
      }
      return Promise.resolve('unknown');
    }

    function getCurrent() {
      if (engine === 'native') {
        return Promise.resolve().then(() => plugin.getCurrent()).then((r) => {
          const lat = r ? num(r.lat) : NaN, lng = r ? num(r.lng) : NaN;
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            throw locErr('位置の値が読めませんでした', 2);  // 黙って捨てない（v16）
          }
          return { lat, lng };
        }).catch((e) => {
          if (e && typeof e.code === 'number') throw e;      // 上で作った形はそのまま通す
          const m = NATIVE_CODE[e && e.code] || { code: 2 };
          throw locErr((e && e.message) || '位置情報を取得できませんでした', m.code, m.permission);
        });
      }
      if (engine === 'web') {
        return new Promise((resolve, reject) => {
          geo.getCurrentPosition(
            (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
            (err) => reject(locErr(
              (err && err.message) || '位置情報を取得できませんでした',
              (err && err.code) || 2,
              (err && err.code) === 1 ? 'denied' : null)),
            GEO_OPTS
          );
        });
      }
      return Promise.reject(locErr('この環境では位置情報を使えません', 2));
    }

    // 設定をオンにした瞬間に一度だけ聞く（v38）＝原因と結果が目の前で繋がる。
    // native は「許可だけ」を求められる。web にはその API が無いので一度取りに行く（＝ダイアログの引き金）。
    function requestPermission() {
      if (engine === 'native') {
        return Promise.resolve().then(() => plugin.requestPermission())
          .then((r) => normState(r && r.state))
          .catch(() => 'unknown');
      }
      if (engine === 'web') {
        return getCurrent().then(
          () => 'granted',
          (e) => (e && e.permission === 'denied') ? 'denied' : 'unknown'
        );
      }
      return Promise.resolve('unknown');
    }

    // 🔑 v52 の肝: OS 設定で許可が変わった**瞬間**に知らせる。
    // native = CLLocationManager の delegate（プロセスを跨いで正確）／web = PermissionStatus.onchange。
    let webPermStatus = null;   // GC されると onchange が来ない＝参照を持ち続ける（v49）
    function onPermissionChange(cb) {
      if (typeof cb !== 'function') return;
      if (engine === 'native') {
        // v13: 未登録プラグインの proxy は addListener で同期的に throw することがある
        try { plugin.addListener('permissionChange', (d) => cb(normState(d && d.state))); }
        catch (e) { failure = failure || (e && e.message) || String(e); }
        return;
      }
      if (engine === 'web' && perms && perms.query) {
        Promise.resolve().then(() => perms.query({ name: 'geolocation' })).then((st) => {
          webPermStatus = st;
          st.onchange = () => cb(normState(st.state));
        }).catch(() => { /* 未対応環境では変化を拾えない＝バナー表示中の実測で補う */ });
      }
    }

    return {
      engine,                                  // 'native' | 'web' | 'none'
      nativeFailure: () => failure,            // 診断に出す（native なのに web に落ちた理由）
      detail: () => detail,                    // 直近に許可状態を読んだ経路と生値
      getPermission, getCurrent, requestPermission, onPermissionChange,
      _webPermStatus: () => webPermStatus,     // テスト用（参照が保たれているか）
    };
  }

  const api = { create: createLocation, GEO_OPTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.VCLocation = api;
})(typeof window !== 'undefined' ? window : globalThis);
