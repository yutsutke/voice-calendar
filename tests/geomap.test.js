// tests/geomap.test.js — 地図の座標計算（v81）
//
// なぜ厚めに縛るか: **この環境は描画しない**（プレビューのペインが絵を出さない）＝地図のズレは
// 目で確かめられない。純関数にしてここで固定するのが唯一の検証手段（v46 で学んだ制約への対処）。
//
// 守る不変条件:
//   1. Web メルカトルの既知の値と一致する（東京・0,0・端）
//   2. **全部の点が画面に入る**ズームを返す（1点しか無い時も破綻しない）
//   3. 存在しないタイルを要求しない（上下の外）／日付変更線で切れない（左右は回り込む）
//   4. ドラッグしてもズームしても壊れない（往復で戻る）
'use strict';

const G = require('../engine/geomap.js');

let pass = 0;
const failures = [];
function t(name, fn) {
  try { fn(); pass++; }
  catch (e) { failures.push(`✗ ${name}\n    ${e.message}`); }
}
function ok(cond, label) { if (!cond) throw new Error(label || 'false だった'); }
function near(a, b, eps, label) {
  if (!(Math.abs(a - b) <= eps)) throw new Error(`${label || ''} 期待 ${b}±${eps} / 実際 ${a}`);
}

// ===== 1. 図法そのもの =====
t('(0,0) は世界の真ん中', () => {
  const f = G.toFraction(0, 0);
  near(f.fx, 0.5, 1e-12, 'fx');
  near(f.fy, 0.5, 1e-12, 'fy');
});
t('東京駅がズーム0で既知の位置に来る', () => {
  // 東京駅 35.6812, 139.7671 → タイル座標 x≈0.888, y≈0.394（世界を1枚と見た割合）
  const f = G.toFraction(35.6812, 139.7671);
  near(f.fx, 0.8882, 1e-3, 'fx');
  near(f.fy, 0.3945, 1e-3, 'fy');
});
t('緯度経度 → 割合 → 緯度経度 で戻る', () => {
  for (const [lat, lng] of [[35.68, 139.76], [-33.87, 151.21], [64.13, -21.9], [0, 0]]) {
    const f = G.toFraction(lat, lng);
    const b = G.fromFraction(f.fx, f.fy);
    near(b.lat, lat, 1e-9, 'lat');
    near(b.lng, lng, 1e-9, 'lng');
  }
});
t('極は切り落とす（無限大にしない）', () => {
  const f = G.toFraction(90, 0);
  ok(Number.isFinite(f.fy) && f.fy >= 0 && f.fy <= 1, `北極で ${f.fy} になった`);
  ok(Number.isFinite(G.toFraction(-90, 0).fy), '南極で壊れる');
});

// ===== 2. 全部入るズームを選ぶ =====
const TOKYO = [
  { lat: 35.6812, lng: 139.7671 }, // 東京駅
  { lat: 35.6896, lng: 139.7006 }, // 新宿駅
  { lat: 35.6580, lng: 139.7016 }, // 渋谷駅
];
t('近い数点なら街の縮尺、全部が画面に入る', () => {
  const v = G.fit(TOKYO, 360, 340);
  ok(v, '結果が無い');
  ok(v.zoom >= 11 && v.zoom <= 14, `ズームが街の縮尺でない: ${v.zoom}`);
  for (const p of TOKYO) {
    const at = G.pinAt(v.center, v.zoom, 360, 340, p.lat, p.lng);
    ok(at, `点が画面の外に出た（${p.lat},${p.lng}）`);
    ok(at.x >= 0 && at.x <= 360 && at.y >= 0 && at.y <= 340, `点が縁を越えた: ${JSON.stringify(at)}`);
  }
});
t('遠く離れた2点でも両方入る（世界規模）', () => {
  const pts = [{ lat: 35.68, lng: 139.76 }, { lat: -33.87, lng: 151.21 }];
  const v = G.fit(pts, 360, 340);
  for (const p of pts) {
    const at = G.pinAt(v.center, v.zoom, 360, 340, p.lat, p.lng);
    ok(at && at.x >= 0 && at.x <= 360 && at.y >= 0 && at.y <= 340, '離れた点が入らない');
  }
});
t('1点だけなら既定の縮尺（0除算で壊れない）', () => {
  const v = G.fit([{ lat: 35.68, lng: 139.76 }], 360, 340);
  ok(v && v.zoom === G.POINT_ZOOM, `1点のズームが ${v && v.zoom}`);
  near(v.center.lat, 35.68, 1e-6, 'center.lat');
});
t('同じ場所を何度も保存しても壊れない（幅ゼロ）', () => {
  const same = [{ lat: 35.68, lng: 139.76 }, { lat: 35.68, lng: 139.76 }];
  const v = G.fit(same, 360, 340);
  ok(v && Number.isFinite(v.zoom) && v.zoom === G.POINT_ZOOM, '重なった点でズームが壊れる');
});
t('点が無ければ null（空の地図を創作しない）', () => {
  ok(G.fit([], 360, 340) === null, '空でも地図を返している');
  ok(G.fit(null, 360, 340) === null, 'null で落ちる');
  ok(G.fit([{ lat: 'x', lng: null }], 360, 340) === null, '数でない値を通している');
});
t('ズームは範囲内に収める', () => {
  const v = G.fit([{ lat: 0, lng: -179.9 }, { lat: 0, lng: 179.9 }], 100, 100);
  ok(v.zoom >= G.MIN_ZOOM && v.zoom <= G.MAX_ZOOM, `範囲外のズーム ${v.zoom}`);
});

// ===== 3. タイルの並べ方 =====
t('画面を覆うだけのタイルを返す（隙間なく・行儀よく）', () => {
  const center = { lat: 35.68, lng: 139.76 };
  const tiles = G.tilesFor(center, 12, 360, 340);
  ok(tiles.length >= 4, `タイルが少なすぎる: ${tiles.length}`);
  // 左上が画面の外（<=0）から始まり、右下が画面を越える＝隙間ができない
  ok(Math.min(...tiles.map((t) => t.left)) <= 0, '左に隙間ができる');
  ok(Math.min(...tiles.map((t) => t.top)) <= 0, '上に隙間ができる');
  ok(Math.max(...tiles.map((t) => t.left)) + 256 >= 360, '右に隙間ができる');
  ok(Math.max(...tiles.map((t) => t.top)) + 256 >= 340, '下に隙間ができる');
});
t('世界の外のタイルは要求しない（上下）', () => {
  const tiles = G.tilesFor({ lat: 85, lng: 0 }, 3, 400, 400);
  const n = Math.pow(2, 3);
  for (const t2 of tiles) ok(t2.y >= 0 && t2.y < n, `存在しないタイル y=${t2.y}`);
});
t('日付変更線をまたいでも切れない（左右は回り込む）', () => {
  const tiles = G.tilesFor({ lat: 0, lng: 179.99 }, 3, 400, 400);
  const n = Math.pow(2, 3);
  for (const t2 of tiles) ok(t2.x >= 0 && t2.x < n, `範囲外のタイル x=${t2.x}`);
  ok(tiles.some((t2) => t2.x === 0), '回り込んだ側のタイルが無い＝画面の端が空白になる');
});

// ===== 4. 動かしても壊れない =====
t('右に動かして左に戻すと元の中心に戻る', () => {
  const c0 = { lat: 35.68, lng: 139.76 };
  const c1 = G.panned(c0, 14, 120, 80);
  const c2 = G.panned(c1, 14, -120, -80);
  near(c2.lat, c0.lat, 1e-9, 'lat');
  near(c2.lng, c0.lng, 1e-9, 'lng');
});
t('上へ動かし続けても世界の外へ出ない', () => {
  let c = { lat: 80, lng: 0 };
  for (let i = 0; i < 50; i++) c = G.panned(c, 3, 0, -500);
  ok(Number.isFinite(c.lat) && c.lat <= 85.06 && c.lat >= -85.06, `緯度が壊れた: ${c.lat}`);
});
t('画面の外の点は置かない（null）', () => {
  const at = G.pinAt({ lat: 35.68, lng: 139.76 }, 16, 360, 340, -33.87, 151.21);
  ok(at === null, '画面外の点を縁に張り付けている＝嘘の位置を見せる');
});

console.log(`\ngeomap.test: ${pass} passed, ${failures.length} failed`);
if (failures.length) { console.log('\n' + failures.join('\n\n')); process.exit(1); }
