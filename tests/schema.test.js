// tests/schema.test.js — 共有状態＋欄ロック（SPEC §8）の単体テスト
// v1 で「ロック（イベント基準）と描画スキップ（activeElement 基準）の二重管理」により
// **ストアと画面がズレて画面と違う値が保存される**バグを踏んだ。核心機能なのでテストで固定する。
'use strict';
const { createDraftStore, FIELDS } = require('../engine/schema.js');

let pass = 0, fail = 0;
const failures = [];
function t(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; failures.push(`✗ ${name}\n    ${e.message}`); }
}
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label || ''} 期待 ${b} / 実際 ${a}`);
}

// ===== 2経路が同じ1つの state を更新する（背骨①） =====
t('音声パッチと手入力が同じ state を更新する', () => {
  const s = createDraftStore();
  s.applyVoicePatch({ title: '歯医者', startDate: '2026-07-17' }, '明日 歯医者');
  s.setByHuman('location', '駅前クリニック');
  eq(s.get().title, '歯医者', 'title');
  eq(s.get().location, '駅前クリニック', 'location');
});

// ===== 明示 lock（DOM を持たない宿主用） =====
t('lock した欄には音声が書かない・skipped に出る', () => {
  const s = createDraftStore();
  s.setByHuman('title', '手で書いた');
  s.lock('title');
  const r = s.applyVoicePatch({ title: '声で書いた', startTime: '15:00' }, 'x');
  eq(r.written, ['startTime'], 'written');
  eq(r.skipped, ['title'], 'skipped');
  eq(s.get().title, '手で書いた', 'ロック中の値は不変');
  eq(s.get().startTime, '15:00', 'ロックされていない欄は書ける');
});

t('unlock すると再び書ける（フォーカスが外れたら解除）', () => {
  const s = createDraftStore();
  s.lock('title');
  s.applyVoicePatch({ title: 'A' }, 'x');
  eq(s.get().title, '', 'ロック中は書かれない');
  s.unlock('title');
  s.applyVoicePatch({ title: 'B' }, 'x');
  eq(s.get().title, 'B', '解除後は書ける');
});

// ===== lockSource（宿主が「編集中か」の正を注入）＝ v1 バグの再発防止 =====
t('lockSource が true を返す欄には音声が書かない', () => {
  const s = createDraftStore();
  let editing = 'title';
  s.setLockSource((f) => f === editing);
  s.setByHuman('title', '手で書いた');
  const r = s.applyVoicePatch({ title: '声で書いた', startTime: '15:00' }, 'x');
  eq(r.skipped, ['title'], 'skipped');
  eq(s.get().title, '手で書いた', 'ストアも守られる（画面だけでなく）');
  editing = null;
  s.applyVoicePatch({ title: '声で書いた' }, 'x');
  eq(s.get().title, '声で書いた', 'フォーカスが外れたら書ける');
});

t('【v1 バグの回帰】lockSource が locked と言う欄は getFieldState も locked（描画スキップと一致）', () => {
  const s = createDraftStore();
  s.setLockSource((f) => f === 'title');
  s.setByHuman('title', '歯医者');
  // 描画は isLocked でスキップを決める。ここが false だと「スキップしないのに書かれない」
  // 逆に applyVoicePatch が書いてしまうと「スキップするのにストアは変わる」＝画面とズレる。
  eq(s.isLocked('title'), true, 'isLocked');
  eq(s.getFieldState('title'), 'locked', 'getFieldState');
  s.applyVoicePatch({ title: '定例' }, 'x');
  eq(s.get().title, '歯医者', 'ストアの値＝画面の値（ズレない）');
});

t('lockSource と明示 lock は OR で効く', () => {
  const s = createDraftStore();
  s.setLockSource((f) => f === 'location');
  s.lock('title');
  const r = s.applyVoicePatch({ title: 'A', location: 'B', note: 'C' }, 'x');
  eq(r.written, ['note'], 'written');
  eq(r.skipped, ['title', 'location'], 'skipped');
});

// ===== fieldState =====
t('fieldState は empty → confirmed（AI は創作しない＝空は空のまま）', () => {
  const s = createDraftStore();
  eq(s.getFieldState('title'), 'empty', '初期');
  s.applyVoicePatch({ title: '歯医者' }, 'x');
  eq(s.getFieldState('title'), 'confirmed', '音声で確定');
  eq(s.getFieldState('endTime'), 'empty', '言っていない欄は empty のまま');
  s.setByHuman('title', '');
  eq(s.getFieldState('title'), 'empty', '空にしたら empty へ戻る');
});

// ===== 発話 = 言い直し（再描画）: 前回の音声欄は掃除、人の欄は残す（実発話FB第2回） =====
t('新しい発話が触れなかった音声欄は空に戻る（--:--）', () => {
  const s = createDraftStore();
  s.applyVoicePatch({ title: '食事', startDate: '2026-07-15', startTime: '11:30' }, '昨日の11時半食事');
  const r = s.applyVoicePatch({ title: '仕事', startDate: '2026-07-31' }, '今月の末仕事');
  eq(s.get().startTime, '', '前回の 11:30 が残らない');
  eq(s.getFieldState('startTime'), 'empty', 'fieldState も empty へ');
  eq(r.cleared, ['startTime'], 'cleared に報告される');
  eq(s.get().title, '仕事', '言及した欄は新しい値');
});

t('人が手で入れた欄は音声の言い直しで消えない', () => {
  const s = createDraftStore();
  s.applyVoicePatch({ title: '歯医者', startTime: '15:00' }, 'x');
  s.setByHuman('location', '駅前クリニック');
  const r = s.applyVoicePatch({ title: '美容院' }, 'y');
  eq(s.get().location, '駅前クリニック', '手入力の場所は残る');
  eq(s.get().startTime, '', '音声由来の時刻は掃除される');
  eq(r.cleared, ['startTime'], 'cleared は音声由来のみ');
});

t('編集中ロックの欄は掃除もされない（§8: 編集中の経路を保護）', () => {
  const s = createDraftStore();
  s.applyVoicePatch({ title: 'A', startTime: '15:00' }, 'x');
  s.lock('startTime');
  s.applyVoicePatch({ title: 'B' }, 'y');
  eq(s.get().startTime, '15:00', 'ロック中は掃除されない');
  s.unlock('startTime');
});

t('手で書いた欄も発話が言及すれば上書きされる（編集中でなければ）', () => {
  const s = createDraftStore();
  s.setByHuman('title', '手のタイトル');
  s.applyVoicePatch({ title: '声のタイトル' }, 'x');
  eq(s.get().title, '声のタイトル', '言及あり=上書き');
  const r = s.applyVoicePatch({ startTime: '09:00' }, 'y');
  eq(s.get().title, '', '直前の発話の title は音声由来になったので掃除される');
  eq(r.cleared, ['title'], 'cleared');
});

// ===== 欄指定パッチ（v17）: その欄だけの差分＝掃除しない =====
t('targeted パッチは他の音声欄を掃除しない（「終了22時」で予定が消えない）', () => {
  const s = createDraftStore();
  s.applyVoicePatch({ title: '歯医者', startDate: '2026-07-17', startTime: '15:00' }, '明日15時に歯医者');
  const r = s.applyVoicePatch({ endTime: '22:00' }, '終了22時', { targeted: true });
  eq(s.get().title, '歯医者', 'タイトルが残る');
  eq(s.get().startDate, '2026-07-17', '開始日が残る');
  eq(s.get().startTime, '15:00', '開始時刻が残る');
  eq(s.get().endTime, '22:00', '終了が入る');
  eq(r.cleared, [], '掃除リストは空');
});

t('targeted でも編集中ロックは尊重（§8）', () => {
  const s = createDraftStore();
  s.lock('endTime');
  const r = s.applyVoicePatch({ endTime: '22:00' }, '終了22時', { targeted: true });
  eq(r.skipped, ['endTime'], 'ロック中はスキップ');
  eq(s.get().endTime, '', '書かれない');
  s.unlock('endTime');
});

t('targeted なし（通常の言い直し）は従来どおり掃除する', () => {
  const s = createDraftStore();
  s.applyVoicePatch({ title: 'A', startTime: '15:00' }, 'x');
  const r = s.applyVoicePatch({ title: 'B' }, 'y'); // opts なし = 言い直し
  eq(s.get().startTime, '', '掃除される');
  eq(r.cleared, ['startTime'], 'cleared に出る');
});

// ===== 巻き戻し（v18）: 来歴の ↩ ＝「その発話の直前の状態」を復元 =====
// 🔴 v20 の回帰: 来歴の行に見えている状態と、↩ で戻る状態が一致すること。
// v18 は「発話の“前”の状態」を積んでいたため、行に「飲み会」と出ているのに ↩ で「会議」に
// 戻った（1つ前）＝行の表示と結果が食い違い「反映されない」に見えた。
t('【v20 回帰】↩ は「その発話を適用した後の状態」＝行の表示と一致する', () => {
  const s = createDraftStore();
  // UI と同じ手順: 発話を適用した「後」に snapshot を積む
  const hist = [];
  const speak = (patch, text) => { s.applyVoicePatch(patch, text); hist.unshift({ text, after: s.snapshot() }); };
  speak({ title: '歯医者', startTime: '10:00' }, '明日10時 歯医者');
  speak({ title: '会議', startTime: '14:00' }, '明日14時 会議');
  speak({ title: '飲み会', startTime: '18:00' }, '明日18時 飲み会');
  // 来歴（新しい順）: 飲み会 / 会議 / 歯医者
  eq(hist.map((e) => e.after.draft.title), ['飲み会', '会議', '歯医者'], '各行の状態＝その行の発話の結果');
  // 「会議」の行の ↩ を押したら「会議」になる（「歯医者」ではない）
  s.restore(hist[1].after);
  eq(s.get().title, '会議', '行に見えているタイトルがそのまま入る');
  eq(s.get().startTime, '14:00', '時刻も行のもの');
  // 「歯医者」の行の ↩ を押したら「歯医者」になる
  s.restore(hist[2].after);
  eq(s.get().title, '歯医者', '行の表示と一致');
  eq(s.get().startTime, '10:00', '時刻も一致');
});

t('snapshot → 発話で壊れる → restore で元通り（意図せず新規になった時の逃げ道）', () => {
  const s = createDraftStore();
  s.applyVoicePatch({ title: '歯医者', startDate: '2026-07-18', startTime: '15:00' }, '明日15時に歯医者');
  s.applyVoicePatch({ endTime: '22:00' }, '終了22時', { targeted: true });
  const before = s.snapshot();
  // 意図せず「新規（言い直し）」になり、積み上げた予定が消える
  s.applyVoicePatch({ title: '会議' }, '会議');
  eq(s.get().startTime, '', '事故: 開始が消えた');
  eq(s.get().endTime, '', '事故: 終了が消えた');
  // ↩ で直前に戻る
  eq(s.restore(before), true, 'restore が成功する');
  eq(s.get().title, '歯医者', 'タイトルが戻る');
  eq(s.get().startTime, '15:00', '開始が戻る');
  eq(s.get().endTime, '22:00', '終了が戻る');
});

t('restore は fieldState と origin も戻す（戻した後の言い直し掃除が正しく効く）', () => {
  const s = createDraftStore();
  s.applyVoicePatch({ title: '歯医者', startTime: '15:00' }, 'x');
  s.setByHuman('location', '駅前');
  const before = s.snapshot();
  s.reset();
  s.restore(before);
  eq(s.getFieldState('startTime'), 'confirmed', 'fieldState が戻る');
  eq(s.getFieldOrigin('location'), 'human', 'origin が戻る＝手入力は掃除されない');
  eq(s.getFieldOrigin('startTime'), 'voice', 'origin が戻る＝音声欄は掃除対象のまま');
  // 戻した後の言い直しで、音声欄だけが掃除される
  const r = s.applyVoicePatch({ title: '会議' }, 'y');
  eq(r.cleared, ['startTime'], '音声由来だけ掃除');
  eq(s.get().location, '駅前', '手入力は残る');
});

t('restore はスナップショットのコピーを使う（後から元オブジェクトを触っても壊れない）', () => {
  const s = createDraftStore();
  s.applyVoicePatch({ title: 'A' }, 'x');
  const snap = s.snapshot();
  s.applyVoicePatch({ title: 'B' }, 'y');
  snap.draft.title = '外から改変';
  s.restore(snap);
  eq(s.get().title, '外から改変', 'snapshot は素の値なので渡された内容が入る（参照の共有はしない）');
  const snap2 = s.snapshot();
  s.setByHuman('title', 'C');
  eq(snap2.draft.title, '外から改変', 'snapshot 取得後に store を変えても snapshot は不変');
});

t('不正な snapshot では restore が false を返す（黙って壊さない）', () => {
  const s = createDraftStore();
  s.setByHuman('title', 'A');
  eq(s.restore(null), false, 'null');
  eq(s.restore({}), false, 'draft なし');
  eq(s.get().title, 'A', 'state は無傷');
});

// ===== 詳細設定の注入（v19）: setPolicySource が実挙動を変えるか =====
t('未注入なら既定＝これまでの実挙動（新規扱い・手入力保護・ロック）', () => {
  const s = createDraftStore();
  s.applyVoicePatch({ title: 'A', startTime: '15:00' }, 'x');
  s.setByHuman('location', '駅前');
  const r = s.applyVoicePatch({ title: 'B' }, 'y');
  eq(r.cleared, ['startTime'], '音声欄は掃除');
  eq(s.get().location, '駅前', '手入力は保護');
});

t('plainUtteranceIsNew=false なら掃除しない（消えるのが嫌な人向け）', () => {
  const s = createDraftStore();
  s.setPolicySource((k) => (k === 'plainUtteranceIsNew' ? false : undefined));
  s.applyVoicePatch({ title: 'A', startTime: '15:00' }, 'x');
  const r = s.applyVoicePatch({ title: 'B' }, 'y');
  eq(r.cleared, [], '掃除されない');
  eq(s.get().startTime, '15:00', '前の入力が残る');
  eq(s.get().title, 'B', '言及した欄は更新される');
});

t('protectManualEdits=false なら手入力も掃除される', () => {
  const s = createDraftStore();
  s.setPolicySource((k) => (k === 'protectManualEdits' ? false : undefined));
  s.setByHuman('location', '駅前');
  s.applyVoicePatch({ title: 'A' }, 'x');
  eq(s.get().location, '', '手入力も新規で消える');
});

t('lockEditingField=false なら編集中でも音声が書き込む', () => {
  const s = createDraftStore();
  s.setPolicySource((k) => (k === 'lockEditingField' ? false : undefined));
  s.lock('title');
  const r = s.applyVoicePatch({ title: '声' }, 'x');
  eq(r.skipped, [], 'スキップされない');
  eq(s.get().title, '声', '書き込まれる');
  eq(s.getFieldState('title'), 'confirmed', 'locked 扱いにならない');
});

t('policySource が undefined を返した設定は既定にフォールバック', () => {
  const s = createDraftStore();
  s.setPolicySource(() => undefined); // 何も答えない注入
  s.applyVoicePatch({ title: 'A', startTime: '15:00' }, 'x');
  const r = s.applyVoicePatch({ title: 'B' }, 'y');
  eq(r.cleared, ['startTime'], '既定どおり掃除される');
});

// ===== 来歴（SPEC §5-①: note に流し込まない） =====
t('転写は来歴として貯まり、note には流し込まれない', () => {
  const s = createDraftStore();
  s.applyVoicePatch({ title: '歯医者' }, '明日15時に歯医者');
  eq(s.get().note, '', 'note は空のまま');
  eq(s.getTranscripts().length, 1, '来歴は1件');
  eq(s.getTranscripts()[0].text, '明日15時に歯医者', '生テキストが残る');
});

// ===== reset =====
t('reset で state もロックも初期化される', () => {
  const s = createDraftStore();
  s.setByHuman('title', 'A');
  s.lock('title');
  s.reset();
  eq(s.get().title, '', 'value');
  eq(s.isLocked('title'), false, 'ロック解除');
  eq(s.getFieldState('title'), 'empty', 'fieldState');
});

// ===== 購読 =====
t('subscribe に written / skipped が通知される', () => {
  const s = createDraftStore();
  s.lock('title');
  let got = null;
  s.subscribe((c) => { if (c.type === 'voice') got = c; });
  s.applyVoicePatch({ title: 'A', startTime: '15:00' }, 'x');
  eq(got.fields, ['startTime'], 'fields');
  eq(got.skipped, ['title'], 'skipped');
});

// ===== v55: 出所（prov）の配管（スパン出所追跡 A'） =====
t('applyVoicePatch が prov を欄ごとに保持し、言い直し掃除で消える', () => {
  const s = createDraftStore();
  const prov = {
    title: { source: 'transcript', span: null },
    startDate: { source: 'inferred', span: { a: 0, b: 3, quote: '20日' }, why: '月は言っていない' },
  };
  s.applyVoicePatch({ title: '美容院', startDate: '2026-07-20' }, '20日に美容院', { prov });
  eq(s.getFieldProv('title'), { source: 'transcript', span: null }, 'title');
  eq(s.getFieldProv('startDate').source, 'inferred', 'startDate は推論');
  s.applyVoicePatch({ title: '会議' }, '会議', { prov: { title: { source: 'transcript', span: null } } });
  eq(s.getFieldProv('startDate'), null, '掃除された欄の prov は消える');
  eq(s.getFieldProv('title'), { source: 'transcript', span: null }, '新しい発話の prov に置き換わる');
});

t('prov を渡さない呼び出しは従来どおり動き、出所は不明(null)＝transcript を創作しない', () => {
  const s = createDraftStore();
  const r = s.applyVoicePatch({ title: 'A', startTime: '15:00' }, 'x');
  eq(r.written, ['title', 'startTime'], '書き込みは従来どおり');
  eq(s.getFieldProv('title'), null, 'title の出所は不明');
  eq(s.getFieldProv('startTime'), null, 'startTime の出所は不明');
});

t('手入力の prov は human・空にすると null', () => {
  const s = createDraftStore();
  s.setByHuman('location', '駅前');
  eq(s.getFieldProv('location'), { source: 'human' }, '手入力');
  s.setByHuman('location', '');
  eq(s.getFieldProv('location'), null, '空にしたら null');
});

t('snapshot/restore が prov も往復する（↩ で出所が現在値のまま残らない）', () => {
  const s = createDraftStore();
  s.applyVoicePatch({ title: 'A' }, 'x', { prov: { title: { source: 'transcript', span: null } } });
  const snap = s.snapshot();
  s.applyVoicePatch({ title: 'B' }, 'y'); // 出所不明の上書き
  eq(s.getFieldProv('title'), null, '上書き後は不明');
  s.restore(snap);
  eq(s.getFieldProv('title'), { source: 'transcript', span: null }, '復元で出所も戻る');
});

t('prov の無い古い snapshot でも restore できる（後方互換・v54 以前の来歴）', () => {
  const s = createDraftStore();
  s.applyVoicePatch({ title: 'A' }, 'x', { prov: { title: { source: 'transcript', span: null } } });
  const ok = s.restore({ draft: { title: 'C' } });
  eq(ok, true, 'restore は成功する');
  eq(s.get().title, 'C', '値は戻る');
  eq(s.getFieldProv('title'), null, '欠けた prov は不明(null)に戻る＝古い出所を残さない');
});

t('reset で prov も初期化される', () => {
  const s = createDraftStore();
  s.applyVoicePatch({ title: 'A' }, 'x', { prov: { title: { source: 'transcript', span: null } } });
  s.reset();
  eq(s.getFieldProv('title'), null, 'reset 後は null');
});

// ===== v57: 訂正の記録（スパン出所追跡 B） =====
t('音声の値を人が変えると訂正として記録される（直される前の出所つき）', () => {
  const s = createDraftStore();
  s.applyVoicePatch({ startDate: '2026-07-20', title: '会議' }, 'x', {
    prov: { startDate: { source: 'inferred', span: null }, title: { source: 'transcript', span: null } },
  });
  s.setByHuman('startDate', '2026-07-21');
  eq(s.getCorrections(), { startDate: 'inferred' }, '推論由来の訂正');
  s.setByHuman('title', '打ち合わせ');
  eq(s.getCorrections().title, 'transcript', '発話どおり由来の訂正');
});

t('同じ値の再確定は訂正ではない（※既存仕様どおり origin は human に移る＝以後は人の欄）', () => {
  const s = createDraftStore();
  s.applyVoicePatch({ title: '会議' }, 'x', { prov: { title: { source: 'transcript', span: null } } });
  s.setByHuman('title', '会議'); // 同じ値＝変えていない
  eq(s.getCorrections(), {}, '同値は訂正ではない');
  eq(s.getFieldOrigin('title'), 'human', '触った欄が human になるのは v1 からの既存仕様（掃除からの保護）');
});

t('人の値の再編集は二重に数えない（最初の訂正の出所を保つ）', () => {
  const s = createDraftStore();
  s.applyVoicePatch({ title: '会議' }, 'x', { prov: { title: { source: 'transcript', span: null } } });
  s.setByHuman('title', 'A'); // 訂正（voice → human）
  s.setByHuman('title', 'B'); // 人の値の再編集
  eq(s.getCorrections(), { title: 'transcript' }, '最初の訂正の出所だけを保つ');
});

t('出所情報の無い音声値の訂正は null（不明を transcript に化けさせない）', () => {
  const s = createDraftStore();
  s.applyVoicePatch({ title: '会議' }, 'x'); // prov なし
  s.setByHuman('title', 'A');
  eq(s.getCorrections(), { title: null });
});

t('音声が書き直した欄の訂正は消える・手入力保護で残った欄の訂正は残る', () => {
  const s = createDraftStore();
  s.applyVoicePatch({ title: '会議', startDate: '2026-07-20' }, 'x', {
    prov: { title: { source: 'transcript', span: null }, startDate: { source: 'inferred', span: null } },
  });
  s.setByHuman('title', 'A');
  s.setByHuman('startDate', '2026-07-21');
  s.applyVoicePatch({ title: '飲み会' }, 'y'); // title は音声が書き直し・startDate は手入力保護（既定）で残る
  eq(s.getCorrections(), { startDate: 'inferred' }, '最終値が音声のもの＝訂正から消える／人の値が残る欄＝訂正のまま');
});

t('snapshot/restore/reset が訂正も往復・初期化する', () => {
  const s = createDraftStore();
  s.applyVoicePatch({ title: '会議' }, 'x', { prov: { title: { source: 'inferred', span: null } } });
  s.setByHuman('title', 'A');
  const snap = s.snapshot();
  s.reset();
  eq(s.getCorrections(), {}, 'reset で空');
  s.restore(snap);
  eq(s.getCorrections(), { title: 'inferred' }, 'restore で戻る');
  s.restore({ draft: { title: 'C' } }); // 旧形式（corrections 無し）
  eq(s.getCorrections(), {}, '欠けた snapshot は空に戻す（後方互換）');
});

console.log(`\nschema.test: ${pass} passed, ${fail} failed`);
if (failures.length) { console.log('\n' + failures.join('\n\n')); process.exit(1); }
