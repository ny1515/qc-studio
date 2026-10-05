import { build, transform } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const web = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(web, '..');
const out = path.resolve(root, 'docs');
if (path.dirname(out) !== root || path.basename(out) !== 'docs') throw new Error('Unsafe build directory');
await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(path.join(out, 'assets'), { recursive: true });

const result = await build({
  absWorkingDir: root,
  entryPoints: { app: path.join(root, 'public', 'app.js') },
  tsconfigRaw: {},
  outdir: out,
  entryNames: 'assets/[name]-[hash]',
  chunkNames: 'assets/[name]-[hash]',
  assetNames: 'assets/[name]-[hash]',
  bundle: true,
  splitting: true,
  platform: 'browser',
  format: 'esm',
  target: ['chrome109', 'edge109', 'firefox115', 'safari16.4'],
  minify: true,
  legalComments: 'linked',
  charset: 'utf8',
  metafile: true,
  sourcemap: false,
  plugins: [{
    name: 'browser-platform',
    setup(builder) {
      builder.onResolve({ filter: /^\.\/platform\.js$/ }, args => {
        if (path.resolve(args.resolveDir) === path.join(root, 'public')) {
          return { path: path.join(web, 'src', 'browser-platform.mjs') };
        }
      });
    },
  }],
});
const app = Object.entries(result.metafile.outputs).find(([, data]) => data.entryPoint === 'public/app.js');
if (!app) throw new Error('Browser entry point was not generated');
if (Object.keys(result.metafile.inputs).some(name => /@oai|lib\/(exports|tool-exports)|server\.mjs/.test(name))) {
  throw new Error('The browser build contains a server-only dependency');
}
const appPath = path.relative(out, path.resolve(root, app[0])).replaceAll('\\', '/');
const css = await transform(await fs.readFile(path.join(root, 'public', 'styles.css'), 'utf8'), { loader: 'css', minify: true });
const cssPath = `assets/styles-${createHash('sha256').update(css.code).digest('hex').slice(0, 10)}.css`;
await fs.writeFile(path.join(out, cssPath), css.code);
const policy = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
let html = await fs.readFile(path.join(root, 'public', 'index.html'), 'utf8');
html = html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />\n    <meta name="referrer" content="no-referrer" />\n    <meta name="description" content="QC活動の7工程とQC7つ道具・新QC7つ道具を整理し、PowerPointとExcelを作成。活動データはブラウザーに保存されます。" />\n    <link rel="icon" href="./favicon.svg" type="image/svg+xml" />`)
  .replace('href="./styles.css"', `href="./${cssPath}"`)
  .replace('src="./app.js"', `src="./${appPath}"`)
  .replaceAll('このPCに保存', 'このブラウザーに保存')
  .replace('入力データはこのブラウザーに保存されます。サンプルはすべて架空の内容です。', '活動データはこのブラウザーに保存され、このアプリから外部へ送信されません。ブラウザーのデータ削除や端末の変更に備え、JSONバックアップを保存してください。サンプルは架空の内容です。')
  .replace('<div class="backup-tools">', '<p class="browser-storage-note">ブラウザーのデータ削除・別端末への移行前に、JSONバックアップを保存してください。</p>\n          <div class="backup-tools">')
  .replace('<input type="file" id="import-file"', '<a class="licenses-link" href="./licenses.html" target="_blank" rel="noopener">使い方・ライセンス</a>\n          <input type="file" id="import-file"');
await fs.writeFile(path.join(out, 'index.html'), html);
await fs.appendFile(path.join(out, cssPath), '\n.browser-storage-note{font-size:10px;line-height:1.7;color:#b4ccc6}.licenses-link{display:inline-block;font-size:10px;color:#b4ccc6;margin-top:12px}\n');
await fs.writeFile(path.join(out, '.nojekyll'), '');
await fs.writeFile(path.join(out, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#153e43"/><g fill="#d8e6c8"><rect x="14" y="14" width="14" height="14" rx="3"/><rect x="36" y="36" width="14" height="14" rx="3"/></g><g fill="#68ad98"><rect x="36" y="14" width="14" height="14" rx="3"/><rect x="14" y="36" width="14" height="14" rx="3"/></g></svg>');

const notices = [], missingNotices = [], visited = new Set();
async function collect(name, from) {
  const require = createRequire(path.join(from, 'package.json'));
  let folder;
  try { folder = path.dirname(require.resolve(`${name}/package.json`)); }
  catch {
    folder = path.dirname(require.resolve(name));
    while (folder !== path.dirname(folder)) {
      try { if (JSON.parse(await fs.readFile(path.join(folder, 'package.json'), 'utf8')).name === name) break; } catch {}
      folder = path.dirname(folder);
    }
  }
  folder = await fs.realpath(folder);
  if (visited.has(folder)) return;
  visited.add(folder);
  const pkg = JSON.parse(await fs.readFile(path.join(folder, 'package.json'), 'utf8'));
  const files = (await fs.readdir(folder)).filter(file => /^(licen[cs]e|copying|notice)([.-]|$)/i.test(file));
  const texts = [];
  for (const file of files) {
    if ((await fs.stat(path.join(folder, file))).isFile()) texts.push(await fs.readFile(path.join(folder, file), 'utf8'));
  }
  if (!texts.length) {
    const readmeName = (await fs.readdir(folder)).find(file => /^readme(?:\.|$)/i.test(file));
    if (readmeName) {
      const readme = await fs.readFile(path.join(folder, readmeName), 'utf8');
      const license = readme.match(/^#{1,6}\s+licen[cs]e\b[^\n]*\n([\s\S]*)/im);
      if (license && /permission is hereby granted|redistribution and use|licensed under/i.test(license[1])) texts.push(license[1]);
    }
  }
  if (!texts.length && pkg.name === 'saxes' && pkg.version === '5.0.1') {
    texts.push(await fs.readFile(path.join(web, 'third-party', 'saxes-5.0.1-LICENSE.txt'), 'utf8'));
  }
  if (!texts.length) missingNotices.push(`${pkg.name}@${pkg.version} (${JSON.stringify(pkg.repository)})`);
  notices.push({ name: pkg.name, version: pkg.version, license: pkg.license, text: texts.join('\n\n') });
  for (const dependency of Object.keys(pkg.dependencies || {})) {
    // These streaming file backends are absent from ExcelJS's browser bundle.
    if (pkg.name === 'exceljs' && ['archiver', 'unzipper'].includes(dependency)) continue;
    if (pkg.browser && typeof pkg.browser === 'object' && pkg.browser[dependency] === false) continue;
    await collect(dependency, folder);
  }
}
for (const name of ['exceljs', 'pptxgenjs', 'jszip']) await collect(name, web);
if (missingNotices.length) throw new Error(`Missing license notices: ${missingNotices.join('; ')}`);
notices.sort((a, b) => a.name.localeCompare(b.name));
const notice = notices.map(item => `${item.name} ${item.version}\nLicense: ${item.license}\n${'='.repeat(72)}\n${item.text}`).join('\n\n');
await fs.writeFile(path.join(out, 'THIRD-PARTY-NOTICES.txt'), notice);
await fs.writeFile(path.join(out, 'licenses.html'), `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${policy}"><title>使い方・ライセンス — QC Studio</title><link rel="stylesheet" href="./${cssPath}"><main style="max-width:850px;margin:40px auto;padding:24px"><a href="./">← QC Studioに戻る</a><h1 style="margin-top:28px">QC Studioの使い方</h1><p>「新しいQC活動を作成」で活動を開始し、7工程に沿って入力します。「QC道具」でQC7つ道具・新QC7つ道具・層別を追加できます。右上の「保存」でこのブラウザーに記録し、「PowerPoint」「Excel」で編集できる資料をダウンロードします。</p><p>活動データの保存先はこのブラウザーです。ブラウザーのデータを削除すると保存内容も失われます。端末・ブラウザーを移す際は「JSONバックアップ」と「読み込み」を使用してください。活動データはアプリから外部へ送信されません。インターネット接続はサイトの読み込みに使われます。</p><p>Microsoft Edge・Google Chromeなどの最新のデスクトップブラウザーでご利用ください。ExcelのQC道具解析結果・図は出力時点の値です。QC Studioで編集して再出力してください。Excelの活動指標には再計算可能な式を含みます。PowerPointの表・図形・グラフは編集できます。</p><p>サンプル活動・サンプル道具は架空のデータです。結果だけで因果関係や統計的な有意差は断定できません。社内ルールに沿って確認し、資料を仕上げてください。</p><h2>ライセンス</h2><p>サイトに同梱する第三者ライブラリの著作権表示とライセンスは<a href="./THIRD-PARTY-NOTICES.txt">第三者ライブラリのライセンス一覧</a>をご覧ください。</p></main></html>`);
await fs.writeFile(path.join(web, '.build-meta.json'), JSON.stringify(result.metafile, null, 2));
console.log(JSON.stringify({ directory: 'docs', assets: Object.keys(result.metafile.outputs).length, notices: notices.length, app: appPath }));
