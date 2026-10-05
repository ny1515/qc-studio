import { createBlankProject, createSampleProject, normalizeProject, analyzeProject, STEPS } from '../../lib/model.mjs';
import { TOOL_CATALOG, createTool, analyzeTool } from '../../lib/qc-tools.mjs';

// This adapter replaces public/app.js's api() directly. It never calls fetch:
// normal requests return plain objects; binary requests return a Response.
const DATABASE_NAME = 'qc-studio-browser';
const DATABASE_VERSION = 1;
const PROJECT_STORE = 'projects';
const BODY_LIMIT = 4 * 1024 * 1024;
const CONFLICT = '別の画面で更新されています。入力内容をJSONで保存し、プロジェクトを開き直してください。';
let databaseConnection = null;
let openingDatabase = null;
let activeExport = false;

function apiError(status, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.status = status;
  return error;
}

function storageError(error) {
  if (error?.status) return error;
  if (error?.name === 'QuotaExceededError') return apiError(507, 'ブラウザーの保存容量が足りません。入力内容をJSONでバックアップし、不要な活動を削除してから保存してください。', error);
  if (error?.name === 'SecurityError' || error?.name === 'NotAllowedError') return apiError(503, 'ブラウザーへの保存が許可されていません。サイトの保存設定やプライベートモードを確認してください。入力内容はJSONでバックアップできます。', error);
  if (error?.name === 'VersionError') return apiError(503, '保存データは新しいバージョンで作成されています。QC Studioの画面を再読み込みしてください。', error);
  if (error?.name === 'InvalidStateError') return apiError(503, 'ブラウザーの保存領域を開けませんでした。入力内容をJSONでバックアップしてから、画面を再読み込みしてください。', error);
  return apiError(503, 'ブラウザーへの保存・読み込みに失敗しました。入力内容をJSONでバックアップし、保存設定や空き容量を確認してください。', error);
}

function checkBrowserFeatures() {
  if (typeof globalThis.crypto?.randomUUID !== 'function') throw apiError(503, 'この画面では安全なIDを作成できません。HTTPSの公開URLを、対応する新しいブラウザーで開いてください。');
  if (typeof globalThis.structuredClone !== 'function') throw apiError(503, 'このブラウザーは必要なデータ処理に対応していません。ブラウザーを更新してからQC Studioを開いてください。');
  try {
    if (typeof globalThis.indexedDB?.open !== 'function') throw apiError(503, 'このブラウザーではローカル保存を利用できません。IndexedDBを利用できる通常のブラウザーで開いてください。');
  } catch (error) { throw storageError(error); }
}

async function openDatabase() {
  if (databaseConnection) return databaseConnection;
  if (openingDatabase) return openingDatabase;
  const pending = new Promise((resolve, reject) => {
    let factory;
    try { factory = globalThis.indexedDB; }
    catch (error) { reject(storageError(error)); return; }
    if (!factory) { reject(apiError(503, 'このブラウザーではローカル保存を利用できません。IndexedDBを利用できる通常のブラウザーで開いてください。')); return; }
    let request, finished = false;
    const fail = error => { if (finished) return; finished = true; reject(storageError(error)); };
    try { request = factory.open(DATABASE_NAME, DATABASE_VERSION); }
    catch (error) { fail(error); return; }
    request.onupgradeneeded = () => {
      try {
        const db = request.result;
        if (!db.objectStoreNames.contains(PROJECT_STORE)) db.createObjectStore(PROJECT_STORE, { keyPath: 'id' });
      } catch (error) {
        try { request.transaction?.abort(); } catch { /* The request error below also rejects the open. */ }
        fail(error);
      }
    };
    request.onerror = () => fail(request.error);
    request.onblocked = () => fail(apiError(503, '別のQC Studio画面が保存領域を使用しています。ほかのタブを閉じ、この画面を再読み込みしてください。'));
    request.onsuccess = () => {
      const db = request.result;
      if (finished) { db.close(); return; }
      finished = true;
      databaseConnection = db;
      db.onversionchange = () => {
        db.close();
        if (databaseConnection === db) databaseConnection = null;
      };
      db.onclose = () => { if (databaseConnection === db) databaseConnection = null; };
      resolve(db);
    };
  });
  openingDatabase = pending;
  try { return await pending; }
  finally { if (openingDatabase === pending) openingDatabase = null; }
}

// The callback must schedule its requests synchronously. In particular, the
// revision read and following put/delete stay in ONE readwrite transaction.
// IndexedDB serializes overlapping write transactions, including other tabs.
async function transaction(mode, callback) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    let tx, output, failure = null;
    try { tx = db.transaction(PROJECT_STORE, mode); }
    catch (error) { reject(storageError(error)); return; }
    const fail = error => {
      failure ||= error?.status ? error : storageError(error);
      try { tx.abort(); }
      catch { reject(failure); }
    };
    tx.oncomplete = () => failure ? reject(failure) : resolve(output);
    tx.onabort = () => reject(failure || storageError(tx.error));
    tx.onerror = () => { failure ||= storageError(tx.error); };
    const watch = (request, success) => {
      request.onerror = () => fail(request.error);
      request.onsuccess = () => {
        try { success(request.result); }
        catch (error) { fail(error?.status ? error : error instanceof DOMException ? storageError(error) : apiError(400, error.message || '保存データの形式を確認してください。', error)); }
      };
      return request;
    };
    try { callback(tx.objectStore(PROJECT_STORE), { watch, result: value => { output = value; }, fail }); }
    catch (error) { fail(error); }
  });
}

function validId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) throw apiError(400, 'プロジェクトIDが不正です。');
  return value;
}

function requestBody(body) {
  let encoded;
  try { encoded = JSON.stringify(body); }
  catch { throw apiError(400, 'JSONの形式を確認してください。'); }
  if (typeof encoded !== 'string') throw apiError(400, 'JSON形式の入力が必要です。');
  if (new TextEncoder().encode(encoded).byteLength > BODY_LIMIT) throw apiError(413, '送信できるデータは4 MB以内です。長い記録を整理してから再度お試しください。');
  const input = JSON.parse(encoded);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw apiError(400, 'JSON形式のオブジェクトを指定してください。');
  return input;
}

function storedProject(raw, id) {
  if (!raw) throw apiError(404, 'プロジェクトが見つかりません。別のタブで削除された可能性があります。');
  try {
    const project = normalizeProject(raw);
    if (project.id !== id) throw new Error('IDが一致しません。');
    return project;
  } catch (error) { throw apiError(422, '保存データの形式を読み込めませんでした。元のデータは変更していません。JSONバックアップがある場合は新しい活動として読み込んでください。', error); }
}

async function listProjects() {
  return transaction('readonly', (store, { watch, result }) => {
    const projects = []; let skipped = 0;
    watch(store.openCursor(), cursor => {
      if (!cursor) {
        projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        result({ projects, ...(skipped ? { warning: `${skipped}件の保存データを読み込めませんでした。元のデータはブラウザー内に保持されています。` } : {}) });
        return;
      }
      try {
        const project = storedProject(cursor.value, cursor.key);
        projects.push({ id: project.id, title: project.meta.title, team: project.meta.team, updatedAt: project.updatedAt, isSample: project.isSample, revision: project.revision });
      } catch { skipped++; }
      cursor.continue();
    });
  });
}

async function readProject(id) {
  validId(id);
  return transaction('readonly', (store, { watch, result }) => {
    watch(store.get(id), raw => result(storedProject(raw, id)));
  });
}

async function insertProject(project) {
  return transaction('readwrite', (store, { watch, result }) => {
    // add() never overwrites an existing project, even if a generated ID collided.
    watch(store.add(project), () => result(project));
  });
}

async function updateProject(id, input) {
  validId(id);
  const project = normalizeProject(input.project);
  if (project.id !== id) throw apiError(400, '保存先とプロジェクトIDが一致しません。');
  return transaction('readwrite', (store, { watch, result }) => {
    watch(store.get(id), raw => {
      const stored = storedProject(raw, id);
      if (project.revision !== stored.revision) throw apiError(409, CONFLICT);
      if (!Number.isSafeInteger(stored.revision + 1)) throw apiError(409, '保存バージョンの上限に達しました。JSONでバックアップし、新しい活動として読み込んでください。');
      project.revision = stored.revision + 1;
      project.createdAt = stored.createdAt;
      project.updatedAt = new Date().toISOString();
      // Editing the title or omitting a flag must not relabel fictional data.
      project.isSample = stored.isSample || project.isSample;
      const sampleIds = new Set(stored.tools.filter(tool => tool.isSample).map(tool => tool.id));
      project.tools.forEach(tool => { if (sampleIds.has(tool.id)) tool.isSample = true; });
      watch(store.put(project), () => result(project));
    });
  });
}

async function deleteProject(id, input) {
  validId(id);
  const revision = input.revision ?? input.project?.revision;
  if (!Number.isSafeInteger(revision) || revision < 1) throw apiError(400, '削除する活動の保存バージョンを指定してください。');
  if (input.project?.id !== undefined && input.project.id !== id) throw apiError(400, '削除先とプロジェクトIDが一致しません。');
  return transaction('readwrite', (store, { watch, result }) => {
    watch(store.get(id), raw => {
      const project = storedProject(raw, id);
      if (project.revision !== revision) throw apiError(409, CONFLICT);
      watch(store.delete(id), () => result({ deleted: true, id }));
    });
  });
}

function fileName(project, format) {
  // Count Unicode characters rather than UTF-16 halves so emoji at the limit
  // cannot break encodeURIComponent(). Replace malformed lone surrogates too.
  const title = Array.from((project.meta.title || 'QC活動資料').replace(/[\x00-\x1f\x7f\\/:*?"<>|]/g, '_').trim())
    .slice(0, 70)
    .map(character => character.length === 1 && /[\ud800-\udfff]/.test(character) ? '_' : character)
    .join('') || 'QC活動資料';
  return `${project.isSample ? 'サンプル_' : ''}${title}${format === 'json' ? '_バックアップ' : ''}.${format}`;
}

function attachment(blob, project, format) {
  const mime = { json: 'application/json; charset=utf-8', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }[format];
  return new Response(blob, {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Content-Disposition': `attachment; filename="QC-report.${format}"; filename*=UTF-8''${encodeURIComponent(fileName(project, format))}`,
      'Content-Length': String(blob.size),
      'Cache-Control': 'no-store',
    },
  });
}

async function exportProject(input) {
  if (!['pptx', 'xlsx', 'json'].includes(input.format)) throw apiError(400, '出力形式はPowerPoint・Excel・JSONのいずれかを選んでください。');
  const format = input.format, project = normalizeProject(input.project);
  if (format === 'json') return attachment(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json;charset=utf-8' }), project, format);
  const analysis = analyzeProject(project);
  const invalid = analysis.measurementErrors.find(error => error.kind === 'invalid');
  if (invalid) throw apiError(400, `測定データの${invalid.index + 1}行目を確認してください。${invalid.message}`);
  const included = new Set(project.tools.filter(tool => tool.included).map(tool => tool.id));
  const invalidTool = analysis.tools.find(result => included.has(result.id) && !result.valid);
  if (invalidTool) throw apiError(400, `「${invalidTool.title}」を確認してください。${invalidTool.errors[0]} 下書きの道具は「資料に含める」を外せます。`);
  if (activeExport) throw apiError(409, '別の資料を出力中です。完了後にもう一度お試しください。');
  activeExport = true;
  try {
    const { createOfficeBlob } = await import('./browser-exports.mjs');
    const blob = await createOfficeBlob({ project, analysis, format });
    if (!(blob instanceof Blob) || blob.size === 0) throw apiError(500, '資料の作成結果を読み込めませんでした。もう一度出力してください。');
    return attachment(blob, project, format);
  } catch (error) {
    if (error?.status) throw error;
    throw apiError(500, `資料の作成に失敗しました。${error?.message || '画面を再読み込みしてからお試しください。'} 入力内容はJSONでバックアップできます。`, error);
  } finally { activeExport = false; }
}

/**
 * Local API replacement. No project content is transmitted over the network.
 * Errors have a numeric .status and Japanese .message, matching app.js's api().
 * DELETE /api/projects/:id requires {revision} or {project:{id?, revision}}.
 */
export async function browserApi(url, { method = 'GET', body, binary = false } = {}) {
  try {
    if (typeof url !== 'string') throw apiError(400, '操作先の形式が不正です。');
    let parsed;
    try { parsed = new URL(url, 'https://qc-studio.invalid'); }
    catch { throw apiError(400, '操作先の形式が不正です。'); }
    if (parsed.origin !== 'https://qc-studio.invalid') throw apiError(400, 'ブラウザー内のQC Studio操作だけを利用できます。');
    let route;
    try { route = decodeURIComponent(parsed.pathname); }
    catch { throw apiError(400, '操作先の文字コードが不正です。'); }
    method = String(method).toUpperCase();
    const input = body === undefined ? null : requestBody(body);
    let output;
    if (method === 'GET' && route === '/api/bootstrap') {
      checkBrowserFeatures();
      output = { csrfToken: 'browser-local', steps: STEPS, toolCatalog: TOOL_CATALOG, version: '1.2.0-web', storage: 'indexeddb' };
    } else if (method === 'GET' && route === '/api/health') {
      output = { ok: true, app: 'qc-studio', storage: 'indexeddb' };
    } else if (method === 'GET' && route === '/api/projects') {
      output = await listProjects();
    } else if (method === 'POST' && route === '/api/projects') {
      if (!input || !['blank', 'sample'].includes(input.source)) throw apiError(400, '新規作成の種類が不正です。');
      const project = await insertProject(input.source === 'sample' ? createSampleProject() : createBlankProject());
      output = { project, analysis: analyzeProject(project) };
    } else if (method === 'POST' && route === '/api/projects/import') {
      if (input?.project?.schemaVersion !== 1 || !input.project.meta || !input.project.theme) throw apiError(400, 'QC Studioから保存したJSONファイルを選んでください。');
      const project = normalizeProject(input.project);
      project.id = createBlankProject().id;
      project.revision = 1;
      project.createdAt = project.updatedAt = new Date().toISOString();
      await insertProject(project);
      output = { project, analysis: analyzeProject(project) };
    } else if (method === 'POST' && route === '/api/analyze') {
      if (!input?.project) throw apiError(400, '解析する活動データが必要です。');
      output = { analysis: analyzeProject(normalizeProject(input.project)) };
    } else if (method === 'POST' && route === '/api/tools/create') {
      if (!input || input.sample !== undefined && typeof input.sample !== 'boolean') throw apiError(400, 'サンプル区分が不正です。');
      const tool = createTool(input.kind, { sample: input.sample ?? false });
      output = { tool, analysis: analyzeTool(tool) };
    } else if (method === 'POST' && route === '/api/exports') {
      if (!input) throw apiError(400, '出力する活動データが必要です。');
      output = await exportProject(input);
    } else {
      const match = route.match(/^\/api\/projects\/([^/]+)$/);
      if (!match) throw apiError(404, '対象の操作が見つかりません。');
      const id = validId(match[1]);
      if (method === 'GET') { const project = await readProject(id); output = { project, analysis: analyzeProject(project) }; }
      else if (method === 'PUT') {
        if (!input?.project) throw apiError(400, '保存する活動データが必要です。');
        const project = await updateProject(id, input); output = { project, analysis: analyzeProject(project) };
      } else if (method === 'DELETE') output = await deleteProject(id, input || {});
      else throw apiError(405, 'この操作方法には対応していません。');
    }
    if (output instanceof Response) {
      if (!binary && output.headers.get('Content-Type')?.startsWith('application/json')) return output.json();
      return output;
    }
    const payload = structuredClone(output);
    return binary ? Response.json(payload) : payload;
  } catch (error) {
    if (error?.status) throw error;
    throw apiError(400, error?.message || '入力内容を確認してください。', error);
  }
}
