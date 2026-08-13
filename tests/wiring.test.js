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
  // 出す条件が変わったら見直される場所も固定（キーの有無は renderAiConfig が唯一の反映点）
  ok(/refreshRewriteRow\s*\(\s*\)/.test(bodyOf('renderAiConfig')),
    'キーを保存/削除しても行が見直されない＝設定した直後に出ない／消しても残る');
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
  ok(/targeted/.test(body), '欄指定発話でも挟んでいる＝v17（その欄だけの差分）の意味が壊れる');
  // 定義（function openReview）は数えない＝**呼び出し**が1箇所であることを見る
  const calls = countOf(/(?<!function )\bopenReview\s*\(/g);
  ok(calls === 1, `openReview の呼び出しが ${calls} 箇所＝入口が増えると条件が食い違う`);
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

console.log(`\nwiring.test: ${pass} passed, ${fail.length} failed`);
if (fail.length) { console.log('\n' + fail.join('\n\n')); process.exit(1); }
