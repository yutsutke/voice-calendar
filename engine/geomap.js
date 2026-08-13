// engine/geomap.js — 地図の座標計算（v81・ゆう要求「どこでつぶやいているかを地図で振り返る」）
//
// なぜ engine に置くか: **地図の数学は宿主も DOM も知らない純関数**にできる（SPEC §6）。
//   宿主（index.html）は「返された並びを img に置く」だけ＝計算の正しさはテストで固定できる。
//   ここが純粋でないと、ズレを目で確かめるしかなくなる（この環境は描画しない＝目が使えない）。
//
// 🚫 **外部の地図ライブラリを入れない**: バンドラ無し運用（<script> 直読み・window.VC* 名前空間）を
//   崩さない。必要なのは Web メルカトル図法の変換とタイルの並べ方だけで、それは下の 60 行に収まる。
//
// 用語（1行で）:
//   ・タイル = 地図を 256px 四方に切った画像。ズーム z では 2^z × 2^z 枚で世界を覆う。
//   ・ワールド座標 = ズーム z における世界全体を1枚の画像と見なした時のピクセル位置（256 * 2^z 四方）。
//   ・Web メルカトル = その並べ方の決まり。緯度は上下に引き伸ばされる（＝経度と式が違う）。
(function (global) {
  'use strict';

  const TILE = 256;
  const MIN_ZOOM = 2;   // これ以上引くと世界が画面より小さくなり、余白の扱いが煩雑になるだけ
  const MAX_ZOOM = 19;  // OpenStreetMap の標準タイルが用意している上限
  const POINT_ZOOM = 16; // 1点しか無い時の既定（建物が見える程度＝「どこで話したか」が分かる寄り）

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // 緯度経度 → 0〜1 の割合（左上が 0,0）。ズームに依らない形で持つと、ズーム変更が掛け算だけになる。
  function toFraction(lat, lng) {
    const la = clamp(Number(lat), -85.05112878, 85.05112878); // メルカトルは極で無限大＝端を切る
    const r = (la * Math.PI) / 180;
    return {
      fx: (Number(lng) + 180) / 360,
      // 端の緯度では丸め誤差で -6e-12 のような「わずかに外」が出る。**0〜1 の外は返さない**と
      // 決めておけば、これを使う側（タイル・ピン）が毎回それを気にしなくて済む。
      fy: clamp((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2, 0, 1),
    };
  }
  function fromFraction(fx, fy) {
    const n = Math.PI * (1 - 2 * fy);
    return { lat: (Math.atan(Math.sinh(n)) * 180) / Math.PI, lng: fx * 360 - 180 };
  }
  const worldSize = (z) => TILE * Math.pow(2, z);
  // 緯度経度 → そのズームでのワールド座標（ピクセル）
  function project(lat, lng, z) {
    const f = toFraction(lat, lng);
    const s = worldSize(z);
    return { x: f.fx * s, y: f.fy * s };
  }

  // 全部の点が入るズームと中心を決める（＝開いた瞬間に「自分の行動範囲」が1枚で見える）。
  // pad: 端に寄った点が縁で切れないための余白（px）。
  function fit(points, width, height, opts) {
    const pad = (opts && opts.pad) || 40;
    const pts = (points || []).filter((p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)));
    if (!pts.length) return null;                       // 点が無い＝地図を出す理由が無い（空を創作しない）
    const fs = pts.map((p) => toFraction(p.lat, p.lng));
    const fx0 = Math.min(...fs.map((f) => f.fx)), fx1 = Math.max(...fs.map((f) => f.fx));
    const fy0 = Math.min(...fs.map((f) => f.fy)), fy1 = Math.max(...fs.map((f) => f.fy));
    const center = fromFraction((fx0 + fx1) / 2, (fy0 + fy1) / 2);
    const availW = Math.max(1, width - pad * 2), availH = Math.max(1, height - pad * 2);
    let zoom = POINT_ZOOM;
    const dx = fx1 - fx0, dy = fy1 - fy0;
    if (dx > 0 || dy > 0) {
      // 2^z * TILE * d <= avail を満たす最大の z（x と y の厳しい方に合わせる）
      const zx = dx > 0 ? Math.log2(availW / (dx * TILE)) : Infinity;
      const zy = dy > 0 ? Math.log2(availH / (dy * TILE)) : Infinity;
      zoom = Math.floor(Math.min(zx, zy));
    }
    return { center, zoom: clamp(zoom, MIN_ZOOM, MAX_ZOOM) };
  }

  // 画面に必要なタイルの並び。返すのは「どの画像を、画面のどこに置くか」だけ＝宿主は考えない。
  //   center: {lat,lng} / width,height: 画面の大きさ(px)
  // 🚨 **世界の外のタイルは返さない**（y 方向）＝存在しない画像を要求して 404 を並べない（黙って壊れない）。
  //   x 方向は地球が丸いので回り込ませる（日付変更線をまたいでも切れない）。
  function tilesFor(center, zoom, width, height) {
    const z = clamp(Math.round(zoom), MIN_ZOOM, MAX_ZOOM);
    const n = Math.pow(2, z);
    const c = project(center.lat, center.lng, z);
    const left = c.x - width / 2, top = c.y - height / 2;   // 画面左上のワールド座標
    const out = [];
    const tx0 = Math.floor(left / TILE), tx1 = Math.floor((left + width - 1) / TILE);
    const ty0 = Math.floor(top / TILE), ty1 = Math.floor((top + height - 1) / TILE);
    for (let ty = ty0; ty <= ty1; ty++) {
      if (ty < 0 || ty >= n) continue;                      // 上下の外＝タイルが存在しない
      for (let tx = tx0; tx <= tx1; tx++) {
        out.push({
          x: ((tx % n) + n) % n,                            // 左右は回り込む
          y: ty,
          z,
          left: tx * TILE - left,                           // 画面上の位置
          top: ty * TILE - top,
        });
      }
    }
    return out;
  }

  // 点を画面上のどこに置くか（画面の外なら null＝置かない）。
  function pinAt(center, zoom, width, height, lat, lng) {
    const z = clamp(Math.round(zoom), MIN_ZOOM, MAX_ZOOM);
    const c = project(center.lat, center.lng, z);
    const p = project(lat, lng, z);
    const x = p.x - (c.x - width / 2);
    const y = p.y - (c.y - height / 2);
    if (x < -20 || y < -20 || x > width + 20 || y > height + 20) return null;
    return { x, y };
  }

  // 画面を dx,dy ピクセル動かした後の中心（ドラッグ）。中心を緯度経度で持ち続けるとズームしても壊れない。
  function panned(center, zoom, dx, dy) {
    const z = clamp(Math.round(zoom), MIN_ZOOM, MAX_ZOOM);
    const s = worldSize(z);
    const c = project(center.lat, center.lng, z);
    const y = clamp(c.y - dy, 0, s);                       // 上下は世界の外へ出さない
    const x = ((c.x - dx) % s + s) % s;                    // 左右は回り込む
    return fromFraction(x / s, y / s);
  }

  const api = { TILE, MIN_ZOOM, MAX_ZOOM, POINT_ZOOM, toFraction, fromFraction, project, fit, tilesFor, pinAt, panned };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.VCGeoMap = api;
})(typeof window !== 'undefined' ? window : globalThis);
