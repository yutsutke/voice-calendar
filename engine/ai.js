// engine/ai.js — BYOK（Bring Your Own Key）: ユーザー自身の API キーで長文を解釈（v40）
//
// アプリは無料公開・使いたい人だけ使う＝**開発者のサーバ（プロキシ）は存在しない**。
// 本文はユーザーが選んだ AI 社のエンドポイントへ**ブラウザから直接**送る。
// キーは端末の localStorage のみ（外部送信はユーザーが選んだ AI 社への API 呼び出しだけ）。
//
// 設計:
//   - **既定はローカル完結のまま**（SPEC §2-5・§13）: キー未設定なら何も送れない・何も変わらない。
//     AI は「まとめて入力」の opt-in 機能＝音声の短文経路（ルールベース）には一切触れない。
//   - **プロバイダの壁は CORS**: Anthropic は公式のブラウザ直叩きヘッダあり・Gemini は直で叩ける。
//     OpenAI は CORS を返さない＝ PROVIDERS に**入れない**（UI にも「非対応」と明記＝
//     「キーを入れたのに動かない」を作らない）。仕様が変わったら足せばよい。
//   - **プロンプトは注入**（batch.buildPrompt の結果を宿主が渡す）＝ ai.js は契約を知らない。
//     差分はエンドポイント・認証ヘッダ・リクエスト形・テキストの取り出し位置の4点だけ＝
//     プロバイダアダプタ1枚に収める。
//   - **エラー文にキーを絶対に含めない**（テストで固定）。HTTP エラーは日本語の原因と次の一手に写像。
//   - fetch は注入可（fetchFn）＝ネット無しでテストできる（transcriber の simulate と同じ思想）。
//
// DOM は知らない（Node からも require 可）。読みは縮退・書きは throw（records/dict と同じ・v16）。
(function (global) {
  'use strict';

  const KEY = 'vc_ai_v1';
  const MAX_TOKENS = 8000;        // 20件×日本語 title/note＋ambiguities でも切れない余裕（4000 はぎりぎり）
  const MAX_INPUT_CHARS = 20000;  // コスト暴発の防波堤＝超えたら正直に断る（黙って切らない）

  const PROVIDERS = {
    anthropic: {
      label: 'Anthropic（Claude）',
      defaultModel: 'claude-haiku-4-5',
      endpoint: () => 'https://api.anthropic.com/v1/messages',
      headers: (key) => ({
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        // 公式のブラウザ直叩きフラグ。名前は物々しいが BYOK（ユーザー自身のキー）は想定内の用途
        'anthropic-dangerous-direct-browser-access': 'true',
      }),
      body: (system, text, model, maxTokens) => ({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: text }],
      }),
      extract: (res) => {
        const block = Array.isArray(res && res.content)
          ? res.content.find((b) => b && b.type === 'text' && typeof b.text === 'string')
          : null; // content[0] 決め打ちにしない（先頭が text 以外のブロックのことがある）
        if (!block) throw new Error('AI の応答にテキストがありません');
        if (res.stop_reason === 'max_tokens') throw new Error('AI の応答が長さの上限で切れました（本文を分けて試してください）');
        return block.text;
      },
    },
    gemini: {
      label: 'Google（Gemini）',
      defaultModel: 'gemini-2.5-flash',
      endpoint: (model) => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      headers: (key) => ({
        'content-type': 'application/json',
        'x-goog-api-key': key,
      }),
      body: (system, text, model, maxTokens) => ({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: { maxOutputTokens: maxTokens, responseMimeType: 'application/json' },
      }),
      extract: (res) => {
        const cand = res && Array.isArray(res.candidates) ? res.candidates[0] : null;
        const part = cand && cand.content && Array.isArray(cand.content.parts)
          ? cand.content.parts.find((p) => p && typeof p.text === 'string')
          : null;
        if (!part) throw new Error('AI の応答にテキストがありません');
        if (cand.finishReason === 'MAX_TOKENS') throw new Error('AI の応答が長さの上限で切れました（本文を分けて試してください）');
        return part.text;
      },
    },
    // 🚫 openai は入れない: ブラウザからの直接呼び出しが CORS でブロックされる＝
    //    「キーを入れたのに動かない」を仕様として作ることになる（UI に理由を明記して非対応）。
  };

  // ---------- 設定（キーは端末内のみ） ----------
  function loadConfig() {
    const def = { provider: 'anthropic', key: '', model: '' };
    try {
      const v = JSON.parse(global.localStorage.getItem(KEY));
      if (!v || typeof v !== 'object') return def;
      return {
        provider: PROVIDERS[v.provider] ? v.provider : def.provider, // 未知プロバイダは既定へ
        key: typeof v.key === 'string' ? v.key : '',
        model: typeof v.model === 'string' ? v.model : '',
      };
    } catch { return def; }
  }

  // 書き込み失敗は**握らず投げる**（「設定したつもり」を作らない＝v16）
  function saveConfig(cfg) {
    const c = {
      provider: PROVIDERS[cfg && cfg.provider] ? cfg.provider : 'anthropic',
      key: String((cfg && cfg.key) || ''),
      model: String((cfg && cfg.model) || '').trim(),
    };
    global.localStorage.setItem(KEY, JSON.stringify(c));
    return c;
  }

  function clearConfig() { try { global.localStorage.removeItem(KEY); } catch {} }
  function hasKey() { return !!loadConfig().key; }
  function modelFor(cfg) { return (cfg && cfg.model && cfg.model.trim()) || PROVIDERS[(cfg && cfg.provider) || 'anthropic'].defaultModel; }

  // ---------- 呼び出し ----------
  function honestHttpError(status) {
    if (status === 401 || status === 403) return `API キーが正しくないか、権限がありません（${status}）。キーを確認してください`;
    if (status === 429) return '利用上限に達しています（429）。しばらく待つか、プロバイダ側の利用状況を確認してください';
    if (status >= 500) return `AI 側のサーバエラーです（${status}）。しばらくして再試行してください`;
    return `AI の呼び出しに失敗しました（HTTP ${status}）`;
  }

  async function callProvider(system, text, cfg, fetchFn, timeoutMs) {
    const p = PROVIDERS[cfg && cfg.provider];
    if (!p) throw new Error('対応していないプロバイダです');
    if (!cfg.key) throw new Error('API キーが設定されていません（AI 設定で登録してください）');
    const f = fetchFn || global.fetch;
    if (typeof f !== 'function') throw new Error('この環境ではネットワークを使えません');
    const model = modelFor(cfg);
    // v42: タイムアウト（音声経路は待たせられない）。「時間切れ」はネットワーク失敗と**別の顔で名指す**
    // ＝原因の切り分け（遅いだけ？繋がらない？）を利用者ができる。real fetch は signal で実際に中断。
    const useTimeout = typeof timeoutMs === 'number' && timeoutMs > 0;
    const ctrl = useTimeout && typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timer = null;
    let timedOut = false;
    let res;
    try {
      const fp = f(p.endpoint(model), {
        method: 'POST',
        headers: p.headers(cfg.key),
        body: JSON.stringify(p.body(system, text, model, MAX_TOKENS)),
        signal: ctrl ? ctrl.signal : undefined,
      });
      if (useTimeout) {
        fp.catch(() => {}); // 時間切れ後に元 fetch が落ちても unhandled rejection にしない
        res = await Promise.race([
          fp,
          new Promise((_, rej) => { timer = setTimeout(() => { timedOut = true; if (ctrl) ctrl.abort(); rej(new Error('timeout')); }, timeoutMs); }),
        ]);
      } else {
        res = await fp;
      }
    } catch {
      // fetch の reject にキーや URL の断片を混ぜない（エラー文にキーを絶対に出さない）
      if (timedOut) throw new Error(`時間切れです（${Math.round(timeoutMs / 1000)}秒以内に AI の応答がありませんでした）`);
      throw new Error('ネットワークに接続できませんでした（オフラインか、接続がブロックされています）');
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!res.ok) throw new Error(honestHttpError(res.status));
    let json;
    try { json = await res.json(); } catch { throw new Error('AI の応答を読めませんでした（JSON でない応答）'); }
    return p.extract(json);
  }

  // 長文 → AI → 応答テキスト（JSON のはず＝検証は呼び手が VCBatch.parseBatch で行う）。
  // opts.system: VCBatch.buildPrompt の結果を渡す（契約は宿主が注入＝ai.js は契約を知らない）。
  async function interpretLongText(text, opts) {
    const t = String(text == null ? '' : text).trim();
    if (!t) throw new Error('本文が空です');
    if (t.length > MAX_INPUT_CHARS) {
      throw new Error(`本文が長すぎます（${t.length}文字。上限${MAX_INPUT_CHARS}文字）。分けて試してください`);
    }
    const system = opts && opts.system;
    if (!system) throw new Error('内部エラー: 指示文（system）がありません');
    const cfg = (opts && opts.config) || loadConfig();
    return callProvider(system, t, cfg, opts && opts.fetchFn, opts && opts.timeoutMs);
  }

  // 疎通確認（キー・モデル・CORS がまとめて検証される最小の呼び出し）
  async function testConnection(opts) {
    const cfg = (opts && opts.config) || loadConfig();
    return callProvider('接続テストです。「OK」とだけ返してください。', 'OK', cfg, opts && opts.fetchFn, opts && opts.timeoutMs);
  }

  const api = { PROVIDERS, KEY, MAX_TOKENS, MAX_INPUT_CHARS, loadConfig, saveConfig, clearConfig, hasKey, modelFor, interpretLongText, testConnection };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.VCAI = api;
})(typeof window !== 'undefined' ? window : globalThis);
