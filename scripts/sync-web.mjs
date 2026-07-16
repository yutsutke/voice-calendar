// web 本体をルート（GitHub Pages 配信用）から Capacitor の webDir（www/）へコピーする。
// Capacitor にバンドルさせる前に実行する（`cap sync` / `cap copy` の前）。
// 狙い: ルートを GitHub Pages の配信元として維持しつつ、native ビルドは www/ を使う
// （あの日 photo-memory-spike と同じ運用。iPhone Safari での実発話検証を GitHub Pages で行う）。
import { rmSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const out = join(root, 'www');

// バンドルに含める web アセット（必要なものだけ。docs/tests/native プロジェクト等は含めない）。
const ASSETS = ['index.html', 'engine', 'input', 'adapters'];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

for (const a of ASSETS) {
  const src = join(root, a);
  if (!existsSync(src)) { console.warn('skip (missing):', a); continue; }
  cpSync(src, join(out, a), { recursive: true });
  console.log('copied', a);
}

console.log('web assets synced ->', out);
