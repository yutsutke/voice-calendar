// tests/batch.test.js — まとめて入力（v39: 契約＋検証ゲート＋取り込みリスト）の単体テスト
//
// 守る不変条件:
//   1. **契約と実装の鏡合わせ**: contract.js の events.items.properties = schema.js の FIELDS + ambiguities + quotes、
//      quotes.properties = FIELDS・maxItems = MAX_EVENTS（契約だけ直して検証が古い、を機械的に禁止する）
//   2. **AI の出力を信用しない**: 不正値は落として problems に明記（黙って捨てない v16）・
//      「それらしく直す」creation はしない（整形は値の意味を変えない範囲だけ・やったら明記）
//   3. 過去日付を弾かない（過去も一級市民＝v5）
//   4. 21件超は先頭20＋警告（silent truncation にしない）
//   5. toSnapshot は store.restore と噛み合う（allDay は === true の時だけ「入っている」＝
//      schema.js の isEmptyVal と鏡。false に origin を付けると無内容の掃除表示が出る）
//   6. staging: 読みは縮退・書きは throw（records/dict と同じ）
//   7. 不可視文字（v14）で JSON.parse が落ちない・集合は parser.normalize と鏡合わせ
'use strict';

const mem = new Map();
let failNextSet = false;
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => {
    if (failNextSet) { failNextSet = false; throw new Error('容量超過（模擬）'); }
    mem.set(k, String(v));
  },
  removeItem: (k) => mem.delete(k),
};

const B = require('../engine/batch.js');
const C = require('../engine/contract.js');
const { FIELDS, createDraftStore } = require('../engine/schema.js');
const P = require('../engine/parser.js');

let pass = 0, fail = 0;
const failures = [];
function t(name, fn) {
  mem.clear();
  failNextSet = false;
  try { fn(); pass++; }
  catch (e) { fail++; failures.push(`✗ ${name}\n    ${e.message}`); }
}
function eq(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label || ''} 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`);
  }
}
function ok(cond, label) { if (!cond) throw new Error(label || 'false だった'); }

// ===== 不変条件1: 契約と実装の鏡合わせ =====
t('契約のイベント欄 = schema.js の FIELDS + ambiguities + quotes（鏡合わせ）', () => {
  const props = Object.keys(C.SCHEMA.properties.events.items.properties);
  eq([...props].sort(), [...FIELDS, 'ambiguities', 'quotes'].sort(), '欄を増やす時は contract.js と schema.js の両方を見る');
  // v56: quotes の中身も FIELDS と鏡合わせ＝欄を増やした時に「引用先だけ増やし忘れる」を機械的に禁止
  eq(Object.keys(C.SCHEMA.properties.events.items.properties.quotes.properties).sort(), [...FIELDS].sort(), 'quotes.properties = FIELDS');
});

t('契約の maxItems = batch.js の MAX_EVENTS', () => {
  eq(C.SCHEMA.properties.events.maxItems, B.MAX_EVENTS);
  eq(B.MAX_EVENTS, 20);
});

t('契約に日本語の「創作しない」制約が書いてある（description がそのままプロンプトになる）', () => {
  const s = JSON.stringify(C.SCHEMA);
  ok(s.includes('推測で補わない'), '省略の指示');
  ok(s.includes('ambiguities'), '曖昧の申告先');
  // 🔴 v58（実機FB第34回）: ambiguities は「**値についての不確かさ**」だけの籠。
  // 「言っていないので省いた」まで申告させると、日時を言わない発話で AI だけが申告し、
  // ルール経路は黙る場面で自動保存が止まる＝経路差だけの不便が生まれる（index.html の門と対）。
  const amb = C.SCHEMA.properties.events.items.properties.ambiguities.description;
  ok(amb.includes('省略した項目については書かない'), '省略は申告事項ではない、と契約に書いてある');
  ok(B.buildPrompt({ now: new Date(2026, 6, 22, 12, 0), schema: C.SCHEMA }).includes('省略したこと自体を ambiguities に書かない'),
    'プロンプト側にも同じ指示がある');
  ok(typeof C.VERSION === 'string' && C.VERSION.length > 0, 'VERSION がある');
});

// ===== parseBatch: 入力の形 =====
t('オブジェクト直渡し → ok・draft は FIELDS 形（欠損キーは既定で埋まる）', () => {
  const r = B.parseBatch({ events: [{ title: '会議', startDate: '2026-07-20', startTime: '10:00' }] });
  eq(r.ok, true);
  eq(r.events.length, 1);
  const d = r.events[0].draft;
  eq(Object.keys(d).sort(), [...FIELDS].sort(), 'draft のキーは FIELDS と一致');
  eq(d.title, '会議');
  eq(d.startDate, '2026-07-20');
  eq(d.startTime, '10:00');
  eq(d.endDate, '');
  eq(d.allDay, false);
  eq(r.events[0].problems, []);
});

t('素の JSON 文字列 → ok', () => {
  const r = B.parseBatch('{"events":[{"title":"会議"}]}');
  eq(r.ok, true);
  eq(r.events[0].draft.title, '会議');
});

t('```json フェンス付き → 中身を取り出して ok', () => {
  const r = B.parseBatch('```json\n{"events":[{"title":"会議"}]}\n```');
  eq(r.ok, true);
  eq(r.events[0].draft.title, '会議');
});

t('前後に散文が付いていても最初の JSON を拾う', () => {
  const r = B.parseBatch('以下が結果です。\n{"events":[{"title":"会議"}]}\n以上です。');
  eq(r.ok, true);
  eq(r.events[0].draft.title, '会議');
});

t('素の配列 [...] も events として受ける（AI が封筒を省くことがある）', () => {
  const r = B.parseBatch('[{"title":"会議"},{"title":"歯医者"}]');
  eq(r.ok, true);
  eq(r.events.length, 2);
});

t('sourceText 付きの封筒も ok（契約どおり）', () => {
  const r = B.parseBatch({ events: [{ title: '会議' }], sourceText: '明日の会議…' });
  eq(r.ok, true);
});

t('壊れた JSON → ok:false・手掛かりのあるエラー文', () => {
  const r = B.parseBatch('{"events": [');
  eq(r.ok, false);
  ok(r.errors.length > 0);
  ok(r.errors[0].includes('途中で切れていないか'), `手掛かり付き: ${r.errors[0]}`);
});

t('events 欠損 / 空 / オブジェクトでない → ok:false の日本語エラー', () => {
  eq(B.parseBatch({ foo: 1 }).ok, false);
  ok(B.parseBatch({ foo: 1 }).errors[0].includes('events'), 'events が無いと言う');
  eq(B.parseBatch({ events: [] }).ok, false);
  eq(B.parseBatch('5').ok, false);
});

// ===== 不変条件7: 不可視文字（v14）＝ parser.normalize と鏡合わせ =====
t('不可視文字が JSON の構造位置に混ざっても落ちない・集合は parser.normalize と一致', () => {
  // \u エスケープをソースに書くと出力経路で生文字に化ける（v36 で実際に踏んだ）＝コードから構築
  const chars = [0x200B, 0x200F, 0x2060, 0x2064, 0x2066, 0x2069, 0xFEFF].map((c) => String.fromCharCode(c));
  for (const ch of chars) {
    const code = 'U+' + ch.charCodeAt(0).toString(16).toUpperCase();
    eq(P.normalize('a' + ch + 'b'), 'ab', `parser.normalize が ${code} を除去（鏡合わせ）`);
    const r = B.parseBatch('{' + ch + '"events":[{"title":"x"}]}');
    eq(r.ok, true, `batch が ${code} で落ちない`);
  }
});

// ===== 不変条件4: 21件超は先頭20＋警告 =====
t('21件 → 先頭20件＋dropped=1＋警告（黙って切り捨てない）', () => {
  const evs = Array.from({ length: 21 }, (_, i) => ({ title: `予定${i + 1}` }));
  const r = B.parseBatch({ events: evs });
  eq(r.ok, true);
  eq(r.events.length, 20);
  eq(r.dropped, 1);
  ok(r.warnings.some((w) => w.includes('21件目以降の1件は取り込みません')), `警告: ${r.warnings}`);
  eq(r.events[19].draft.title, '予定20', '先頭20件が順序どおり残る');
});

// ===== 不変条件2: 不正値は落として明記 =====
t('未知の項目 → 落として problems に明記', () => {
  const r = B.parseBatch({ events: [{ title: '会議', priority: '高' }] });
  eq(r.ok, true);
  ok(r.events[0].problems.some((p) => p.includes('未知の項目「priority」')), `${r.events[0].problems}`);
});

t('存在しない日付（2/30）→ 空にして明記（創作しない）', () => {
  const r = B.parseBatch({ events: [{ title: 'x', startDate: '2026-02-30' }] });
  eq(r.events[0].draft.startDate, '');
  ok(r.events[0].problems.some((p) => p.includes('存在しない日付')), `${r.events[0].problems}`);
});

t('形式違いの日付（スラッシュ区切り）→ 空にして明記', () => {
  const r = B.parseBatch({ events: [{ title: 'x', startDate: '2026/07/20' }] });
  eq(r.events[0].draft.startDate, '');
  ok(r.events[0].problems.some((p) => p.includes('YYYY-MM-DD として読めない')), `${r.events[0].problems}`);
});

t('ゼロ埋め欠け（2026-7-5 / 9:5）→ 整形して「読み替えた」と明記（意味は変えない）', () => {
  const r = B.parseBatch({ events: [{ title: 'x', startDate: '2026-7-5', startTime: '9:5' }] });
  eq(r.events[0].draft.startDate, '2026-07-05');
  eq(r.events[0].draft.startTime, '09:05');
  ok(r.events[0].problems.some((p) => p.includes('「2026-7-5」を「2026-07-05」として読みました')), `${r.events[0].problems}`);
  ok(r.events[0].problems.some((p) => p.includes('「9:5」を「09:05」として読みました')), `${r.events[0].problems}`);
});

t('全角数字の日付・時刻 → 半角に整形して明記（値だけ・title は触らない）', () => {
  const r = B.parseBatch({ events: [{ title: '１０時の会議', startDate: '２０２６－０７－２０', startTime: '１０：００' }] });
  eq(r.events[0].draft.startDate, '2026-07-20');
  eq(r.events[0].draft.startTime, '10:00');
  eq(r.events[0].draft.title, '１０時の会議', 'title の全角は改変しない（人・AI が書いた内容）');
});

t('時刻の範囲外（25:00）→ 空にして明記', () => {
  const r = B.parseBatch({ events: [{ title: 'x', startTime: '25:00' }] });
  eq(r.events[0].draft.startTime, '');
  ok(r.events[0].problems.some((p) => p.includes('範囲外')), `${r.events[0].problems}`);
});

t('型違い（title が数値・allDay が文字列）→ 落として明記', () => {
  const r = B.parseBatch({ events: [{ title: 123, allDay: 'true', startDate: '2026-07-20' }] });
  eq(r.events[0].draft.title, '');
  eq(r.events[0].draft.allDay, false, '"true"（文字列）を true に解釈しない');
  ok(r.events[0].problems.some((p) => p.includes('title が文字列でない')), `${r.events[0].problems}`);
  ok(r.events[0].problems.some((p) => p.includes('allDay が true/false でない')), `${r.events[0].problems}`);
});

t('ambiguities: 文字列だけ拾う・一覧でなければ無視を明記', () => {
  const r = B.parseBatch({ events: [
    { title: 'a', ambiguities: ['17時か17時半か曖昧', 42, '  '] },
    { title: 'b', ambiguities: '曖昧' },
  ] });
  eq(r.events[0].ambiguities, ['17時か17時半か曖昧'], '文字列以外・空白だけは落とす');
  ok(r.events[1].problems.some((p) => p.includes('ambiguities が一覧でない')), `${r.events[1].problems}`);
});

t('内容が空のイベント → 除外して封筒側の警告に明記（カードが無いので）', () => {
  const r = B.parseBatch({ events: [{ title: '会議' }, {}] });
  eq(r.ok, true);
  eq(r.events.length, 1);
  ok(r.warnings.some((w) => w.includes('2件目') && w.includes('内容が空')), `${r.warnings}`);
});

t('全イベントが空 → ok:false（理由を全部言う）', () => {
  const r = B.parseBatch({ events: [{}, { foo: 1 }] });
  eq(r.ok, false);
  ok(r.errors.some((e) => e.includes('取り込める予定がありませんでした')));
});

// ===== 不変条件3: 過去も一級市民（v5） =====
t('過去日付を弾かない（実績も声・文章で入れる用途が実在する）', () => {
  const r = B.parseBatch({ events: [{ title: '打ち合わせだった', startDate: '2020-01-01' }] });
  eq(r.ok, true);
  eq(r.events[0].draft.startDate, '2020-01-01');
  eq(r.events[0].problems, []);
});

t('allDay:true と startTime の併記は両方保持（どちらを勝たせるかは materialize の仕事）', () => {
  const r = B.parseBatch({ events: [{ title: 'x', allDay: true, startTime: '10:00' }] });
  eq(r.events[0].draft.allDay, true);
  eq(r.events[0].draft.startTime, '10:00');
});

// ===== buildPrompt =====
t('buildPrompt: スキーマ現物・現在日時（曜日つき）・守ることが入る', () => {
  const p = B.buildPrompt({ now: new Date(2026, 6, 19, 18, 30), schema: C.SCHEMA });
  ok(p.includes('2026-07-19'), '現在日付');
  ok(p.includes('日曜日'), '曜日（相対表現の解決に必須）');
  ok(p.includes('18:30'), '現在時刻');
  ok(p.includes('JSON のみ'), 'JSON だけ返す指示');
  ok(p.includes('創作しない'), '創作禁止');
  ok(p.includes('ambiguities'), '曖昧の申告先');
  ok(p.includes(`最大${B.MAX_EVENTS}件`), '上限');
  ok(p.includes('"events"'), 'スキーマ現物の埋め込み（二重管理ゼロ）');
});

// ===== 不変条件5: toSnapshot は store.restore と噛み合う =====
t('toSnapshot: 非空欄だけ confirmed/voice・allDay は === true の時だけ', () => {
  const s = B.toSnapshot({ title: '会議', startDate: '2026-07-20', allDay: false });
  eq(s.fieldState.title, 'confirmed');
  eq(s.origin.title, 'voice');
  eq(s.fieldState.startDate, 'confirmed');
  eq(s.fieldState.location, 'empty');
  eq(s.origin.location, null);
  eq(s.fieldState.allDay, 'empty', 'allDay=false は「入っていない」');
  eq(s.origin.allDay, null);
  const s2 = B.toSnapshot({ title: 'x', allDay: true });
  eq(s2.fieldState.allDay, 'confirmed');
});

t('store.restore(toSnapshot(...)) が壊れない・言い直し掃除（v6）が正しく効く', () => {
  const store = createDraftStore();
  ok(store.restore(B.toSnapshot({ title: '会議', startDate: '2026-07-20', location: '丸の内' })), 'restore 成功');
  eq(store.get().title, '会議');
  eq(store.get().startDate, '2026-07-20');
  eq(store.getFieldState('title'), 'confirmed');
  // 次の素の発話 → 取り込み由来の欄（origin=voice）は言い直しとして掃除される
  const a = store.applyVoicePatch({ title: '歯医者' }, '歯医者', {});
  ok(a.cleared.includes('startDate'), '前回（取り込み）の startDate が掃除される');
  ok(a.cleared.includes('location'), '前回（取り込み）の location が掃除される');
  ok(!a.cleared.includes('allDay'), 'allDay=false は掃除の対象にならない（無内容の掃除表示を出さない）');
  eq(store.get().title, '歯医者');
  eq(store.get().startDate, '');
});

// ===== 不変条件6: staging（読みは縮退・書きは throw） =====
t('stageAdd → stageList の往復・id はユニーク・draft は既定で補完', () => {
  const added = B.stageAdd([
    { draft: { title: '会議', startDate: '2026-07-20' }, ambiguities: ['a'], problems: [] },
    { draft: { title: '歯医者' } },
  ], new Date(1770000000000));
  eq(added.length, 2);
  ok(added[0].id !== added[1].id, 'id がユニーク');
  eq(added[0].addedAt, 1770000000000);
  const list = B.stageList();
  eq(list.length, 2);
  eq(list[0].draft.title, '会議');
  eq(list[0].draft.endDate, '', '欠損キーは既定で埋まる');
  eq(list[0].ambiguities, ['a']);
  eq(list[1].ambiguities, [], 'ambiguities 欠損は空配列');
});

t('壊れた保存値 → 読める行だけで動く（読みは縮退）', () => {
  mem.set(B.KEY, '{oops');
  eq(B.stageList(), [], 'JSON 破損 → 空');
  mem.set(B.KEY, JSON.stringify([{ id: 'a', draft: { title: 'x' } }, { nope: 1 }, null]));
  const list = B.stageList();
  eq(list.length, 1, '壊れた行は読み飛ばす');
  eq(list[0].draft.title, 'x');
});

t('書き込み失敗は throw（「取り込んだつもり」を作らない）', () => {
  failNextSet = true;
  let threw = false;
  try { B.stageAdd([{ draft: { title: 'x' } }], 1770000000000); } catch { threw = true; }
  ok(threw, 'stageAdd が投げる');
});

t('stageRemove / stageClear', () => {
  const added = B.stageAdd([{ draft: { title: 'a' } }, { draft: { title: 'b' } }], 1770000000000);
  B.stageRemove(added[0].id);
  const list = B.stageList();
  eq(list.length, 1);
  eq(list[0].draft.title, 'b');
  B.stageClear();
  eq(B.stageList(), []);
});

// ===== draftToPatch（v42: 音声AI経路 → applyVoicePatch の patch） =====
t('draftToPatch: 非空欄だけキーに載る（言っていない欄に触れない）', () => {
  const p = B.draftToPatch({ title: '会議', startDate: '2026-07-20', startTime: '', location: '' });
  eq(p, { title: '会議', startDate: '2026-07-20' }, '空文字の欄はキーごと省く');
});

t('draftToPatch: allDay は === true の時だけ載る（toSnapshot と鏡）', () => {
  eq('allDay' in B.draftToPatch({ title: 'x', allDay: false }), false, 'false は「言っていない」');
  eq(B.draftToPatch({ title: 'x', allDay: true }).allDay, true);
});

t('draftToPatch: 空 draft → {}（applyVoicePatch に渡しても何も起きない形）', () => {
  eq(B.draftToPatch({}), {});
  eq(B.draftToPatch(null), {});
});

// ===== ambiguityNote（v43）: AI の曖昧をメモ欄に残す。**機械の注記が人の文章を潰さない** =====
t('ambiguityNote: 空のメモには ⚠ で積む（保存後も「夕方あたり と言った」が残る）', () => {
  const p = B.ambiguityNote({ title: '打ち合わせ' }, ['「夕方あたり」は時刻が不明', '終了時刻が無い'], '');
  eq(p.note, '⚠「夕方あたり」は時刻が不明\n⚠終了時刻が無い');
  eq(p.title, '打ち合わせ', '他の欄は素通し');
});

t('🚨 ambiguityNote: 手で書いたメモは潰さない（E2E で実際に潰した回帰）', () => {
  const p = B.ambiguityNote({ title: '打ち合わせ' }, ['夕方あたりが曖昧'], '手で書いたメモ');
  eq('note' in p, false, 'note をキーに載せない＝applyVoicePatch が触れない＝掃除もされない');
  eq(p.title, '打ち合わせ');
});

t('ambiguityNote: AI 自身の note には後ろに積む（どちらもこの発話の産物）', () => {
  const p = B.ambiguityNote({ note: '保険証を持参' }, ['時刻が曖昧'], '');
  eq(p.note, '保険証を持参\n⚠時刻が曖昧');
  // 人のメモが在っても、AI が note を返したなら従来どおり上書き（v42 の挙動を変えない）
  eq(B.ambiguityNote({ note: 'AIメモ' }, ['x'], '人のメモ').note, 'AIメモ\n⚠x');
});

t('ambiguityNote: 曖昧が無ければ patch を変えない（既定の体験を1ミリも変えない）', () => {
  const base = { title: 'a' };
  eq(B.ambiguityNote(base, [], ''), base);
  eq(B.ambiguityNote(base, null, ''), base);
  eq(B.ambiguityNote(base, ['  ', 42], ''), base, '空白だけ・文字列以外は曖昧として数えない');
});

t('ambiguityNote: 引数の patch を書き換えない（純関数＝呼び手の値が変わらない）', () => {
  const base = { title: 'a' };
  B.ambiguityNote(base, ['x'], '');
  eq('note' in base, false, '元の patch は無傷');
});

// ===== registerWebMcp（v41）: 登録は throw しない・execute は保存しない =====
t('WebMCP: modelContext が無ければ unsupported（絶対 throw しない）', () => {
  eq(B.registerWebMcp(undefined, { schema: C.SCHEMA }), 'unsupported');
  eq(B.registerWebMcp({}, { schema: C.SCHEMA }), 'unsupported');
  eq(B.registerWebMcp({ modelContext: {} }, { schema: C.SCHEMA }), 'unsupported', 'registerTool が無い形');
});

t('WebMCP: registerTool に name/description/inputSchema=契約の現物 が渡る', () => {
  let tool = null;
  const nav = { modelContext: { registerTool: (t2) => { tool = t2; } } };
  eq(B.registerWebMcp(nav, { schema: C.SCHEMA }), 'registered');
  eq(tool.name, 'create_events');
  ok(tool.description.includes('直接保存されず'), '確認リスト経由を説明に明記（エージェントにも約束を教える）');
  ok(tool.inputSchema === C.SCHEMA, '契約の現物（コピーでなく同一オブジェクト＝二重管理ゼロ）');
  ok(typeof tool.execute === 'function');
});

t('WebMCP execute: 検証ゲート → onEvents に積むだけ＝保存しない', () => {
  let tool = null;
  const got = [];
  B.registerWebMcp({ modelContext: { registerTool: (t2) => { tool = t2; } } }, {
    schema: C.SCHEMA,
    onEvents: (events) => { got.push(...events); return events; },
  });
  const res = tool.execute({ events: [{ title: '外から来た予定', startDate: '2026-07-25' }] });
  eq(got.length, 1);
  eq(got[0].draft.title, '外から来た予定');
  ok(res.content[0].text.includes('1件を取り込みリストに入れました'), `${res.content[0].text}`);
  ok(res.content[0].text.includes('人が確認してから'), '保存しない約束を返事にも書く');
  ok(!res.isError);
  eq(mem.has(B.KEY), false, 'onEvents 注入時は staging へ直接書かない（宿主が制御）');
});

t('WebMCP execute: 不正な入力は isError で返す（throw しない）・onEvents は呼ばれない', () => {
  let tool = null;
  let called = 0;
  B.registerWebMcp({ modelContext: { registerTool: (t2) => { tool = t2; } } }, {
    schema: C.SCHEMA,
    onEvents: () => { called++; },
  });
  const res = tool.execute({ foo: 1 });
  eq(res.isError, true);
  ok(res.content[0].text.includes('取り込めませんでした'));
  eq(called, 0);
});

t('WebMCP: registerTool 自体が throw しても registerWebMcp は error 文字列を返すだけ', () => {
  const r = B.registerWebMcp({ modelContext: { registerTool: () => { throw new Error('壊れた実装'); } } }, { schema: C.SCHEMA });
  ok(String(r).startsWith('error: '), `${r}`);
  ok(String(r).includes('壊れた実装'));
});

t('WebMCP: onEvents 未指定なら既定で staging に積む', () => {
  let tool = null;
  B.registerWebMcp({ modelContext: { registerTool: (t2) => { tool = t2; } } }, { schema: C.SCHEMA });
  const res = tool.execute({ events: [{ title: 'そのまま staging へ' }] });
  ok(!res.isError);
  eq(B.stageList().length, 1);
  eq(B.stageList()[0].draft.title, 'そのまま staging へ');
});

// ===== v53: 自動保存してよい取り込みを選ぶ（pickAutoSavable）=====
// 「まとめて入力の自動保存」をオンにした時、**どれを人の目に残すか**の判断はここだけが持つ。
// 保存は不可逆（カレンダーは読めない＝消せない）＝迷ったら保存しない（v28）。
const entry = (over) => Object.assign({ id: 'x', draft: { title: 'a' }, ambiguities: [], problems: [] }, over || {});

t('v53: 申告も問題も無い取り込みは自動保存の対象', () => {
  const r = B.pickAutoSavable([entry({ id: '1' }), entry({ id: '2' })], []);
  eq(r.save.map((e) => e.id), ['1', '2']);
  eq(r.hold.length, 0);
});

t('v53: AI が曖昧だと申告したカードは残す（v43/v48 の安全弁と同じ門）', () => {
  const r = B.pickAutoSavable([entry({ id: '1' }), entry({ id: '2', ambiguities: ['夕方あたり'] })], []);
  eq(r.save.map((e) => e.id), ['1'], '曖昧でないものは保存してよい（全部止めない）');
  eq(r.hold.map((e) => e.id), ['2']);
});

t('v53: 検証ゲートが項目を無視したカード（problems）も残す', () => {
  const r = B.pickAutoSavable([entry({ id: '1', problems: ['未知の項目「foo」を無視しました'] })], []);
  eq(r.save.length, 0);
  eq(r.hold.map((e) => e.id), ['1']);
});

t('🚨 v53: 封筒に warnings がある回は**まるごと**人が見る（信用の単位は「回」）', () => {
  // 落とした行があるということは、その応答自体が契約から外れている＝生き残った行も同じ応答から出ている
  const r = B.pickAutoSavable([entry({ id: '1' }), entry({ id: '2' })], ['3件目: 内容が空のため除外しました']);
  eq(r.save.length, 0, '1件も自動保存しない');
  eq(r.hold.map((e) => e.id), ['1', '2']);
});

t('v53: 20件超の切り捨ても warnings ＝まるごと保留（parseBatch と繋がっていることの確認）', () => {
  const many = { events: Array.from({ length: 25 }, (_, i) => ({ title: `件${i}` })) };
  const p = B.parseBatch(many);
  ok(p.ok && p.warnings.length, '切り捨ての warning が出ている');
  eq(B.pickAutoSavable(p.events, p.warnings).save.length, 0);
});

t('v53: 空・null・壊れた入力でも throw しない（黙って落ちない）', () => {
  eq(B.pickAutoSavable([], []).save.length, 0);
  eq(B.pickAutoSavable(null, null).save.length, 0);
  eq(B.pickAutoSavable([null, undefined, entry({ id: '1' })], undefined).save.map((e) => e.id), ['1']);
  eq(B.pickAutoSavable([{ id: '2' }], []).save.map((e) => e.id), ['2'], 'ambiguities/problems が無い形も素通しできる');
});

t('v53: pickAutoSavable は staging を読まない（純関数＝渡されたものだけ見る）', () => {
  B.stageAdd([{ title: '台帳に居る予定' }]);
  const r = B.pickAutoSavable([entry({ id: '1' })], []);
  eq(r.save.map((e) => e.id), ['1'], '前から残っているカードを巻き込まない＝人が意図的に残したものに触らない');
  eq(B.stageList().length, 1, '台帳は変えない');
});

// ===== v56: quote → 出所（スパン出所追跡 A''）=====
// ルール経路（parser v55）と鏡: あちらは span から quote を作る、こちらは quote を本文の indexOf で検証する。
t('v56: quote が本文で見つかる → transcript（span は本文のオフセット・quote と一致）', () => {
  const srcText = '明日の10時に会議、場所は本社ビル';
  const r = B.parseBatch(JSON.stringify({
    events: [{ title: '会議', startDate: '2026-07-23', startTime: '10:00', location: '本社ビル',
      quotes: { title: '会議', startTime: '10時', location: '本社ビル' } }],
  }), { sourceText: srcText });
  eq(r.ok, true);
  const p = r.events[0].prov;
  eq(p.startTime.source, 'transcript');
  eq(srcText.slice(p.startTime.span.a, p.startTime.span.b), '10時', 'span が本文の該当箇所を指す');
  eq(p.location.span.quote, '本社ビル');
  eq(p.startDate.source, 'inferred', 'quote の無い項目は「推論で埋めた」という申告');
  eq(r.quoteMisses, 0);
});

t('v56: quote が本文に無い → inferred に降格＋quoteMisses を数える（幻覚の検出）', () => {
  const r = B.parseBatch(JSON.stringify({
    events: [{ title: '打ち合わせ', quotes: { title: 'ミーティング' } }],
  }), { sourceText: '明日打ち合わせ' });
  eq(r.ok, true);
  eq(r.events[0].prov.title.source, 'inferred');
  ok(r.events[0].prov.title.why.includes('見つからない'), 'why に理由が残る');
  eq(r.quoteMisses, 1);
  // 🚫 不一致は problems に入れない＝pickAutoSavable（v53）の挙動を変えない。
  //    変えるかどうかは計測（スパン出所追跡 B）で不一致の頻度と訂正の相関を見てから（塞ぐ時は開ける条件を書く）
  eq(r.events[0].problems, [], '不一致は problems に入れない');
  const picked = B.pickAutoSavable(r.events, r.warnings);
  eq(picked.save.length, 1, 'quote 不一致だけでは自動保存を止めない（意図した保留＝上のコメント参照）');
});

t('v56: quotes の無い応答 → prov は null（従来の JSON もそのまま通る・出所を創作しない）', () => {
  const r = B.parseBatch(JSON.stringify({ events: [{ title: '会議' }] }), { sourceText: '会議' });
  eq(r.ok, true);
  eq(r.events[0].prov, null);
  eq(r.quoteMisses, 0);
});

t('v56: 本文が無い（WebMCP 等）→ quote 付きは不明(null)・quote 無しは inferred（自己申告は残る）', () => {
  const r = B.parseBatch(JSON.stringify({
    events: [{ title: '会議', startDate: '2026-07-23', quotes: { title: '会議' } }],
  }));
  eq(r.ok, true);
  const p = r.events[0].prov;
  eq(p.title, null, '検証の錨が無い＝transcript とは認めない（自己証明にしない）');
  eq(p.startDate.source, 'inferred', '「引用なし」の申告は本文が無くても意味を持つ');
});

t('v56: quotes の壊れた形は problems に明記して無視（黙って捨てない v16）', () => {
  const r = B.parseBatch(JSON.stringify({
    events: [{ title: '会議', quotes: { title: 42, 謎: 'x' } }],
  }), { sourceText: '会議' });
  eq(r.ok, true);
  ok(r.events[0].problems.some((s) => s.includes('quotes.title')), '非文字列を明記');
  ok(r.events[0].problems.some((s) => s.includes('謎')), '未知の項目を明記');
  eq(r.events[0].prov.title.source, 'inferred', '生き残った quotes は空＝引用なしの申告として扱う');
});

t('v56: 不可視文字（v14）が本文と引用のどちらに混ざっても突き合わせられる', () => {
  const zwsp = String.fromCharCode(0x200B);
  const r = B.parseBatch(JSON.stringify({
    events: [{ title: '会議', quotes: { title: '会' + zwsp + '議' } }],
  }), { sourceText: '明日' + zwsp + '会議' });
  eq(r.ok, true);
  eq(r.events[0].prov.title.source, 'transcript', '両辺から除去して一致');
});

t('v56: staging が prov を往復させる・prov の無い古い行は null で読める', () => {
  B.stageClear();
  B.stageAdd([{ draft: { title: 'A' }, ambiguities: [], problems: [], prov: { title: { source: 'transcript', span: { a: 0, b: 1, quote: 'A' } } } }], new Date(1770000000000));
  eq(B.stageList()[0].prov.title.source, 'transcript', '往復');
  mem.set(B.KEY, JSON.stringify([{ id: 'old', draft: { title: 'x' }, addedAt: 1 }])); // v55 以前の行
  eq(B.stageList()[0].prov, null, '古い行は不明として読める（後方互換）');
  B.stageClear();
});

t('v59: staging が src（経路・生テキスト）を往復させる・渡さなければ持たない（後方互換）', () => {
  B.stageClear();
  B.stageAdd([{ draft: { title: 'A' } }], new Date(1770000000000), { path: 'ai-multi', text: '来週会議', conf: 0.9 });
  const e = B.stageList()[0];
  eq(e.src.path, 'ai-multi', '往復（再読込で落ちない＝prov と同じ扱い）');
  eq(e.src.text, '来週会議');
  B.stageClear();
  B.stageAdd([{ draft: { title: 'B' } }], new Date(1770000000000)); // src 無し
  ok(!('src' in B.stageList()[0]), 'src を渡さなければ持たない（旧エントリと同じ形）');
  B.stageClear();
});

t('v56: toSnapshot が prov を運ぶ（カード→フォーム）・渡さなければ全欄 null', () => {
  const prov = { title: { source: 'transcript', span: { a: 0, b: 2, quote: '会議' } } };
  const s1 = B.toSnapshot({ title: '会議', startDate: '2026-07-23' }, prov);
  eq(s1.prov.title.source, 'transcript', '出所が乗る');
  eq(s1.prov.startDate, null, '出所の無い欄は不明');
  const s2 = B.toSnapshot({ title: '会議' });
  eq(s2.prov.title, null, '渡さなければ不明＝従来どおり');
});

t('v56: buildPrompt に quotes（一字一句の引用）の指示が入る', () => {
  const p = B.buildPrompt({ now: new Date(2026, 6, 22, 12, 0), schema: C.SCHEMA });
  ok(p.includes('quotes'), 'quotes の言及');
  ok(p.includes('一字一句'), '一字一句そのまま');
});

console.log(`\nbatch.test: ${pass} passed, ${fail} failed`);
if (failures.length) { console.log('\n' + failures.join('\n\n')); process.exit(1); }
