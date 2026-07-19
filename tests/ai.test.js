// tests/ai.test.js — BYOK（v40）の単体テスト（fetchFn 注入＝実ネットワーク無し）
//
// 守る不変条件:
//   1. リクエストの形（エンドポイント・認証ヘッダ・body）が各プロバイダの契約どおり
//      ＝ズレると「キーを入れたのに動かない」を実機で踏む（calendar.test の native 契約と同じ精神）
//   2. 応答の取り出しは content[0] 決め打ちにしない・**切れた応答（max_tokens）は検出して正直に言う**
//      （切れた JSON が parseBatch に渡ると「JSON が読めない」という別の顔で化けて出る＝原因を上流で名指す）
//   3. HTTP エラー → 日本語の原因と次の一手（401=キー・429=上限・5xx=先方・reject=ネットワーク）
//   4. **エラー文のどこにもキーが漏れない**
//   5. openai は指定できない（CORS 非対応＝仕様として作らない）
//   6. 設定: 読みは縮退（破損・未知プロバイダ→既定）・書きは throw
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

const AI = require('../engine/ai.js');

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
    const m = String(e.message);
    if (!m.includes(needle)) throw new Error(`エラー文に "${needle}" を期待 / 実際 "${m}"`);
    return m;
  }
  throw new Error('throw を期待したのに成功した');
}

const SECRET = 'sk-secret-key-1234';
const okFetch = (resBody) => async () => ({ ok: true, status: 200, json: async () => resBody });
const httpFetch = (status) => async () => ({ ok: false, status, json: async () => ({}) });

// ===== 不変条件1: リクエストの形 =====
t('anthropic: エンドポイント・ヘッダ3種・body の形が契約どおり', async () => {
  let got = null;
  const fetchFn = async (url, init) => { got = { url, init }; return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: '{}' }] }) }; };
  await AI.interpretLongText('明日の会議', {
    system: 'SYSTEM_PROMPT',
    config: { provider: 'anthropic', key: SECRET, model: '' },
    fetchFn,
  });
  eq(got.url, 'https://api.anthropic.com/v1/messages');
  eq(got.init.method, 'POST');
  eq(got.init.headers['x-api-key'], SECRET);
  eq(got.init.headers['anthropic-version'], '2023-06-01');
  eq(got.init.headers['anthropic-dangerous-direct-browser-access'], 'true', 'ブラウザ直叩きの公式フラグ');
  const body = JSON.parse(got.init.body);
  eq(body.model, 'claude-haiku-4-5', 'モデル未指定は既定');
  eq(body.max_tokens, AI.MAX_TOKENS);
  eq(body.system, 'SYSTEM_PROMPT');
  eq(body.messages, [{ role: 'user', content: '明日の会議' }]);
});

t('gemini: URL にモデル・x-goog-api-key・system_instruction・JSON 応答指定', async () => {
  let got = null;
  const fetchFn = async (url, init) => { got = { url, init }; return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '{}' }] } }] }) }; };
  await AI.interpretLongText('明日の会議', {
    system: 'SYS',
    config: { provider: 'gemini', key: SECRET, model: '' },
    fetchFn,
  });
  ok(got.url.includes('generativelanguage.googleapis.com'), got.url);
  ok(got.url.includes('gemini-2.5-flash:generateContent'), 'モデル既定が URL に入る');
  eq(got.init.headers['x-goog-api-key'], SECRET);
  const body = JSON.parse(got.init.body);
  eq(body.system_instruction.parts[0].text, 'SYS');
  eq(body.contents[0].parts[0].text, '明日の会議');
  eq(body.generationConfig.responseMimeType, 'application/json', 'JSON を明示要求（散文混入を減らす）');
  eq(body.generationConfig.maxOutputTokens, AI.MAX_TOKENS);
});

t('モデル名を指定すればそれが使われる', async () => {
  let got = null;
  const fetchFn = async (url, init) => { got = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'x' }] }) }; };
  await AI.interpretLongText('t', { system: 's', config: { provider: 'anthropic', key: SECRET, model: 'claude-sonnet-5' }, fetchFn });
  eq(got.model, 'claude-sonnet-5');
});

// ===== 不変条件2: 応答の取り出し =====
t('anthropic: content の最初の text ブロックを拾う（[0] 決め打ちにしない）', async () => {
  const fetchFn = okFetch({ content: [{ type: 'thinking', thinking: '…' }, { type: 'text', text: 'ANSWER' }] });
  const r = await AI.interpretLongText('t', { system: 's', config: { provider: 'anthropic', key: SECRET }, fetchFn });
  eq(r, 'ANSWER');
});

t('anthropic: max_tokens で切れた応答は正直に言う（壊れた JSON として下流に化けさせない）', async () => {
  const fetchFn = okFetch({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"events":[' }] });
  await rejects(
    () => AI.interpretLongText('t', { system: 's', config: { provider: 'anthropic', key: SECRET }, fetchFn }),
    '上限で切れました'
  );
});

t('gemini: candidates から text を拾う・MAX_TOKENS も検出', async () => {
  const r = await AI.interpretLongText('t', { system: 's', config: { provider: 'gemini', key: SECRET }, fetchFn: okFetch({ candidates: [{ content: { parts: [{ text: 'G' }] } }] }) });
  eq(r, 'G');
  await rejects(
    () => AI.interpretLongText('t', { system: 's', config: { provider: 'gemini', key: SECRET }, fetchFn: okFetch({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'x' }] } }] }) }),
    '上限で切れました'
  );
});

t('応答にテキストが無い → 正直にエラー（黙って空にしない）', async () => {
  await rejects(
    () => AI.interpretLongText('t', { system: 's', config: { provider: 'anthropic', key: SECRET }, fetchFn: okFetch({ content: [] }) }),
    'テキストがありません'
  );
});

// ===== 不変条件3: HTTP エラーの写像 =====
t('401 → キー・429 → 上限・500 → 先方・reject → ネットワーク', async () => {
  const cfg = { provider: 'anthropic', key: SECRET };
  await rejects(() => AI.interpretLongText('t', { system: 's', config: cfg, fetchFn: httpFetch(401) }), 'キーが正しくない');
  await rejects(() => AI.interpretLongText('t', { system: 's', config: cfg, fetchFn: httpFetch(429) }), '利用上限');
  await rejects(() => AI.interpretLongText('t', { system: 's', config: cfg, fetchFn: httpFetch(500) }), 'サーバエラー');
  await rejects(() => AI.interpretLongText('t', { system: 's', config: cfg, fetchFn: async () => { throw new Error('TypeError: CORS'); } }), 'ネットワークに接続できません');
});

// ===== 不変条件4: エラー文にキーが漏れない =====
t('🔒 どの失敗経路のエラー文にもキーが出ない', async () => {
  const cfg = { provider: 'anthropic', key: SECRET };
  const paths = [
    () => AI.interpretLongText('t', { system: 's', config: cfg, fetchFn: httpFetch(401) }),
    () => AI.interpretLongText('t', { system: 's', config: cfg, fetchFn: async () => { throw new Error('failed: ' + SECRET); } }), // fetch がキー入りで死んでも
    () => AI.interpretLongText('t', { system: 's', config: cfg, fetchFn: okFetch({ content: [] }) }),
    () => AI.interpretLongText('', { system: 's', config: cfg }),
  ];
  for (const p of paths) {
    try { await p(); } catch (e) {
      ok(!String(e.message).includes(SECRET), `キーが漏れた: ${e.message}`);
      ok(!String(e.stack || '').includes(SECRET), 'stack にも出ない');
    }
  }
});

// ===== 不変条件5: openai は指定できない =====
t('🚫 openai は PROVIDERS に無い（CORS 非対応＝「入れたのに動かない」を作らない）', async () => {
  ok(!AI.PROVIDERS.openai, 'openai を足すなら CORS の仕様変更を確認してから');
  eq(Object.keys(AI.PROVIDERS).sort(), ['anthropic', 'gemini']);
  await rejects(
    () => AI.interpretLongText('t', { system: 's', config: { provider: 'openai', key: SECRET } }),
    '対応していないプロバイダ'
  );
});

// ===== 入力ガード =====
t('本文が空 / 長すぎ → 送信前に正直に断る（コストの防波堤）', async () => {
  const cfg = { provider: 'anthropic', key: SECRET };
  await rejects(() => AI.interpretLongText('   ', { system: 's', config: cfg }), '本文が空');
  await rejects(() => AI.interpretLongText('あ'.repeat(AI.MAX_INPUT_CHARS + 1), { system: 's', config: cfg }), '長すぎます');
});

t('キー未設定 → 送信せず案内', async () => {
  let called = false;
  await rejects(
    () => AI.interpretLongText('t', { system: 's', config: { provider: 'anthropic', key: '' }, fetchFn: async () => { called = true; } }),
    'API キーが設定されていません'
  );
  eq(called, false, 'ネットワークに出ない');
});

// ===== 不変条件6: 設定の読み書き =====
t('saveConfig → loadConfig の往復・キーは端末内（localStorage）だけ', () => {
  mem.clear();
  AI.saveConfig({ provider: 'gemini', key: SECRET, model: ' gemini-2.5-pro ' });
  const c = AI.loadConfig();
  eq(c.provider, 'gemini');
  eq(c.key, SECRET);
  eq(c.model, 'gemini-2.5-pro', 'モデルは trim');
  eq(AI.hasKey(), true);
});

t('破損 JSON・未知プロバイダ → 既定に縮退（黙って壊れない）', () => {
  mem.clear();
  mem.set(AI.KEY, '{oops');
  eq(AI.loadConfig(), { provider: 'anthropic', key: '', model: '' });
  mem.set(AI.KEY, JSON.stringify({ provider: 'openai', key: 'k', model: 5 }));
  const c = AI.loadConfig();
  eq(c.provider, 'anthropic', '未知プロバイダは既定へ');
  eq(c.model, '', '型違いは既定へ');
});

t('書き込み失敗は throw（「設定したつもり」を作らない）・clearConfig で消える', () => {
  mem.clear();
  failNextSet = true;
  let threw = false;
  try { AI.saveConfig({ provider: 'anthropic', key: 'k' }); } catch { threw = true; }
  ok(threw);
  AI.saveConfig({ provider: 'anthropic', key: 'k' });
  eq(AI.hasKey(), true);
  AI.clearConfig();
  eq(AI.hasKey(), false);
});

t('modelFor: 未指定は既定モデル・指定があればそれ', () => {
  eq(AI.modelFor({ provider: 'anthropic', model: '' }), 'claude-haiku-4-5');
  eq(AI.modelFor({ provider: 'gemini', model: '' }), 'gemini-2.5-flash');
  eq(AI.modelFor({ provider: 'anthropic', model: 'claude-sonnet-5' }), 'claude-sonnet-5');
});

// ===== タイムアウト（v42: 音声経路は待たせられない） =====
t('timeoutMs: 応答が来なければ「時間切れ」と名指す（ネットワーク失敗と別の顔）', async () => {
  const never = () => new Promise(() => {}); // 永遠に解決しない fetch
  const m = await rejects(
    () => AI.interpretLongText('t', { system: 's', config: { provider: 'anthropic', key: SECRET }, fetchFn: never, timeoutMs: 30 }),
    '時間切れ'
  );
  ok(!m.includes('ネットワーク'), 'ネットワーク失敗と混同しない');
});

t('timeoutMs 指定時は AbortSignal を fetch に渡す（real fetch は実際に中断される）・未指定なら渡さない', async () => {
  let withTimeout = null, without = null;
  const capture = (store2) => async (url, init) => { store2.signal = init.signal; return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'x' }] }) }; };
  const s1 = {};
  await AI.interpretLongText('t', { system: 's', config: { provider: 'anthropic', key: SECRET }, fetchFn: capture(s1), timeoutMs: 5000 });
  withTimeout = s1.signal;
  const s2 = {};
  await AI.interpretLongText('t', { system: 's', config: { provider: 'anthropic', key: SECRET }, fetchFn: capture(s2) });
  without = s2.signal;
  ok(withTimeout !== undefined && withTimeout !== null, 'timeout あり → signal が渡る');
  ok(without === undefined, 'timeout なし → signal を渡さない（従来どおり）');
});

// ===== testConnection =====
t('testConnection: 最小の呼び出しで疎通（キー・モデル・経路の検証）', async () => {
  let got = null;
  const fetchFn = async (url, init) => { got = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'OK' }] }) }; };
  const r = await AI.testConnection({ config: { provider: 'anthropic', key: SECRET }, fetchFn });
  eq(r, 'OK');
  ok(got.system.includes('接続テスト'), '軽い呼び出し');
});

(async () => {
  for (const [name, fn] of tests) {
    mem.clear();
    failNextSet = false;
    try { await fn(); pass++; }
    catch (e) { fail++; failures.push(`✗ ${name}\n    ${e.message}`); }
  }
  console.log(`\nai.test: ${pass} passed, ${fail} failed`);
  if (failures.length) { console.log('\n' + failures.join('\n\n')); process.exit(1); }
})();
