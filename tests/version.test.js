// tests/version.test.js — BUILD と script の ?v= の一致を強制する（node tests/version.test.js）
//
// なぜ必要か（v9 で踏んだ実バグ）:
// この製品は BUILD 版文字列を index.html だけに持つが、ロジックは engine/ input/ adapters/ の
// 別ファイルにある＝**別々にキャッシュされる**。script に版を付けないと、
// 「index.html は新しいのに parser.js は古い」＝**フッタが v9 と嘘をつくのに解釈は v8** という
// 状態が成立し、実機で「直したはずのバグが直っていない」に化ける（あの日は単一 index.html
// なのでこの罠が無かった。エンジン分離の代償）。
//
// → BUILD を上げたら script の ?v= も上げる。人間の注意力に頼らず、ここで機械的に落とす。
'use strict';
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

let pass = 0;
const fail = [];

// BUILD の先頭の版（例: "v10：script に…" → "10"）
const buildMatch = html.match(/const BUILD = 'v(\d+)[：:]/);
if (!buildMatch) {
  fail.push('index.html の BUILD が `const BUILD = \'vN：...` の形で見つからない');
} else {
  pass++;
}
const buildVer = buildMatch && buildMatch[1];

// ローカルの JS を読む script タグを全部集める（外部 URL は対象外）
const tags = [...html.matchAll(/<script src="([^"]+\.js)([^"]*)"><\/script>/g)];
if (!tags.length) fail.push('ローカル JS の script タグが見つからない');
else pass++;

for (const [, src, query] of tags) {
  const v = (query.match(/\?v=(\d+)/) || [])[1];
  if (!v) {
    fail.push(`${src}: ?v= が付いていない（別キャッシュで古い版が残り、フッタが嘘をつく）`);
  } else if (v !== buildVer) {
    fail.push(`${src}: ?v=${v} だが BUILD は v${buildVer} → 版がズレている（BUILD を上げたら ?v= も上げる）`);
  } else {
    pass++;
  }
}

console.log(`\nversion.test: ${pass} passed, ${fail.length} failed`);
if (fail.length) { console.log('\n' + fail.map((f) => `✗ ${f}`).join('\n')); process.exit(1); }
