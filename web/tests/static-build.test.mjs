import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DOCS = path.join(ROOT, 'docs');
const BASE = new URL('https://example.invalid/qc-studio/');
let meta;
let files;
let content;

const slash = value => value.replaceAll('\\', '/');
const normalizedInput = value => slash(value).replace(/^\.\//, '');
const inside = (target, directory) => {
  const relative = path.relative(directory, target);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
};

async function walk(directory, relative = '') {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    assert.equal(entry.isSymbolicLink(), false, `Publication must not follow a link: ${name}`);
    if (entry.isDirectory()) result.push(...await walk(path.join(directory, entry.name), name));
    else if (entry.isFile()) result.push(name);
    else assert.fail(`Unexpected published file type: ${name}`);
  }
  return result.sort();
}

function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/gs)].map(match => [match[1].toLowerCase(), match[3]]));
}

async function assertAsset(reference, relativePage, label) {
  if (!reference || reference.startsWith('#')) return;
  assert.ok(reference.startsWith('./') || reference.startsWith('../'), `${label} must use a relative URL: ${reference}`);
  const resolved = new URL(reference, new URL(relativePage, BASE));
  assert.equal(resolved.origin, BASE.origin, `${label} leaves the site's origin`);
  assert.ok(resolved.pathname.startsWith(BASE.pathname), `${label} escapes /qc-studio/: ${reference}`);
  let relative = decodeURIComponent(resolved.pathname.slice(BASE.pathname.length));
  if (!relative || relative.endsWith('/')) relative += 'index.html';
  const target = path.resolve(DOCS, relative);
  assert.ok(inside(target, DOCS), `${label} escapes the publish directory`);
  assert.ok((await fs.stat(target)).isFile(), `${label} is missing: ${relative}`);
}

before(async () => {
  try {
    meta = JSON.parse(await fs.readFile(path.join(ROOT, 'web', '.build-meta.json'), 'utf8'));
    files = await walk(DOCS);
    content = new Map(await Promise.all(files.map(async name => [name, await fs.readFile(path.join(DOCS, name), 'utf8')])));
  } catch (error) {
    throw new Error('The static build must complete before this suite runs. Run the web build first.', { cause: error });
  }
});

test('the published directory contains only intended site files and bundled assets', () => {
  for (const required of ['index.html', 'licenses.html', 'THIRD-PARTY-NOTICES.txt', 'favicon.svg', '.nojekyll']) {
    assert.ok(files.includes(required), `Missing ${required}`);
  }
  const pages = new Set(['index.html', 'licenses.html', 'THIRD-PARTY-NOTICES.txt', 'favicon.svg', '.nojekyll']);
  for (const file of files) {
    assert.ok(pages.has(file) || /^assets\/[A-Za-z0-9_.-]+\.(?:js|css|txt|svg|woff2?)$/.test(file), `Unexpected public file: ${file}`);
    assert.doesNotMatch(file, /(?:^|\/)(?:data|projects|outputs|\.validation|node_modules|\.git|tests)(?:\/|$)/i);
    assert.doesNotMatch(file, /\.(?:json|pptx|xlsx|map|log|py|ps1|cmd)$/i);
  }
});

test('HTML asset and navigation links stay valid beneath an arbitrary project-site subpath', async () => {
  for (const page of ['index.html', 'licenses.html']) {
    const html = content.get(page);
    for (const match of html.matchAll(/<(?:script|link|a|img|iframe|source)\b[^>]*>/gi)) {
      const attrs = attributes(match[0]);
      if (attrs.src !== undefined) await assertAsset(attrs.src, page, `${page} src`);
      if (attrs.href !== undefined) await assertAsset(attrs.href, page, `${page} href`);
    }
  }
});

test('the generated app entry and every emitted module dependency resolve within docs', async () => {
  const entries = Object.entries(meta.outputs).filter(([, output]) => normalizedInput(output.entryPoint || '').endsWith('public/app.js'));
  assert.equal(entries.length, 1, 'One browser app entry is required');
  const entryFile = path.resolve(ROOT, entries[0][0]);
  assert.ok(inside(entryFile, DOCS));
  const scriptTag = [...content.get('index.html').matchAll(/<script\b[^>]*>/gi)].map(match => attributes(match[0])).find(attrs => attrs.type === 'module');
  assert.ok(scriptTag?.src, 'The entry must be loaded as an ES module');
  assert.equal(new URL(scriptTag.src, BASE).pathname, BASE.pathname + slash(path.relative(DOCS, entryFile)));

  for (const [name, output] of Object.entries(meta.outputs)) {
    const target = path.resolve(ROOT, name);
    assert.ok(inside(target, DOCS), `Build output escapes publication: ${name}`);
    assert.ok((await fs.stat(target)).isFile(), `Missing emitted output: ${name}`);
    for (const dependency of output.imports || []) {
      assert.equal(Boolean(dependency.external), false, `Unbundled runtime import: ${dependency.path}`);
      const imported = path.resolve(ROOT, dependency.path);
      assert.ok(inside(imported, DOCS), `Module import escapes publication: ${dependency.path}`);
      assert.ok((await fs.stat(imported)).isFile(), `Missing module import: ${dependency.path}`);
    }
  }
});

test('the browser dependency graph excludes the HTTP adapter, Node exporter, and private runtime packages', () => {
  const inputs = Object.keys(meta.inputs).map(normalizedInput);
  for (const required of ['web/src/browser-platform.mjs', 'web/src/browser-api.mjs', 'web/src/browser-exports.mjs', 'lib/model.mjs', 'lib/qc-tools.mjs', 'lib/tool-scenes.mjs']) {
    assert.ok(inputs.some(name => name.endsWith(required)), `Missing browser dependency: ${required}`);
  }
  for (const input of inputs) {
    assert.doesNotMatch(input, /(?:^|\/)public\/platform\.js$/, 'HTTP platform must be replaced at build time');
    assert.doesNotMatch(input, /(?:^|\/)(?:server|export-worker)\.mjs$/);
    assert.doesNotMatch(input, /(?:^|\/)lib\/(?:exports|tool-exports)\.mjs$/);
    assert.doesNotMatch(input, /@oai|codex-primary-runtime|artifact[_-]tool/i);
    assert.doesNotMatch(input, /(?:^|\/)(?:data|outputs|\.validation)(?:\/|$)/i);
    assert.doesNotMatch(input, /^node:/);
  }
});

test('published HTML sets a restrictive network policy before loading any app assets', () => {
  for (const page of ['index.html', 'licenses.html']) {
    const html = content.get(page);
    const tags = [...html.matchAll(/<meta\b[^>]*>/gi)];
    const match = tags.find(match => attributes(match[0])['http-equiv']?.toLowerCase() === 'content-security-policy');
    assert.ok(match, `${page}: CSP meta tag is missing`);
    const policy = attributes(match[0]).content;
    const directives = new Map(policy.split(';').map(value => value.trim()).filter(Boolean).map(value => {
      const [name, ...tokens] = value.split(/\s+/);
      return [name, tokens];
    }));
    for (const name of ['default-src', 'connect-src', 'object-src', 'base-uri', 'form-action']) {
      assert.deepEqual(directives.get(name), ["'none'"], `${page}: unsafe ${name}`);
    }
    assert.deepEqual(directives.get('script-src'), ["'self'"]);
    assert.doesNotMatch(policy, /unsafe-eval|https?:|\*/i);
    const firstAsset = html.search(/<(?:script|link)\b/i);
    assert.ok(firstAsset < 0 || match.index < firstAsset, `${page}: CSP must precede app assets`);
    assert.doesNotMatch(html, /<script\b[^>]*>\s*[^<\s]/i, `${page}: inline script is not allowed`);
    assert.doesNotMatch(html, /\son(?:load|error|click)\s*=/i, `${page}: inline event handler is not allowed`);
  }
});

test('styles do not pull external fonts, stylesheets, or image URLs at runtime', async () => {
  for (const [name, css] of content) {
    if (!name.endsWith('.css')) continue;
    assert.doesNotMatch(css, /@import\b/i, `${name}: external style import`);
    for (const match of css.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)) {
      const reference = match[2].trim();
      if (reference.startsWith('data:') || reference.startsWith('#')) continue;
      await assertAsset(reference.startsWith('.') ? reference : `./${reference}`, name, `${name} CSS URL`);
    }
  }
});

test('published text contains no local filesystem paths, private runtime identifiers, or source maps', () => {
  const absoluteRoot = slash(ROOT).replace(/\/$/, '');
  for (const [name, text] of content) {
    assert.ok(!slash(text).includes(absoluteRoot), `${name}: workspace path leaked`);
    assert.doesNotMatch(text, /[A-Z]:[\\/](?:Users|Windows|Program Files)[\\/]|file:\/\/\/|\/home\/[^\s"']+\/\.codex/ig, `${name}: local path leaked`);
    assert.doesNotMatch(text, /\.codex[\\/]|codex-primary-runtime|@oai\/artifact-tool/i, `${name}: private runtime leaked`);
    assert.doesNotMatch(text, /[#@]\s*sourceMappingURL\s*=/i, `${name}: source map reference leaked`);
  }
});

test('storage and backup instructions accurately describe browser persistence', () => {
  const html = content.get('index.html');
  assert.match(html, /このブラウザーに保存/);
  assert.match(html, /JSONバックアップ/);
  assert.match(html, /ブラウザーのデータ削除/);
  assert.doesNotMatch(html, /このPCに保存|起動用ウィンドウ/);
  const help = content.get('licenses.html');
  assert.match(help, /外部へ送信されません/);
  assert.match(help, /インターネット接続はサイトの読み込み/);
  const notices = content.get('THIRD-PARTY-NOTICES.txt');
  for (const dependency of ['exceljs', 'pptxgenjs', 'jszip']) assert.match(notices, new RegExp(`\\b${dependency}\\b`));
});
