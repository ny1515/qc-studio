import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBDatabase, IDBObjectStore } from 'fake-indexeddb';

const originalIndexedDB = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
const originalFetch = globalThis.fetch;
let serial = 0;
const freshModule = () => import(`../src/browser-api.mjs?storage-test=${++serial}`);
async function setup() {
  globalThis.indexedDB = new IDBFactory();
  globalThis.fetch = () => { throw new Error('Network requests are forbidden in browserApi tests'); };
  return (await freshModule()).browserApi;
}
afterEach(() => {
  if (originalIndexedDB) Object.defineProperty(globalThis, 'indexedDB', originalIndexedDB);
  else delete globalThis.indexedDB;
  globalThis.fetch = originalFetch;
});
const post = (api, route, body, binary = false) => api(route, { method: 'POST', body, binary });
const save = (api, project) => api(`/api/projects/${project.id}`, { method: 'PUT', body: { project } });
const read = (api, project) => api(`/api/projects/${project.id}`);
const status = expected => error => { assert.equal(error.status, expected, error.message); assert.equal(typeof error.message, 'string'); return true; };

test('bootstrap and all local CRUD/analysis routes work with network disabled', async () => {
  const api = await setup(), bootstrap = await api('/api/bootstrap');
  assert.equal(bootstrap.steps.length, 7);
  assert.equal(bootstrap.toolCatalog.length, 15);
  assert.equal(bootstrap.storage, 'indexeddb');
  bootstrap.steps[0].title = 'mutated client copy';
  assert.equal((await api('/api/bootstrap')).steps[0].title, 'テーマの選定');
  assert.deepEqual((await api('/api/projects')).projects, []);
  const { project } = await post(api, '/api/projects', { source: 'blank' });
  assert.equal(project.meta.title, ''); assert.equal(project.isSample, false); assert.equal(project.revision, 1);
  project.meta.title = 'ローカルに保存する活動';
  assert.equal((await read(api, project)).project.meta.title, '');
  const saved = await save(api, project);
  assert.equal(saved.project.revision, 2);
  assert.equal(project.revision, 1, 'caller snapshot must not mutate');
  assert.equal((await api('/api/projects')).projects[0].title, project.meta.title);
  assert.equal((await post(api, '/api/analyze', { project: saved.project })).analysis.steps.length, 7);
  assert.equal((await api('/api/health')).ok, true);
});

test('zero and missing measurements stay distinct through storage and JSON backup', async () => {
  const api = await setup(), { project } = await post(api, '/api/projects', { source: 'blank' });
  project.theme.metricType = 'count'; project.theme.unit = '件';
  project.measurements = [
    { id: 'before-zero', phase: 'before', date: '2026-10-01', category: '検査', value: 0, denominator: null, note: '' },
    { id: 'after-missing', phase: 'after', date: '2026-10-02', category: '検査', value: null, denominator: null, note: '' },
  ];
  const saved = await save(api, project);
  assert.equal(saved.analysis.before.value, 0); assert.equal(saved.analysis.after.value, null);
  const persisted = (await read(api, project)).project;
  assert.equal(persisted.measurements[0].value, 0); assert.equal(persisted.measurements[1].value, null);
  const response = await post(api, '/api/exports', { project: persisted, format: 'json' }, true);
  assert(response instanceof Response); assert.match(response.headers.get('Content-Disposition'), /filename\*=UTF-8''/);
  const backup = await response.json();
  assert.equal(backup.measurements[0].value, 0); assert.equal(backup.measurements[1].value, null);
});

test('project and tool sample markers survive title edits and accidental flag clearing', async () => {
  const api = await setup(), { project } = await post(api, '/api/projects', { source: 'sample' });
  assert.equal(project.isSample, true);
  const { tool } = await post(api, '/api/tools/create', { kind: 'pareto', sample: true });
  project.tools.push(tool);
  const first = (await save(api, project)).project;
  first.meta.title = '変更したタイトル'; first.isSample = false; first.tools[0].title = '変更した図'; first.tools[0].isSample = false;
  const second = (await save(api, first)).project;
  assert.equal(second.isSample, true); assert.equal(second.tools[0].isSample, true);
  const backup = await post(api, '/api/exports', { project: second, format: 'json' }, true);
  assert.match(decodeURIComponent(backup.headers.get('Content-Disposition')), /サンプル_/);
});

test('concurrent separate connections accept one writer and reject the stale one', async () => {
  const api = await setup(), otherTab = (await freshModule()).browserApi;
  const { project } = await post(api, '/api/projects', { source: 'blank' });
  const a = structuredClone(project), b = structuredClone(project); a.meta.title = 'tab A'; b.meta.title = 'tab B';
  const results = await Promise.allSettled([save(api, a), save(otherTab, b)]);
  const wins = results.filter(result => result.status === 'fulfilled'), losses = results.filter(result => result.status === 'rejected');
  assert.equal(wins.length, 1); assert.equal(losses.length, 1); assert.equal(losses[0].reason.status, 409);
  const actual = (await read(otherTab, project)).project;
  assert.equal(actual.revision, 2); assert.equal(actual.meta.title, wins[0].value.project.meta.title);
});

test('saving resolves only after the IndexedDB transaction commits', async () => {
  const api = await setup(), { project } = await post(api, '/api/projects', { source: 'blank' });
  const transaction = IDBDatabase.prototype.transaction;
  let completed = false;
  IDBDatabase.prototype.transaction = function (...args) {
    const tx = transaction.apply(this, args);
    if (args[1] === 'readwrite') tx.addEventListener('complete', () => { completed = true; });
    return tx;
  };
  try { project.meta.title = 'commit check'; await save(api, project); assert.equal(completed, true); }
  finally { IDBDatabase.prototype.transaction = transaction; }
});

test('quota failure is visible and an aborted update leaves the original unchanged', async () => {
  const api = await setup(), { project } = await post(api, '/api/projects', { source: 'blank' });
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function () { throw new DOMException('Full storage', 'QuotaExceededError'); };
  try { project.meta.title = 'must not replace'; await assert.rejects(save(api, project), error => { assert.equal(error.status, 507); assert.match(error.message, /保存容量/); return true; }); }
  finally { IDBObjectStore.prototype.put = put; }
  const actual = (await read(api, project)).project;
  assert.equal(actual.meta.title, ''); assert.equal(actual.revision, 1);
});

test('deletion requires the current revision and does not remove a newer save', async () => {
  const api = await setup(), { project } = await post(api, '/api/projects', { source: 'blank' });
  const saved = (await save(api, project)).project;
  await assert.rejects(api(`/api/projects/${project.id}`, { method: 'DELETE' }), status(400));
  await assert.rejects(api(`/api/projects/${project.id}`, { method: 'DELETE', body: { revision: project.revision } }), status(409));
  assert.equal((await read(api, project)).project.revision, saved.revision);
  const deleted = await api(`/api/projects/${project.id}`, { method: 'DELETE', body: { revision: saved.revision } });
  assert.deepEqual(deleted, { deleted: true, id: project.id });
  await assert.rejects(read(api, project), status(404));
  assert.equal((await api('/api/projects')).projects.length, 0);
});

test('JSON imports receive a new identity and preserve original activity and sample data', async () => {
  const api = await setup(), { project } = await post(api, '/api/projects', { source: 'sample' });
  project.revision = 39;
  const imported = (await post(api, '/api/projects/import', { project })).project;
  assert.notEqual(imported.id, project.id); assert.equal(imported.revision, 1);
  assert.equal(imported.isSample, true); assert.equal(imported.meta.title, project.meta.title);
  assert.deepEqual(imported.measurements, project.measurements);
  const importedAgain = (await post(api, '/api/projects/import', { project })).project;
  assert.notEqual(importedAgain.id, imported.id);
  assert.equal((await api('/api/projects')).projects.length, 3);
  assert.equal((await read(api, project)).project.revision, 1);
});

test('4 MB limit counts UTF-8 bytes and malformed inputs never reach storage', async () => {
  const api = await setup();
  await assert.rejects(post(api, '/api/projects', { source: 'blank', extra: 'あ'.repeat(1_400_000) }), status(413));
  const circular = {}; circular.circular = circular;
  await assert.rejects(post(api, '/api/projects/import', circular), status(400));
  await assert.rejects(post(api, '/api/projects', []), status(400));
  await assert.rejects(post(api, '/api/tools/create', { kind: 'pareto', sample: 'yes' }), status(400));
  await assert.rejects(api('https://example.com/api/projects'), status(400));
  assert.equal((await api('/api/projects')).projects.length, 0);
});

test('invalid Office data is rejected but a JSON backup of the draft remains possible', async () => {
  const api = await setup(), { project } = await post(api, '/api/projects', { source: 'blank' });
  const { tool } = await post(api, '/api/tools/create', { kind: 'tree', sample: false });
  project.tools.push(tool);
  await assert.rejects(post(api, '/api/exports', { project, format: 'pptx' }, true), error => { assert.equal(error.status, 400); assert.match(error.message, /系統図法/); return true; });
  const response = await post(api, '/api/exports', { project, format: 'json' }, true);
  assert.equal((await response.json()).tools[0].id, tool.id);
  await assert.rejects(post(api, '/api/exports', { project, format: 'exe' }, true), status(400));
});

test('download filenames preserve emoji boundaries and tolerate malformed Unicode', async () => {
  const api = await setup(), { project } = await post(api, '/api/projects', { source: 'blank' });
  project.meta.title = `${'あ'.repeat(69)}😀`;
  let response = await post(api, '/api/exports', { project, format: 'json' }, true);
  assert.match(decodeURIComponent(response.headers.get('Content-Disposition')), /😀_バックアップ\.json/);
  project.meta.title = '活動\ud800';
  response = await post(api, '/api/exports', { project, format: 'json' }, true);
  assert.match(decodeURIComponent(response.headers.get('Content-Disposition')), /活動__バックアップ\.json/);
});

test('unavailable and denied IndexedDB produce actionable errors', async () => {
  const api = await setup();
  delete globalThis.indexedDB;
  await assert.rejects(api('/api/bootstrap'), error => { assert.equal(error.status, 503); assert.match(error.message, /IndexedDB/); return true; });
  globalThis.indexedDB = { open() { throw new DOMException('Denied', 'SecurityError'); } };
  await assert.rejects(api('/api/projects'), error => { assert.equal(error.status, 503); assert.match(error.message, /保存が許可/); return true; });
});

test('invalid stored records are skipped with a warning, and are not deleted', async () => {
  const api = await setup();
  await api('/api/projects');
  const db = await new Promise((resolve, reject) => { const request = indexedDB.open('qc-studio-browser', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  await new Promise((resolve, reject) => { const tx = db.transaction('projects', 'readwrite'); tx.objectStore('projects').add({ id: 'invalid-record', schemaVersion: 999 }); tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
  const list = await api('/api/projects'); assert.equal(list.projects.length, 0); assert.match(list.warning, /1件/);
  const record = await new Promise((resolve, reject) => { const request = db.transaction('projects').objectStore('projects').get('invalid-record'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  assert.equal(record.schemaVersion, 999); db.close();
});
