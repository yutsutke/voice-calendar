// engine/parser.js — スキーマ拘束・解釈層（SPEC §5-②）
//
// interpret(text, now) : (転写テキスト, 現在時刻) → DraftEvent への patch。
// **副作用のない純関数**。同じ転写から何度でも再導出できる（now を注入するのはそのため）。
//
// v0 の方針（SPEC §7）: 「確定」だけを埋める。曖昧は埋めない＝素通し（notes に理由を残す）。
// LLM なし・確定的ルールのみ。埋めなかった発話の断片はタイトルに残る＝ユーザーに見える。
//
// 確定として扱う決め打ちルール（テストで固定。変えるときはテストも変える）:
//   - 素の曜日「金曜」= 直近の未来のその曜日（今日を含む）
//   - 「来週(の)X曜」= 次の月曜始まりの週の X 曜。「の」は挟んでよい（実発話FBより）
//   - 「今週X曜」「先週X曜」「昨日」「一昨日」= 過去の日付も埋める
//     （実発話FBで「昨日の11時半暇だった」＝過去の実績を記録する用途が実在した）
//   - **言った年には必ず従う**（v9）: 「2027年11月5日」「来年の3月1日」「去年の6月30日」。
//     推測（下の「最も近い」）は**年を言っていない時だけ**の話。明示指定を推測で上書きしない。
//   - **言っていない上位単位（年・月）は「今日に最も近いもの」を選ぶ**（v8。過去も一級市民＝v5の学び）
//     「N月(の)N日」= 最も近い年（7/16 に「6月30日」→ 16日前の 6/30。「1月5日」→ 173日先の来年 1/5）
//     「N日」= 最も近い月（7/16 に「20日」→ 今月20日。7/28 に「5日」→ 8日後の来月5日）
//     存在しない日付（2月30日 等）は埋めない（素通し）
//     ※ 半年前後の中間帯は本質的に曖昧（「3月1日」＝4か月前 or 8か月先）。v1 の 'guessed'（仮）表示の第一候補
//   - 「N日後/N週間後/Nか月後/N年後」= 相対日。数は算用数字と漢数字（一〜九十九）
//     か月後の月末越えは月末に丸める（1/31 の1か月後 = 2/28）
//   - 時刻だけで日付がない場合 = その時刻がまだ来ていなければ今日、過ぎていれば明日
//   - 修飾なしの 1〜6 時（「3時」）= 午前/午後が曖昧 → 埋めない（素通し）。7〜24時は文字どおり
//   - 時刻の数は算用数字と漢数字の両方（v34。「午後三時」「十九時」「三十分後」。曖昧ルールも同じ＝
//     「三時」は「3時」と同じ素通し。語中の「一時的/一時停止」は 1〜6時の曖昧扱い＝埋めない）
//   - 「N分後」「N時間(半)後」= 今からの相対時刻（v34）。「30分後ろ倒し」の「後ろ」は食わない
//   - 「今からX時まで」= 開始が今・終了が X時（v34。従来は開始が X時 に化けていた）
//   - 「XからYまで」で Y ≤ X かつ X が18時以降 = 日またぎとして翌日扱い。それ以外は end を埋めない
//
// patch のキーは共有状態層（schema.js）の粒度に合わせる:
//   { title?, startDate?('YYYY-MM-DD'), startTime?('HH:mm'), endDate?, endTime?, allDay? }
//
// v55（スパン出所追跡 A'）: 返り値に prov（欄ごとの出所）を追加。
//   prov[欄] = { source: 'transcript' | 'inferred', span: { a, b, quote } | null, why? }
//   - span は normalizedText（正規化後に解釈へかけた文字列）へのオフセット。
//     **quote === normalizedText.slice(a, b) をテストが強制**（AI 経路 v56 の quote 検証と鏡）。
//   - 境界は機械的: nearestBy（年・月の最近接補完 v8）や now 比較（時刻だけ→今日/明日・日またぎ）で
//     **実在する複数候補から1つを選んだら inferred**（why に理由＝notes と同じ言葉遣い）。
//     定義的に1つへ解決する語（明日・来週火曜・2027年11月5日・30分後）は transcript。
//     曖昧（修飾なし1〜6時）は従来どおり埋めない＝prov も付かない（素通し）。
//     title は「消費されなかった断片の寄せ集め」＝複数スパンの合成なので span を持たない（source のみ）。
(function (global) {
  'use strict';

  // ---------- 正規化 ----------
  function normalize(raw) {
    let t = String(raw || '');
    // 不可視文字を除去（v14）: iOS の音声認識やキーボードは数字の前後に双方向テキスト分離子
    // （U+2066-2069）やゼロ幅文字を混ぜることがある。**見た目は「7月14日」なのに正規表現が
    // 一致しない**＝「画面に見えているのに入らない」の原因になり得る。実機FBで
    // 「同じ文字列でもテキスト入力は通り音声は通らない」が観測されたため防御。
    t = t.replace(/[\u200B-\u200F\u2060-\u2064\u2066-\u2069\uFEFF]/g, '');
    // 特殊スペース（NBSP・狭い NBSP・全角スペース）→ 普通のスペース
    t = t.replace(/[\u00A0\u202F\u3000]/g, ' ');
    // 全角数字・記号 → 半角（1文字→1文字なのでインデックスは保たれる）
    t = t.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
    t = t.replace(/：/g, ':').replace(/[~～]/g, '〜');
    return t;
  }

  // 言い淀み・相づちだけの発話か（v47）。**自動保存の門でだけ使う判定**で、interpret には一切関与しない
  // ＝発話は今までどおり素通しでタイトルに残る（v7「素通しの痕跡」）。捨てるのではなく「黙って確定しない」。
  //
  // なぜ要るか: v47 で「日時を言わなくても自動保存する」を解禁した＝v28 で塞いだ穴が再び開く。
  //   パーサは意味を判定しない（LLM なし）→「えーっと」もタイトルになり、v27「日時なし→今」で確定し、
  //   v24「起動＝即録音」と重なると **アプリを開くだけで環境音が予定になる**（保存は不可逆）。
  //   意味の判定は出来ないが、**言い淀みの定型語そのもの**なら決定的に弾ける。
  //
  // 🚨 **完全一致だけ**（部分一致・前方一致にしない）: 日本語は語境界が無いので、部分一致にすると
  //   「あの店で待ち合わせ」「はいチーズ」のような正当な発話まで殺す＝v22「場所 メモリアルホール」・
  //   v27「今井さん」と同じ silent wrong answer。**弾く範囲は狭く・確実に**。
  const FILLER_ONLY = new Set([
    'えーっと', 'えーと', 'えっと', 'ええと', 'えと', 'えー', 'えっ', 'え',
    'あのー', 'あのう', 'あの', 'あー', 'ああ', 'あ',
    'うーん', 'ううん', 'うん', 'うー', 'う',
    'んー', 'んん', 'ん',
    'そのー', 'その',
    'まあ', 'まー', 'ま',
    'はい', 'ええ', 'ねー', 'ねえ',
  ]);
  function isFillerOnly(raw) {
    let t = normalize(raw);
    t = t.replace(/ｰ/g, 'ー');                              // 半角長音 ｰ → ー
    t = t.replace(/[\s、。,.，．!?！？・…「」『』〜]/g, '');       // 記号・空白は中身ではない
    t = t.replace(/ー{2,}/g, 'ー');                              // 「えーーーっと」→「えーっと」
    if (!t) return true;                                        // 中身が無い＝確定させるものが無い
    return FILLER_ONLY.has(t);
  }

  // ---------- 長い発話の分割（v58・実機FB第34回） ----------
  // ゆうの観察: 「いまの気分を2行くらい話すと、削られたりタイトルになる」
  //   → 「**タイトルは簡素に書いて、話したすべての気分をメモに入れるのが正解では**」（ゆう決定）。
  //
  // 🚨 **要約はしない**（SPEC §7 創作しない・LLM なし）＝**前の方を切り出すだけ**。
  //    メモには全文が入る＝**何も失わない**（タイトルの言葉もメモに含まれる＝話したまま残る）。
  // 発動は**長い時だけ**＝「歯医者」「新宿駅に着いた」は今までどおりタイトルだけ（既定の体験を変えない v19）。
  // 🚨 切り出した頭が言い淀みだけ（「えーっと、」）なら次の区切りまで伸ばす＝タイトルが「えーっと」に
  //    化ける事故を防ぐ（判定は isFillerOnly を再利用＝完全一致だけ・v47。新しい語彙を作らない）。
  // 🚨 **区切り（、。）の有無で判定を分ける**: 日本語は語境界が無く、区切りの無い文を文字数で切ると
  //    語の途中で切れる（「…ミーティングの準」）。区切りがある時＝話者自身が切った所で切れる＝安全。
  //    区切りが無い長文は HARD を超えた時だけ文字数で切る（保険。全文はメモに残るので損はしない）。
  const TITLE_MAX = 20;  // これを超え、かつ区切りがあれば分割する
  const TITLE_HARD = 40; // 区切りが無くてもここを超えたら文字数で切る
  function splitLongUtterance(text) {
    if (text.length <= TITLE_MAX) return { title: text, note: '' };
    let title = '';
    const re = /[、。]/g;
    let m;
    while ((m = re.exec(text))) {
      const cand = text.slice(0, m.index).trim();
      if (!cand || isFillerOnly(cand)) continue; // 頭が言い淀みだけ → 次の区切りまで伸ばす
      title = cand;
      break;
    }
    if (title.length > TITLE_HARD) title = text.slice(0, TITLE_MAX).trim(); // 最初の区切りが遠すぎる
    if (!title) {
      // 区切りが無い（or 全部言い淀み）。極端に長くなければ**そのままタイトル**＝変な位置で切らない
      if (text.length <= TITLE_HARD) return { title: text, note: '' };
      title = text.slice(0, TITLE_MAX).trim();
    }
    title = title.replace(/[にへでをはがの、。．\s]+$/u, '').trim(); // 端の助詞・句読点（本文と同じ処理）
    return { title: title || text.slice(0, TITLE_MAX), note: text };
  }

  // ---------- 日付ヘルパ（すべて端末ローカル時刻） ----------
  const pad2 = (n) => String(n).padStart(2, '0');
  const fmtDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const fmtTime = (h, m) => `${pad2(h)}:${pad2(m)}`;
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  // 月曜=0 … 日曜=6（日本の週感覚。「来週」= 次の月曜始まりの週）
  const weekIdxMon = (d) => (d.getDay() + 6) % 7;
  const JP_WEEKDAY = { 月: 0, 火: 1, 水: 2, 木: 3, 金: 4, 土: 5, 日: 6 };
  // 年の明示指定（v9）: 絶対「2027年」／相対「来年・去年」等。言ったら必ず従う＝推測で上書きしない
  const REL_YEAR = { 今年: 0, 来年: 1, 再来年: 2, 去年: -1, 昨年: -1, 一昨年: -2, おととし: -2 };
  // 日付パターンの先頭に置く年プレフィクス（省略可）。捕獲: [1]=4桁年, [2]=相対年
  const YEAR_PREFIX = '(?:(\\d{4})年の?|(今年|来年|再来年|去年|昨年|一昨年|おととし)の?)?';
  // 月単位の加算は月末に丸める（1/31 の1か月後 = 2/28。JS Date の自然なオーバーフロー 3/3 は使わない）
  const addMonthsClamped = (d, n) => {
    const y = d.getFullYear(), m = d.getMonth() + n;
    const last = new Date(y, m + 1, 0).getDate();
    return new Date(y, m, Math.min(d.getDate(), last));
  };
  // 年・月を言っていない日付は「今日に最も近い候補」を選ぶ（v8）。
  //   makeDate(k) = k 年（または k か月）ずらした候補、valid(c) = その候補が実在するか。
  //   候補が全て無効（2月30日 等）なら null → 呼び手は素通しする（AI は創作しない）。
  // 「過去なら未来へ倒す」を捨てた理由: 昨日/一昨日は過去に入るのに 6月30日 は来年に飛ぶ、という
  // 非一貫が実発話FBで露呈した（この製品は予定だけでなく実績も声で入れる＝v5 の学び）。
  const nearestBy = (today, makeDate, valid) => {
    const cands = [-1, 0, 1].map(makeDate).filter(valid);
    if (!cands.length) return null;
    return cands.reduce((best, c) => (Math.abs(c - today) < Math.abs(best - today) ? c : best));
  };
  // 時刻に使う数（v34）: 算用数字と漢数字（一〜九十九・jpNum と対）。「午後三時」「三十分後」を拾う。
  // 「半」は分離を許す（\s*・認識が「10時 半」と切ることがある）が「半分」は誤読しない（半(?!分)）。
  const JNUM = '[一二三四五六七八九]?十[一二三四五六七八九]?|[一二三四五六七八九]';
  const TNUM = `\\d{1,2}|${JNUM}`;
  // 欄指定発話（v17）の値から時刻をひとつ拾う（本文の TIME_RE と同じ意味論:
  // 午前/午後/朝/夜等の修飾・「半」「N分」「H:MM」・修飾なし1〜6時は曖昧）
  const TIME_VALUE_RE = new RegExp(`(午前|午後|朝|昼|夜|夕方|晩)?(?:(${TNUM})時(?!間)(?:\\s*(半(?!分)|(${TNUM})分))?|正午|(\\d{1,2}):(\\d{2}))`);
  const timeFromValue = (value) => {
    const m = TIME_VALUE_RE.exec(value);
    if (!m) return null;
    if (m[0].includes('正午')) return { h: 12, min: 0, ambiguous: false, raw: m[0] };
    const qual = m[1] || '';
    let h, min = 0;
    if (m[5] !== undefined) { h = +m[5]; min = +m[6]; }
    else {
      h = jpNum(m[2]);
      if (m[3] === '半') min = 30;
      else if (m[4] !== undefined) min = jpNum(m[4]);
    }
    if (h == null || min == null || h > 24 || min > 59) return null;
    let ambiguous = false;
    if (qual === '午後') h = h < 12 ? h + 12 : h;
    else if (qual === '午前' || qual === '朝') { /* そのまま */ }
    else if (qual === '夜' || qual === '夕方' || qual === '晩' || qual === '昼') h = h < 12 ? (h === 12 ? 12 : h + 12) : h;
    else if (h >= 1 && h <= 6) ambiguous = true; // 修飾なし 1〜6時 = 午前/午後が決められない
    if (h === 24) h = 0;
    return { h, min, ambiguous, raw: m[0] };
  };

  // 漢数字（一〜九十九）→ 整数。算用数字はそのまま
  const jpNum = (s) => {
    if (/^\d+$/.test(s)) return +s;
    const D = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    const i = s.indexOf('十');
    if (i < 0) return D[s] || null;
    const tens = i === 0 ? 1 : D[s.slice(0, i)];
    const rest = s.slice(i + 1);
    const ones = rest ? D[rest] : 0;
    if (tens == null || ones == null) return null;
    return tens * 10 + ones;
  };

  // ---------- 欄指定発話（v17・実機FB第9回） ----------
  // 「終了22時」「場所 立川」のように**フォームの欄名で始まる**発話は、その欄だけを狙った
  // 差分として扱う（SPEC §0「任意項目は声か手で足す」= UC2 の声版。呼び手は掃除なしで適用する）。
  //   - 従来は「終了 22時」と言うと通常解釈が動き、時刻→**開始**に入ってしまった
  //   - 誤爆ガード①: 欄名で「始まる」発話だけ（「プロジェクト終了 打ち上げ」は通常解釈のまま）
  //   - 誤爆ガード②: 値が解釈できなければ null を返し通常解釈へフォールバック（発話を捨てない）
  const FIELD_KEYS = { タイトル: 'title', 件名: 'title', 場所: 'location', メモ: 'note', 開始: 'startTime', 終了: 'endTime' };
  function tryTargeted(text) {
    const m = /^(タイトル|件名|場所|メモ|開始|終了)[はがをに:、。]?\s*(.+)$/.exec(text);
    if (!m) return null;
    const field = FIELD_KEYS[m[1]];
    const value = m[2].replace(/^[はがをに:、。\s]+/, '').replace(/[。．\s]+$/, '');
    if (!value) return null;
    // v55: 欄指定の値は発話にそのまま在る＝transcript。span は最初の出現（値と同一文字列なので quote は常に一致）
    const spanOf = (q) => { const i = text.indexOf(q); return i >= 0 ? { a: i, b: i + q.length, quote: q } : null; };
    if (field === 'startTime' || field === 'endTime') {
      const t = timeFromValue(value);
      if (!t || t.ambiguous) return null; // 時刻なし/曖昧（3時）→ 通常解釈へ（曖昧の理由はそちらが出す）
      return { patch: { [field]: fmtTime(t.h, t.min) }, prov: { [field]: { source: 'transcript', span: spanOf(t.raw) } } };
    }
    // title / location / note は自由文をそのまま
    return { patch: { [field]: value }, prov: { [field]: { source: 'transcript', span: spanOf(value) } } };
  }

  // ---------- 本体 ----------
  function interpret(rawText, now) {
    const text = normalize(rawText);
    const today = startOfDay(now);
    const consumed = new Array(text.length).fill(false);
    const notes = []; // 素通しの理由（UI で見せる／将来の仮置き v1 の種）

    // 欄指定発話なら、その欄だけの差分を返す（通常解釈は走らせない）
    const targetedHit = tryTargeted(text);
    if (targetedHit) {
      return { patch: targetedHit.patch, notes, targeted: true, normalizedText: text, prov: targetedHit.prov };
    }

    const isFree = (a, b) => {
      for (let i = a; i < b; i++) if (consumed[i]) return false;
      return true;
    };
    const consume = (a, b) => {
      for (let i = a; i < b; i++) consumed[i] = true;
    };
    const findAll = (re) => {
      const out = [];
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        out.push({ m, a: m.index, b: m.index + m[0].length });
        if (m.index === re.lastIndex) re.lastIndex++;
      }
      return out;
    };
    // v55: 出所レコードを作る。quote は必ず text.slice(a,b) ＝「span の指す場所に quote が実在する」を
    // 構造的に保証する（AI 経路 v56 では逆向きに quote→indexOf で検証する＝鏡）。
    const provOf = (meta, a, b) => {
      const p = { source: (meta && meta.source) || 'transcript', span: a != null ? { a, b, quote: text.slice(a, b) } : null };
      if (meta && meta.why) p.why = meta.why;
      return p;
    };

    // ===== 終日 =====
    let allDay = false, allDaySpan = null;
    for (const { m, a, b } of findAll(/終日|一日中|丸一日|まる一日/g)) {
      if (!isFree(a, b)) continue;
      allDay = true;
      if (!allDaySpan) allDaySpan = { a, b };
      consume(a, b);
    }

    // ===== 日付候補の収集（優先順。span 重複は先勝ち） =====
    // 候補 = { date: Date, a, b }。複数候補が「別の日」を指したら曖昧 → 日付は埋めない。
    const dateCands = [];
    // 無効な日付（2月30日 等）のスパン: 消費しない（タイトルに残して見せる＝素通し）が、
    // 後続パターンによる再解釈は禁止する。これが無いと「2月30日」の「30日」を素のN日が拾い、
    // 言っていない 7/30 を創作してしまう（背骨: AI は創作しない）。
    const blocked = [];
    const overlaps = (list, a, b) => list.some((c) => a < c.b && c.a < b);
    // 年プレフィクスの解決（v9）。null = 年を言っていない → 呼び手が「最も近い年」を推測する
    const explicitYear = (abs, rel) => {
      if (abs) return +abs;
      if (rel) return today.getFullYear() + REL_YEAR[rel];
      return null;
    };
    // meta（v55・省略可）: 出所。省略＝transcript（発話が定義的に1つへ解決する語）。
    // nearestBy 等で複数候補から選んだ呼び出し元だけが { source:'inferred', why } を渡す。
    const pushCand = (date, a, b, meta) => {
      if (!date || !isFree(a, b) || overlaps(dateCands, a, b) || overlaps(blocked, a, b)) return;
      dateCands.push({ date, a, b, meta: meta || { source: 'transcript' } });
    };
    // 「今」系を言ったか（v27）。日付は下で今日として積み、時刻は時刻確定の後に補完する
    let nowSpan = null;

    // 1) N月(の)N日（過去なら来年。「7月の28日」の「の」も許す＝実発話FB。
    //    「の」未対応だと月が黙って無視され、素のN日として解釈される＝「12月の5日」が8月になる事故）
    for (const { m, a, b } of findAll(new RegExp(YEAR_PREFIX + '(\\d{1,2})月の?(\\d{1,2})日', 'g'))) {
      const mo = +m[3], da = +m[4];
      if (mo < 1 || mo > 12 || da < 1 || da > 31) continue;
      const valid = (c) => c.getMonth() === mo - 1 && c.getDate() === da;
      const y = explicitYear(m[1], m[2]);
      // 年を言ったならそれに従う／言っていない時だけ最も近い年を推測（過去も可）。
      // 存在しない日（2月30日）は素通し＝blocked（素の N日 に再解釈させない）
      let d;
      if (y != null) {
        d = new Date(y, mo - 1, da);
        if (!valid(d)) d = null;
      } else {
        d = nearestBy(today, (k) => new Date(today.getFullYear() + k, mo - 1, da), valid);
      }
      if (!d) { blocked.push({ a, b }); notes.push(`「${m[0]}」は存在しない日付なので入れていません`); continue; }
      pushCand(d, a, b, y != null ? null : { source: 'inferred', why: `年は言っていないため、今日に最も近い${d.getFullYear()}年として解釈` });
    }
    // 2) 来月N日 / 今月N日
    for (const { m, a, b } of findAll(/(来月|今月)(\d{1,2})日/g)) {
      const shift = m[1] === '来月' ? 1 : 0;
      const da = +m[2];
      if (da < 1 || da > 31) continue;
      pushCand(new Date(today.getFullYear(), today.getMonth() + shift, da), a, b);
    }
    // 3) N月の末（「7月の末」「9月末」「来年2月末」）。new Date(y, mo, 0) = mo 月の最終日
    for (const { m, a, b } of findAll(new RegExp(YEAR_PREFIX + '(\\d{1,2})月の?末', 'g'))) {
      const mo = +m[3];
      if (mo < 1 || mo > 12) continue;
      const y = explicitYear(m[1], m[2]);
      const d = y != null
        ? new Date(y, mo, 0)
        : nearestBy(today, (k) => new Date(today.getFullYear() + k, mo, 0), () => true);
      pushCand(d, a, b, (y != null || !d) ? null : { source: 'inferred', why: `年は言っていないため、今日に最も近い${d.getFullYear()}年として解釈` });
    }
    // 3.5) 月末（来月の末 / 今月の末 / 来月末 / 今月末 / 月末。「の」を許す＝実発話FB。
    //      素の「末」は拾わない＝「週末」を月末と誤読しないため）
    for (const { m, a, b } of findAll(/(来月|今月)の?末|月末/g)) {
      const shift = m[1] === '来月' ? 1 : 0;
      // new Date(y, m+1, 0) = その月の最終日
      pushCand(new Date(today.getFullYear(), today.getMonth() + shift + 1, 0), a, b);
    }
    // 4) N{日|週間|か月|年}後（相対。実発話FB「一か月後旅行」から。素のN日より先に拾う）
    //    「1ヵ月後の今日」の「の今日」も同じ日付なので一緒に消費（実発話FB: 複数日付と誤判定していた）
    for (const { m, a, b } of findAll(/([0-9]+|[一二三四五六七八九]?十[一二三四五六七八九]?|[一二三四五六七八九])(日|週間|[かヶヵカケ箇]月|年)後(?:の(?:今日|きょう))?/g)) {
      const n = jpNum(m[1]);
      if (n == null || n === 0) continue;
      const unit = m[2];
      let d;
      if (unit === '日') d = addDays(today, n);
      else if (unit === '週間') d = addDays(today, n * 7);
      else if (unit === '年') d = addMonthsClamped(today, n * 12);
      else d = addMonthsClamped(today, n); // ◯か月
      pushCand(d, a, b);
    }
    // 4.5) 相対時刻「N分後」「N時間(半)後」「N時間N分後」（v34・実データ由来の宿題）: 開始 = 今 + Δ。
    //    その時点の「日」を日付候補として積み、時刻は時刻確定の後に補完する（「今」v27 と同じ流儀）
    //    ＝「明日 30分後」のような矛盾は日付の複数候補として素通しになる（創作しない）。
    //    🚨 「後ろ」を食わない: 「30分後ろ倒し」（差分修正＝v1 の主戦場）を相対時刻と誤読しない → 後(?!ろ)。
    //    🚨 「15時30分後」の「30分」は時刻の一部: 直前が「時」なら拾わない。
    let relTime = null;
    for (const { m, a, b } of findAll(new RegExp(`(?:(${TNUM})時間(?:(${TNUM})分|(半))?|(${TNUM})分)後(?!ろ)`, 'g'))) {
      if (a > 0 && text[a - 1] === '時') continue; // 「15時30分後」の誤読ガード
      let delta;
      if (m[4] !== undefined) {
        delta = jpNum(m[4]);
      } else {
        const hN = jpNum(m[1]);
        const extra = m[3] ? 30 : (m[2] !== undefined ? jpNum(m[2]) : 0);
        delta = (hN == null || extra == null) ? null : hN * 60 + extra;
      }
      if (delta == null || delta <= 0) continue;
      const target = new Date(now.getTime() + delta * 60000);
      pushCand(startOfDay(target), a, b);
      relTime = { h: target.getHours(), min: target.getMinutes(), day: fmtDate(startOfDay(target)), a, b };
    }
    // 5) 相対日（長いものから。一昨日は昨日を、明々後日は明後日/明日を含むので順序が大事）
    //    過去（昨日/一昨日）も埋める＝実績の記録という用途が実在（実発話FB）
    const REL = [
      [/一昨日|おととい/g, -2],
      [/明々後日|明明後日|しあさって/g, 3],
      [/明後日|あさって/g, 2],
      [/昨日|きのう/g, -1],
      [/明日|あした|あす/g, 1],
      [/今日|きょう|本日/g, 0],
    ];
    for (const [re, days] of REL) {
      for (const { a, b } of findAll(re)) pushCand(addDays(today, days), a, b);
    }
    // 5.5) 「今」「現在」= 今日（＋時刻も現在。時刻の補完は下の「今の時刻」で行う）。v27・メモ用途。
    //    🔴 **「今」単独を素で拾ってはいけない**: 日本語は語境界が無く「今」は語の中に自然に現れる
    //    （今井/今川/今泉/今田・今日/今週/今月/今年/今度…）→ 「今井さんと会議」が「井さんと会議」に
    //    化ける＝v22 で「場所 メモリアルホール」を理由に複数欄分割を却下したのと同じ silent wrong answer。
    //    → **後ろが区切り（空白・読点・文末）の「今」**と、**それ自体で完結した語**だけを拾う。
    //    拾えなかった「今牛乳買う」等は、保存アダプタの「日時を何も言わない → 今の日時」（v27）が
    //    結果的に救う＝2つの仕組みが補い合う（タイトルに「今」が残るのは素通しの痕跡＝v7）。
    for (const { a, b } of findAll(/現在|たった今|ただいま|今すぐ|今から|今(?=[\s、。]|$)/g)) {
      pushCand(today, a, b);
      nowSpan = { a, b };
    }
    // 6) 曜日（再来週/来週/今週/先週/素。「来週の月曜」の「の」も許す＝実発話FB）
    for (const { m, a, b } of findAll(/(再来週|来週|今週|先週)?の?(月|火|水|木|金|土|日)曜日?/g)) {
      const scope = m[1] || '';
      const wd = JP_WEEKDAY[m[2]];
      const thisMonday = addDays(today, -weekIdxMon(today));
      let d;
      if (scope === '来週') d = addDays(thisMonday, 7 + wd);
      else if (scope === '再来週') d = addDays(thisMonday, 14 + wd);
      else if (scope === '先週') d = addDays(thisMonday, -7 + wd);
      else if (scope === '今週') d = addDays(thisMonday, wd); // 過去でも埋める（実績記録の用途）
      else {
        // 素の曜日 = 直近の未来（今日を含む）
        d = addDays(today, (wd - weekIdxMon(today) + 7) % 7);
      }
      pushCand(d, a, b);
    }
    // 7) 素のN日。月は言っていない → 最も近い月（7/16 の「20日」= 今月20日、7/28 の「5日」= 来月5日）。
    //    「N日間」「7月N日」「N日後」等は除外/消費済み。31日 が無い月の候補は valid で弾く
    for (const { m, a, b } of findAll(/(\d{1,2})日(?![間時分月])/g)) {
      const da = +m[1];
      if (da < 1 || da > 31) continue;
      const d = nearestBy(
        today,
        (k) => new Date(today.getFullYear(), today.getMonth() + k, da),
        (c) => c.getDate() === da
      );
      pushCand(d, a, b, d ? { source: 'inferred', why: `月は言っていないため、今日に最も近い${d.getMonth() + 1}月として解釈` } : null);
    }

    // 日付の確定判定：ユニークな日が1つだけなら採用（同じ日を2回言うのは OK）
    let dateStr = null, dateProv = null;
    const uniqueDays = [...new Set(dateCands.map((c) => fmtDate(c.date)))];
    if (uniqueDays.length === 1) {
      dateStr = uniqueDays[0];
      for (const c of dateCands) consume(c.a, c.b);
      // v55: 出所。同じ日を複数の言い方で言った時（「今日20日」）は、選択の無かった方（transcript）を代表に
      const pick = dateCands.find((c) => c.meta.source === 'transcript') || dateCands[0];
      dateProv = provOf(pick.meta, pick.a, pick.b);
    } else if (uniqueDays.length > 1) {
      notes.push(`日付らしき言葉が複数あるため（${uniqueDays.join(' / ')}）日付は入れていません`);
      // consume しない＝全部タイトルに残る
    }

    // ===== 時刻の収集 =====
    // 時刻表現: (午前|午後|朝|昼|夜|夕方|晩)? H時[半|M分] ／ 正午 ／ H:MM（数は算用数字＋漢数字 v34）
    const TIME_RE = new RegExp(`(午前|午後|朝|昼|夜|夕方|晩)?(?:(${TNUM})時(?!間)(?:\\s*(半(?!分)|(${TNUM})分))?|正午|(\\d{1,2}):(\\d{2}))`, 'g');
    // → {h, min, ambiguous, a, b}
    function resolveTime(m) {
      if (m[0].includes('正午')) return { h: 12, min: 0, ambiguous: false };
      const qual = m[1] || '';
      let h, min = 0;
      if (m[5] !== undefined) { h = +m[5]; min = +m[6]; } // H:MM
      else {
        h = jpNum(m[2]);
        if (m[3] === '半') min = 30;
        else if (m[4] !== undefined) min = jpNum(m[4]);
      }
      if (h == null || min == null || h > 24 || min > 59) return null;
      let ambiguous = false;
      if (qual === '午後') h = h < 12 ? h + 12 : h;
      else if (qual === '午前' || qual === '朝') { /* そのまま */ }
      else if (qual === '夜' || qual === '夕方' || qual === '晩' || qual === '昼') h = h < 12 ? (h === 12 ? 12 : h + 12) : h;
      else if (h >= 1 && h <= 6) ambiguous = true; // 修飾なし 1〜6時 = 午前/午後が決められない
      if (qual === '昼' && h === 24) return null;
      if (h === 24) h = 0; // 「24時」= 翌 0:00 として扱う（日またぎは範囲側で処理）
      return { h, min, ambiguous };
    }
    const timeCands = [];
    for (const { m, a, b } of findAll(TIME_RE)) {
      if (!isFree(a, b)) continue;
      const t = resolveTime(m);
      if (t) timeCands.push({ ...t, a, b, raw: m[0] });
    }

    // 範囲ペアリング：隣接する2つの時刻の間が「から/〜」なら start–end
    let startT = null, endT = null, dayCross = false;
    if (timeCands.length >= 2) {
      const t1 = timeCands[0], t2 = timeCands[1];
      const between = text.slice(t1.b, t2.a);
      if (/^(から|〜)$/.test(between)) {
        if (t1.ambiguous) {
          notes.push(`時刻「${t1.raw}」は午前/午後が曖昧なので入れていません`);
        } else {
          startT = t1;
          consume(t1.a, t2.a); // t1 + 「から/〜」
          const endsBeforeStart = t2.h * 60 + t2.min <= t1.h * 60 + t1.min;
          if (t2.ambiguous && !(endsBeforeStart && t1.h >= 18)) {
            notes.push(`終了時刻「${t2.raw}」は午前/午後が曖昧なので入れていません`);
          } else {
            endT = t2;
            if (endsBeforeStart) dayCross = true; // 22時から2時 → 翌日 2:00
            consume(t2.a, t2.b);
            const after = text.slice(t2.b);
            if (after.startsWith('まで')) consume(t2.b, t2.b + 2);
          }
        }
      }
    }
    // 単独時刻（範囲が成立しなかった場合）
    if (!startT) {
      const clear = timeCands.filter((t) => !t.ambiguous);
      const amb = timeCands.filter((t) => t.ambiguous);
      if (clear.length === 1) {
        const t = clear[0];
        const after = text.slice(t.b);
        // 「今からX時まで」（v34・TODO の実測: 従来は開始が X時 に化けていた）:
        // 「今」を言っていて時刻の直後が「まで」なら、その時刻は**終了**。開始は下の「今」補完が入れる。
        if (nowSpan && dateStr === fmtDate(today) && after.startsWith('まで')) {
          endT = t;
          if (t.h * 60 + t.min <= now.getHours() * 60 + now.getMinutes()) dayCross = true; // 「今から0時まで」= 翌日
          consume(t.a, t.b + 2);
          // 「現在から15時まで」の「から」を食べ残さない（「今から」は now 語彙が丸ごと消費済み）
          if (t.a >= 2 && text.slice(t.a - 2, t.a) === 'から' && isFree(t.a - 2, t.a)) consume(t.a - 2, t.a);
        } else {
          startT = t;
          consume(t.a, t.b);
          if (after.startsWith('から')) consume(t.b, t.b + 2);
        }
      } else if (clear.length > 1) {
        notes.push('時刻らしき言葉が複数あるため時刻は入れていません');
      }
      for (const t of amb) notes.push(`時刻「${t.raw}」は午前/午後が曖昧なので入れていません`);
    }

    // 相対時刻の補完（v34）: 「30分後」等は、その日が日付として採用された時だけ時刻を入れる（「今」と同じ流儀）。
    // 明示の時刻が別にあればそちらが勝つ＝人の指定を上書きしない（v9）。
    if (relTime && !startT && dateStr === relTime.day) {
      startT = { h: relTime.h, min: relTime.min, ambiguous: false, raw: '相対時刻', a: relTime.a, b: relTime.b };
    }
    // 「今」の時刻補完（v27）: 日付は既に今日として確定・消費済み。時刻を言っていなければ現在時刻を入れる。
    // 時刻を別に言っていればそちらが勝つ（「今から15時まで」＝開始15時ではなく…は範囲側で処理される）。
    // 「今」が日付として採用されなかった時（他の日付と衝突＝素通し）は時刻も入れない＝創作しない。
    if (nowSpan && !startT && dateStr === fmtDate(today)) {
      startT = { h: now.getHours(), min: now.getMinutes(), ambiguous: false, raw: '今', a: nowSpan.a, b: nowSpan.b };
    }

    // 継続時間：「(から)N時間(半)」があれば end = start + N時間（数は漢数字も可 v34。
    // 「2時間後」は相対時刻＝継続と誤読しない → 後 を除外）
    if (startT && !endT) {
      for (const { m, a, b } of findAll(new RegExp(`(${TNUM})時間(半)?(?!後)`, 'g'))) {
        if (!isFree(a, b)) continue;
        const nH = jpNum(m[1]);
        if (nH == null) continue;
        const durMin = nH * 60 + (m[2] ? 30 : 0);
        const total = startT.h * 60 + startT.min + durMin;
        endT = { h: Math.floor(total / 60) % 24, min: total % 60, a, b };
        if (total >= 24 * 60) dayCross = true;
        consume(a, b);
        if (a >= 2 && text.slice(a - 2, a) === 'から' && isFree(a - 2, a)) consume(a - 2, a);
        break;
      }
    }

    // ===== patch 合成 =====
    const patch = {};
    const prov = {}; // v55: 欄ごとの出所（patch に入れた欄だけキーを持つ）
    // 時刻の出所: 明示時刻・「30分後」・「今」いずれも定義的に1つへ解決する＝transcript（span は根拠の言葉）
    const timeProv = (t) => (t && t.a != null ? provOf(null, t.a, t.b) : { source: 'transcript', span: null });
    if (allDay) {
      if (startT) notes.push('「終日」と時刻が両方あるため、時刻を優先しています');
      else {
        patch.allDay = true;
        prov.allDay = allDaySpan ? provOf(null, allDaySpan.a, allDaySpan.b) : { source: 'transcript', span: null };
      }
    }
    // 時刻だけで日付がない → まだ来ていなければ今日、過ぎていれば明日（決め打ちルール）
    let effDateStr = dateStr, effDateProv = dateProv;
    if (!effDateStr && startT) {
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const tMin = startT.h * 60 + startT.min;
      const isToday = tMin > nowMin;
      effDateStr = fmtDate(isToday ? today : addDays(today, 1));
      // 今日/明日の2候補から now 比較で選んだ＝inferred（span は根拠になった時刻の言葉を指す）
      effDateProv = {
        source: 'inferred',
        span: startT.a != null ? { a: startT.a, b: startT.b, quote: text.slice(startT.a, startT.b) } : null,
        why: isToday ? '日付は言っていないため、この時刻がまだ来ていない今日として解釈' : '日付は言っていないため、この時刻が過ぎているので明日として解釈',
      };
    }
    if (effDateStr) {
      patch.startDate = effDateStr;
      if (effDateProv) prov.startDate = effDateProv;
    }
    if (startT) {
      patch.startTime = fmtTime(startT.h, startT.min);
      prov.startTime = timeProv(startT);
    }
    if (endT) {
      patch.endTime = fmtTime(endT.h, endT.min);
      prov.endTime = timeProv(endT);
      if (effDateStr) {
        const [y, mo, da] = effDateStr.split('-').map(Number);
        patch.endDate = fmtDate(addDays(new Date(y, mo - 1, da), dayCross ? 1 : 0));
        // 終了日は言っていない: 日またぎは「翌日」を選んだ推論・それ以外は開始日の出所をそのまま引き継ぐ
        prov.endDate = dayCross
          ? { source: 'inferred', span: prov.endTime.span, why: '終了時刻が開始より前のため、翌日に終わる予定として解釈' }
          : (effDateProv ? { ...effDateProv } : { source: 'inferred', span: null, why: '終了日は言っていないため開始と同じ日として解釈' });
      }
    }

    // ===== タイトル（消費されなかった残り） =====
    let leftover = '';
    for (let i = 0; i < text.length; i++) if (!consumed[i]) leftover += text[i];
    // 依頼の言い回し（「〜の予定を入れて」等）を尾から剥がす
    leftover = leftover.replace(/(の)?(予定|よてい)?(を|も)?(入れて|いれて|追加して|追加|登録して|登録|お願いします|お願い)(ください)?[。．\s]*$/u, '');
    // 端に残った助詞・句読点を落とす（内部の「と」「の」は保持）
    leftover = leftover.replace(/^[にへでをはがのとかも、。．\s]+/u, '').replace(/[にへでをはがの、。．\s]+$/u, '');
    leftover = leftover.replace(/\s+/g, ' ').trim();
    if (leftover) {
      // v58: 長い発話は「タイトル＝簡素・メモ＝話した全文」に分ける（上の splitLongUtterance 参照）
      const split = splitLongUtterance(leftover);
      patch.title = split.title;
      // title は消費されなかった断片の寄せ集め＝全て発話由来（素通し）。複数スパンの合成なので span は持たない
      prov.title = { source: 'transcript', span: null };
      if (split.note) {
        patch.note = split.note;
        prov.note = { source: 'transcript', span: null };
      }
    }

    return { patch, notes, normalizedText: text, prov };
  }

  const api = { interpret, normalize, isFillerOnly };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.VCParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
