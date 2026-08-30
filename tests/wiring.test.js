// tests/wiring.test.js — index.html の**配線**を縛る（node tests/wiring.test.js）
//
// なぜ必要か（v74 で実機が壊れた場所・2026-07-30）:
// ユニットテストは engine/ adapters/ の純関数しか見ない＝**index.html の配線は誰も検証しない**。
// v74 の真因はまさにそこだった: v54 が「保存」ボタンにだけ `editingRec ? 更新 : 新規` の分岐を入れ、
// v44 の2つ目の保存ボタン（🔤 辞書に登録して保存）は `doSave()` を直呼びしたまま残った
// ＝ 直している最中に辞書ボタンを押すと新規保存が走り、改正volN が付かず・台帳の行が増え・
// 編集バナーが残った。**どちらのファイルも単体では正しく、テストも全部通っていた。**
//
// 教訓＝「入口を足す」より「**分岐を足す**」方が危ない。分岐は複製せず1箇所に持つのが唯一の
// 構造的な防御なので、その「1箇所」であることをここで機械的に固定する。
// v75（来歴からも保存済みを直せる）で編集の入口が2つ（リストの ✏️ / 来歴の ✏️）になったため、
// 同じ事故が起きうる形が実際に増えた＝このテストを新設した。
//
// ⚠ 限界: これはソースの構造を見るだけで、**実際に動くか**は見ていない（実挙動は実ブラウザと実機）。
//   行頭のコメント行は除いて数える（コメント内の `doSave()` を実コードと数えないため）。
'use strict';
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// 行頭コメント（// ... / * ... / /* ... ）を落とした「実コードだけ」のソース。
// 行の途中の // は落とさない（文字列中の https:// を壊さないため）＝その行には実コードもある。
const code = html
  .split('\n')
  .filter((ln) => {
    const t = ln.trim();
    return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
  })
  .join('\n');

let pass = 0;
const fail = [];
function t(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail.push(`✗ ${name}\n    ${e.message}`); }
}
function ok(cond, label) { if (!cond) throw new Error(label || 'false だった'); }

// 関数の本体を波括弧の対応で切り出す（正規表現だけだと入れ子で誤る）
function bodyOf(name) {
  const m = code.match(new RegExp(`function ${name}\\s*\\([^)]*\\)\\s*\\{`));
  if (!m) throw new Error(`function ${name} が見つからない`);
  let i = m.index + m[0].length - 1;
  let depth = 0;
  for (let j = i; j < code.length; j++) {
    if (code[j] === '{') depth++;
    else if (code[j] === '}') { depth--; if (depth === 0) return code.slice(i, j + 1); }
  }
  throw new Error(`function ${name} の本体を閉じられない`);
}
const countOf = (re) => (code.match(re) || []).length;

// ===== 1. 保存の分岐は1箇所（v74 の再発防止・この製品でいちばん高くついたバグ） =====
t('保存の分岐は runSave 1箇所（doSave の直呼びは自動保存だけ）', () => {
  const lines = code.split('\n').filter((ln) => /doSave\s*\(/.test(ln));
  ok(lines.length > 0, 'doSave が消えている（名前を変えたならこのテストも直す）');
  for (const ln of lines) {
    const isDef = /(async )?function doSave\s*\(/.test(ln);
    const isRunSave = /function runSave/.test(ln);
    const isAuto = /doSave\(\{\s*auto:\s*true\s*\}\)/.test(ln);
    ok(isDef || isRunSave || isAuto,
      `doSave を直呼びしている行がある（保存の入口は runSave を通す）:\n      ${ln.trim()}`);
  }
});

t('runSave が「直している最中か」で行き先を分ける唯一の場所', () => {
  ok(/function runSave\s*\([^)]*\)\s*\{[^}]*editingRec\s*\?/.test(code),
    'runSave の中に editingRec の分岐が無い');
  // 保存ボタンも辞書ボタンも runSave を呼ぶ（v44 の2つ目の入口が doSave へ戻っていないこと）
  ok(countOf(/runSave\s*\(/g) >= 3, '保存の入口（保存ボタン・辞書ボタン）が runSave を通っていない');
});

// ===== 2. 編集の開始も1箇所（v75 で入口が2つになった） =====
t('編集中の状態を立てるのは startEditRecord だけ（入口が増えても本体は1つ）', () => {
  ok(countOf(/editingRec\s*=\s*\{/g) === 1,
    'editingRec を立てている場所が1箇所でない＝編集開始のロジックが複製されている');
  ok(/editingRec\s*=\s*\{/.test(bodyOf('startEditRecord')),
    'editingRec を立てているのが startEditRecord の中でない');
});

t('来歴の ✏️ もリストの ✏️ と同じ道（startEditRecord）を通る', () => {
  const body = bodyOf('editSavedFromHistory');
  ok(/startEditRecord\s*\(/.test(body), '来歴の ✏️ が独自の編集処理を持っている（v74 と同じ形の事故）');
  // 描画の後に台帳から消えている可能性があるので、押した時に現物を引き直す
  ok(/VCRecords\.find\s*\(/.test(body), '押した時に台帳の現物を引き直していない（幽霊の行を直しうる）');
  ok(/renderHistory\s*\(/.test(body), '消えていた時に来歴を撮り直していない（押せるのに直せない ✏️ が残る）');
});

// ===== 3. 来歴に「保存した」と刻むのも1箇所 =====
t('来歴に保存を刻むのは markHistorySaved だけ', () => {
  ok(countOf(/\.saved\s*=\s/g) === 1, '来歴の saved を書いている場所が1箇所でない');
  ok(/\.saved\s*=\s/.test(bodyOf('markHistorySaved')), 'saved を書いているのが markHistorySaved の外');
});

// 🚨 v75 の肝: 刻む相手を **at で名指す**。v33-v74 は「先頭行＝その発話」と決め打っていたが、
//   ①来歴の × で先頭を消せる ②手動保存は発話から時間が空く ③保存は await を挟む＝その間に
//   次の発話が積まれ得る ＝ 先頭が別の発話になっている経路が3つある。決め打ちに戻すと
//   **別の発話に 💾 と ✏️ が付く**＝押すと関係ない記録がフォームに載る（黙って作らない・v52）。
t('markHistorySaved は at で行を名指す（先頭決め打ちに戻さない）', () => {
  const body = bodyOf('markHistorySaved');
  ok(/findIndex/.test(body) && /\.at\s*===\s*at|at\s*===\s*e\.at/.test(body),
    'at で来歴の行を探していない＝先頭決め打ちに戻っている');
  ok(/if\s*\(i\s*<\s*0\)\s*return/.test(body),
    'その発話の行が無い時に return していない＝別の行に刻んでしまう');
  ok(countOf(/h\[0\]\.saved/g) === 0, 'h[0] への直書きが復活している');
});

t('保存した発話の行だけが ✏️ を持てる（台帳の行 id を控えている）', () => {
  ok(/savedId/.test(bodyOf('markHistorySaved')), 'markHistorySaved が台帳の行 id を控えていない');
  ok(/recId/.test(bodyOf('doSave')), 'doSave が台帳の行 id を渡していない＝来歴から直せない');
  // 発話が無い保存（手入力だけ・編集ロード後）は刻まない＝発話を創作しない
  ok(/utterAt/.test(bodyOf('doSave')), 'doSave が「どの発話の保存か」を持っていない');
});

// ===== 4. 台帳が変わったら来歴の ✏️ も撮り直す（付け忘れが起きない形か） =====
t('台帳の描画は来歴も撮り直す（消えた行の ✏️ を残さない）', () => {
  const body = bodyOf('renderRecords');
  ok(/renderHistory\s*\(/.test(body),
    'renderRecords が来歴を撮り直していない＝削除・全消しの後に幽霊の ✏️ が残る');
  // 早期 return のある描画本体と分けてある＝0件（全消し直後）でも来歴が撮り直される
  ok(/renderRecordsList\s*\(/.test(body), '描画本体が分かれていない＝早期 return で来歴が取り残される');
});

// ===== 5. 録音も「入口2つ・道1本」（v77 で下の固定マイクバーが増えた） =====
// v77 で録音の入口が2つになった（上の丸いマイク／下の固定バー）＝ v74 の実バグ（保存の入口が2つで
// 道が2本あり、後から足した分岐が片方に配線されていなかった）とまったく同じ形が作れる場所になった。
// 数え方は「関数の本体に何回あるか」と「ソース全体に何回あるか」の一致で見る
// （行の一致だと `function f() { ... }` の1行書きで body に行全体が入らず誤検知する＝実際に踏んだ）
const inBody = (name, re) => ((bodyOf(name).match(re) || []).length);

t('録音の開始/停止は toggleMic 1本（transcriber.toggle を直呼びしない）', () => {
  const all = countOf(/transcriber\.toggle\s*\(/g);
  ok(all > 0, 'transcriber.toggle が消えている（名前を変えたならこのテストも直す）');
  const inside = inBody('toggleMic', /transcriber\.toggle\s*\(/g);
  ok(all === inside, `transcriber.toggle を toggleMic の外で呼んでいる（外に ${all - inside} 箇所）`);
  ok(countOf(/toggleMic\b/g) >= 3, '録音の入口（上のマイク・下のバー）が toggleMic を通っていない');
});

t('「やめる」も cancelMic 1本（入口が増えても取り消しの中身は複製しない）', () => {
  const all = countOf(/transcriber\.cancel\s*\(\s*\)/g);
  ok(all > 0, 'transcriber.cancel が消えている（名前を変えたならこのテストも直す）');
  const inside = inBody('cancelMic', /transcriber\.cancel\s*\(\s*\)/g);
  ok(all === inside, `transcriber.cancel を cancelMic の外で呼んでいる（外に ${all - inside} 箇所）`);
  ok(countOf(/cancelMic\b/g) >= 3, '「やめる」の入口（上・下）が cancelMic を通っていない');
});

// 🚨 v77 の肝: 録音中の**見た目**も1箇所。v76 までは onState と「やめる」の2箇所で同じ見た目を
//   書いていた＝下のバーが増えた時点で「片方だけ直して食い違う」（上は録音中の赤、下は待機中の顔）
//   が成立する。見た目の食い違いは v3（store と画面のズレ）と同じ種類の事故＝画面が嘘をつく。
t('録音中の見た目を触るのは renderMicState だけ', () => {
  ok(/function renderMicState/.test(code), 'renderMicState が無い（見た目の反映が散っている）');
  const body = bodyOf('renderMicState');
  for (const [label, re] of [['micCancelBtn.hidden', /micCancelBtn\.hidden\s*=/g], ["mic の listening", /micBtn\.classList\.toggle\s*\(\s*'listening'/g]]) {
    const all = countOf(re), inside = (body.match(re) || []).length;
    ok(all === inside, `${label} を renderMicState の外で書いている（外に ${all - inside} 箇所）`);
  }
  // 下のバーも同じ関数の中で一緒に切り替わる（上だけ赤い、を作らない）
  ok(/dockMic/.test(body) && /dockCancel/.test(body), 'renderMicState が下の固定バーを切り替えていない');
});

t('下の固定バーは「上のマイクが画面外の時だけ」出す（判定は1箇所）', () => {
  ok(countOf(/micDock\.hidden\s*=/g) === 1,
    '下のバーの表示を書いている場所が1箇所でない＝条件が食い違う');
  ok(/micBtn\.getBoundingClientRect/.test(bodyOf('syncDock')),
    'syncDock が上のマイクの位置を見ていない＝2つのマイクが同時に見える／どこにも出ない');
  // きっかけは2つとも残す。IO だけにすると IO が効かない環境で出なくなり、scroll だけにすると
  // スクロールのたびに JS が走る。**判定は syncDock 1箇所**なので、きっかけが増えても食い違わない。
  ok(/IntersectionObserver\(syncDock/.test(code), 'IntersectionObserver から syncDock を呼んでいない');
  ok(/addEventListener\('scroll', syncDock/.test(code), 'スクロールで見直していない＝出たきり／出ないままになる');
});

// ===== 6. 録音中の「専用画面」（v78・ゆう要求） =====
// 専用画面はフォームを完全に覆う＝ここで配線が2本に割れると、
// ①専用画面のボタンだけ古い挙動 ②閉じ忘れてフォームに戻れない、という**本体を殺す**壊れ方をする（v13）。
// だから「同じノードを化けさせているだけ」であることを構造として固定する。
t('専用画面は同じノードを化けさせる（ボタンを複製していない）', () => {
  ok(/id="micStage"/.test(html), '#micStage が無い（専用画面の器が消えている）');
  const from = html.indexOf('id="micStage"');
  const to = html.indexOf('<div class="notes"');
  ok(to > from, '#micStage の後に notes が無い＝構造が変わった（このテストも直す）');
  const inner = html.slice(from, to);
  for (const id of ['id="mic"', 'id="micCancel"', 'id="ovNoAuto"', 'id="ovAI"', 'id="transcript"']) {
    ok(inner.includes(id), `${id} が専用画面の中に無い＝録音中に見えない／別物を出している`);
    ok(html.split(id).length - 1 === 1,
      `${id} が2つある＝専用画面用に複製している（配線が2本＝v74 と同じ形の事故）`);
  }
});

t('専用画面の出し入れは renderMicState だけ（上のマイク・下のバーと必ず同時）', () => {
  const re = /classList\.toggle\(\s*'recording'/g;
  ok(countOf(re) === 1, '専用画面を付け外ししている場所が1箇所でない＝赤いのに画面が出ない等の食い違いを作れる');
  ok(re.test(bodyOf('renderMicState')) || /classList\.toggle\(\s*'recording'/.test(bodyOf('renderMicState')),
    '専用画面の付け外しが renderMicState の外にある');
});

t('専用画面が出ている間は下の固定バーを出さない（判定は syncDock 1箇所のまま）', () => {
  ok(/'recording'/.test(bodyOf('syncDock')),
    'syncDock が録音中を見ていない＝専用画面の上に下のバーが重なる（同じ操作が2つ見える）');
  ok(/syncDock\s*\(\s*\)/.test(bodyOf('renderMicState')),
    'renderMicState が syncDock を呼んでいない＝専用画面を出してもバーが残る');
});

// 🚨 専用画面はフォームを覆う＝閉じる道が壊れると本体（保存・手入力）に届かなくなる（v13 の再来）。
t('録音が死んだら専用画面を閉じる（フォームに閉じ込めない）', () => {
  ok(/if\s*\(!transcriber\.isListening\(\)\)\s*renderMicState\(false\)/.test(code),
    'エラー時に専用画面を閉じる保険が無い＝録音が死ぬとフォームへ戻れない');
});

// ===== 7. ホーム長押し「リスト」が録音に覆われない（v79・実機FB第44回） =====
// 症状「新規で開こうとするとリストではなく録音ボタンになる」の正体＝**リストは開いていた**。
// 上に v78 の専用画面（不透明な全画面層）が被っていただけ。
// 🔑 native がリストの指示を届けるのと、自動録音（v24）が実際に始まる（native から listening が返る）のは
//    **どちらが先か決まっていない**＝片方だけの対処では必ず取りこぼす。だから門が3つ要る。
t('リストの意図は autoRecord を止める（指示が先に届いた場合）', () => {
  ok(/let listIntent/.test(code), 'listIntent が無い（名前を変えたならこのテストも直す）');
  ok(/listIntent/.test(bodyOf('autoRecord')),
    'autoRecord が listIntent を見ていない＝リストを開いた直後に録音が始まって覆う');
});

t('録音が先なら引っ込める（判定は quietAutoRecordForList 1箇所・呼ぶ場所は2つ）', () => {
  const body = bodyOf('quietAutoRecordForList');
  ok(/transcriptEl\.textContent/.test(body),
    'まだ何も拾っていないかを見ていない＝喋った言葉を捨てることになる（v16 違反）');
  ok(/cancelMic\(/.test(body), '引っ込める道が cancelMic を通っていない＝取り消しの中身を複製している');
  ok(/__vcQuickAction\s*=\s*function[\s\S]{0,800}quietAutoRecordForList/.test(code),
    'リストの指示が届いた時に呼んでいない＝録音が先に始まっていた場合を取りこぼす');
  ok(/onState\(s\)\s*\{[\s\S]{0,800}quietAutoRecordForList/.test(code),
    '録音が始まった時に呼んでいない＝指示が先に届いた場合を取りこぼす（cold start の実際の順番）');
});

t('リストの意図は「マイクを押した」「アプリを離れた」で消える（居座らない）', () => {
  ok(/listIntent\s*=\s*false/.test(bodyOf('toggleMic')),
    'マイクを押しても意図が残る＝自分で始めた録音が引っ込められる');
  ok(/visibilityState\s*!==\s*'visible'[\s\S]{0,200}listIntent\s*=\s*false/.test(code),
    'アプリを離れた時に消えない＝一度長押しで開いた人の「起動＝即録音」が二度と戻らない');
});

// ===== 8. 長文を AI で整える（v80・ゆう要求） =====
// 🚨 これは**フォームの中身を機械が書き換える**唯一の手動操作＝守りが緩むと「押したら文章が変わっていた、
//    元に戻せない、しかも保存済み」が成立する。だから3つを構造で固定する。
t('整えるボタンは「キーがある」「長い」の両方で出す（判定は1箇所）', () => {
  const body = bodyOf('refreshRewriteRow');
  ok(/VCAI\s*&&\s*VCAI\.hasKey\(\)/.test(body), 'キーの有無を見ていない＝押せるのに動かないボタンが出る');
  ok(/VCRewrite\.isLongEnough/.test(body), '長さの判定を engine に任せていない＝閾値が2箇所に散る');
  // 行そのものを触ってよいのは判定関数の中だけ（他所から出し入れすると条件が食い違う）
  const re = /getElementById\('rewriteRow'\)/g;
  const all = countOf(re), inside = (body.match(re) || []).length;
  ok(all > 0 && all === inside, `rewriteRow を refreshRewriteRow の外で触っている（外に ${all - inside} 箇所）`);
  // 出す条件が変わったら見直される場所も固定。v89 でキーの反映点は refreshAiState に移した
  // （自動保存が入って「キーが変わる瞬間」が増えたため＝反映は1箇所に集める）。
  ok(/refreshRewriteRow\s*\(\s*\)/.test(bodyOf('refreshAiState')),
    'キーを保存/削除しても行が見直されない＝設定した直後に出ない／消しても残る');
  ok(/refreshAiState\s*\(\s*\)/.test(bodyOf('renderAiConfig')),
    '設定の描画が保存済みの姿を反映していない');
});

t('整えた結果は来歴に残り、↩ で戻せる（黙って書き換えない）', () => {
  const body = bodyOf('applyRewrite');
  ok(/logHistory\(/.test(body), '来歴に残していない＝何がいつ書き換わったか誰も見られない');
  ok(/after:\s*store\.snapshot\(\)/.test(body), '状態を撮っていない＝↩ が出ない（v18 の機構に乗っていない）');
  ok(/toast\(/.test(body), '結果を告げていない＝黙って書き換わる');
});

t('整えるだけ＝保存はしない（保存は不可逆・v28）', () => {
  for (const fn of ['applyRewrite', 'runRewrite']) {
    ok(!/\b(doSave|runSave)\s*\(/.test(bodyOf(fn)), `${fn} が保存を呼んでいる＝押しただけでカレンダーに入る`);
  }
});

t('人が書いたタイトルは触らない・切り方は parser と同じ関数', () => {
  const body = bodyOf('applyRewrite');
  ok(/getFieldOrigin\('title'\)\s*===\s*'voice'/.test(body),
    '人が書いたタイトルを潰す（v43 の不変条件を破る）');
  ok(/VCParser\.splitLongUtterance/.test(body),
    'タイトルの切り方を自前で書いている＝v58 と規則が2つに割れて静かにズレる');
});

// ===== 9. つぶやいた場所の地図（v81・ゆう要求） =====
t('「今出ている行」を決めるのは visibleRecords 1箇所（描画・CSV・地図が同じ道）', () => {
  ok(/function visibleRecords/.test(code), 'visibleRecords が無い');
  // 生の filter 式が復活していないか（v36 と描画で複製されていたものを v81 でまとめた）
  const raw = countOf(/kind === 'plan' \? recShowPlan\.checked/g);
  ok(raw === 1, `表示中の行を選ぶ式が ${raw} 箇所ある＝片方だけ直して食い違う（v74 と同じ形）`);
  ok(countOf(/visibleRecords\s*\(\s*\)/g) >= 3, '読み手（描画・CSV・地図）が同じ関数を通っていない');
});

t('地図は開くまで画像を取りに行かない（閉じている間は通信ゼロ）', () => {
  ok(/if\s*\(!box\.open\)\s*return/.test(bodyOf('refreshMap')),
    '閉じたままタイルを要求する＝黙って外部へ通信する（v38 の約束を破る）');
  ok(/getElementById\('mapBox'\)\.addEventListener\('toggle'/.test(code),
    '開いた時に描き始める配線が無い＝開いても白いまま');
});

t('地図の出典表示が在る（OpenStreetMap の利用条件）', () => {
  ok(/map-attr/.test(html) && /OpenStreetMap/.test(html), '出典表示が無い＝タイルを使う条件を満たさない');
});

// ===== 11-b. 地図の全画面（v90・ゆう要求） =====
// 全画面は「隠す」変更＝**外に置いてあったものが黙って見えなくなる**のがこの機能固有の壊れ方。
// （説明＝画面外の件数の申告 v16／選んだピンのカード＝押した結果）。ここを機械で見張る。
t('全画面は CSS で覆う（Fullscreen API は本命の実機で効かない）', () => {
  ok(/\.map-wrap\.full \{/.test(html), '全画面の規則が無い（名前を変えたならこのテストも直す）');
  ok(!/requestFullscreen|webkitRequestFullscreen|exitFullscreen/.test(code),
    'Fullscreen API を使っている＝iOS Safari / WKWebView は要素の全画面化を持たない（動かない道）');
});

t('全画面から必ず出られる（閉じ込めない・v78）', () => {
  ok(/function setMapFull/.test(code), 'setMapFull が無い');
  ok(/getElementById\('mapFull'\)\.addEventListener\('click'/.test(code), '全画面ボタンの配線が無い');
  // v91 で Esc は「上に居るものから閉じる」1箇所の判断になった（期間の板 → 地図の全画面）
  const esc = code.slice(code.indexOf("e.key !== 'Escape'"));
  ok(/e\.key !== 'Escape'/.test(code), 'Esc の受け口が無い＝出口が1つしか無い');
  ok(/closePeriodSheet\(\)/.test(esc.slice(0, 400)) && /setMapFull\(false\)/.test(esc.slice(0, 400)),
    'Esc が上から順に閉じていない（板を開いたまま地図だけ閉じる／どちらも閉じない）');
  const toggle = code.slice(code.indexOf("getElementById('mapBox').addEventListener('toggle'"));
  ok(/setMapFull\(false\)/.test(toggle.slice(0, 400)),
    '地図の段を畳んでも全画面が残る＝出口の無い画面ができる');
  ok(/if \(mapFull\) setMapFull\(false\);/.test(bodyOf('refreshMap')),
    '点が無くなった時に全画面から出ない＝器ごと隠れて中の説明も消える');
});

t('全画面では説明と選んだピンのカードも地図の中へ移す（外は見えない）', () => {
  const body = bodyOf('setMapFull');
  ok(/wrap\.appendChild\(hint\)/.test(body) && /wrap\.appendChild\(sel\)/.test(body),
    '全画面で説明・選択カードを地図の中へ移していない＝画面外の件数もピンを押した結果も見えない');
  ok(/mapHintHome/.test(body) && /mapSelHome/.test(body),
    '元の置き場所へ戻していない＝一度全画面にすると通常表示が壊れる');
  ok(/\.map-wrap\.full \.map-hint/.test(html) && /\.map-wrap\.full \.map-sel/.test(html),
    '移した先の見た目の規則が無い＝地図に重ねただけで読めない');
});

t('全画面の重なりは dock より上・録音より下（v86 の表に載せる）', () => {
  const fullZ = Number((html.match(/\.map-wrap\.full \{[\s\S]*?z-index:\s*(\d+)/) || [])[1]);
  const dockZ = Number((html.match(/\.dock \{[\s\S]*?z-index:\s*(\d+)/) || [])[1]);
  const micZ = Number((html.match(/body\.recording #micStage \{[\s\S]*?z-index:\s*(\d+)/) || [])[1]);
  const toastZ = Number((html.match(/\.toast[\s\S]*?z-index:\s*(\d+)/) || [])[1]);
  ok(fullZ > dockZ, `全画面(${fullZ}) が下のバー(${dockZ}) の下＝地図の上にバーが残る`);
  ok(fullZ < micZ, `全画面(${fullZ}) が録音中の画面(${micZ}) 以上＝録音が始まっても本体が見えない`);
  ok(fullZ < toastZ, `全画面(${fullZ}) が toast(${toastZ}) 以上＝告げるものが隠れる（v86 の実バグ）`);
});

// 🔴 v90 で見つかった実バグ（v81 から在った・全画面の E2E が暴いた）: `pointerdown` で即
//    `setPointerCapture` すると、**その後の click は捕まえた要素に届く**＝中のピンの click は一生来ない。
//    説明文は「点を押すと内容が出ます」と言っていた＝画面が嘘をついていた。
t('地図を掴むのは動き始めてから（押しただけではピンの click を奪わない）', () => {
  const drag = code.slice(code.indexOf('function wireMapDrag'));
  const body = drag.slice(0, drag.indexOf('\n})();'));
  const down = body.slice(body.indexOf("addEventListener('pointerdown'"), body.indexOf("addEventListener('pointermove'"));
  ok(!/setPointerCapture/.test(down),
    'pointerdown で捕まえている＝ピンを押しても選べない（v81 の実バグそのもの）');
  ok(/setPointerCapture/.test(body.slice(body.indexOf("addEventListener('pointermove'"))),
    '動き始めても捕まえない＝指が地図から外れるとドラッグが切れる');
  ok(/MAP_DRAG_SLOP/.test(body), '閾値が無い＝指の揺れでタップが地図の移動になる');
});

t('点が無い時は描かない（説明文を上書きしない）', () => {
  ok(/!mapPoints\.length\) return/.test(bodyOf('drawMap')),
    '0件でも描く＝「位置が付かない理由」を「0件の位置。ドラッグで…」で上書きする（E2E で発覚）');
});

t('大きさが変わったら描き直す（全画面の出入り・回転）', () => {
  ok(/addEventListener\('resize'/.test(code), 'resize を見ていない＝回転するとタイルがズレたまま');
  ok(/clearTimeout\(mapResizeTimer\)/.test(code), 'まとめずに毎回描き直す＝連続 resize でちらつく');
  ok(/requestAnimationFrame\(\(\) => drawMap\(\)\)/.test(bodyOf('setMapFull')),
    '全画面に切り替えた直後に測っている＝class を当てる前の古い大きさで描く（v78 の親戚）');
});

// ===== 11-c. 期間で絞る（v91・ゆう要求） =====
// この機能の固有の壊れ方＝**絞っているのに気づかず「保存した行が消えた」と読む**こと。
// だから「1箇所で絞る」と「絞っていることを見せる」を機械で見張る。
t('期間は visibleRecords に合流する（リスト・地図・CSV が同じ行を見る）', () => {
  const body = bodyOf('visibleRecords');
  ok(/VCPeriod\.windowFor/.test(body) && /VCPeriod\.inWindow/.test(body),
    '期間の判定が visibleRecords の外にある＝読み手ごとに見えている行が食い違う（v74 の形）');
  const calls = countOf(/VCPeriod\.inWindow\s*\(/g);
  ok(calls === 1, `inWindow の呼び出しが ${calls} 箇所＝絞る場所が増えている`);
});

t('期間の計算は engine（「今日の午前は何時か」を宿主に書かない）', () => {
  for (const fn of ['visibleRecords', 'renderPeriodUi', 'setPeriod']) {
    ok(!/12 \* 3600|86400000|setHours\(/.test(bodyOf(fn)),
      `${fn} が時刻の計算を持っている＝engine/period.js と規則が2つに割れる`);
  }
  ok(/VCPeriod\.PRESETS/.test(bodyOf('renderPeriodUi')), '選択肢の表を宿主が持っている（engine と二重管理）');
});

t('入口は2つでも板は1枚（設定を2つ作らない）', () => {
  ok(/getElementById\('periodBtn'\)\.addEventListener\('click', openPeriodSheet\)/.test(code)
    && /getElementById\('mapPeriod'\)\.addEventListener\('click', openPeriodSheet\)/.test(code),
    'リストと地図が別々の板を開いている＝設定が2つに割れる');
  ok(countOf(/function openPeriodSheet/g) === 1, '板を開く関数が複数ある');
});

t('選んだ瞬間に効く（「適用」ボタンを作らない・v89 と同じ線）', () => {
  ok(/renderRecords\(\)/.test(bodyOf('setPeriod')), '選んでも描き直していない＝押しても何も起きない');
  ok(!/id="periodApply"/.test(html), '適用ボタンが増えている＝押し忘れが戻る');
  ok(/saveRecView\(\)/.test(bodyOf('setPeriod')), '選択が残らない＝開き直すたびに戻る');
});

t('絞っていることを常に見せる（黙って隠さない）', () => {
  ok(/periodBtnLabel/.test(bodyOf('renderPeriodUi')), 'ボタンに今の期間が出ていない');
  ok(/function periodActive/.test(code), 'periodActive が無い');
  ok(/periodActive\(\)/.test(bodyOf('drawMap')), '地図の説明に期間が出ない＝全画面で理由が消える');
  ok(/periodActive\(\)/.test(bodyOf('renderRecordsList')), 'リストが0件の理由に期間が出ない');
  ok(/rows\.length\}\/\$\{all\.length\}件/.test(bodyOf('renderRecordsList')),
    '件数が「N/M件」になっていない＝減ったのが絞りのせいだと分からない');
  const csv = code.slice(code.indexOf("getElementById('recordsCsv').addEventListener"));
  ok(/periodActive\(\)/.test(csv.slice(0, 1200)), 'CSV の返事に期間が出ない＝全部のつもりで書き出す');
});

// v48 の縦積み（flex が縮めた結果、日本語のラベルが1文字ずつ割れる）の再発防止。
// 期間ボタンは**選んだ期間で幅が変わる**（「8/10〜8/12」）＝伸びる前提で組んでおく必要がある。
t('絞りの行は縮めずに折り返す（v48 の縦積みを作らない）', () => {
  // cssBlock はこのファイルの後ろで定義される（const＝巻き上がらない）ので、ここでは自前で切り出す
  const ruleOf = (sel) => {
    const i = html.indexOf(sel + ' {');
    ok(i > 0, `${sel} の規則が見つからない（名前を変えたならこのテストも直す）`);
    return html.slice(i, html.indexOf('}', i)).replace(/\/\*[\s\S]*?\*\//g, '');
  };
  ok(/flex-wrap:\s*wrap/.test(ruleOf('.rec-filters')), '.rec-filters が折り返さない＝狭い端末でラベルが1文字ずつ割れる');
  ok(/white-space:\s*nowrap/.test(ruleOf('.rec-filters label')), 'ラベルが途中で折れる');
  ok(/white-space:\s*nowrap/.test(ruleOf('.period-btn')), '期間ボタンの文字が途中で折れる');
});

// 🔴 実機FB第50回（v92）: 地図の 📆 は**地図の枠の中**に居るので、0 件で枠ごと隠すと
//    「期間を変える手段」まで消えていた＝**行き止まり**（v78 の違反）。説明文も「まだありません」の
//    一択で、期間で 0 件にした人には嘘だった（v51）。
t('地図が0件でも出口が残る（枠ごと消えても期間を変えられる）', () => {
  const body = bodyOf('refreshMap');
  ok(/map-empty-actions/.test(body), '0件の時に出口を置いていない＝地図から期間を触れなくなる');
  ok(/openPeriodSheet/.test(body), '0件の画面から板を開けない');
  ok(/setPeriod\('all'\)/.test(body), '「全期間に戻す」の1押しが無い＝いちばん多い出口が遠い');
  ok(/periodActive\(\)/.test(body) && /VCPeriod\.labelOf/.test(body),
    '0件の理由を言い分けていない＝期間で消えたのに「まだありません」と言う（v51 の腐り）');
});

t('期間の板から必ず出られる（閉じ込めない・v78）', () => {
  for (const id of ['periodClose', 'periodBack']) {
    ok(new RegExp(`getElementById\\('${id}'\\)\\.addEventListener\\('click', closePeriodSheet\\)`).test(code),
      `${id} で閉じられない`);
  }
});

t('期間の板は地図の全画面より上・録音より下（v86 の表）', () => {
  const sheetZ = Number((html.match(/\.period-sheet \{[\s\S]*?z-index:\s*(\d+)/) || [])[1]);
  const fullZ = Number((html.match(/\.map-wrap\.full \{[\s\S]*?z-index:\s*(\d+)/) || [])[1]);
  const micZ = Number((html.match(/body\.recording #micStage \{[\s\S]*?z-index:\s*(\d+)/) || [])[1]);
  ok(sheetZ > fullZ, `板(${sheetZ}) が地図の全画面(${fullZ}) の下＝全画面から開いても見えない`);
  ok(sheetZ < micZ, `板(${sheetZ}) が録音(${micZ}) 以上＝録音が始まっても板が上に残る`);
});

t('地図の計算は engine（宿主で三角関数を書き直さない）', () => {
  for (const fn of ['drawMap', 'refreshMap', 'fitMapToAll']) {
    ok(!/Math\.(log|tan|atan|sinh|PI)/.test(bodyOf(fn)),
      `${fn} が図法の計算を持っている＝engine/geomap.js と規則が2つに割れる`);
  }
  ok(/VCGeoMap\.tilesFor/.test(bodyOf('drawMap')) && /VCGeoMap\.pinAt/.test(bodyOf('drawMap')),
    'drawMap が engine の計算を使っていない');
  ok(/VCGeoMap\.fit\(/.test(bodyOf('fitMapToAll')), '「全体」が初回表示と同じ規則（fit）を使っていない');
});

t('画面の外に出た点は数で申告する（黙って消さない）', () => {
  const body = bodyOf('drawMap');
  ok(/placed/.test(body) && /画面の外/.test(html),
    '置けなかった点を数えていない＝点が消えたのか外に出たのか区別がつかない');
});

// ===== 10. 長文モード（v82・ゆう要求「この会話に限り、話し終わって自動で録音をとめない」） =====
t('長文モードは「この録音だけ」＝録音のたびに戻る', () => {
  ok(/keepOpen/.test(code), 'keepOpen が無い（名前を変えたならこのテストも直す）');
  ok(/keepOpen\s*=\s*false/.test(bodyOf('resetRecOverride')),
    '録音ごとにリセットしていない＝次の録音まで「止めない」が居座る（v61 の約束を破る）');
});

t('長文モードのボタンは native の時だけ出す', () => {
  ok(/ovKeepOpen\.hidden\s*=\s*!transcriber\.canKeepOpen/.test(code),
    'web でも出している＝押せるのに効かないボタンになる');
});

t('押した時に native へ伝える（画面だけ変わって効いていない、を作らない）', () => {
  ok(/setContinuous\(recOverride\.keepOpen\)/.test(code),
    'ボタンの状態を native に渡していない＝✓ は付くのに止まり続ける（画面が嘘をつく・v3）');
});

// ===== 11. 長文の推敲画面（v84・ゆう要求） =====
// 🚨 これは背骨②「仲介者を消す」への**意図した例外**＝だからこそ「どこまでが例外か」を機械で固定する。
//    ①短い発話には絶対に出さない ②解釈の前に止める ③出口が必ず在る。
t('推敲画面は解釈の前に止める（直した文章がそのまま解釈に掛かる）', () => {
  const body = bodyOf('onUtterance');
  const i = body.indexOf('openReview');
  const j = body.indexOf('VCParser.interpret');
  ok(i > 0, 'onUtterance が推敲画面を開いていない');
  ok(j > 0 && i < j, '解釈より後で止めている＝崩れた文のまま解釈され、直しが二度手間になる');
  ok(/opts && opts\.reviewed/.test(body), '推敲済みの再入を止めていない＝画面が無限に出る');
});

t('挟む判定は1箇所・長さの数字は engine が持つ', () => {
  ok(/function shouldReviewUtterance/.test(code), 'shouldReviewUtterance が無い');
  const body = bodyOf('shouldReviewUtterance');
  ok(/VCRewrite\.needsReview/.test(body), '長さの判定を engine に任せていない＝閾値が2箇所に散る');
  // v93: 長文モード（自分でボタンを押した時）だけは越える＝下の 15 節で別に縛る
  ok(/targeted/.test(body), '欄指定発話でも挟んでいる＝v17（その欄だけの差分）の意味が壊れる');
  // 定義（function openReview）は数えない＝**呼び出し**を見る。v96 で入口は2つになった:
  //   ①条件で開く（onUtterance→shouldReviewUtterance）②人がボタンで開く（openLiveReview・逐次）。
  //   ②は「押すこと自体が意思表明」（v44）＝条件が食い違う心配が無い。条件由来の入口は今も1つ。
  const calls = countOf(/(?<!function )\bopenReview\s*\(/g);
  ok(calls === 2, `openReview の呼び出しが ${calls} 箇所（条件の入口1＋逐次の入口1＝2のはず）`);
  ok(/function openLiveReview[\s\S]{0,300}openReview\('', null, \{ live: true \}\)/.test(code),
    '逐次の入口が openLiveReview 1関数に集まっていない');
  ok(countOf(/openLiveReview\b/g) >= 3, 'ボタンと E2E が openLiveReview を通っていない');
});

t('閉じ込めない＝出口は「進む」と「捨てる」の2つ（v78 の不変条件）', () => {
  for (const id of ['reviewGo', 'reviewCancel']) {
    ok(html.includes(`id="${id}"`), `${id} が無い＝画面から出られなくなる`);
    ok(new RegExp(`getElementById\\('${id}'\\)\\.addEventListener`).test(code), `${id} が配線されていない`);
  }
  ok(countOf(/function closeReview/g) === 1, '閉じる処理が1箇所でない');
});

t('AI の結果は人が上書きできる（↩ で戻せる・そのまま手でも直せる）', () => {
  ok(/reviewUndoText\s*=\s*before/.test(code), 'AI を当てる前の本文を控えていない＝戻せない');
  ok(/id="reviewText"/.test(html) && /<textarea id="reviewText"/.test(html),
    '本文が編集できる要素になっていない（要求「そのまま表示して修正できる」）');
});

t('捨てた時も来歴に残す（黙って捨てない・v16）', () => {
  ok(/kind: 'review', text: spoken, dropped: true/.test(code),
    '捨てた発話が痕跡なしに消える＝何を失ったか誰も追えない');
  ok(/kind === 'review'/.test(code), '来歴が推敲の行を描き分けていない');
});

// ===== 12. モデル一覧のプルダウン（v85・ゆう要求） =====
t('モデル一覧は押した時だけ取りに行く（起動時に勝手に外へ出ない）', () => {
  const calls = countOf(/VCAI\.listModels\s*\(/g);
  ok(calls === 1, `listModels の呼び出しが ${calls} 箇所＝入口が増えると起動時にも走りうる`);
  ok(/getElementById\('aiFetchModels'\)\.addEventListener\('click'/.test(code),
    '取得がボタン以外から走る形になっている');
  ok(/VCAI\.listModels/.test(bodyOf('fetchModelList')), '取得が fetchModelList の外にある');
});

t('選んだモデルは「欄を埋めるだけ」＝保存される形はただの文字列', () => {
  ok(/getElementById\('aiModel'\)\.value = v/.test(code),
    'プルダウンがモデル欄を埋めていない＝選んでも保存に反映されない／別の保存経路ができている');
  // 保存の道は1本（v74）＝ saveConfig を呼ぶのは saveAiConfig だけ。入口がいくつ増えてもここを通る
  const saves = countOf(/VCAI\.saveConfig\s*\(/g);
  ok(saves === 1, `saveConfig の呼び出しが ${saves} 箇所＝保存の道が増えている（v74 の形）`);
  ok(/VCAI\.saveConfig\s*\(/.test(bodyOf('saveAiConfig')), '保存が saveAiConfig の外にある');
});

// ===== 12-b. AI 設定は「変えた時点で保存」（v89・実機FB第49回） =====
// 実バグの形: キーやモデルを変えて**保存ボタンを押し忘れる**と、画面には新しい値が見えているのに
// 動くのは古い設定＝**画面が嘘をつく**（v20 の「表示と操作結果の食い違い」）。ボタンを消したので、
// 「入口が全部つながっているか」を機械で見張らないと**黙って保存されない欄**が生まれる。
t('保存ボタンが存在しない（押し忘れの余地を作らない）', () => {
  ok(!/id="aiSave"/.test(html), 'AI 設定に保存ボタンが復活している＝押し忘れの事故が戻る');
  ok(!/getElementById\('aiSave'\)/.test(code), 'aiSave の配線が残っている');
});

t('3つの入口（プロバイダ・モデル・キー）がすべて自動保存を通る', () => {
  ok(/function saveAiConfig/.test(code), 'saveAiConfig が無い');
  const after = (needle) => {
    const i = code.indexOf(needle);
    ok(i > 0, `${needle} が見つからない`);
    return code.slice(i, i + 700);
  };
  ok(/saveAiConfig\('provider'\)/.test(after("getElementById('aiProvider').addEventListener")),
    'プロバイダを変えても保存されない');
  ok(/saveAiConfig\('model'\)/.test(after("getElementById('aiModel').addEventListener('change'")),
    'モデル欄を直しても保存されない');
  ok(/saveAiConfig\('model'\)/.test(after("getElementById('aiModelList').addEventListener('change'")),
    '一覧から選んでも保存されない');
  ok(/saveAiConfig\('key'\)/.test(after("getElementById('aiKey').addEventListener('change'")),
    'キーを入れても保存されない');
  ok(/getElementById\('aiKey'\)\.addEventListener\('paste'/.test(code),
    '貼り付けで保存されない＝キーは貼って終わりなので、離れる操作が無いまま閉じられる');
});

t('黙って保存しない・失敗も黙らない（v16）', () => {
  const body = bodyOf('saveAiConfig');
  ok(/setAiSavedNote\(`✅/.test(body), '保存したことを画面に出していない＝押した実感の代わりが無い');
  ok(/setAiSavedNote\(`⚠/.test(body) && /toast\(`保存できませんでした/.test(body),
    '保存に失敗した時に黙る＝「設定したつもり」が残る');
});

t('入力中のキー欄を消さない／保存後は画面に書き戻さない（v40 の約束）', () => {
  const body = bodyOf('refreshAiState');
  ok(/activeElement !== keyEl/.test(body) && /keyEl\.value = ''/.test(body),
    'キー欄の扱いが「フォーカス中は触らない・それ以外は空へ」になっていない');
  ok(!/keyEl\.value = cfg\.key/.test(code), 'キーを DOM に書き戻している（v40 の約束違反）');
});

t('プロバイダを変えたら古い一覧を残さない（別社のモデルを選べる事故を防ぐ・v43）', () => {
  ok(/function clearModelList/.test(code), 'clearModelList が無い');
  ok(/clearModelList\s*\(\s*\)/.test(bodyOf('renderAiConfig')), '設定の描画で一覧を片付けていない');
  const onChange = code.slice(code.indexOf("getElementById('aiProvider').addEventListener"));
  ok(/clearModelList/.test(onChange.slice(0, 900)), 'プロバイダ切替で一覧が残る');
});

// ===== 13. 重なりの順番とトーストの位置（v86・実機FB第46回） =====
// 🚨 実バグ: **toast に z-index が無かった**ので、下の固定バー(40)と録音中の専用画面(60)の
//    **下敷き**になり、しかも同じ「画面の下」に居るので**物理的にも 81% 重なっていた**
//    （実測: トースト 62px のうち 50px がバーの下）。告げるためのものが隠れたら、無いのと同じ。
// 規則の中身だけ（**CSS コメントは落とす**＝解説文に書いた「transition: all」を実装と数えない）
const cssBlock = (sel) => {
  const i = html.indexOf(sel + ' {');
  ok(i > 0, `${sel} の規則が見つからない（名前を変えたならこのテストも直す）`);
  return html.slice(i, html.indexOf('}', i)).replace(/\/\*[\s\S]*?\*\//g, '');
};
t('重なりの順番: トーストが全部の層より上に居る', () => {
  const zOf = (block) => { const m = block.match(/z-index:\s*(\d+)/); return m ? Number(m[1]) : null; };
  const toastZ = zOf(cssBlock('.toast'));
  ok(toastZ, '.toast に z-index が無い＝下のバーの下敷きになる（v86 の実バグそのもの）');
  for (const sel of ['.dock', '#reviewStage']) {
    const z = zOf(cssBlock(sel));
    ok(z && toastZ > z, `${sel}(${z}) が toast(${toastZ}) 以上＝トーストが隠れる`);
  }
  const m = html.match(/body\.recording #micStage \{[\s\S]*?z-index:\s*(\d+)/);
  ok(m && toastZ > Number(m[1]), `#micStage(${m && m[1]}) が toast(${toastZ}) 以上＝録音中のトーストが隠れる`);
});

t('トーストの位置は「出す瞬間に測る」（高さを決め打ちしない）', () => {
  ok(/function bottomUiTop/.test(code), 'bottomUiTop が無い');
  ok(/bottomUiTop\(\)/.test(bodyOf('toast')), 'toast が測っていない＝バーが伸びた端末でまた重なる（v76 の教訓）');
  ok(/getBoundingClientRect/.test(bodyOf('bottomUiTop')), '実際に測っていない＝どこかに高さが埋め込まれている');
  const calls = countOf(/(?<!function )\bbottomUiTop\s*\(\s*\)/g); // 定義は数えない
  ok(calls === 1, `bottomUiTop の呼び出しが ${calls} 箇所＝状態を持ち始めている（更新し忘れの余地・v74）`);
  // 下に居うるもの3つを全部見ている（1つでも漏れるとその場面だけ隠れる）
  const body = bodyOf('bottomUiTop');
  for (const [name, re] of [['下の固定バー', /micDock/], ['録音中の操作群', /recording/], ['推敲画面の操作群', /reviewStage/]]) {
    ok(re.test(body), `${name} を見ていない＝その場面でトーストが隠れる`);
  }
});

t('トーストは位置まで補間しない（前の位置から動いて見える）', () => {
  const b = cssBlock('.toast');
  ok(!/transition:\s*all/.test(b), 'transition: all ＝ bottom まで補間対象になり、一瞬古い位置に出る');
  ok(/transition:\s*opacity/.test(b), '補間の対象を明示していない');
});

t('トーストは操作を邪魔しない（重なっても押せる）', () => {
  ok(/pointer-events:\s*none/.test(cssBlock('.toast')),
    'トーストがタップを吸う＝下のボタンが押せなくなる');
});

// ===== 15. v93: 長文モードは必ず推敲画面を挟む／推敲画面から AI 設定を触れる（ゆう要求） =====
// ゆう「録音時、長く話すボタン押したら、保存前に**必ず**1枚下書きのページを挟むようにして、
//      下書きのページに AI設定ボタンを置いてください」。
t('長文モードの録音は長さに関わらず推敲画面を挟む', () => {
  const body = bodyOf('shouldReviewUtterance');
  ok(/opts && opts\.longMode/.test(body), 'longMode を見ていない＝短い長文モードの発話が素通りする');
  // 長さ・欄指定の判定より**前**に返す（後ろに置くと 80字未満で弾かれて挟まらない）
  const iLong = body.indexOf('opts.longMode');
  const iLen = body.indexOf('needsReview');
  const iTg = body.indexOf('targeted');
  ok(iLong > 0 && iLen > iLong && iTg > iLong,
    '長さ／欄指定の判定が先＝長文モードでも 80字未満や「メモ 〜」で挟まれない');
});

t('長文モードの印を渡すのは音声の確定だけ（テキスト送信を巻き込まない）', () => {
  ok(/onFinal[\s\S]{0,160}?onUtterance\([\s\S]{0,80}?longMode:\s*recOverride\.keepOpen/.test(code),
    '音声の確定が長文モードを渡していない＝ボタンを押しても挟まらない');
  // recOverride は次の録音開始までリセットされない（v61）＝テキスト送信が巻き添えを食う形を禁じる
  ok(!/longMode/.test(bodyOf('send')),
    'テキスト送信が longMode を渡している＝録音の後にテキストを送ると短文でも推敲画面が出る');
  ok(!/recOverride\.keepOpen/.test(bodyOf('shouldReviewUtterance')),
    '判定関数が recOverride を直接読んでいる＝どの経路から来たか区別できず誤爆する');
});

t('なぜ挟まれたかを画面に出す（勝手に画面が挟まったに見せない）', () => {
  const body = bodyOf('openReview');
  ok(/reviewHead/.test(body) && /長文モード/.test(body),
    '見出しを言い分けていない＝長さで出たのか自分で押したのか分からない');
});

t('推敲画面の AI 設定は詳細設定の現物を移す（設定を2つ作らない・v74）', () => {
  ok(/function setReviewAiConfig/.test(code), 'setReviewAiConfig が無い');
  const body = bodyOf('setReviewAiConfig');
  ok(/aiConfigBox/.test(body), '現物（#aiConfigBox）を使っていない＝入力欄を複製している');
  // 推敲画面の中に AI 設定の入力欄を作り直していないこと（id の重複＝どちらが本物か分からなくなる）
  for (const id of ['aiProvider', 'aiModel', 'aiKey']) {
    ok(countOf(new RegExp(`id="${id}"`, 'g')) === 1, `#${id} が2つある＝設定の入れ物が割れている`);
  }
});

t('借りた AI 設定は必ず詳細設定へ返す（画面から機能が失踪しない）', () => {
  ok(/setReviewAiConfig\(false\)/.test(bodyOf('closeReview')),
    '推敲画面を閉じる時に返していない＝詳細設定を開いても AI 設定が無い');
  ok(/setReviewAiConfig\(false\)/.test(bodyOf('openReview')),
    '開く時に畳んでいない＝前回の開きっぱなしが残る');
  ok(/aiConfigSlot/.test(bodyOf('setReviewAiConfig')) && /id="aiConfigSlot"/.test(html),
    '戻る場所（#aiConfigSlot）が無い＝元の位置を復元できない');
  // 移す側・返す側の**両方**に親チェックが要る（片方だけだと、そちらでフォーカスが飛ぶ）
  const moves = (bodyOf('setReviewAiConfig').match(/appendChild\(box\)/g) || []).length;
  const guarded = (bodyOf('setReviewAiConfig').match(/parentNode !== \w+\)\s*\w+\.appendChild\(box\)/g) || []).length;
  ok(moves > 0 && moves === guarded,
    `同じ親でも appendChild している（${guarded}/${moves} だけ守られている）＝入力中にフォーカスが飛ぶ`);
});

t('AI 設定ボタンはキーが無くても出す（押せるものが1つも無い画面を作らない）', () => {
  const body = bodyOf('renderReviewAi');
  ok(/reviewTidy/.test(body) && /reviewSum/.test(body), '整える／要約の出し入れがここに無い');
  ok(!/reviewAiCfg[^\n]*hidden\s*=\s*!has/.test(body), 'AI 設定ボタンをキーの有無で隠している');
  ok(/cfgBtn\.hidden\s*=\s*!window\.VCAI/.test(body),
    'AI 機能が読めていない時にも出している＝開いても空の枠しか出ない');
  // v89 の「見た目を直す1箇所」から呼ぶ＝キーを入れた瞬間に「整える」が出る
  ok(/renderReviewAi\(\)/.test(bodyOf('refreshAiState')),
    'refreshAiState から呼んでいない＝設定した直後も画面が古いまま（画面が嘘をつく・v20）');
});

t('Esc は上に居るものから（推敲画面そのものは Esc で閉じない）', () => {
  const m = code.match(/if \(e\.key !== 'Escape'\) return;[\s\S]{0,400}?\}\);/);
  ok(m, 'Esc のハンドラが見つからない');
  const h = m[0];
  const iAi = h.indexOf('reviewAiConfigOpen');
  const iSheet = h.indexOf('periodSheet');
  ok(iAi > 0 && iAi < iSheet, 'AI 設定より先に期間の板を閉じている＝上に居るものから閉じていない');
  ok(!/closeReview\(\)/.test(h), 'Esc で推敲画面ごと閉じている＝書いた本文が一発で消える');
});

// ===== v94: 下書きで続きを声で足す／たまったら自動で要約（ゆう要求 2026-08-30）=====
// 🚨 ここが壊れると **捨てたはずの続きがカレンダーに入る**（閉じた後の確定がフォームへ流れる）か、
//    **本文が黙って伸びる**（自動録音が推敲中に走る）。どちらも実機まで気づけない種類の事故。

t('推敲中かの判定は reviewOpen 1関数（同じ答えを3つの経路が見る）', () => {
  ok(/function reviewOpen\s*\(/.test(code), 'reviewOpen が無い');
  // 画面の hidden を直接読む場所を増やさない（v3 の二重管理と同じ形になる）
  ok(countOf(/rvStage\.hidden\s*===/g) === 0, 'reviewStage の hidden を別の場所で読んでいる＝判定が2つ');
});

t('下書きへの確定は reviewTakeFinal 1本（逐次の話し終わりか、続きの追記かはそこで分ける）', () => {
  const h = code.match(/onFinal\(t, meta\) \{[\s\S]{0,300}?\n  \},/);
  ok(h, 'onFinal のハンドラが見つからない');
  ok(/if \(reviewOpen\(\)\) \{ reviewTakeFinal\(t\); return; \}/.test(h[0]),
    '推敲中の確定をフォームへ流している（下書きの続きが予定になる）');
  const b = bodyOf('reviewTakeFinal');
  ok(/liveActive/.test(b) && /finishLive\(t\)/.test(b) && /appendReview\(t\)/.test(b),
    'reviewTakeFinal が逐次と追記を分けていない');
  ok(countOf(/appendReview\s*\(/g) === 2, `appendReview の呼び出しが1箇所でない（定義+1呼び出し＝2のはず・実際 ${countOf(/appendReview\s*\(/g)}）`);
  ok(countOf(/finishLive\s*\(/g) === 4, `finishLive の入口が増えた（定義+話し終わり+録音エラー+無言＝4のはず・実際 ${countOf(/finishLive\s*\(/g)}）`);
});

t('推敲中は自動で録音しない（本文が黙って伸びない）', () => {
  ok(/reviewOpen\(\)\) return 'review'/.test(bodyOf('autoRecord')),
    'autoRecord に推敲中の門が無い＝アプリへ戻るだけで下書きに環境音が足される（v28 の積）');
});

t('画面を閉じる時は必ず録音を止める（閉じた後の確定がフォームへ流れない）', () => {
  ok(/stopReviewMic\(\);/.test(bodyOf('closeReview')), 'closeReview が録音を止めていない');
  // 進むも捨てるも closeReview を通る＝止める場所は1つ
  ok(countOf(/stopReviewMic\(\)/g) === 2, '録音を止める場所が closeReview の外にもある（複製）');
});

t('続きは本文・話したまま・↩ の戻し先の3つに同じだけ足す', () => {
  const b = bodyOf('appendReview');
  ok(/rvText\.value = VCRewrite\.appendSpoken/.test(b), '本文に足していない');
  ok(/reviewSpoken = VCRewrite\.appendSpoken/.test(b), '話したまま（来歴用）に足していない＝来歴が嘘になる');
  ok(/reviewUndoText = VCRewrite\.appendSpoken/.test(b), '↩ の戻し先に足していない＝↩ で自分が話した続きが消える');
  ok(/reviewUndoText !== null/.test(b), 'AI を当てる前でも戻し先を作っている（↩ が勝手に出る）');
});

t('区切り方も境目の数字も engine が持つ（宿主に書かない）', () => {
  ok(countOf(/VCRewrite\.appendSpoken/g) >= 3, '足し方を宿主で書いている');
  ok(/VCRewrite\.shouldAutoSummarize\(reviewAdded\)/.test(bodyOf('maybeAutoSummarize')),
    '自動要約の境目を宿主の数字で判定している');
  ok(countOf(/reviewAdded\s*>=?\s*\d/g) === 0, '宿主に閾値の数字が書かれている（二重管理）');
});

t('長文モードを頼むのは「録音が始まった後」だけ（native は start でリセットする）', () => {
  ok(countOf(/setReviewContinuous\(\)/g) === 2, 'setReviewContinuous の呼び出しが1箇所でない');
  ok(/if \(on\) setReviewContinuous\(\);/.test(code), 'onState の listening 以外で頼んでいる＝黙って効かない');
  ok(!/setReviewContinuous\(\)[\s\S]{0,80}transcriber\.start/.test(code),
    'start より前に頼んでいる＝native の「この録音だけ」リセットで消える');
});

t('自動要約が走るのは声で足した直後だけ（打っている最中に走らない）', () => {
  ok(countOf(/maybeAutoSummarize\(\)/g) === 2, 'maybeAutoSummarize の呼び出しが1箇所でない');
  ok(/maybeAutoSummarize\(\);/.test(bodyOf('appendReview')), '声で足した直後に見ていない');
  const b = bodyOf('maybeAutoSummarize');
  ok(/settings\.get\('autoSummarize'\)/.test(b), '設定を見ずに走っている（既定オフが効かない）');
  ok(/VCAI\.hasKey\(\)/.test(b), 'キーが無くても走らせている（押せるのに動かない・v40）');
  ok(/auto: true/.test(b), '自動で走ったことを runReviewAi へ伝えていない＝理由が画面に出ない');
});

t('AI の待ち時間に本文が変わっていたら当てない（人の編集を上書きしない）', () => {
  const b = bodyOf('runReviewAi');
  ok(/rvText\.value\.trim\(\) !== before/.test(b), '待機中の編集を見ていない＝打った字が消える（v3 の線）');
  const iGuard = b.indexOf('!== before');
  const iApply = b.indexOf('rvText.value = r.text');
  ok(iGuard > 0 && iApply > 0 && iGuard < iApply, '当ててから確かめている（順番が逆）');
});

t('「話した分」を数え直すのは AI を当てた時（要約の要約が続けて走らない）', () => {
  ok(/reviewAdded = 0;/.test(bodyOf('runReviewAi')), 'runReviewAi で数え直していない＝失敗のたびに再挑戦する');
  ok(/reviewAdded = 0;/.test(bodyOf('openReview')), '新しい下書きに前の回の分を持ち越している');
  ok(/reviewAdded = 0;/.test(bodyOf('closeReview')), '閉じても数が残っている');
});

t('☑ は設定の現物に直結（入れ物を2つ作らない）', () => {
  ok(/settings\.set\('autoSummarize'/.test(code), '☑ が設定を書き換えていない＝次に開くと消える');
  ok(/autoCb\.checked = !!settings\.get\('autoSummarize'\)/.test(bodyOf('renderReviewAi')),
    '☑ の見た目を設定から作っていない＝画面と設定が食い違う（v20）');
  ok(/autoWrap\.hidden = !has/.test(bodyOf('renderReviewAi')), 'キーが無くても ☑ を出している（v40）');
});
// ===== v96: 逐次モード＝話しながら AI が整える（ゆう要求 2026-08-30）=====
// 🚨 ここが壊れると: 認識が死んだ時に**出口の無い画面**に閉じ込める（進むは隠れたまま）／
//    人の編集に AI の訂正が**後から**重なって打った字が消える／逐次の状態が次の下書きへ漏れる。

t('逐次の interim 分岐は reviewOpen より先（逐次中の途中経過を追記側が食わない）', () => {
  const m = code.match(/onInterim\(t\) \{[\s\S]{0,400}?\n  \},/);
  ok(m, 'onInterim のハンドラが見つからない');
  const iLive = m[0].indexOf('liveActive');
  const iReview = m[0].indexOf('reviewOpen()');
  ok(iLive > 0 && iLive < iReview, 'liveActive の分岐が reviewOpen より後＝逐次の途中経過が v94 側に流れる');
});

t('区切りの数字は engine が持つ（宿主に息継ぎの ms・字数を書かない）', () => {
  ok(/VCRewrite\.LIVE\.PAUSE_MS/.test(bodyOf('liveInterim')), '息継ぎの ms を宿主に書いている');
  ok(/VCRewrite\.LIVE\.MAX_TAIL_CHARS/.test(bodyOf('liveInterim')), '溜まりすぎの字数を宿主に書いている');
  ok(/VCRewrite\.LIVE\.MIN_CHUNK_CHARS/.test(bodyOf('settleLiveChunk')), '最小の断片の字数を宿主に書いている');
  ok(/VCRewrite\.LIVE\.CONTEXT_CHARS/.test(bodyOf('correctLiveChunk')), '文脈の長さを宿主に書いている');
});

t('録音中の本文は readOnly（機械が書く欄に人の編集を混ぜない）', () => {
  ok(/rvText\.readOnly = liveActive/.test(bodyOf('openReview')), '逐次で開いても編集できる＝訂正が上書きする');
  ok(/rvText\.readOnly = false/.test(bodyOf('finishLive')), '話し終わっても readOnly のまま＝直せない');
  ok(/rvText\.readOnly = false/.test(bodyOf('closeReview')), '捨てた後も readOnly が残る＝次の下書きが直せない');
});

t('話し終わり後に返ってきた訂正は「本文が組んだままの時だけ」当てる', () => {
  const b = bodyOf('correctLiveChunk');
  ok(/rvText\.value === joined/.test(b), '在庫の訂正が人の編集を上書きする（v3 の線）');
  ok(/liveActive/.test(b), '録音中かどうかを見ていない');
  ok(/VCAI\.hasKey\(\)/.test(b), 'キーが無くても AI を呼ぼうとする');
});

t('逐次中に認識が死んだら、拾えた分で話し終わりにする（閉じ込めない・v78）', () => {
  const m = code.match(/onError\(e\) \{[\s\S]{0,700}?\n  \},/);
  ok(m, 'onError のハンドラが見つからない');
  ok(/liveActive && !transcriber\.isListening\(\)/.test(m[0]) && /finishLive\(liveLastInterim\)/.test(m[0]),
    '逐次中の録音死で final が来ない＝「進む」が隠れたままの画面に閉じ込める');
});

t('逐次の後始末は closeReview にもある（捨てても次の下書きへ漏れない）', () => {
  const b = bodyOf('closeReview');
  ok(/liveActive = false/.test(b), 'liveActive が残る＝次の確定が finishLive へ吸われる');
  ok(/clearTimeout\(liveTimer\)/.test(b), '息継ぎタイマーが残る＝閉じた後に settle が走る');
});

t('逐次モード中も ✕ 捨てる は残る（CSS で隠す一覧に reviewCancel が居ない）', () => {
  const m = html.match(/#reviewStage\.live[^{]*\{ display: none; \}/);
  ok(m, '逐次中に隠す CSS が見つからない');
  ok(!m[0].includes('reviewCancel') && !m[0].includes('reviewMic'),
    '出口（✕ 捨てる／⏹）まで隠している＝閉じ込め（v78 違反）');
});

t('来歴に残す「話したまま」は生の全文（訂正後を話したことにしない）', () => {
  ok(/reviewSpoken = liveChunks\.map\(\(c\) => c\.raw\)\.join\(''\)/.test(bodyOf('finishLive')),
    '来歴が訂正後の文になっている＝認識と解釈の切り分け（v5）が壊れる');
});

t('↩ の戻し先は話したまま・訂正があった時だけ出す', () => {
  const b = bodyOf('finishLive');
  ok(/reviewUndoText = reviewSpoken/.test(b), '↩ が生の全文に戻らない');
  ok(/fixedCount/.test(b), '訂正ゼロでも ↩ を出している（押しても何も起きないボタン）');
});

t('openLiveReview は長文モードを道連れにする（無音で止まったら「話しながら」にならない）', () => {
  const b = bodyOf('openLiveReview');
  ok(/recOverride\.keepOpen = true/.test(b), 'keepOpen を立てていない');
  ok(/setContinuous\(true\)/.test(b), 'native に「止めない」を頼んでいない');
});

t('逐次ボタンは native の長文＋キーの両方がある時だけ（押せるのに動かないを作らない）', () => {
  ok(/ovLive\.hidden = !\(transcriber\.canKeepOpen && canAI\)/.test(bodyOf('renderOverrideButtons')),
    'ovLive の出し入れが canKeepOpen と canAI の両方を見ていない');
});
console.log(`\nwiring.test: ${pass} passed, ${fail.length} failed`);
if (fail.length) { console.log('\n' + fail.join('\n\n')); process.exit(1); }
