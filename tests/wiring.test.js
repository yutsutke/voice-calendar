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

console.log(`\nwiring.test: ${pass} passed, ${fail.length} failed`);
if (fail.length) { console.log('\n' + fail.join('\n\n')); process.exit(1); }
